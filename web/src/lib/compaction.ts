import { compactionCut, isCompaction, isCompactor, messageCount, type Brain, type Conversation, type CutMoved, type LedgerMessage } from "../api/types.ts";

/**
 * T20 frontend: what the browser says about compaction, from the server's own rule (`compactionCut`, `isCompaction`,
 * `messageCount` in src/conversations/compaction.ts). DOM-free, so test/web-api.test.ts checks `compactOffer` against
 * the server's planner (planCompact) on the same ledgers.
 */

type Ledger = Pick<Conversation, "brains" | "messages">;

const authorOf = (m: LedgerMessage) => (m.author.type === "brain" ? m.author.brainId : null);

/**
 * Where the scrollback folds: `at`, the newest compaction's index (-1: none, nothing folds), and `pinnedAbove`, how
 * many of the messages before it are pinned to a brain (they still reach that brain, right after the setup).
 */
export function cutView(conv: Ledger): { at: number; pinnedAbove: number } {
  const at = compactionCut(conv, conv.messages);
  if (at <= 0) return { at, pinnedAbove: 0 };
  const above = new Set(conv.messages.slice(0, at).map((m) => m.id));
  const pinned = new Set<string>();
  for (const b of conv.brains) for (const p of b.pins) if (above.has(p.messageId)) pinned.add(p.messageId);
  return { at, pinnedAbove: pinned.size };
}

/**
 * The messages a compaction at `index` stands for: every message before it, compactions not counted (what its
 * brain's {{count}} was sent as, when it was written through the message right before it).
 */
export const storyCount = (conv: Ledger, index: number) => messageCount(conv, conv.messages.slice(0, index));

/**
 * What "Compact through here" on a message does with a compaction brain (`brainId`; default: the only one), by the
 * server's rule (planCompact), so the menu can say it before you send:
 *   none        no brain here writes compactions (offer the preset's, or the setting)
 *   pick        several do: say which (`brains`)
 *   compaction  the message is a compaction itself: nothing new to compact through it
 *   above       it is above the newest compaction (`newest`), which covers it: refused
 *   version     it is right before this brain's newest compaction (`compaction`): that compaction gets version `version`
 *   new         a new compaction goes in right after it, standing for `count` messages; `after` stay as they are below it
 */
export type CompactOffer =
  | { kind: "none" }
  | { kind: "pick"; brains: Brain[] }
  | { kind: "compaction" }
  | { kind: "above"; brain: Brain; newest: string }
  | { kind: "version"; brain: Brain; compaction: string; version: number; count: number }
  | { kind: "new"; brain: Brain; count: number; after: number };

export function compactOffer(conv: Ledger, messageId: string, brainId?: string): CompactOffer {
  const compactors = conv.brains.filter(isCompactor);
  if (compactors.length === 0) return { kind: "none" };
  const brain = brainId ? compactors.find((b) => b.id === brainId) : compactors.length === 1 ? compactors[0] : undefined;
  if (!brain) return { kind: "pick", brains: compactors };
  const at = conv.messages.findIndex((m) => m.id === messageId);
  const through = conv.messages[at];
  if (!through || isCompaction(conv, through)) return { kind: "compaction" };
  const cut = compactionCut(conv, conv.messages);
  const count = messageCount(conv, conv.messages.slice(0, at + 1));
  if (cut > at) {
    const newest = conv.messages[cut]!;
    if (cut === at + 1 && authorOf(newest) === brain.id) return { kind: "version", brain, compaction: newest.id, version: newest.versions.length + 1, count };
    return { kind: "above", brain, newest: newest.id };
  }
  return { kind: "new", brain, count, after: conv.messages.length - (at + 1) };
}

const nameOf = (conv: Ledger, m: LedgerMessage | undefined) => {
  const id = m && authorOf(m);
  return (id && conv.brains.find((b) => b.id === id)?.name) || "the";
};

/**
 * A command moved where every request starts (`cutMoved`: a delete, Said by…, words in a compaction brain's mouth, the
 * setting switched): the browser's words for it. The CLI's `cutMovedLine` names message ids; here the fold shows where.
 * `fresh`: the message as the command saved it, when it is the new compaction (its author may have just changed).
 */
export function cutMovedWords(moved: CutMoved, conv: Ledger, fresh?: LedgerMessage): string {
  if (moved.to === null) return "No compaction is left, so every brain's request holds the whole story again.";
  const m = fresh?.id === moved.to ? fresh : conv.messages.find((x) => x.id === moved.to);
  const who = nameOf(conv, m);
  const n = moved.before;
  return `Every brain's request now starts at ${who === "the" ? "the" : `${who}'s`} compaction${
    n ? `: the ${n === 1 ? "message" : `${n} messages`} before it ${n === 1 ? "is" : "are"} left out of requests (still here, folded above it).` : "."
  }`;
}
