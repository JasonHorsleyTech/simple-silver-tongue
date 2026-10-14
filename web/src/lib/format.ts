import type { Conversation, LedgerMessage, MessageVersion } from "../api/types.ts";

/** Dollars the way the CLI prints them (src/venice/models.ts usd): cents when it's at least a cent, else 2 significant digits. */
export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  return n >= 0.01 ? `$${n.toFixed(2)}` : `$${Number(n.toPrecision(2))}`;
}

/**
 * Everything ever spent on a conversation, like the server's totalCost: its running `spentUsd`, which keeps
 * deleted messages and stopped replies (T03 QA-2). Older files have none; their versions are the record.
 */
export function conversationCost(conv: Conversation): number {
  if (conv.spentUsd !== undefined) return conv.spentUsd;
  let sum = 0;
  for (const m of conv.messages) for (const v of m.versions) sum += v.costUsd ?? 0;
  return sum;
}

export function activeVersion(m: LedgerMessage): MessageVersion {
  return m.versions[m.activeVersion] ?? m.versions[0]!;
}

/** "just now", "5m", "3h", "Yesterday", "Mon", "Oct 12", "Oct 12, 2025". */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  const d = new Date(t);
  const today = new Date(now);
  if (s < 86400 && d.getDate() === today.getDate()) return `${Math.round(s / 3600)}h`;
  const yesterday = new Date(now - 86400_000);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  if (s < 6 * 86400) return d.toLocaleDateString(undefined, { weekday: "short" });
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/** "14:02" today, "Oct 12, 14:02" otherwise. */
export function clockTime(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === new Date(now).toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

export function fullTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** 1234 → "1.2k". */
export function compactNumber(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
}

/** An idle limit in minutes, as words: "60 minutes", "1 minute"; a test's fraction reads as seconds ("15 seconds"). */
export function idleDuration(minutes: number): string {
  if (minutes < 1) {
    const s = Math.round(minutes * 60);
    return s === 1 ? "1 second" : `${s} seconds`;
  }
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/**
 * A turn's stop or break, said for the browser. The server's sentence ends with how to resend from the terminal
 * ("…send again to Game Master with no new message and no new roll: turn --brain b_… without --content or
 * --roll"). Here the words before the colon already say it (that brain's chip, nothing typed, the die off), so
 * only the command is cut; the rest is the server's own sentence.
 */
export function forBrowser(message: string): string {
  return message.replace(/: turn --brain \S+ without --content(?: or --roll)?/g, "");
}
