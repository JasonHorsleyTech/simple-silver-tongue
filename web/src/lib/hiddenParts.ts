import { couldOpenHidden, splitHidden, type HiddenSegment } from "../api/types.ts";

/**
 * T08: a message as the scrollback shows it, from the one shared rule (`splitHidden`): visible text parts, each
 * rendered as Markdown, and hidden notes, each rendered as a fold. A note's words are never in a text part, so
 * they never reach the Markdown renderer. Blank text parts (the gaps around a note) are dropped.
 *
 * While a reply is still being written (`writing`), its unfinished last line is held back while it could still
 * become a note's opening fence ("``", "- ```hid"), as the CLI's stream folder does: shown, it would flash for a
 * frame as an empty code block before turning into the fold. A note the text ends inside is already a fold, so
 * nothing is held then. DOM-free, so `node:test` imports it (test/web-hidden.test.ts).
 */
export function messageParts(text: string, opts: { writing?: boolean } = {}): HiddenSegment[] {
  let parts = splitHidden(text);
  if (opts.writing && parts.at(-1)?.type !== "hidden") {
    const nl = Math.max(text.lastIndexOf("\n"), text.lastIndexOf("\r"));
    if (couldOpenHidden(text.slice(nl + 1))) parts = splitHidden(text.slice(0, nl + 1));
  }
  return parts.filter((p) => p.type === "hidden" || p.text.trim() !== "");
}

/** The containers a note's opening line was in, outermost first ("> - " is a list item inside a quote), so its fold can sit where the note was. */
export type NoteContainer = { kind: "quote" } | { kind: "list"; marker: string };

const CONTAINER = /^[ \t]*(?:(>)[ \t]?|([-+*]|\d{1,9}[.)])[ \t]+|\[\^[^\]]+\]:[ \t]*)/;

export function containersOf(prefix: string): NoteContainer[] {
  const out: NoteContainer[] = [];
  let rest = prefix;
  for (let m = CONTAINER.exec(rest); m && m[0]; m = CONTAINER.exec(rest)) {
    if (m[1]) out.push({ kind: "quote" });
    else if (m[2]) out.push({ kind: "list", marker: /^\d/.test(m[2]) ? `${m[2].slice(0, -1)}.` : "•" });
    rest = rest.slice(m[0].length);
  }
  return out;
}
