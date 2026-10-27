import type { Brain, Conversation, LedgerMessage } from "./types.ts";

/**
 * T20, compaction (design.md, "Compaction"). A brain with `compacts` writes compactions: every request, for every
 * brain, takes the ledger from the newest compaction on, that message included (the cut). The messages before it
 * stay in the ledger, to read, edit or bring back by deleting the compaction; they are only left out of requests.
 * Pins are untouched: a message before the cut that is pinned to a brain still reaches that brain, with the setup.
 * Nothing here knows what a summary is. Dependency-free, so the browser finds the cut with the same rule.
 */

/** Whether this brain's messages are compactions: the setting is on, and it is a text brain. */
export const isCompactor = (brain: Pick<Brain, "compacts" | "kind">): boolean => brain.compacts === true && brain.kind === "text";

/** Whether this message is a compaction: a text message by a brain whose messages are compactions. */
export function isCompaction(conv: Pick<Conversation, "brains">, m: Pick<LedgerMessage, "author" | "kind">): boolean {
  if (m.kind !== "text" || m.author.type !== "brain") return false;
  const id = m.author.brainId;
  const brain = conv.brains.find((b) => b.id === id);
  return brain !== undefined && isCompactor(brain);
}

/**
 * Where requests start: the index of the newest compaction in `messages` (the conversation's ledger, or the part of it a
 * request holds), or -1 when there is none. Everything before it is left out of every request.
 */
export function compactionCut(conv: Pick<Conversation, "brains">, messages: ReadonlyArray<Pick<LedgerMessage, "author" | "kind">>): number {
  for (let i = messages.length - 1; i >= 0; i--) if (isCompaction(conv, messages[i]!)) return i;
  return -1;
}

/**
 * The number a final reminder's {{count}} is sent as: the messages from the start of the conversation through the last
 * one this request holds, compactions not counted. So a first compaction through message 42 reads 42, and a second one,
 * 20 messages later, reads 62: the whole story it now stands for, which a model would miscount.
 */
export function messageCount(conv: Pick<Conversation, "brains">, messages: ReadonlyArray<Pick<LedgerMessage, "author" | "kind">>): number {
  let n = 0;
  for (const m of messages) if (!isCompaction(conv, m)) n++;
  return n;
}

/** The placeholder a final reminder may hold (T20): the app writes the number in, every time, and the preview shows it. */
export const COUNT_PLACEHOLDER = "{{count}}";
