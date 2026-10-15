import assert from "node:assert/strict";
import { test } from "node:test";
import { findQuotes, rehypeQuotes } from "../web/src/lib/quotes.ts";

/** The text with ⟦ ⟧ around each colored run. */
function marked(text: string, open = false): string {
  let out = "";
  let at = 0;
  for (const [s, e] of findQuotes(text, { open })) out += text.slice(at, s) + "⟦" + text.slice(s, e) + "⟧", (at = e);
  return out + text.slice(at);
}

// Each case is the expected output; the input is the same text without the brackets.
const FINISHED = [
  // The four kinds of mark.
  `He leans in. ⟦"Come closer."⟧`,
  `⟦'Not a chance,'⟧ she said.`,
  `⟦“Curly double.”⟧ And ⟦‘curly single.’⟧`,
  `⟦"Mixed curl.”⟧`,
  // Apostrophes never open or close.
  `I don't think it's the players' table, the GM's call.`,
  `'Tis a fine night, rock 'n' roll, back in the '90s, 'em and 'cause.`,
  `It’s the players’ table, don’t touch.`,
  `’Twas brillig.`,
  `⟦"Don't touch the players' dice,"⟧ she warned.`,
  `⟦"I can't 'cause I'm busy."⟧`,
  `⟦'Watch the players' table,'⟧ she said.`,
  `⟦'I'm goin' home,'⟧ he said.`,
  `⟦‘It’s fine,’⟧ she lied.`,
  // A lone weak closer pairs only when nothing else closes the quote.
  `The words ⟦'yes'⟧ and ⟦'no'⟧ mean little.`,
  `The so-called ⟦'experts'⟧ say so.`,
  // Nested quotes color as one run.
  `⟦"He told me 'run' and ran."⟧`,
  `⟦“She said ‘never’ twice.”⟧`,
  // Quotes beside punctuation.
  `(⟦"Aside."⟧) —⟦"Interrupted"⟧— ⟦"Stop!"⟧—she said. ⟦"Wait"⟧, ⟦"what?"⟧`,
  `Grondar asks: ⟦"Where?"⟧ ⟦"There."⟧`,
  `Empty ⟦""⟧ quotes.`,
  // Unclosed quotes stay plain once the reply is done.
  `He said "and then he left.`,
  `A 6" blade and 5' of rope.`,
  // A year in quotes still opens.
  `The book ⟦'1984'⟧ again.`,
  // Line breaks inside one paragraph.
  `⟦"First line,\nsecond line."⟧`,
  // Between letters, a mark is nothing.
  `say"hi"there`,
];

test("quotes: corpus, finished replies", () => {
  for (const want of FINISHED) {
    const text = want.replace(/[⟦⟧]/g, "");
    assert.equal(marked(text), want, `input: ${text}`);
  }
});

test("quotes: a streaming reply colors its open quote to the end, and only an open one", () => {
  const cases: [string, string][] = [
    [`He leans in. "Come clo`, `He leans in. ⟦"Come clo⟧`],
    [`He leans in. "Come closer."`, `He leans in. ⟦"Come closer."⟧`],
    [`"He told me 'ru`, `⟦"He told me 'ru⟧`],
    [`'Watch the players' tab`, `⟦'Watch the players' tab⟧`],
    [`'yes' and 'no`, `⟦'yes'⟧ and ⟦'no⟧`],
    [`I don't think it's the players' tab`, `I don't think it's the players' tab`],
    [`'Tis a fine`, `'Tis a fine`],
    [`“Curly and open`, `⟦“Curly and open⟧`],
  ];
  for (const [text, want] of cases) assert.equal(marked(text, true), want, `input: ${text}`);
  // Each prefix of a streamed line keeps the color of the text before it: nothing turns off as more arrives.
  const line = `The figure smiles. "You *shouldn't* be here, 'friend'," she says, "not at this hour."`;
  const final = findQuotes(line);
  for (let n = 1; n <= line.length; n++) {
    const prefix = line.slice(0, n);
    const colored = (i: number, ranges: [number, number][]) => ranges.some(([s, e]) => i >= s && i < e);
    const now = findQuotes(prefix, { open: true });
    for (let i = 0; i < n - 1; i++) {
      assert.equal(colored(i, now), colored(i, final), `prefix ${JSON.stringify(prefix)} at ${i}`);
    }
  }
});

type H = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: H[] };
const t = (value: string): H => ({ type: "text", value });
const el = (tagName: string, ...children: H[]): H => ({ type: "element", tagName, properties: {}, children });

/** The tree as text, each colored piece in ⟦ ⟧ and each element as <tag>…</tag> (wrapping spans left out). */
function show(n: H): string {
  if (n.type === "text") return n.value ?? "";
  const inner = (n.children ?? []).map(show).join("");
  if (n.tagName === "span") return (n.properties?.className as string[] | undefined)?.includes("md-quote") ? `⟦${inner}⟧` : inner;
  return n.type === "root" ? inner : `<${n.tagName}>${inner}</${n.tagName}>`;
}

test("quotes: the rehype plugin runs a quote through bold and italics, never into code or across blocks", () => {
  const tree: H = {
    type: "root",
    children: [
      el("p", t(`He says `), el("em", t(`"leans in`)), t(` Come closer, I said `), el("strong", t("no")), t(`."`)),
      el("p", t(`Type `), el("code", t(`"quoted"`)), t(` or "run `), el("code", t("ls")), t(` now."`)),
      el("pre", el("code", t(`"in a block"`))),
      el("p", t(`"Open here`)),
      el("p", t(`and closed here."`)),
      el("ul", el("li", t(`"Item"`))),
    ],
  };
  rehypeQuotes()(tree);
  assert.equal(
    show(tree),
    `<p>He says <em>⟦"leans in⟧</em>⟦ Come closer, I said ⟧<strong>⟦no⟧</strong>⟦."⟧</p>` +
      `<p>Type <code>"quoted"</code> or ⟦"run ⟧<code>ls</code>⟦ now."⟧</p>` +
      `<pre><code>"in a block"</code></pre>` +
      `<p>"Open here</p>` +
      `<p>and closed here."</p>` +
      `<ul><li>⟦"Item"⟧</li></ul>`,
  );
});

test("quotes: while streaming, only the run at the very end may stay open", () => {
  const streaming = (...children: H[]): string => {
    const tree: H = { type: "root", children };
    rehypeQuotes({ open: true })(tree);
    return show(tree);
  };
  assert.equal(streaming(el("p", t(`"Earlier`)), el("p", t(`"Now`))), `<p>"Earlier</p><p>⟦"Now⟧</p>`);
  assert.equal(streaming(el("p", t(`"Before a block`)), el("pre", el("code", t("x")))), `<p>"Before a block</p><pre><code>x</code></pre>`);
});
