import { CommandError, conflict, notFound, toErrorBody, type ErrorBody } from "../lib/errors.ts";
import { nowIso } from "../lib/ids.ts";
import type { StreamEvent } from "../registry.ts";
import { listFiles, readJson, removeFile, writeJson, type Vault } from "../storage/vault.ts";
import type { UnreadableConversation } from "./format.ts";
import type { Conversation } from "./types.ts";

/**
 * Conversation files, through the vault (so they are ciphertext for encrypted users). There is no cache:
 * every command reads from disk, and every change is a read-modify-write under a per-conversation queue, so
 * a rename during a streaming reply can't be overwritten by the reply's save.
 */

export const CONVERSATION_ID_RE = /^c_[a-z0-9]{4,32}$/;

const fileOf = (id: string) => `conversations/${id}.json`;
const keyOf = (vault: Vault, id: string) => `${vault.dir}\0${id}`;

export async function loadConversation(vault: Vault, id: string): Promise<Conversation> {
  const conv = await readJson<Conversation>(vault, fileOf(id));
  if (!conv) throw notFound(`No conversation ${id}. List yours with ./ss conversation.list.`);
  return conv;
}

/**
 * Every readable conversation, newest first, plus the files that aren't (T02 QA-4). One bad file (hand-edited
 * JSON, a file copied in from another user, a partial document) must not hide the rest. Error texts are ours
 * (vault.ts never quotes content), so they are safe to show. A closed vault still fails the whole list.
 */
export async function listConversations(vault: Vault): Promise<{ conversations: Conversation[]; unreadable: UnreadableConversation[] }> {
  const ids = (await listFiles(vault, "conversations")).filter((n) => /^c_[a-z0-9]+\.json$/.test(n)).map((n) => n.slice(0, -5));
  const results = await Promise.allSettled(ids.map(async (id) => checkShape(id, await loadConversation(vault, id))));
  const conversations: Conversation[] = [];
  const unreadable: UnreadableConversation[] = [];
  for (const [i, r] of results.entries()) {
    const id = ids[i]!;
    if (r.status === "fulfilled") conversations.push(r.value);
    else if (r.reason instanceof CommandError && r.reason.code === "not_found") continue; // deleted while we listed
    else if (r.reason instanceof CommandError) throw r.reason; // session_ended and the like
    else unreadable.push({ id, error: String((r.reason as Error)?.message ?? r.reason).replace(`${fileOf(id)}: `, "") });
  }
  conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { conversations, unreadable };
}

/** Just enough shape for a list row, so a partial document is reported instead of crashing the list. */
function checkShape(id: string, c: Conversation): Conversation {
  const ok =
    typeof c === "object" && c !== null &&
    typeof c.title === "string" && typeof c.updatedAt === "string" && typeof c.settings?.textModel === "string" &&
    Array.isArray(c.messages) && c.messages.every((m) => Array.isArray(m?.versions));
  if (!ok) throw new Error(`${fileOf(id)}: not a conversation document (fields are missing)`);
  return c;
}

export async function createConversationFile(vault: Vault, conv: Conversation): Promise<void> {
  await serialize(keyOf(vault, conv.id), () => writeJson(vault, fileOf(conv.id), conv));
}

/**
 * Load the latest copy, let `fn` change it, bump updatedAt and save. If `fn` throws, nothing is saved.
 * All writes to one conversation go through here (or createConversationFile), one at a time.
 */
export async function mutateConversation<T>(
  vault: Vault,
  id: string,
  fn: (conv: Conversation) => T | Promise<T>,
): Promise<{ conv: Conversation; result: T }> {
  return serialize(keyOf(vault, id), async () => {
    const conv = await loadConversation(vault, id);
    const result = await fn(conv);
    conv.updatedAt = nowIso();
    await writeJson(vault, fileOf(id), conv);
    return { conv, result };
  });
}

export async function deleteConversationFile(vault: Vault, id: string): Promise<void> {
  if (generations.has(keyOf(vault, id))) throw busy(id);
  await serialize(keyOf(vault, id), async () => {
    await loadConversation(vault, id); // 404 if it isn't there
    await removeFile(vault, fileOf(id));
  });
}

// One queue per conversation: each job starts after the previous one settles.
const queues = new Map<string, Promise<unknown>>();

async function serialize<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(job, job);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  try {
    return await run;
  } finally {
    if (queues.get(key) === tail) queues.delete(key);
  }
}

/**
 * One generation at a time per conversation (design.md: a second turn or regenerate is a 409).
 * The AbortController is there for a future generation.stop (T03); release() also aborts any upstream
 * request still open, so a failed turn never leaves a Venice connection behind.
 *
 * A generation also keeps, in memory only, the events it has streamed so far, so generation.follow can
 * re-attach to it: a reloaded browser tab, or a second terminal (T02 frontend). Consecutive text deltas are
 * merged, so a late follower gets the reply so far in a few events and then the rest live.
 */
type Generation = { controller: AbortController; startedAt: string; live: Live };
type Follower = { queue: StreamEvent[]; wake?: () => void };
type Live = {
  log: StreamEvent[];
  followers: Set<Follower>;
  ended: boolean;
  failure?: { status: number; body: ErrorBody };
};
const generations = new Map<string, Generation>();

const busy = (id: string) =>
  conflict(`Conversation ${id} is busy: a reply is still being generated. Wait for it to finish, then try again.`);

const MERGEABLE = new Set(["reasoning", "delta", "tool_args"]);

export type GenerationHandle = {
  signal: AbortSignal;
  /** Pass the generation's events through, recording them for followers (generation.follow). */
  relay(events: AsyncIterable<StreamEvent>): AsyncGenerator<StreamEvent, void, undefined>;
  release(): void;
};

export function beginGeneration(vault: Vault, id: string): GenerationHandle {
  const key = keyOf(vault, id);
  if (generations.has(key)) throw busy(id);
  const live: Live = { log: [], followers: new Set(), ended: false };
  const gen: Generation = { controller: new AbortController(), startedAt: nowIso(), live };
  generations.set(key, gen);

  const publish = (ev: StreamEvent) => {
    const last = live.log.at(-1);
    if (last && last.type === ev.type && MERGEABLE.has(ev.type)) {
      live.log[live.log.length - 1] = { type: ev.type, delta: String(last.delta) + String(ev.delta) };
    } else {
      live.log.push(ev);
    }
    for (const f of live.followers) {
      f.queue.push(ev);
      f.wake?.();
    }
  };
  const end = (failure?: { status: number; body: ErrorBody }) => {
    if (live.ended) return;
    live.ended = true;
    if (failure) live.failure = failure;
    for (const f of live.followers) f.wake?.();
  };

  return {
    signal: gen.controller.signal,
    async *relay(events) {
      try {
        for await (const ev of events) {
          publish(ev);
          yield ev;
        }
        end();
      } catch (err) {
        end(toErrorBody(err)); // followers get the same error the caller does
        throw err;
      }
    },
    release() {
      end({ status: 500, body: { code: "internal", message: "The reply ended unexpectedly. Check what was saved." } });
      if (generations.get(key) === gen) generations.delete(key);
      gen.controller.abort();
    },
  };
}

/**
 * The running generation's events: first `{type: "following", startedAt}`, then what has streamed so far
 * (merged), then the rest as it arrives, ending with its `done`, or throwing its error. Null when nothing
 * is being generated for this conversation.
 */
export function followGeneration(vault: Vault, id: string): AsyncGenerator<StreamEvent, void, undefined> | null {
  const gen = generations.get(keyOf(vault, id));
  return gen ? follow(gen) : null;
}

async function* follow(gen: Generation): AsyncGenerator<StreamEvent, void, undefined> {
  const live = gen.live;
  const me: Follower = { queue: [...live.log] };
  live.followers.add(me);
  try {
    yield { type: "following", startedAt: gen.startedAt };
    for (;;) {
      while (me.queue.length) yield me.queue.shift()!;
      if (live.ended) break;
      await new Promise<void>((resolve) => (me.wake = resolve));
      me.wake = undefined;
    }
  } finally {
    live.followers.delete(me);
  }
  const f = live.failure;
  if (f) throw new CommandError(f.status, f.body.code, f.body.message, f.body.details);
}

export function isGenerating(vault: Vault, id: string): boolean {
  return generations.has(keyOf(vault, id));
}
