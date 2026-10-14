import { CommandError, notFound } from "../lib/errors.ts";
import { newId, nowIso } from "../lib/ids.ts";
import type { StreamEvent } from "../registry.ts";
import type { ChatEvent } from "../venice/chat.ts";
import type { VeniceClient } from "../venice/client.ts";
import type { ModelInfo } from "../venice/models.ts";
import { buildRequest, nothingToAnswer, REASONING_NOTE, reasoningOn, resolveBrain, type ModelCaps } from "./prompt.ts";
import { partialPrompt, type ToolCallParts } from "./tool-call.ts";
import { STOP_REASONING_NOTE, stopNote } from "./wording.ts";
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
  /**
   * Plain-language notes the payload view shows with the body: text the provider adds that we can't show
   * (reasoning on), and what the body's stop sequences do (T07 triage).
   */
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
 * What a regenerate will send (docs/design.md, "Turns, regeneration and edits"). message.regenerate sends
 * plan.body and prompt.preview --regenerate returns it, so the steered request can be previewed exactly.
 */
export type RegeneratePlan = {
  brain: Brain;
  /** The message that gets a new version: always the last one in the ledger, written by a brain. */
  message: LedgerMessage;
  /** The steer as it is sent and stored (trimmed). Absent: a plain re-roll. */
  steer?: string;
  /** With a steer: the index of the version it revises (the active one, which stays in the request). */
  steeredFrom?: number;
  body: ChatRequest;
} & BodyReview;

/**
 * Only the last ledger message can be regenerated, and only when a brain wrote it; the message's own brain
 * answers. A blank steer means a plain re-roll. With a steer the active version stays in, as the brain's own
 * last reply, so the model can see what "your previous response" is (T02 live probe); without one the message
 * is left out and the brain answers the history before it. Either way the steer is in this one request only.
 */
export function planRegenerate(conv: Conversation, opts: { message?: string; steer?: string }, model: ModelCaps): RegeneratePlan {
  const last = conv.messages.at(-1);
  if (!last) throw new CommandError(400, "nothing_to_regenerate", "This conversation has no messages yet, so there is nothing to regenerate.");
  const message = opts.message ? conv.messages.find((m) => m.id === opts.message) : last;
  if (!message) throw notFound(`No message ${opts.message} in this conversation.`);
  if (message !== last) {
    throw new CommandError(
      400,
      "not_last_message",
      `Only the last message can be regenerated, and ${message.id} is not the last one (${last.id} is). To change an earlier message, edit it.`,
    );
  }
  if (message.author.type !== "brain") {
    throw new CommandError(
      400,
      "not_a_brain_message",
      `${message.id} is your own message, so there is no reply to regenerate. Edit it, or ask a brain to answer it.`,
    );
  }
  const brainId = message.author.brainId;
  const brain = conv.brains.find((b) => b.id === brainId);
  if (!brain) throw new Error(`message ${message.id}: author brain ${brainId} is missing from conversation ${conv.id}`);

  const steer = opts.steer?.trim() || undefined;
  const body = steer
    ? buildRequest(conv, brain.id, { model, steer })
    : buildRequest(conv, brain.id, { model, excludeFromMessageId: message.id });
  const review = reviewBody(brain, body, model);
  if (review.refusal && !steer && body.messages.at(-1)?.role === "assistant") {
    // A plain re-roll whose message comes right after the same brain's own reply. When nothing comes before
    // it at all, nothingToAnswer's "only its system prompt" already says why (T03 QA-4).
    review.refusal = `Without ${message.id}, the request would end with ${brain.name}'s own earlier reply, so a plain re-roll has nothing to answer. Give it a steer, or edit the message instead.`;
  }
  const plan: RegeneratePlan = { brain, message, body, ...review };
  if (steer) {
    plan.steer = steer;
    plan.steeredFrom = message.activeVersion;
  }
  return plan;
}

/**
 * The checks every plan shares (planTurn and planRegenerate), so a new plan can't miss one.
 * The send path re-checks the refusal on its own (assertAnswerable in openChatStream).
 */
export function reviewBody(brain: Brain, body: ChatRequest, model: ModelCaps): BodyReview {
  const review: BodyReview = { notes: [] };
  const refusal = nothingToAnswer(body, brain.name);
  if (refusal) review.refusal = refusal;
  if (reasoningOn(brain, model)) review.notes.push(REASONING_NOTE);
  if (body.stop?.length) review.notes.push(stopNote(body.stop));
  if (body.stop?.length && reasoningOn(brain, model)) review.notes.push(STOP_REASONING_NOTE);
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
  /** Tool calls by `index`, in the order they started (an image brain makes one; see tool-call.ts). */
  toolCalls: ToolCallParts[];
  /** The first tool call's prompt as far as it has been decoded: what the `prompt` events have streamed. */
  prompt: string;
  finishReason?: string;
  usage?: Usage;
  costUsd?: number;
  /** generation.stop cut it short: this is what had arrived. */
  stopped?: true;
  /**
   * With `stopped`: the unread rest of the Venice stream. Venice finishes and bills a stopped reply anyway
   * (T03 QA-2), so the caller drains it for the usage and cost (drainStopped in commands/chat.ts).
   */
  rest?: AsyncIterable<ChatEvent>;
};

const STOP = Symbol("stop");

/** Resolves with STOP once the signal aborts. */
export function untilAborted(signal: AbortSignal): Promise<typeof STOP> {
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(STOP), { once: true }));
}

/**
 * Relay a chat stream as NDJSON events (reasoning, delta, prompt) while collecting the whole reply,
 * which is the generator's return value: `const reply = yield* relayReply(events, stop)`. A stop
 * (generation.stop) is not an error here: the relay ends at once and the reply so far comes back with
 * `stopped: true`, plus the unread `rest` of the stream. The Venice request itself is left running.
 */
export async function* relayReply(events: AsyncIterable<ChatEvent>, stop?: AbortSignal): AsyncGenerator<StreamEvent, Reply> {
  const reply: Reply = { content: "", reasoning: "", toolCalls: [], prompt: "" };
  const it = events[Symbol.asyncIterator]();
  const stopped = stop && untilAborted(stop);
  const halt = (pending?: Promise<IteratorResult<ChatEvent>>) => {
    reply.stopped = true;
    reply.rest = rest(it, pending);
    return reply;
  };
  for (;;) {
    if (stop?.aborted) return halt();
    const next = it.next();
    const r = stopped ? await Promise.race([stopped, next]) : await next;
    if (r === STOP) return halt(next);
    if (r.done) return reply;
    yield* handle(r.value, reply);
  }
}

/** The stream from where the relay left it, starting with the read that was in flight when the stop came. */
function rest(it: AsyncIterator<ChatEvent>, pending?: Promise<IteratorResult<ChatEvent>>): AsyncIterable<ChatEvent> {
  pending?.catch(() => {}); // a stream that breaks before the drain starts is not an unhandled rejection
  return (async function* () {
    for (let r = await (pending ?? it.next()); !r.done; r = await it.next()) yield r.value;
  })();
}

/** One upstream event into the reply, and the NDJSON event the client sees, if any. */
function* handle(ev: ChatEvent, reply: Reply): Generator<StreamEvent, void> {
  switch (ev.type) {
    case "reasoning":
      reply.reasoning += ev.delta;
      yield { type: "reasoning", delta: ev.delta };
      break;
    case "content":
      reply.content += ev.delta;
      yield { type: "delta", delta: ev.delta };
      break;
    case "tool_call": {
      // Fragments are kept apart by index, so parallel calls can't be glued into one invalid JSON (T02 QA-7).
      let call = reply.toolCalls.find((c) => c.index === ev.index);
      if (!call) reply.toolCalls.push((call = { index: ev.index, args: "" }));
      if (ev.id) call.id = ev.id;
      if (ev.name) call.name = ev.name;
      call.args += ev.argsDelta;
      if (call !== reply.toolCalls[0] || !ev.argsDelta) break;
      // The first call's prompt, decoded as it arrives: the client sees the words, not JSON fragments.
      const text = partialPrompt(call.args)?.text ?? "";
      if (text.length > reply.prompt.length && text.startsWith(reply.prompt)) {
        yield { type: "prompt", delta: text.slice(reply.prompt.length) };
        reply.prompt = text;
      }
      break;
    }
    case "finish":
      reply.finishReason = ev.reason;
      break;
    case "usage":
      reply.usage = ev.usage;
      if (ev.costUsd !== undefined) reply.costUsd = ev.costUsd;
      break;
  }
}

/** A generated version from a finished reply. Reasoning is kept for display only; the builder never sends it. */
export function generatedVersion(reply: Reply, model: string): MessageVersion {
  const v: MessageVersion = { content: reply.content, source: "generated", model, createdAt: nowIso() };
  if (reply.reasoning) v.reasoning = reply.reasoning;
  if (reply.finishReason) v.finishReason = reply.finishReason;
  if (reply.usage) v.usage = reply.usage;
  if (reply.costUsd !== undefined) v.costUsd = reply.costUsd;
  if (reply.stopped) v.stopped = true;
  return v;
}

/**
 * What a conversation has cost so far (T03 QA-2): `spentUsd`, which only ever grows, so deleting a message or
 * stopping a reply doesn't hide money already spent. Files from before it have no `spentUsd`; for them the
 * versions still in the ledger are the record.
 */
export function totalCost(conv: Conversation): number {
  if (conv.spentUsd !== undefined) return conv.spentUsd;
  let sum = 0;
  for (const m of conv.messages) for (const v of m.versions) sum += v.costUsd ?? 0;
  return sum;
}

/**
 * Add a reply's cost to the running total, inside mutateConversation. Call it before the change that adds or
 * removes versions: for an older file it first pins the total from the versions as they are.
 */
export function addSpend(conv: Conversation, usd = 0): void {
  conv.spentUsd = totalCost(conv) + usd;
}
