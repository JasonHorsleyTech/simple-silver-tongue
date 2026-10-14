import { table } from "../lib/text.ts";
import { usd } from "../venice/models.ts";
import { activeVersion } from "./prompt.ts";
import { totalCost } from "./turn.ts";
import type { ChatRequest, Conversation } from "./types.ts";

/** Plain-text CLI renderings. Content is printed in full and verbatim: these are the user's own words. */

export type ConversationSummary = {
  id: string;
  title: string;
  textModel: string;
  messageCount: number;
  costUsd: number;
  createdAt: string;
  updatedAt: string;
};

export function summarize(c: Conversation): ConversationSummary {
  return {
    id: c.id,
    title: c.title,
    textModel: c.settings.textModel,
    messageCount: c.messages.length,
    costUsd: totalCost(c),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

const cost = (n: number | undefined) => (n ? usd(n) : "");

/** A conversation file that couldn't be read or isn't a conversation. Listed, so it can't hide the others (T02 QA-4). */
export type UnreadableConversation = { id: string; error: string };

export function formatList(list: ConversationSummary[], unreadable: UnreadableConversation[] = []): string {
  const out: string[] = [];
  if (list.length) {
    out.push(
      table(
        ["ID", "TITLE", "MESSAGES", "COST", "MODEL", "UPDATED"],
        list.map((c) => [c.id, c.title, c.messageCount, cost(c.costUsd) || "$0", c.textModel, c.updatedAt.slice(0, 19).replace("T", " ")]),
      ),
    );
  } else if (!unreadable.length) {
    out.push('No conversations yet. Start one: ./ss conversation.create --title "..." --system-prompt "..."');
  }
  if (unreadable.length) {
    out.push(`${list.length ? "\n" : ""}Unreadable conversation files (${unreadable.length}):`);
    for (const u of unreadable) out.push(`  ${u.id}: ${u.error}`);
  }
  return out.join("\n");
}

export function formatConversation(c: Conversation): string {
  const brainName = new Map(c.brains.map((b) => [b.id, b.name]));
  const out = [
    `${c.title} (${c.id}) · ${c.settings.textModel} · ${c.messages.length} messages · ${usd(totalCost(c))}`,
    `Brains: ${c.brains
      .map((b) => `${b.name}${b.id === c.defaultBrainId ? " (default)" : ""} [${b.id}, ${b.kind}, reasoning ${b.reasoning.enabled ? b.reasoning.effort : "off"}]`)
      .join(", ")}`,
  ];
  if (c.setup.length) out.push(`Setup messages: ${c.setup.map((s) => s.label || s.id).join(", ")}`);
  if (!c.messages.length) out.push("", `(no messages yet: ./ss turn --conversation ${c.id} --content "...")`);
  for (const m of c.messages) {
    const v = activeVersion(m);
    const who = m.author.type === "player" ? "you" : (brainName.get(m.author.brainId) ?? m.author.brainId);
    const bits = [who, m.id];
    if (m.versions.length > 1) bits.push(`version ${m.activeVersion + 1}/${m.versions.length}`);
    if (m.kind === "image") bits.push("image prompt");
    if (v.edited) bits.push("edited");
    if (v.costUsd) bits.push(usd(v.costUsd));
    if (v.finishReason === "length") bits.push("cut off by max_tokens");
    if (v.reasoning) bits.push(`reasoning ${v.reasoning.length} chars (--json)`);
    out.push("", `── ${bits.join(" · ")} ──`, v.content);
  }
  return out.join("\n");
}

export type Preview = {
  conversationId: string;
  brainId: string;
  brainName: string;
  body: ChatRequest;
  /** Plain-language notes on text the provider adds that we can't show (e.g. reasoning on). */
  notes: string[];
  /** turn would refuse to send this body as it stands, and why. */
  refusal?: string;
};

/** The exact body: every non-message field as JSON, then each message's content verbatim. */
export function formatPreview(p: Preview): string {
  const { messages, ...rest } = p.body;
  const out = [
    `Exact request for brain "${p.brainName}" (${p.brainId}): POST /chat/completions`,
    ...p.notes.map((n) => `Note: ${n}`),
    JSON.stringify(rest),
    `${messages.length} messages:`,
  ];
  messages.forEach((m, i) => {
    const extra = m.role === "tool" ? ` (tool_call_id ${m.tool_call_id})` : "";
    out.push("", `── [${i}] ${m.role}${extra} ──`);
    if (m.content !== "" || m.role !== "assistant") out.push(m.content);
    if (m.role === "assistant" && m.tool_calls) out.push(`tool_calls: ${JSON.stringify(m.tool_calls)}`);
  });
  out.push("", "(--json prints the body exactly as it is sent.)");
  if (p.refusal) out.push(`Note: turn would not send this as it stands. ${p.refusal}`);
  return out.join("\n");
}
