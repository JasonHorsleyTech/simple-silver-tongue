import { CommandError } from "../lib/errors.ts";
import { newId, nowIso } from "../lib/ids.ts";
import type { StreamEvent } from "../registry.ts";
import type { ChatEvent } from "../venice/chat.ts";
import type { VeniceClient } from "../venice/client.ts";
import type { ModelInfo } from "../venice/models.ts";
import { buildRequest, nothingToAnswer, REASONING_NOTE, reasoningOn, resolveBrain, type ModelCaps } from "./prompt.ts";
import type { Brain, ChatRequest, Conversation, LedgerMessage, MessageVersion, Usage } from "./types.ts";

/**
 * What a turn will do, worked out without side effects. prompt.preview returns plan.body; turn sends exactly
 * plan.body. Both go through this one function, so the preview is the request.
 */
export type TurnPlan = {
  brain: Brain;
  /** The player message the turn will append first, or null when content is empty (the brain just responds). */
  player: LedgerMessage | null;
  body: ChatRequest;
} & BodyReview;

/** What every plan says about its body, beside the body itself. */
export type BodyReview = {
  /** Set when the send path would refuse this body. prompt.preview still shows the body, with this note. */
  refusal?: string;
  /** Plain-language notes the payload view shows with the body: text the provider adds that we can't show. */
  notes: string[];
};

export function planTurn(conv: Conversation, opts: { brain?: string; content?: string }, model: ModelCaps): TurnPlan {
  const brain = resolveBrain(conv, opts.brain);
  const content = opts.content ?? "";
  const player = content.trim() ? newMessage({ type: "player" }, "text", { content, source: "authored", createdAt: nowIso() }) : null;
  const view = player ? { ...conv, messages: [...conv.messages, player] } : conv;
  const body = buildRequest(view, brain.id, { model });
  return { brain, player, body, ...reviewBody(brain, body, model) };
}

/**
 * The checks every plan shares (planTurn now, T03's planRegenerate next), so a new plan can't miss one.
 * The send path re-checks the refusal on its own (assertAnswerable in openChatStream).
 */
export function reviewBody(brain: Brain, body: ChatRequest, model: ModelCaps): BodyReview {
  const review: BodyReview = { notes: [] };
  const refusal = nothingToAnswer(body, brain.name);
  if (refusal) review.refusal = refusal;
  if (reasoningOn(brain, model)) review.notes.push(REASONING_NOTE);
  return review;
}

export function newMessage(author: LedgerMessage["author"], kind: LedgerMessage["kind"], version: MessageVersion, id = newId("m")): LedgerMessage {
  return { id, author, kind, versions: [version], activeVersion: 0, createdAt: version.createdAt, updatedAt: version.createdAt };
}

/** The model's capabilities from the cached /models list. An unknown model is refused before anything is sent. */
export async function lookupModel(venice: VeniceClient, type: "text" | "image", id: string): Promise<ModelInfo> {
  const { models } = await venice.listModels(type);
  const m = models.find((x) => x.id === id);
  if (!m) {
    throw new CommandError(
      400,
      "unknown_model",
      `Venice has no ${type} model "${id}". See ./ss models.list --type ${type}, then set it with ./ss conversation.update --id <conversation> --settings.${type}-model <id>.`,
    );
  }
  return m;
}

export type Reply = {
  content: string;
  reasoning: string;
  toolArgs: string;
  finishReason?: string;
  usage?: Usage;
  costUsd?: number;
};

/**
 * Relay a chat stream as NDJSON events (reasoning, delta, tool_args) while collecting the whole reply,
 * which is the generator's return value: `const reply = yield* relayReply(events)`.
 */
export async function* relayReply(events: AsyncIterable<ChatEvent>): AsyncGenerator<StreamEvent, Reply> {
  const reply: Reply = { content: "", reasoning: "", toolArgs: "" };
  for await (const ev of events) {
    switch (ev.type) {
      case "reasoning":
        reply.reasoning += ev.delta;
        yield { type: "reasoning", delta: ev.delta };
        break;
      case "content":
        reply.content += ev.delta;
        yield { type: "delta", delta: ev.delta };
        break;
      case "tool_call":
        reply.toolArgs += ev.argsDelta;
        if (ev.argsDelta) yield { type: "tool_args", delta: ev.argsDelta };
        break;
      case "finish":
        reply.finishReason = ev.reason;
        break;
      case "usage":
        reply.usage = ev.usage;
        if (ev.costUsd !== undefined) reply.costUsd = ev.costUsd;
        break;
    }
  }
  return reply;
}

/** A generated version from a finished reply. Reasoning is kept for display only; the builder never sends it. */
export function generatedVersion(reply: Reply, model: string): MessageVersion {
  const v: MessageVersion = { content: reply.content, source: "generated", model, createdAt: nowIso() };
  if (reply.reasoning) v.reasoning = reply.reasoning;
  if (reply.finishReason) v.finishReason = reply.finishReason;
  if (reply.usage) v.usage = reply.usage;
  if (reply.costUsd !== undefined) v.costUsd = reply.costUsd;
  return v;
}

/** Total spent on a conversation: every version that was ever generated, active or not. */
export function totalCost(conv: Conversation): number {
  let sum = 0;
  for (const m of conv.messages) for (const v of m.versions) sum += v.costUsd ?? 0;
  return sum;
}
