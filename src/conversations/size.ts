import { compactionCut } from "./compaction.ts";
import type { Brain, ChatRequest, Conversation, Usage } from "./types.ts";
import { CHARS_PER_TOKEN, TOKENS_PER_MESSAGE } from "./wording.ts";

/**
 * T20, the token counter: how big a brain's prompt is. Venice counts it with every reply (each version's `usage`), so
 * the last real count is a lookup; before a request is sent, all there is is an estimate from its characters, which
 * says it is one. Dependency-free, so the browser can show the same numbers.
 */

/** A body's size before it is sent: its characters (every message's text, tool calls and tool text), and an estimate in tokens. */
export function estimateSize(body: Pick<ChatRequest, "messages" | "tools">): { chars: number; tokens: number } {
  let chars = 0;
  for (const m of body.messages) {
    chars += m.content.length;
    if (m.role === "assistant" && m.tool_calls) for (const c of m.tool_calls) chars += c.function.name.length + c.function.arguments.length;
  }
  if (body.tools) chars += JSON.stringify(body.tools).length;
  return { chars, tokens: Math.ceil(chars / CHARS_PER_TOKEN) + TOKENS_PER_MESSAGE * body.messages.length };
}

/**
 * The last real count for a brain: the newest version it wrote that Venice counted (its request's prompt tokens, cached
 * ones included). `messagesAgo`: how many ledger messages came after that message. `beforeCut`: the newest compaction
 * was written after it was counted (wherever it sits in the ledger), so its next request is cut, and probably smaller.
 */
export type LastCount = {
  messageId: string;
  version: number;
  at: string;
  model?: string;
  promptTokens: number;
  cachedTokens?: number;
  completionTokens: number;
  messagesAgo: number;
  beforeCut?: true;
};

export function lastCount(conv: Pick<Conversation, "brains" | "messages">, brainId: string): LastCount | null {
  let best: LastCount | null = null;
  for (const [i, m] of conv.messages.entries()) {
    if (m.author.type !== "brain" || m.author.brainId !== brainId) continue;
    for (const [j, v] of m.versions.entries()) {
      if (!v.usage || (best && v.createdAt < best.at)) continue;
      const u: Usage = v.usage;
      best = { messageId: m.id, version: j + 1, at: v.createdAt, promptTokens: u.promptTokens, completionTokens: u.completionTokens, messagesAgo: conv.messages.length - 1 - i };
      if (u.cachedTokens) best.cachedTokens = u.cachedTokens;
      if (v.model) best.model = v.model;
    }
  }
  if (!best) return null;
  const cut = conv.messages[compactionCut(conv, conv.messages)];
  // When it was written: the version in use, so a compaction re-rolled at depth (same message, a newer version) counts too.
  if (cut && (cut.versions[cut.activeVersion]?.createdAt ?? cut.createdAt) > best.at) best.beforeCut = true;
  return best;
}

/** T20: prompt.size's answer: each brain's last real count and the estimate of its request now. */
export type PromptSizes = {
  conversationId: string;
  title: string;
  messageCount: number;
  /** The newest compaction, where every request starts, and how many messages are before it. Absent: no cut. */
  cut?: { messageId: string; before: number };
  brains: Array<{
    brainId: string;
    name: string;
    kind: Brain["kind"];
    model: string;
    contextLength?: number;
    /** Venice's count for its newest reply (lastCount). Absent: it has no reply Venice counted. */
    last?: LastCount;
    /** Its request if it took a turn now, with no new message: characters, and an estimate in tokens. */
    now?: { chars: number; tokens: number };
    /** Why its request can't be built now (its model is unknown, say). */
    error?: string;
  }>;
};
