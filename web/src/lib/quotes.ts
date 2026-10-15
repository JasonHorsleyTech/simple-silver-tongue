/**
 * Dialogue in the speaker's color: what counts as a quoted run in a brain's reply. DOM-free, so node:test runs it.
 *
 * Marks: "straight", 'straight', “curly”, ‘curly’ (a double opener closes with either double, a single with either
 * single). Whether a mark opens or closes comes from its neighbors, as CommonMark decides for `_`: an opener has
 * text after it and starts a word, a closer has text before it and ends one. A mark between two letters (don't,
 * it’s) does neither. On top of that, for single marks only:
 *   - a known elision never opens ('tis, 'em, rock 'n' roll, the '90s);
 *   - a letter + mark + space + lowercase word (the players' table, goin' home) is a *weak* closer: it closes
 *     only a quote that nothing else closes ('yes' and 'no').
 * Only pairs are colored. While a reply is still streaming, the last run's open quote is colored to its end, so
 * dialogue shows in color as it arrives and nothing changes when its closing mark lands.
 */

/** [start, end) ranges of quoted text, the marks included, sorted and not overlapping. */
export type Range = [number, number];

const DOUBLE = new Set(['"', "“", "”"]);
const SINGLE = new Set(["'", "‘", "’"]);
const OPEN_ONLY = new Set(["“", "‘"]);
const CLOSE_ONLY = new Set(["”", "’"]);

/** Words that start with an apostrophe, never with a quote (compared lowercased, apostrophes straightened). */
const ELISIONS = new Set(
  (
    "tis twas twere twill twould twixt em cause cuz cos coz til n bout round kay sup nuff fraid gainst mongst neath " +
    "scuse spose pon gain e ello ow ead ave im er ere alf ome appen orse ard eck oo"
  ).split(" "),
);

const isSpace = (c: string | undefined) => c === undefined || /\s/u.test(c);
const isPunct = (c: string | undefined) => c !== undefined && /[\p{P}\p{S}]/u.test(c);
const isLetter = (c: string | undefined) => c !== undefined && /\p{L}/u.test(c);

type Mark = { i: number; double: boolean; open: boolean; close: boolean; weak: boolean };

function classify(text: string, i: number): Mark | null {
  const ch = text[i]!;
  const double = DOUBLE.has(ch);
  if (!double && !SINGLE.has(ch)) return null;
  const prev = text[i - 1];
  const next = text[i + 1];
  const left = !isSpace(next) && (!isPunct(next) || isSpace(prev) || isPunct(prev));
  const right = !isSpace(prev) && (!isPunct(prev) || isSpace(next) || isPunct(next));
  let open = !CLOSE_ONLY.has(ch) && left && (!right || isPunct(prev));
  const close = !OPEN_ONLY.has(ch) && right && (!left || isPunct(next));
  let weak = false;
  if (!double) {
    if (open) {
      const word = /^[\p{L}\p{N}]+/u.exec(text.slice(i + 1))?.[0] ?? "";
      const after = text[i + 1 + word.length];
      // 'n' (rock 'n' roll) ends on a mark; the others end on anything but a letter.
      if (ELISIONS.has(word.toLowerCase()) && !isLetter(after)) open = false;
      // The '90s, class of '05 (a year in quotes, '1984', still opens).
      if (/^\d\d$|^\d\ds$/.test(word)) open = false;
    }
    if (close && isLetter(prev) && /^\s+\p{Ll}/u.test(text.slice(i + 1))) weak = true;
  }
  return open || close ? { i, double, open, close, weak } : null;
}

/** The quoted ranges of one run of text (a paragraph, a list item's line, a table cell). `open`: still streaming. */
export function findQuotes(text: string, { open = false }: { open?: boolean } = {}): Range[] {
  const marks: Mark[] = [];
  for (let i = 0; i < text.length; i++) {
    const m = classify(text, i);
    if (m) marks.push(m);
  }

  const ranges: Range[] = [];
  const stack: Mark[] = [];
  for (const m of marks) {
    if (m.close && !m.weak) {
      let j = stack.length - 1;
      while (j >= 0 && stack[j]!.double !== m.double) j--;
      if (j >= 0) {
        ranges.push([stack[j]!.i, m.i + 1]);
        stack.length = j; // openers inside the pair that never closed are just marks
        continue;
      }
    }
    if (m.open) stack.push(m);
  }

  // A single opener nothing closed takes the first weak closer after it, before the next single mark that
  // counted. While streaming, an opener with no such mark after it may still be waiting for its closer.
  const left: Mark[] = [];
  for (const o of stack) {
    if (o.double) {
      left.push(o);
      continue;
    }
    const bound = marks.find((m) => m.i > o.i && !m.double && !m.weak && (m.open || m.close));
    const weak = !bound && open ? undefined : marks.find((m) => m.i > o.i && m.weak && (!bound || m.i < bound.i));
    if (weak) ranges.push([o.i, weak.i + 1]);
    else left.push(o);
  }
  if (open && left.length > 0) ranges.push([left[0]!.i, text.length]);

  return merge(ranges);
}

function merge(ranges: Range[]): Range[] {
  const out: Range[] = [];
  for (const [s, e] of ranges.sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/* ---- rehype: wrap quoted text in <span class="md-quote"> ---- */

type HNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HNode[] };

/** Phrasing elements a quote can run through. Anything else is a block: quotes never cross it. */
const INLINE = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "del", "dfn", "em", "i", "img", "input", "ins",
  "kbd", "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
]);
/** Inline elements whose text is never colored or read for marks (a quote can still run past them). */
const OPAQUE = new Set(["code", "kbd", "samp", "img", "input", "wbr"]);

type Run = HNode[];

/**
 * The rehype plugin. Quotes pair within one run of inline content (bold, italics and links included, so
 * `"*leans in* Come closer."` is one quote); code, code blocks and hidden notes are never touched. Each text
 * node inside a quote gets its own span, so bold stays bold inside it. `open`: the reply is still streaming, so
 * the last run's open quote is colored to its end (only if that run is the end of the text).
 */
export function rehypeQuotes({ open = false }: { open?: boolean } = {}) {
  return (tree: HNode) => {
    const runs: Run[] = [];
    let endsInRun = false;
    const walk = (node: HNode) => {
      let run: Run = [];
      const flush = () => {
        if (run.length > 0) {
          runs.push(run);
          endsInRun = true;
        }
        run = [];
      };
      for (const child of node.children ?? []) {
        if (child.type === "text" || (child.type === "element" && INLINE.has(child.tagName ?? ""))) {
          run.push(child);
        } else if (child.type === "element") {
          flush();
          endsInRun = false;
          if (child.tagName !== "pre") walk(child);
        }
      }
      flush();
    };
    walk(tree);
    runs.forEach((run, n) => colorRun(run, open && endsInRun && n === runs.length - 1));
  };
}

function colorRun(run: Run, open: boolean) {
  const texts: { node: HNode; start: number }[] = [];
  let flat = "";
  const read = (node: HNode) => {
    if (node.type === "text") {
      texts.push({ node, start: flat.length });
      flat += node.value ?? "";
    } else if (node.type === "element") {
      if (node.tagName === "br") flat += "\n";
      else if (OPAQUE.has(node.tagName ?? "")) flat += "x";
      else node.children?.forEach(read);
    }
  };
  run.forEach(read);
  const ranges = findQuotes(flat, { open });
  if (ranges.length === 0) return;
  for (const { node, start } of texts) {
    const value = node.value ?? "";
    const end = start + value.length;
    const pieces: HNode[] = [];
    let at = start;
    for (const [s, e] of ranges) {
      if (e <= at || s >= end) continue;
      const from = Math.max(s, at);
      const to = Math.min(e, end);
      if (from > at) pieces.push({ type: "text", value: value.slice(at - start, from - start) });
      pieces.push({
        type: "element",
        tagName: "span",
        properties: { className: ["md-quote"] },
        children: [{ type: "text", value: value.slice(from - start, to - start) }],
      });
      at = to;
    }
    if (pieces.length === 0) continue;
    if (at < end) pieces.push({ type: "text", value: value.slice(at - start) });
    // Turn the text node into a span holding its pieces: the tree keeps its shape, no parent to rewrite.
    Object.assign(node, { type: "element", tagName: "span", properties: {}, children: pieces, value: undefined });
  }
}
