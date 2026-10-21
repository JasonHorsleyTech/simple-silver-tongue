import { CommandError, conflict, imageBusy, isUnreadable, notFound, toErrorBody, unreadableFile, type ErrorBody } from "../lib/errors.ts";
import { nowIso } from "../lib/ids.ts";
import type { StreamEvent } from "../registry.ts";
import { listFiles, readJson, removeFile, writeJson, type Vault } from "../storage/vault.ts";
import type { UnreadableConversation } from "./format.ts";
import { upgradeConversation } from "./defaults.ts";
import { allPaintJobs, paintingIn, settleStaleImages } from "./images.ts";
import type { Brain, Conversation, LedgerMessage } from "./types.ts";

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
  if (!conv) throw notFound(`No conversation ${id}. List yours with ./sst conversation.list.`);
  // A copy of another conversation's file under this name would list twice and take this one's writes (T06 QA-4).
  if (conv.id !== id) throw unreadableFile(fileOf(id), `holds ${typeof conv.id === "string" ? `conversation ${conv.id}` : "no conversation id"}, not ${id} (a copy of another file?), so it isn't used`);
  upgradeConversation(conv); // older files (T07 triage: brains without stop sequences)
  await settleStaleImages(vault, conv); // a pending image no job owns is settled here, never left pending (T05)
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
    else if (r.reason instanceof CommandError && !isUnreadable(r.reason)) throw r.reason; // session_ended and the like
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
  if (!ok) throw unreadableFile(fileOf(id), "not a conversation document (fields are missing)");
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

/** Delete the document and return what it was, so the caller can remove its image files too. */
export async function deleteConversationFile(vault: Vault, id: string): Promise<Conversation> {
  return serialize(keyOf(vault, id), async () => {
    if (generations.has(keyOf(vault, id))) throw busy(id); // checked inside the queue, like assertLedgerIdle
    const images = paintingIn(vault, id).length; // their jobs would find nothing to save into (T05 triage)
    if (images) {
      throw imageBusy(`Conversation ${id} still has ${images === 1 ? "an image" : `${images} images`} being made. Venice is already making (and billing) ${images === 1 ? "it" : "them"}; wait a moment, then delete it.`);
    }
    const conv = await loadConversation(vault, id); // 404 if it isn't there
    await removeFile(vault, fileOf(id));
    return conv;
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
 * generation.stop aborts `stop` with a "stopped" reason (stopGeneration). That never cancels the Venice
 * request: Venice finishes and bills a stopped reply anyway (T03 QA-2), so the generation hands the rest of
 * the stream to a drain that records its cost (keepUpstream). release() aborts any Venice request the
 * generation still owns, so a failed turn never leaves a connection behind.
 *
 * A generation also keeps, in memory only, the events it has streamed so far, so generation.follow can
 * re-attach to it: a reloaded browser tab, or a second terminal (T02 frontend). Consecutive text deltas are
 * merged, so a late follower gets the reply so far in a few events and then the rest live.
 */
type Generation = {
  stop: AbortController;
  startedAt: string;
  live: Live;
  settled: Promise<void>;
  /** The brain writing the reply, once the generation has planned it (forBrain). Unknown until then. */
  brainId?: string;
};
type Follower = { queue: StreamEvent[]; wake?: () => void };
type Live = {
  log: StreamEvent[];
  followers: Set<Follower>;
  ended: boolean;
  failure?: { status: number; body: ErrorBody };
  /** Resolves `settled` once the generation has ended (done or error). */
  settle(): void;
};
const generations = new Map<string, Generation>();

const busy = (id: string) =>
  conflict(`Conversation ${id} is busy: a reply is still being generated. Wait for it to finish, then try again.`);

const MERGEABLE = new Set(["reasoning", "delta", "prompt"]);

export type GenerationHandle = {
  /**
   * The generation's one read of the conversation, through its write queue (T03 QA-1). An edit or delete
   * that passed its idle check just before the lock was taken has finished writing by the time this
   * resolves, and every later one sees the lock and gets a 409. So the reply never answers a stale ledger.
   */
  load(): Promise<Conversation>;
  /** Aborted by generation.stop, with a "stopped" CommandError as the reason. It doesn't touch the Venice request. */
  stopSignal: AbortSignal;
  /** For the Venice request. Aborted by release(), unless keepUpstream() handed the request to a drain. */
  upstreamSignal: AbortSignal;
  keepUpstream(): void;
  /**
   * Pass the generation's events through, recording them for followers (generation.follow), and return what
   * `events` returns (an image brain's turn hands back the image it started, to follow after the lock is free).
   */
  relay<R>(events: AsyncGenerator<StreamEvent, R, undefined>): AsyncGenerator<StreamEvent, R, undefined>;
  /**
   * Record an event for followers only: the caller yields it itself, after release(). An image brain's turn
   * announces its image_pending so, and the lock is free by the time its own client hears of the image (T05 triage).
   */
  announce(ev: StreamEvent): void;
  /**
   * Say which brain is writing, right after planning (T04). Until then a brain delete or kind change is refused
   * for every brain (assertBrainIdle), since the generation may be about to answer as any of them.
   */
  forBrain(brainId: string): void;
  release(): void;
};

export function beginGeneration(vault: Vault, id: string): GenerationHandle {
  const key = keyOf(vault, id);
  assertAcceptingWork();
  if (generations.has(key)) throw busy(id);
  let settle = () => {};
  const settled = new Promise<void>((resolve) => (settle = resolve));
  const live: Live = { log: [], followers: new Set(), ended: false, settle };
  const gen: Generation = { stop: new AbortController(), startedAt: nowIso(), live, settled };
  const upstream = new AbortController();
  let keepUpstream = false;
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
    live.settle();
  };

  return {
    load: () => serialize(key, () => loadConversation(vault, id)),
    stopSignal: gen.stop.signal,
    upstreamSignal: upstream.signal,
    keepUpstream() {
      keepUpstream = true;
    },
    async *relay(events) {
      let finished = false;
      try {
        for (;;) {
          const r = await events.next();
          if (r.done) {
            finished = true;
            end();
            return r.value;
          }
          publish(r.value);
          yield r.value;
        }
      } catch (err) {
        finished = true;
        end(toErrorBody(err)); // followers get the same error the caller does
        throw err;
      } finally {
        if (!finished) await events.return(undefined as never); // closed early by the caller: close `events` too
      }
    },
    forBrain(brainId) {
      gen.brainId = brainId;
    },
    announce: publish,
    release() {
      end({ status: 500, body: { code: "internal", message: "The reply ended unexpectedly. Check what was saved." } });
      if (generations.get(key) === gen) generations.delete(key);
      gen.stop.abort();
      if (!keepUpstream) upstream.abort();
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

/** The conversations of the user whose folder is `dir` with a reply being written right now (user.delete). */
export function generatingFor(dir: string): string[] {
  const prefix = `${dir}\0`;
  return [...generations.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
}

/**
 * Ledger edits (edit, delete, select-version) wait for no one: while a reply is being generated they are
 * refused, because that reply answers the ledger as it was sent, and its save expects that ledger to be there.
 * Call it inside mutateConversation: the check then runs in the conversation's queue, and a generation reads
 * through that same queue (GenerationHandle.load), so an edit can't slip in between the lock and the read.
 */
export function assertLedgerIdle(vault: Vault, id: string): void {
  if (isGenerating(vault, id)) {
    throw conflict(
      `Conversation ${id} is busy: a reply is being generated from the messages as they are now. Wait for it to finish, or stop it, then change the messages.`,
    );
  }
}

/**
 * A brain can't be deleted, or change kind, while it is writing a reply: the reply isn't in the ledger yet,
 * so the ledger check alone would let it through, and the save would then add a message by a brain that is
 * gone (or of the wrong kind). Before the generation has said which brain it is (forBrain), every brain counts
 * as busy. Call it inside mutateConversation, like assertLedgerIdle (design.md, "The lock and the read must agree").
 */
export function assertBrainIdle(vault: Vault, id: string, brain: { id: string; name: string }, doing: string): void {
  const gen = generations.get(keyOf(vault, id));
  if (!gen || (gen.brainId !== undefined && gen.brainId !== brain.id)) return;
  const who = gen.brainId === brain.id ? `${brain.name} is writing a reply right now` : "a reply is just starting";
  throw conflict(`Can't ${doing} ${brain.name}: ${who}. Wait for it to finish, or stop it, then try again.`);
}

/**
 * What generation.stop reports: whether anything was running, what the stopped generation saved, and a note
 * on the bill (a stop saves waiting, not money), so the CLI and the browser say the same thing.
 */
export type StopOutcome = {
  stopped: boolean;
  message: LedgerMessage | null;
  error?: ErrorBody;
  note?: string;
  /**
   * T05 triage: the conversation's images still being made. A stop doesn't touch them: once a prompt is saved
   * its image is with Venice, being made and billed, so it is kept when it arrives (IMAGE_STOP_NOTE).
   */
  painting?: Array<{ messageId: string; imageId: string }>;
  /** T16: the brain the stopped reply made, when its brain makes brains (a stopped reply is a new message too). */
  made?: Brain;
};

/**
 * Stop the running generation (generation.stop) and wait until it has settled, so its partial reply is
 * saved by the time this returns. relayReply sees the stop, stops relaying and returns what had arrived
 * with `stopped: true`; the rest of the Venice stream goes to a drain. Null when nothing is being generated.
 */
export async function stopGeneration(vault: Vault, id: string, waitMs = 10_000): Promise<StopOutcome | null> {
  const gen = generations.get(keyOf(vault, id));
  if (!gen) return null;
  gen.stop.abort(new CommandError(499, "stopped", "Stopped."));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([gen.settled, new Promise<void>((resolve) => (timer = setTimeout(resolve, waitMs)))]);
  clearTimeout(timer);
  // The newest saved message the generation reported: its done, or (an image brain's, whose generation ends
  // once the prompt is saved) the message its image_pending carried.
  const last = gen.live.log.findLast((ev) => ev.type === "done" || ev.type.startsWith("image_"));
  const outcome: StopOutcome = { stopped: true, message: (last?.message as LedgerMessage | null | undefined) ?? null };
  const made = gen.live.log.find((ev) => ev.type === "brain_made");
  if (made) outcome.made = made.brain as Brain;
  if (gen.live.failure) outcome.error = gen.live.failure.body;
  else if (!gen.live.ended) {
    outcome.error = { code: "still_saving", message: `The reply was stopped but hadn't finished saving after ${Math.round(waitMs / 1000)} s. Check what was saved with conversation.get.` };
  }
  return outcome;
}

/** The images of a conversation being made right now, as StopOutcome lists them. */
export function paintingNow(vault: Vault, id: string): StopOutcome["painting"] {
  const jobs = paintingIn(vault, id);
  return jobs.length ? jobs.map((j) => ({ messageId: j.messageId, imageId: j.imageId })) : undefined;
}

/**
 * Graceful shutdown (T05 QA-1). `npm run up` / `down` restart the server with SIGTERM; a reply or an image in
 * flight then would be lost, though Venice bills it. So the server stops taking new work (stopTakingWork: a
 * 503 for a new turn, regenerate, edit, add or retry), then waits for what is running (finishInFlight).
 */
let closing = false;

export function stopTakingWork(): void {
  closing = true;
}

export function assertAcceptingWork(): void {
  if (closing) throw new CommandError(503, "shutting_down", "The server is restarting. Try again in a moment, once it is back up.");
}

/**
 * Wait, up to `ms`, for every generation and every image being made. An image turn's image starts as its
 * generation ends, so it looks again until both are empty. Returns how many were still running at the deadline.
 */
export async function finishInFlight(ms: number, onWait?: (n: number) => void): Promise<number> {
  const deadline = Date.now() + ms;
  let told = -1;
  for (;;) {
    const work = [...[...generations.values()].map((g) => g.settled), ...allPaintJobs().map((j) => j.settled)];
    if (!work.length) return 0;
    const left = deadline - Date.now();
    if (left <= 0) return work.length;
    if (work.length !== told) onWait?.((told = work.length));
    await Promise.race([Promise.allSettled(work), new Promise((r) => setTimeout(r, Math.min(left, 200)))]);
  }
}
