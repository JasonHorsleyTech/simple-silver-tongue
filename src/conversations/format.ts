import { table } from "../lib/text.ts";
import type { FormatOpts } from "../registry.ts";
import { usd } from "../venice/models.ts";
import { foldHidden, revealHint } from "./hidden.ts";
import { activeVersion } from "./prompt.ts";
import { totalCost } from "./turn.ts";
import type { ChatRequest, Conversation, ImageRecord, ImageRequest, LedgerMessage, MessageVersion } from "./types.ts";

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

/**
 * T08: a text message's content as the CLI shows it, hidden notes folded to one line unless --reveal. An image
 * prompt is a plain caption (the browser doesn't render it as Markdown either), so it is never folded.
 */
export function shown(content: string, kind: LedgerMessage["kind"], opts: FormatOpts | undefined, count: { folded: number }): string {
  if (opts?.reveal || kind !== "text") return content;
  const f = foldHidden(content);
  count.folded += f.folded;
  return f.text;
}

export function formatConversation(c: Conversation, opts?: FormatOpts): string {
  const count = { folded: 0 };
  const brainName = new Map(c.brains.map((b) => [b.id, b.name]));
  const out = [
    `${c.title} (${c.id}) · ${c.settings.textModel} · ${c.messages.length} messages · ${usd(totalCost(c))}`,
    `Brains: ${c.brains
      .map((b) => {
        const reminder = b.finalReminder.enabled && b.finalReminder.content.trim() ? ", reminder" : "";
        return `${b.name}${b.id === c.defaultBrainId ? " (default)" : ""} [${b.id}, ${b.kind}, reasoning ${b.reasoning.enabled ? b.reasoning.effort : "off"}${reminder}]`;
      })
      .join(", ")}`,
  ];
  if (c.setup.length) out.push(`Setup messages: ${c.setup.map((s) => `${s.label} (${s.id})`).join(", ")} (setup.list shows them)`);
  if (!c.messages.length) out.push("", `(no messages yet: ./ss turn --conversation ${c.id} --content "...")`);
  for (const m of c.messages) {
    const v = activeVersion(m);
    const who = m.author.type === "player" ? "you" : (brainName.get(m.author.brainId) ?? m.author.brainId);
    const bits = [who, m.id];
    if (m.versions.length > 1) bits.push(`version ${m.activeVersion + 1}/${m.versions.length} (message.get shows all)`);
    if (m.author.type === "brain" && v.source === "authored") bits.push("written by you");
    out.push("", `── ${[...bits, ...versionBits(v, m.kind)].join(" · ")} ──`, shown(v.content, m.kind, opts, count));
  }
  if (count.folded) out.push("", revealHint(count.folded, `./ss conversation.get --id ${c.id} --reveal`));
  return out.join("\n");
}

/** What a version's header says about it, beyond who wrote it. The steer is shown, never sent again. */
function versionBits(v: MessageVersion, kind: LedgerMessage["kind"] = "text"): string[] {
  const bits: string[] = [];
  if (kind === "image") bits.push("image prompt", ...(v.image ? [imageLine(v.image)] : ["no image"]));
  if (v.steer !== undefined) bits.push(`steer "${v.steer}"${v.steeredFrom !== undefined ? ` on version ${v.steeredFrom + 1}` : ""}`);
  if (v.edited) bits.push("edited");
  if (v.costUsd) bits.push(usd(v.costUsd));
  if (v.finishReason === "length") bits.push("cut off by max_tokens");
  if (v.stopped) bits.push("stopped");
  if (v.reasoning) bits.push(`reasoning ${v.reasoning.length} chars (--json)`);
  return bits;
}

/** An image's state in one line: "image img_… done (webp)", "image img_… pending", "image failed: why". */
export function imageLine(img: ImageRecord): string {
  const shown = img.previous ? `; ${img.previous.id} still shown` : "";
  if (img.status === "pending") return `image ${img.id} being made with ${img.model}${shown}`;
  if (img.status === "error") return `image ${img.id} failed: ${img.error ?? "unknown error"}${shown}`;
  const bits = [img.mime?.replace("image/", "") ?? "", img.costUsd !== undefined ? usd(img.costUsd) : "", img.blurred ? "blurred by safe mode" : "", img.contentViolation ? "content policy flag" : ""].filter(Boolean);
  return `image ${img.id} done${bits.length ? ` (${bits.join(", ")})` : ""}`;
}

/** One message as message.get, message.edit and message.select-version return it. */
export type MessageView = { conversationId: string; author: string; message: LedgerMessage };

export function formatMessage({ conversationId, author, message: m }: MessageView, opts?: FormatOpts): string {
  const count = { folded: 0 };
  const out = [`${author} · ${m.id} · ${m.versions.length} version${m.versions.length === 1 ? "" : "s"}, version ${m.activeVersion + 1} active`];
  m.versions.forEach((v, i) => {
    const bits = [`version ${i + 1}/${m.versions.length}${i === m.activeVersion ? " (active)" : ""}`, v.source, ...versionBits(v, m.kind)];
    out.push("", `── ${bits.join(" · ")} ──`, shown(v.content, m.kind, opts, count));
  });
  if (count.folded) out.push("", revealHint(count.folded, revealMessage(conversationId, m.id)));
  return out.join("\n");
}

/** The command that shows one message's hidden notes. */
export const revealMessage = (conversationId: string, messageId: string) =>
  `./ss message.get --conversation ${conversationId} --message ${messageId} --reveal`;

export type Preview = {
  conversationId: string;
  brainId: string;
  brainName: string;
  body: ChatRequest;
  /** Plain-language notes on text the provider adds that we can't show (e.g. reasoning on). */
  notes: string[];
  /** turn (or message.regenerate) would refuse to send this body as it stands, and why. */
  refusal?: string;
  /** Set for prompt.preview --regenerate: which message gets the new version, and how it is asked for. */
  regenerate?: { messageId: string; newVersion: number; steer?: string; steeredFrom?: number };
  /**
   * Image brains (T05): the /image/generate request their prompt goes into. `params` is the exact body except
   * `prompt`, which is the prompt the generate_image call writes, word for word. `notes` say which image settings
   * this model can't take and so are left out.
   */
  image?: { path: "/image/generate"; params: Omit<ImageRequest, "prompt">; notes: string[] };
};

/** The exact body: every non-message field as JSON, then each message's content verbatim. */
export function formatPreview(p: Preview): string {
  const { messages, ...rest } = p.body;
  const r = p.regenerate;
  const out = [
    `Exact request for brain "${p.brainName}" (${p.brainId}): POST /chat/completions`,
    ...(r
      ? [
          r.steer === undefined
            ? `Regenerating ${r.messageId} as version ${r.newVersion}: a plain re-roll, so the message is left out.`
            : `Regenerating ${r.messageId} as version ${r.newVersion}: version ${r.steeredFrom! + 1} stays in, then the steer. Only this request carries them both.`,
        ]
      : []),
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
  if (p.image) {
    out.push("", `Then POST ${p.image.path}, with "prompt" set to the prompt from its tool call, word for word:`, JSON.stringify(p.image.params));
    out.push(...p.image.notes.map((n) => `Note: ${n}`));
  }
  out.push("", "(--json prints the body exactly as it is sent.)");
  if (p.refusal) out.push(`Note: ${r ? "message.regenerate" : "turn"} would not send this as it stands. ${p.refusal}`);
  return out.join("\n");
}
