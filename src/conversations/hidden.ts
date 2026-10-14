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
 * The rule, line by line (Markdown's fenced code blocks, plus one forgiving extra):
 * - **Opens:** a line that, after any quote markers (`>`), list markers (`-`, `*`, `+`, `1.`, `1)`) and indentation,
 *   is a fence of 3 or more backticks or tildes followed by the word `hidden`, in any case: ```` ```hidden ````,
 *   `~~~Hidden`, ```` ````hidden ````. Not inside another code block, and not ```` ```hidden-notes ````.
 * - **Label:** the rest of the opening line (```` ```hidden character sheet ````) is part of the note, and the fold
 *   doesn't show it: live (T08), a Character Creator told "the label is shown to the player, never put a secret in it"
 *   labelled its sheet with the character's real name, which the player hadn't learned yet.
 * - **Closes:** a line with the same fence character, at least as many of them, and nothing else.
 * - **Unclosed:** it runs to the end of the message, or of the quote or list item it opened in (a line that doesn't
 *   continue that quote or item ends it, as in Markdown). A reply still streaming into a note looks just like this,
 *   so it is folded from its first line.
 * - **Code inside a note:** a fence with a word after it (```` ```js ````) inside a note opens a code block of its
 *   own, and only after that one closes can the note close. Markdown would end the note at the inner block's bare
 *   closing fence and show the rest; for a note, showing the rest would spill it. A longer outer fence
 *   (```` ````hidden ````) or tildes work too, as in Markdown. A bare ```` ``` ```` always closes the note.
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
  /** The opening line up to the fence: "" at the top level, "> " in a quote, "- " in a list item. */
  prefix: string;
  /** The rest of the opening line after the word, trimmed ("character sheet"), or "". Part of the note: never shown on the fold. */
  label: string;
  /** The note itself: the lines between the fences, without their quote markers or list indentation, trailing blank lines dropped. */
  body: string;
  /** How many lines the body has (0 for an empty note). */
  lines: number;
  /** It has a closing fence. */
  closed: boolean;
  /** Unclosed, and it runs to the end of the text: a reply still being written into it (or one cut off mid-note). */
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
  let open: OpenFence | null = null;
  const finish = (f: OpenFence, closedAt: number | null, atEnd: boolean) => {
    if (!f.hidden) return;
    const body = f.body.slice(0, f.kept);
    blocks.push({
      start: f.start,
      end: closedAt ?? f.lastEnd,
      prefix: f.prefix,
      label: f.label,
      body: body.join("\n"),
      lines: body.length,
      closed: closedAt !== null,
      open: closedAt === null && atEnd,
    });
  };
  let pos = 0;
  const lines = text.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop(); // after a final newline there is no line yet
  for (const raw of lines) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw; // a "\r\n" stays outside the block, like "\n"
    const lineStart = pos;
    const lineEnd = pos + line.length;
    pos += raw.length + 1;
    if (open) {
      const rest = continueLine(line, open.containers);
      if (rest !== null) {
        if (!open.inner && closes(rest, open)) {
          finish(open, lineEnd, false);
          open = null;
          continue;
        }
        if (open.hidden) {
          if (open.inner) {
            if (closes(rest, open.inner)) open.inner = null;
          } else {
            const inner = fenceIn(rest);
            if (inner && inner.info !== "") open.inner = inner;
          }
          open.body.push(rest.slice(Math.min(open.indent, /^ */.exec(rest)![0].length)));
          if (rest.trim() !== "") {
            open.kept = open.body.length;
            open.lastEnd = lineEnd;
          }
        }
        continue;
      }
      finish(open, null, false); // the quote or list item it opened in has ended, and the block with it
      open = null;
    }
    const f = openingFence(line);
    if (f) {
      const hidden = isHiddenInfo(f.info);
      open = {
        ...f,
        hidden,
        label: hidden ? f.info.trim().slice(HIDDEN_WORD.length).trim() : "",
        start: lineStart,
        lastEnd: lineEnd,
        body: [],
        kept: 0,
        inner: null,
      };
    }
  }
  if (open) finish(open, null, true);
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
      const nl = text.lastIndexOf("\n");
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
 * Could this unfinished line still turn into a hidden note's opening fence? `"> ``"`, `"- ```hid"` and `""` could;
 * `"The figure"` and `"```js"` can't, so they print as they arrive. Once false, it stays false as the line grows.
 */
export function couldOpenHidden(partial: string): boolean {
  const rest = stripContainers(partial).rest.replace(/^[ \t]+/, "");
  if (rest === "" || /^(?:[-+*]|\d{1,9}[.)]?)$/.test(rest)) return true; // nothing yet, or a list marker arriving
  const m = /^(`+|~+)(.*)$/.exec(rest);
  if (!m) return false;
  if (m[1]!.length < 3) return m[2] === "";
  const info = m[2]!.replace(/^[ \t]+/, "");
  if (m[1]![0] === "`" && info.includes("`")) return false;
  const word = info.toLowerCase();
  if (word.length <= HIDDEN_WORD.length) return HIDDEN_WORD.startsWith(word);
  return word.startsWith(HIDDEN_WORD) && /\s/.test(word[HIDDEN_WORD.length]!);
}

// ── The line scanner ─────────────────────────────────────────────────────────────────────────────────────────────

/** A container the fence opened in: a quote marker, or a list item's indentation (its content column). */
type Container = "quote" | number;
type Fence = { char: string; len: number; indent: number; info: string };
type OpenFence = Fence & {
  containers: Container[];
  prefix: string;
  hidden: boolean;
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

const QUOTE = /^ {0,3}>[ \t]?/;
const LIST_ITEM = /^[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+/;
const FENCE = /^( *)(`{3,}|~{3,})(.*)$/;

function stripContainers(line: string): { containers: Container[]; rest: string } {
  const containers: Container[] = [];
  let rest = line;
  for (;;) {
    const q = QUOTE.exec(rest);
    if (q) {
      containers.push("quote");
      rest = rest.slice(q[0].length);
      continue;
    }
    const l = LIST_ITEM.exec(rest);
    if (l) {
      containers.push(l[0].length);
      rest = rest.slice(l[0].length);
      continue;
    }
    return { containers, rest };
  }
}

/** A fence at the start of `rest` (after up to any indentation), or null. Backtick fences can't have a backtick after them. */
function fenceIn(rest: string): Fence | null {
  const m = FENCE.exec(rest.replace(/\t/g, "    "));
  if (!m) return null;
  const run = m[2]!;
  const info = m[3]!.trim();
  if (run[0] === "`" && info.includes("`")) return null;
  return { char: run[0]!, len: run.length, indent: m[1]!.length, info };
}

function openingFence(line: string): (Fence & { containers: Container[]; prefix: string }) | null {
  const { containers, rest } = stripContainers(line);
  const f = fenceIn(rest);
  if (!f) return null;
  const ws = /^[ \t]*/.exec(rest)![0];
  return { ...f, containers, prefix: line.slice(0, line.length - rest.length + ws.length) };
}

/** The line with the fence's containers taken off, or null when it doesn't continue them (the quote or item ended). */
function continueLine(line: string, containers: Container[]): string | null {
  let rest = line;
  for (const c of containers) {
    if (c === "quote") {
      const q = QUOTE.exec(rest);
      if (!q) return null;
      rest = rest.slice(q[0].length);
    } else {
      if (rest.trim() === "") return "";
      if (/^ */.exec(rest)![0].length < c) return null;
      rest = rest.slice(c);
    }
  }
  return rest;
}

/** A closing fence for `f`: the same character, at least as many, nothing after, indented at most 3 past the opener. */
function closes(rest: string, f: Fence): boolean {
  const m = /^( *)(`+|~+)[ \t]*$/.exec(rest);
  return m !== null && m[1]!.length <= f.indent + 3 && m[2]![0] === f.char && m[2]!.length >= f.len;
}
