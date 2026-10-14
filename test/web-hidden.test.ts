import assert from "node:assert/strict";
import { test } from "node:test";
import { containersOf, messageParts } from "../web/src/lib/hiddenParts.ts";

// T08 frontend: what the scrollback shows of a message (web/src/lib/hiddenParts.ts). The rule itself is tested in
// hidden.test.ts; this checks the browser's use of it, frame by frame, as a reply streams in.

const SECRETS = ["Mara", "MOCK_SECRET", "forgery", "character sheet", "GM plans", "Sera"];

const REPLIES = [
  // MOCK_HIDDEN's shape: an echo line, a labelled note, a visible line.
  "The figure looks up.\n\n```hidden character sheet\nName: Mara Vell\nSecret: MOCK_SECRET the map is a forgery\n```\n\nShe slides a map across the table.",
  // MOCK_HIDDEN_ONLY's: one note and nothing else.
  "```hidden character sheet\nName: Mara Vell\n\nSecret: MOCK_SECRET a forgery\n```",
  // A note in a list, one in a quote, tildes, an ordinary code block before them.
  "Plans:\n\n```js\nconst x = 1;\n```\n\n- Ask about the map\n- ~~~hidden GM plans\n  Sera is the forger\n  ~~~\n- Order a drink\n\n> ```Hidden\n> MOCK_SECRET\n> ```\n\nDone.",
];

test("a streaming reply never shows a note's words, nor a fence still turning into one", () => {
  for (const reply of REPLIES) {
    for (let i = 0; i <= reply.length; i++) {
      const parts = messageParts(reply.slice(0, i), { writing: true });
      for (const p of parts) {
        if (p.type !== "text") continue;
        for (const s of SECRETS) assert.ok(!p.text.includes(s), `prefix ${i} of ${JSON.stringify(reply.slice(0, 30))} shows ${s}: ${JSON.stringify(p.text)}`);
        // The only fences shown are the ordinary ```js block's (as it arrives), never the start of a note's.
        const fences = p.text.match(/(?:^|\n)[ >\t-]*(`{2,}|~{2,})(.*)/g) ?? [];
        for (const f of fences) assert.match(f, /```(j|js)?$/, `prefix ${i} flashes a fence: ${JSON.stringify(f)}`);
      }
    }
  }
});

test("a reply that is all note is the fold alone, from its first character on", () => {
  const reply = REPLIES[1]!;
  for (let i = 0; i <= reply.length; i++) {
    const parts = messageParts(reply.slice(0, i), { writing: true });
    assert.ok(parts.length <= 1 && parts.every((p) => p.type === "hidden"), `prefix ${i}: ${JSON.stringify(parts)}`);
  }
  const [only] = messageParts(reply);
  assert.equal(only?.type, "hidden");
  assert.equal(only.type === "hidden" && only.block.lines, 3);
  assert.equal(only.type === "hidden" && only.block.label, "character sheet");
});

test("the fold appears as soon as the opening fence does, and counts up while it is written", () => {
  const at = (text: string) => messageParts(text, { writing: true }).map((p) => (p.type === "text" ? "text" : `note:${p.block.lines}:${p.block.open}`));
  assert.deepEqual(at("Hi.\n``"), ["text"]); // "``" waits: it may become a fence
  assert.deepEqual(at("Hi.\n```hidden"), ["text", "note:0:true"]);
  assert.deepEqual(at("Hi.\n```hidden\nA\nB"), ["text", "note:2:true"]);
  assert.deepEqual(at("Hi.\n```hidden\nA\nB\n```\n\nBye"), ["text", "note:2:false", "text"]);
});

test("only a streaming reply holds its last line back; a saved one shows everything", () => {
  assert.deepEqual(messageParts("Count:\n``", { writing: true }), [{ type: "text", text: "Count:\n" }]);
  assert.deepEqual(messageParts("Count:\n``"), [{ type: "text", text: "Count:\n``" }]);
  assert.deepEqual(messageParts("Count to ``", { writing: true }), [{ type: "text", text: "Count to ``" }]); // mid-line: never a fence
  assert.deepEqual(messageParts("Plain words", { writing: true }), [{ type: "text", text: "Plain words" }]);
  // Blank gaps around a note aren't parts of their own.
  assert.deepEqual(
    messageParts("```hidden\nX\n```\n\n").map((p) => p.type),
    ["hidden"],
  );
});

test("a note's containers come back for its fold", () => {
  assert.deepEqual(containersOf(""), []);
  assert.deepEqual(containersOf("> "), [{ kind: "quote" }]);
  assert.deepEqual(containersOf("- "), [{ kind: "list", marker: "•" }]);
  assert.deepEqual(containersOf("> 3) "), [{ kind: "quote" }, { kind: "list", marker: "3." }]);
  assert.deepEqual(containersOf("[^1]: "), []);
  assert.deepEqual(containersOf("   "), []);
});
