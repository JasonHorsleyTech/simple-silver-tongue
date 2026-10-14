import { conflict, notFound } from "../lib/errors.ts";
import { nowIso } from "../lib/ids.ts";
import { listFiles, readJson, removeFile, writeJson, type Vault } from "../storage/vault.ts";
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

export async function listConversations(vault: Vault): Promise<Conversation[]> {
  const names = (await listFiles(vault, "conversations")).filter((n) => /^c_[a-z0-9]+\.json$/.test(n));
  const convs = await Promise.all(names.map((n) => loadConversation(vault, n.slice(0, -5))));
  return convs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
 */
type Generation = { controller: AbortController; startedAt: string };
const generations = new Map<string, Generation>();

const busy = (id: string) =>
  conflict(`Conversation ${id} is busy: a reply is still being generated. Wait for it to finish, then try again.`);

export function beginGeneration(vault: Vault, id: string): { signal: AbortSignal; release(): void } {
  const key = keyOf(vault, id);
  if (generations.has(key)) throw busy(id);
  const gen: Generation = { controller: new AbortController(), startedAt: nowIso() };
  generations.set(key, gen);
  return {
    signal: gen.controller.signal,
    release() {
      if (generations.get(key) === gen) generations.delete(key);
      gen.controller.abort();
    },
  };
}

export function isGenerating(vault: Vault, id: string): boolean {
  return generations.has(keyOf(vault, id));
}
