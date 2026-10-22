import assert from "node:assert/strict";
import { test } from "node:test";
import { rehypeEmoji } from "../web/src/lib/emoji.ts";

type N = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: N[] };
const text = (value: string): N => ({ type: "text", value });
const el = (tagName: string, ...children: N[]): N => ({ type: "element", tagName, properties: {}, children });

/** The tree's text with ⟦ ⟧ around each emoji span. */
const shown = (n: N): string =>
  n.type === "text"
    ? (n.value ?? "")
    : (n.properties?.className as string[] | undefined)?.includes("md-emoji")
      ? `⟦${(n.children ?? []).map(shown).join("")}⟧`
      : (n.children ?? []).map(shown).join("");

test("each emoji gets its own span, the text unchanged; code and text-style symbols are left alone", () => {
  const tree: N = {
    type: "root",
    children: [
      el("p", text("🎲 I rolled a d20: "), el("strong", text("20"))),
      el("p", text("⚔️ then 🎲🎲, 👨‍👩‍👧 and 🇫🇷, 1️⃣ 👍🏽; © ™ ⚔ and 2 stay text")),
      el("pre", el("code", text("🎲 in code"))),
      el("p", el("code", text("🎲")), text(" plain")),
    ],
  };
  const before = shown(tree);
  rehypeEmoji()(tree);
  assert.equal(
    shown(tree),
    "⟦🎲⟧ I rolled a d20: 20" +
      "⟦⚔️⟧ then ⟦🎲⟧⟦🎲⟧, ⟦👨‍👩‍👧⟧ and ⟦🇫🇷⟧, ⟦1️⃣⟧ ⟦👍🏽⟧; © ™ ⚔ and 2 stay text" +
      "🎲 in code" +
      "🎲 plain",
  );
  assert.equal(shown(tree).replace(/[⟦⟧]/g, ""), before);
});
