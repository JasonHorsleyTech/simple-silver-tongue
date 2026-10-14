/**
 * Hidden notes (T08): text every brain reads but the player sees only on purpose (a character sheet full of
 * secrets, a GM's plans). A note is a fenced code block whose info string starts with the word `hidden`:
 *
 *     ```hidden character sheet
 *     Name: ...
 *     Secret: ...
 *     ```
 *
 * It is folded, not secret: ordinary ledger text, sent verbatim to every brain, shown by prompt.preview and edited
 * raw. Only the scrollback and the CLI's human output fold it, to one line that says how big it is. Nothing here
 * touches what is sent to a model.
 *
 * This file is the one definition both clients use: the CLI folds with it and the browser imports it (as it imports
 * wording.ts), so they can't disagree about what is hidden. It is dependency-free on purpose.
 *
 * The rule, line by line. It starts from Markdown's fenced code blocks but is deliberately more eager to hide (T08
 * triage): a note that hides too much costs one click, a note that spills can't be unread.
 * - **Opens:** a line that, after any quote markers (`>`), list markers (`-`, `*`, `+`, `1.`, `1)`), footnote labels
 *   (`[^1]:`) and indentation, is a fence of 3 or more backticks or tildes followed by the word `hidden`, in any case:
 *   ```` ```hidden ````, `~~~Hidden`, ```` ````hidden ````. Not ```` ```hidden-notes ````, not mid-line. Anywhere
 *   else it opens: at any indentation, with backticks in its label, and even inside another code block. The scanner
 *   doesn't track other code blocks at all, so a stray or unclosed fence before a note (a `~~~` scene break, an
 *   indented ```` ``` ````) can't swallow it; an example of the convention inside a code block folds too.
 * - **Label:** the rest of the opening line (```` ```hidden character sheet ````) is part of the note, and the fold
 *   doesn't show it: live (T08), a Character Creator told "the label is shown to the player, never put a secret in it"
 *   labelled its sheet with the character's real name, which the player hadn't learned yet.
 * - **Closes:** a line with the same fence character, at least as many of them, and nothing else. It may be indented
 *   3 columns, or as far as the opening fence if that is further, or 3 past the fence when a list marker starts the
 *   opening line (tabs count to the next multiple of 4). That is never further than Markdown allows, so a note never
 *   ends before Markdown's code block would. It may carry up to as many quote markers as the opening line, or none.
 * - **Unclosed:** it runs to the end of the message, whatever happens to the quote or list item it opened in (a lazy,
 *   unquoted or unindented line doesn't end it). A reply still streaming into a note looks just like this, so it is
 *   folded from its first line.
 * - **Code inside a note:** a fence with a word after it (```` ```js ````) inside a note opens a code block of its
 *   own, and only after that one closes can the note close. Markdown would end the note at the inner block's bare
 *   closing fence and show the rest; for a note, showing the rest would spill it. A longer outer fence
 *   (```` ````hidden ````) or tildes work too, as in Markdown. A bare ```` ``` ```` always closes the note.
 * - **Lines** end at `\n`, `\r\n` or a lone `\r`.
 */

/** The word after the fence that makes a code block a hidden note (compared case-insensitively). */
export const HIDDEN_WORD = "hidden";
/** The first word of every fold, in both clients: "Hidden · 14 lines". */
export const HIDDEN_TITLE = "Hidden";

export type HiddenBlock = {
  /** Offset of the opening fence line's first character (its quote or list marker included). */
  start: number;
  /** Offset just past the block's last line: the closing fence, or the note's last non-blank line if unclosed. The newline after it isn't part of the block. */
  end: number;
  /** The opening line up to the fence: "" at the top level, "> " in a quote, "- " in a list item, "[^1]: " in a footnote. */
  prefix: string;
  /** The rest of the opening line after the word, trimmed ("character sheet"), or "". Part of the note: never shown on the fold. */
  label: string;
  /** The note itself: the lines between the fences, without their quote markers or list indentation (where they have them), trailing blank lines dropped. */
  body: string;
  /** How many lines the body has (0 for an empty note). */
  lines: number;
  /** It has a closing fence. */
  closed: boolean;
  /** Unclosed, so it runs to the end of the text: a reply still being written into it (or one cut off mid-note). Always `!closed` since T08 triage. */
  open: boolean;
};

export type HiddenSegment = { type: "text"; text: string } | { type: "hidden"; block: HiddenBlock };

/** True when a fence's info string (or a Markdown code node's `lang`) makes it a hidden note. */
export function isHiddenInfo(info: string | null | undefined): boolean {
  return (info ?? "").trim().split(/\s+/)[0]!.toLowerCase() === HIDDEN_WORD;
}

/** Every hidden note in a text, in order. */
export function findHidden(text: string): HiddenBlock[] {
  const blocks: HiddenBlock[] = [];
  let note: OpenNote | null = null;
  const finish = (n: OpenNote, closedAt: number | null) => {
    const body = n.body.slice(0, n.kept);
    blocks.push({
      start: n.start,
      end: closedAt ?? n.lastEnd,
      prefix: n.prefix,
      label: n.label,
      body: body.join("\n"),
      lines: body.length,
      closed: closedAt !== null,
      open: closedAt === null,
    });
  };
  for (const { line, start } of linesOf(text)) {
    const end = start + line.length;
    if (!note) {
      const f = fenceAt(line);
      if (f && isHiddenInfo(f.info)) {
        const label = f.info.slice(HIDDEN_WORD.length).trim();
        note = { ...f, prefix: line.slice(0, f.at), label, start, lastEnd: end, body: [], kept: 0, inner: null };
      }
      continue;
    }
    if (note.inner) {
      if (closes(line, note.inner)) note.inner = null;
    } else if (closes(line, note)) {
      finish(note, end);
      note = null;
      continue;
    } else {
      const inner = fenceAt(line);
      if (inner && inner.info !== "") note.inner = inner;
    }
    const kept = dedent(unquote(line, note.quotes), note.col);
    note.body.push(kept);
    if (kept.trim() !== "") {
      note.kept = note.body.length;
      note.lastEnd = end;
    }
  }
  if (note) finish(note, null);
  return blocks;
}

/** The text cut into visible stretches and hidden notes, in order; joined back (text, then each note's raw span) it is the text again. */
export function splitHidden(text: string): HiddenSegment[] {
  const out: HiddenSegment[] = [];
  let at = 0;
  for (const block of findHidden(text)) {
    if (block.start > at) out.push({ type: "text", text: text.slice(at, block.start) });
    out.push({ type: "hidden", block });
    at = block.end;
  }
  if (at < text.length) out.push({ type: "text", text: text.slice(at) });
  return out;
}

/** The text with each hidden note replaced by `marker(block)` (default: the CLI's one-line marker). */
export function foldHidden(text: string, marker: (b: HiddenBlock) => string = hiddenMarker): { text: string; folded: number } {
  let folded = 0;
  const parts = splitHidden(text).map((s) => {
    if (s.type === "text") return s.text;
    folded++;
    return marker(s.block);
  });
  return { text: parts.join(""), folded };
}

/** A message that is nothing but hidden notes (the T10 Character Creator's): there is no visible text to show. */
export function isAllHidden(text: string): boolean {
  const parts = splitHidden(text);
  return parts.some((s) => s.type === "hidden") && parts.every((s) => s.type === "hidden" || s.text.trim() === "");
}

/**
 * What a fold says, in both clients: "Hidden · 14 lines". While a reply is still being written into the note
 * (`writing`), "Hidden · 3 lines so far". Never a word of the note itself, its label included.
 */
export function hiddenSummary(b: Pick<HiddenBlock, "lines">, opts: { writing?: boolean } = {}): string {
  const count = `${b.lines} line${b.lines === 1 ? "" : "s"}`;
  return `${HIDDEN_TITLE} · ${opts.writing ? (b.lines ? `${count} so far` : "being written") : b.lines ? count : "empty"}`;
}

/** The CLI's marker: one line, in the note's own quote or list item, "> [Hidden · 3 lines]". */
export const hiddenMarker = (b: HiddenBlock) => `${b.prefix}[${hiddenSummary(b)}]`;

/** How to see what a fold hides, for the line under the CLI's human output. */
export const revealHint = (folded: number, how: string) =>
  `(${folded} hidden note${folded === 1 ? "" : "s"} folded: ${how} shows ${folded === 1 ? "it" : "them"}; --json has the raw text.)`;

export type HiddenFolder = {
  /** Take the next piece of a streaming reply; returns what can be printed now, never a word of a hidden note. */
  push(delta: string): string;
  /** The stream is over: the rest, with a note still open folded as it stands. */
  end(): string;
  /** The note the text so far ends inside (a reply being written into it), for a "3 lines so far" line; else null. */
  readonly writing: HiddenBlock | null;
  /** How many notes have been folded into the output so far. */
  readonly folded: number;
};

/**
 * Folds a reply as it streams (turn, message.regenerate, generation.follow). A fence can arrive split across
 * deltas ("``", "`hid", "den\n"), so the last, unfinished line is held back while it could still become an
 * opening fence, and nothing after an opening fence is printed until the note closes. Whatever the split, all
 * the output joined is exactly `foldHidden(whole reply, marker).text` (tested with every split).
 */
export function createHiddenFolder(marker: (b: HiddenBlock) => string = hiddenMarker): HiddenFolder {
  let text = "";
  let printed = 0;
  let writing: HiddenBlock | null = null;
  let folded = 0;
  const render = (final: boolean): string => {
    let upTo = text;
    if (!final) {
      const nl = Math.max(text.lastIndexOf("\n"), text.lastIndexOf("\r"));
      if (couldOpenHidden(text.slice(nl + 1))) upTo = text.slice(0, nl + 1);
    }
    let out = "";
    let count = 0;
    writing = null;
    for (const s of splitHidden(upTo)) {
      if (s.type === "text") out += s.text;
      else if (s.block.open && !final) {
        writing = s.block;
        break;
      } else {
        out += marker(s.block);
        count++;
      }
    }
    folded = count;
    const fresh = out.slice(printed);
    printed = Math.max(printed, out.length);
    return fresh;
  };
  return {
    push(delta) {
      text += delta;
      return render(false);
    },
    end: () => render(true),
    get writing() {
      return writing;
    },
    get folded() {
      return folded;
    },
  };
}

/**
 * Could this unfinished line still turn into a hidden note's opening fence? `"> ``"`, `"- ```hid"`, `"[^1"` and `""`
 * could; `"The figure"` and `"```js"` can't, so they print as they arrive. Once false, it stays false as the line grows.
 */
export function couldOpenHidden(partial: string): boolean {
  const rest = stripPrefixes(partial).rest.replace(/^[ \t]+/, "");
  // Nothing yet, or a list marker or footnote label still arriving.
  if (rest === "" || /^(?:[-+*]|\d{1,9}[.)]?)$/.test(rest) || /^\[(?:\^[^\]]*(?:\]:?)?)?$/.test(rest)) return true;
  const m = /^(`+|~+)(.*)$/.exec(rest);
  if (!m) return false;
  if (m[1]!.length < 3) return m[2] === "";
  const word = m[2]!.replace(/^[ \t]+/, "").toLowerCase();
  if (word.length <= HIDDEN_WORD.length) return HIDDEN_WORD.startsWith(word);
  return word.startsWith(HIDDEN_WORD) && /\s/.test(word[HIDDEN_WORD.length]!);
}

// ── The line scanner ─────────────────────────────────────────────────────────────────────────────────────────────

type Fence = {
  char: string;
  len: number;
  /** The fence's column after the line's quote markers (list markers and indentation count): the note's lines lose that much indentation. */
  col: number;
  /** How far in a closing fence may be: Markdown's 3 past its container's column, where that column is known (a list marker on the opening line), else the least it could be. */
  reach: number;
  /** How many quote markers the opening line had: a closing line may carry up to that many, or none. */
  quotes: number;
};
type OpenNote = Fence & {
  prefix: string;
  label: string;
  start: number;
  /** End of the last non-blank line so far (the opening line while there is none). */
  lastEnd: number;
  body: string[];
  /** body.length up to the last non-blank line: trailing blank lines aren't part of the note. */
  kept: number;
  /** A code block inside a hidden note; the note can't close until it does. */
  inner: Fence | null;
};

const QUOTE = /^[ \t]*>[ \t]?/;
const LIST_ITEM = /^[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+/;
const FOOTNOTE = /^[ \t]*\[\^[^\]]+\]:[ \t]*/;

/** The text's lines and where each starts, without their line endings (`\n`, `\r\n` or `\r`). After a final line ending there is no line yet. */
function* linesOf(text: string): Generator<{ line: string; start: number }> {
  let start = 0;
  for (const m of text.matchAll(/\r\n|\r|\n/g)) {
    yield { line: text.slice(start, m.index), start };
    start = m.index + m[0].length;
  }
  if (start < text.length) yield { line: text.slice(start), start };
}

/** Width in columns, a tab reaching the next multiple of 4 (as Markdown counts indentation). */
function cols(s: string): number {
  let n = 0;
  for (const ch of s) n = ch === "\t" ? n + 4 - (n % 4) : n + 1;
  return n;
}

/** Take quote markers, list markers and footnote labels off the front of a line, in any order and nesting. */
function stripPrefixes(line: string): { rest: string; quotes: number; afterQuotes: number; listed: boolean } {
  let rest = line;
  let quotes = 0;
  let afterQuotes = 0;
  let listed = false; // a list marker since the last quote marker
  for (;;) {
    const q = QUOTE.exec(rest);
    if (q) {
      quotes++;
      rest = rest.slice(q[0].length);
      afterQuotes = line.length - rest.length;
      listed = false;
      continue;
    }
    const l = LIST_ITEM.exec(rest);
    const c = l ?? FOOTNOTE.exec(rest);
    if (!c) return { rest, quotes, afterQuotes, listed };
    if (l) listed = true;
    rest = rest.slice(c[0].length);
  }
}

/** A fence starting the line (after its prefixes and indentation), with its info string, or null. */
function fenceAt(line: string): (Fence & { at: number; info: string }) | null {
  const { rest, quotes, afterQuotes, listed } = stripPrefixes(line);
  const m = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(rest);
  if (!m) return null;
  const at = line.length - rest.length + m[1]!.length;
  const col = cols(line.slice(afterQuotes, at));
  // Markdown's container column is col after a list marker (a fence further in isn't a fence there), else anywhere
  // from col - 3 to 0: allowing 3 past the least it could be never closes a note where Markdown wouldn't.
  const reach = listed ? col + 3 : Math.max(3, col);
  return { char: m[2]![0]!, len: m[2]!.length, col, reach, quotes, at, info: m[3]!.trim() };
}

/** Is this line a closing fence for `f`? The same character, at least as many, nothing after, not indented past f.reach. */
function closes(line: string, f: Fence): boolean {
  const m = /^([ \t]*)(`+|~+)[ \t]*$/.exec(unquote(line, f.quotes));
  return m !== null && m[2]![0] === f.char && m[2]!.length >= f.len && cols(m[1]!) <= f.reach;
}

/** The line with up to `n` quote markers taken off its front. */
function unquote(line: string, n: number): string {
  let rest = line;
  for (let i = 0; i < n; i++) {
    const q = QUOTE.exec(rest);
    if (!q) break;
    rest = rest.slice(q[0].length);
  }
  return rest;
}

/** The line with up to `n` columns of indentation taken off (a tab that reaches past n leaves its remainder as spaces). */
function dedent(line: string, n: number): string {
  let col = 0;
  let i = 0;
  while (i < line.length && col < n && (line[i] === " " || line[i] === "\t")) {
    col = line[i] === "\t" ? col + 4 - (col % 4) : col + 1;
    i++;
  }
  return " ".repeat(Math.max(0, col - n)) + line.slice(i);
}
