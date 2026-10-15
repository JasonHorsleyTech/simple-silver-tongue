/**
 * Short labels for the composer's brain buttons (T12): "Co-GM" → CG, "Show Me the Odds" → SMTO, "Character 12" → C12. DOM-free, so
 * test/web-api.test.ts can check it. `brainInitials` keeps them distinct: two brains never wear the same label.
 */

const MAX = 4;

function words(name: string): string[] {
  return name.trim().split(/[\s\-_/.·:]+/u).filter(Boolean);
}

/** A word's initial; a number counts whole (T16: "Character 12" → C12, never C1 beside "Character 1"). */
const first = (w: string) => (/^\p{N}+$/u.test(w) ? w : (Array.from(w)[0] ?? ""));
const upper = (s: string) => s.toLocaleUpperCase();

/** The label for one name, with `extra` more letters of its last word when it needs telling apart from another. */
export function initialsOf(name: string, extra = 0): string {
  const ws = words(name);
  if (ws.length === 0) return "?";
  if (ws.length === 1) {
    const w = ws[0]!;
    const chars = Array.from(w);
    const caps = chars.filter((c) => /\p{Lu}/u.test(c));
    if (caps.length >= 2 && extra === 0) return caps.slice(0, MAX).join(""); // "DiceMaster" → DM
    if (chars.length <= MAX) return w; // "GM", "Bard", "Odds": already short
    return upper(chars[0]!) + chars.slice(1, 2 + extra).join("");
  }
  const head = ws.slice(0, MAX).map((w) => upper(first(w))).join("");
  if (extra === 0) return head;
  if (/^\p{N}+$/u.test(ws[Math.min(ws.length, MAX) - 1]!)) {
    // "Character 12" / "Cargo 12": more of the first word's letters (Ch12 / Ca12), since the number is already whole.
    const w0 = Array.from(ws[0]!);
    return upper(w0[0]!) + w0.slice(1, 1 + extra).join("").toLocaleLowerCase() + ws.slice(1, MAX).map((w) => upper(first(w))).join("");
  }
  const last = Array.from(ws[Math.min(ws.length, MAX) - 1]!);
  return head + last.slice(1, 1 + extra).join("").toLocaleLowerCase();
}

/**
 * One label per name, in order, all different (case-insensitively): a clash takes more letters of the last word
 * ("Character Actor" / "Character Artist" → CAc / CAr), and names that still clash get a number.
 */
export function brainInitials(names: string[]): string[] {
  const labels = names.map((n) => initialsOf(n));
  const key = (s: string) => s.toLocaleLowerCase();
  for (let extra = 1; extra <= 6; extra++) {
    const clashing = clashes(labels.map(key));
    if (clashing.size === 0) return labels;
    for (const i of clashing) labels[i] = initialsOf(names[i]!, extra);
  }
  const clashing = clashes(labels.map(key));
  let n = 0;
  for (const i of clashing) labels[i] = `${labels[i]}${++n}`;
  return labels;
}

function clashes(keys: string[]): Set<number> {
  const seen = new Map<string, number[]>();
  keys.forEach((k, i) => seen.set(k, [...(seen.get(k) ?? []), i]));
  return new Set([...seen.values()].filter((is) => is.length > 1).flat());
}
