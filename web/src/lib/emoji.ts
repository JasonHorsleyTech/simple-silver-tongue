/**
 * Each emoji in rendered Markdown in its own `<span class="md-emoji">`, so CSS can give it room (index.css). The
 * text is untouched: only its nodes are split. DOM-free, so node:test runs it.
 *
 * Why: on a 1x screen, Chrome lays an Apple Color Emoji glyph out exactly 1em wide but draws it about 4px wider
 * at text sizes, over the space after it, so a roll's "🎲 I rolled a d20" read "🎲I rolled". Firefox and Safari
 * already lay it out as wide as it is drawn.
 */

type HNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HNode[] };

/** One emoji as Unicode recommends it (a ZWJ family, a flag or a keycap is one). Bare "©" or "™" is text, never one. */
const EMOJI = new RegExp("\\p{RGI_Emoji}", "gv");

/** Code keeps its text nodes as they are. */
const SKIP = new Set(["code", "pre"]);

export function rehypeEmoji() {
  const walk = (node: HNode) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child) => {
      if (child.type === "element" && !SKIP.has(child.tagName ?? "")) walk(child);
      return child.type === "text" ? splitEmoji(child) : [child];
    });
  };
  return (tree: HNode) => walk(tree);
}

function splitEmoji(node: HNode): HNode[] {
  const text = node.value ?? "";
  const out: HNode[] = [];
  let at = 0;
  for (const m of text.matchAll(EMOJI)) {
    if (m.index > at) out.push({ type: "text", value: text.slice(at, m.index) });
    out.push({ type: "element", tagName: "span", properties: { className: ["md-emoji"] }, children: [{ type: "text", value: m[0] }] });
    at = m.index + m[0].length;
  }
  if (out.length === 0) return [node];
  if (at < text.length) out.push({ type: "text", value: text.slice(at) });
  return out;
}
