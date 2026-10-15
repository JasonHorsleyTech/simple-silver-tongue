import type { Brain, Conversation } from "../api/types.ts";

/**
 * T16: the composer's one row of brain buttons, with a dozen brains or more (one per character). DOM-free, so
 * test/web-api.test.ts checks it.
 */

/**
 * How recently each brain took part: the ledger index of its newest message, or of the message it was made from (a
 * brain just made counts as just now), whichever is later. -1 for a brain that never did either.
 */
export function brainActivity(conv: Pick<Conversation, "brains" | "messages">): Map<string, number> {
  const at = new Map<string, number>();
  const index = new Map<string, number>();
  conv.messages.forEach((m, i) => {
    index.set(m.id, i);
    if (m.author.type === "brain") at.set(m.author.brainId, i);
  });
  const out = new Map<string, number>();
  for (const b of conv.brains) {
    const made = b.madeFrom !== undefined ? (index.get(b.madeFrom) ?? -1) : -1;
    out.set(b.id, Math.max(at.get(b.id) ?? -1, made));
  }
  return out;
}

/**
 * Which of a row's chips to show when they don't all fit in `room` px: the most recently active first (`activity`,
 * ties by their order), as many as fit beside a "+N" button `more` px wide. Returns the indices shown, in row
 * order, so the chips keep their places. All of them when they fit without the "+N".
 */
export function fitRow(widths: number[], activity: number[], room: number, gap: number, more: number): number[] {
  const all = widths.map((_, i) => i);
  if (sum(widths) + gap * Math.max(0, widths.length - 1) <= room) return all;
  const byRecent = [...all].sort((a, b) => activity[b]! - activity[a]! || a - b);
  const shown: number[] = [];
  let used = more;
  for (const i of byRecent) {
    const next = used + gap + widths[i]!;
    if (next > room) break;
    used = next;
    shown.push(i);
  }
  return shown.sort((a, b) => a - b);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** The brain made from a message, if it is still here (T16): its card links back, its message says so. */
export function madeFromIndex(brains: ReadonlyArray<Brain>): Map<string, Brain> {
  const out = new Map<string, Brain>();
  for (const b of brains) if (b.madeFrom) out.set(b.madeFrom, b);
  return out;
}

/** Every brain each message is pinned to (T16), in brain order: the message shows them, and links to each card. */
export function pinsByMessage(brains: ReadonlyArray<Brain>): Map<string, Array<{ brain: Brain; as: Brain["pins"][number]["as"] }>> {
  const out = new Map<string, Array<{ brain: Brain; as: Brain["pins"][number]["as"] }>>();
  for (const b of brains) {
    for (const p of b.pins) {
      const list = out.get(p.messageId) ?? [];
      list.push({ brain: b, as: p.as });
      out.set(p.messageId, list);
    }
  }
  return out;
}

/** The brain that wrote `messageId`, the maker a made brain came from (null when the message is gone, or yours). */
export function makerOf(conv: Pick<Conversation, "brains" | "messages">, brain: Pick<Brain, "madeFrom">): Brain | null {
  if (!brain.madeFrom) return null;
  const m = conv.messages.find((x) => x.id === brain.madeFrom);
  if (m?.author.type !== "brain") return null;
  const id = m.author.brainId;
  return conv.brains.find((b) => b.id === id) ?? null;
}
