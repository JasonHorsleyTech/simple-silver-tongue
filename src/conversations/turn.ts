import { badRequest, CommandError, notFound } from "../lib/errors.ts";
import { newId, nowIso } from "../lib/ids.ts";
import type { StreamEvent } from "../registry.ts";
import type { ChatEvent } from "../venice/chat.ts";
import type { VeniceClient } from "../venice/client.ts";
import type { ModelInfo } from "../venice/models.ts";
import { activeVersion, assembleRequest, nothingToAnswer, REASONING_NOTE, reasoningOn, render, resolveBrain, templateProblem, type ModelCaps, type PinnedAt } from "./prompt.ts";
import { newMuse } from "./defaults.ts";
import { nextMadeName } from "./makers.ts";
import { partialPrompt, type ToolCallParts } from "./tool-call.ts";
import { findHidden, isAllHidden } from "./hidden.ts";
import { freshTakeNote, isMuse, makesNote, MUSE_NAME, museMakesNote, PIN_AS_WORDS, pinnedNote, ROLL_PREVIEW_NOTE, STOP_REASONING_NOTE, stopNote } from "./wording.ts";
import type { Brain, ChatRequest, Conversation, LedgerMessage, MessageVersion, Roll, Usage } from "./types.ts";

/**
 * What a turn will do, worked out without side effects. prompt.preview returns plan.body; turn sends exactly
 * plan.body. Both go through this one function, so the preview is the request.
 */
export type TurnPlan = {
  brain: Brain;
  /** The player message the turn will append first, or null when content is empty (the brain just responds). */
  player: LedgerMessage | null;
  /** T09: a roll-and-send's roll, appended after the player message (if any). Null without a roll. */
  roll: LedgerMessage | null;
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
  /** T16: where the messages pinned to this brain went in the body (right after the setup). Empty without pins. */
  pinned: PinnedAt[];
};

/**
 * `roll` (T09) makes it a roll-and-send: your text first (if any), then the roll's message, then the brain answers.
 * turn passes the Roll the server just made (dice.ts). prompt.preview passes "unrolled": the die isn't rolled until
 * the turn is sent, so the roll's line keeps {{roll}} where the number will go, and a note says so. That one
 * placeholder is the only difference from the body turn sends.
 */
export function planTurn(conv: Conversation, opts: { brain?: string; content?: string; roll?: Roll | "unrolled" }, model: ModelCaps): TurnPlan {
  const brain = resolveBrain(conv, opts.brain);
  const content = opts.content ?? "";
  const createdAt = nowIso();
  const player = content.trim() ? newMessage({ type: "player" }, "text", { content, source: "authored", createdAt }) : null;
  const roll = opts.roll ? rollMessage(conv, opts.roll === "unrolled" ? null : opts.roll, createdAt) : null;
  const added = [player, roll].filter((m): m is LedgerMessage => m !== null);
  const view = added.length ? { ...conv, messages: [...conv.messages, ...added] } : conv;
  const { body, pinned } = assembleRequest(view, brain.id, { model });
  const review = reviewBody(brain, body, model, { conv, pinned });
  if (opts.roll === "unrolled") review.notes.unshift(ROLL_PREVIEW_NOTE);
  // T16: sending to a brain that makes brains has a side effect, so the payload view says what it will make.
  if (brain.makes?.enabled) review.notes.push(makesNote(brain.name, nextMadeName(conv, brain.makes).name));
  return { brain, player, roll, body, ...review };
}

/**
 * A roll as a ledger message (T09): the player's, whose text is the conversation's roll template with the number
 * in it. Every brain reads that text, framed like any player message; `roll` keeps what the die said, for display.
 * With no roll (a preview), {{roll}} stays as typed. A template without {{roll}} is refused, as buildRequest
 * refuses the other templates without their placeholder (files written before conversation.update checked it).
 */
export function rollMessage(conv: Conversation, roll: Roll | null, createdAt = nowIso()): LedgerMessage {
  const problem = templateProblem("roll", conv.templates.roll);
  if (problem) throw new CommandError(400, "bad_template", problem);
  const version: MessageVersion = { content: render(conv.templates.roll, roll ? { roll: String(roll.result) } : {}), source: "authored", createdAt };
  if (roll) version.roll = roll;
  return newMessage({ type: "player" }, "text", version);
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
  /**
   * A fresh take: the Muse's note as it is saved (verbatim; with `wrap`, inside the thought template), and stored on
   * the new version for display. The message is left out, as in a re-roll; the note goes in right before it (T17).
   */
  thought?: string;
  /** T17: with a thought, the Muse's note the send saves (after Venice takes the request) right before the message. */
  note?: MuseNotePlan;
  body: ChatRequest;
} & BodyReview;

/**
 * T17: a fresh take's note, as the send will save it. It is the Muse's (the brain called Muse, added when there is
 * none), right before the message being regenerated: a new message, or, when the message right before is already
 * the Muse's note (written by you: its active version is authored), a new version of that note (the same note, its
 * own pager), or that note as it is when it already says exactly this.
 */
export type MuseNotePlan = {
  /** The note as it will be: a new message by the Muse, or the note right before the message with this version active. */
  message: LedgerMessage;
  /** The (0-based) version that holds the text. */
  version: number;
  /** A new message (no Muse note right before the message yet). */
  isNew: boolean;
  /** The note right before the message already says exactly this: nothing is added, the reply is just asked again. */
  same: boolean;
  /** The Muse: the brain called Muse, or a new one the send adds (museCreated). */
  muse: Brain;
  museCreated: boolean;
};

/**
 * Only the last ledger message can be regenerated, and only when a brain wrote it; the message's own brain
 * answers. A blank steer means a plain re-roll. With a steer the active version stays in, as the brain's own
 * last reply, so the model can see what "your previous response" is (T02 live probe); without one the message
 * is left out and the brain answers the history before it. Either way the steer is in this one request only.
 *
 * With a thought (a fresh take) the message is left out too, and the thought is the Muse's note (T17): a ledger
 * message of its own right before the message (planMuseNote), framed like any helper's, so the request ends on it
 * or on the brain's reminder: a user message, whatever the brain. The brain never sees the reply it replaces. The
 * thought is sent exactly as given (never trimmed); `wrap` puts it into the conversation's thought template first,
 * as the browser's box starts. A blank thought, or one with a steer, is refused.
 */
export function planRegenerate(conv: Conversation, opts: { message?: string; steer?: string; thought?: string; wrap?: boolean }, model: ModelCaps): RegeneratePlan {
  if (opts.thought !== undefined && opts.steer !== undefined) {
    throw badRequest("A regenerate takes a steer (revise the reply on screen) or a thought (a fresh take: a note from the Muse), not both.");
  }
  if (opts.wrap && opts.thought === undefined) throw badRequest("wrap puts your thought into the thought template: give the thought too (--thought).");
  if (opts.thought !== undefined && !opts.thought.trim()) {
    throw badRequest("A thought can't be blank: it is the Muse's note the brain answers. Leave it out for a plain re-roll.");
  }
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
  const thought = opts.thought !== undefined && opts.wrap ? wrapThought(conv, opts.thought, brain.name) : opts.thought;

  const steer = opts.steer?.trim() || undefined;
  const fresh = thought !== undefined ? planMuseNote(conv, message, brain, thought) : null;
  const { body, pinned } = steer
    ? assembleRequest(conv, brain.id, { model, steer })
    : assembleRequest(fresh?.view ?? conv, brain.id, { model, excludeFromMessageId: message.id });
  const review = reviewBody(brain, body, model, { conv: fresh?.view ?? conv, pinned });
  if (review.refusal && !steer && !fresh && body.messages.at(-1)?.role === "assistant" && !endsOnPin(body, pinned)) {
    // A plain re-roll whose message comes right after the same brain's own reply. When nothing comes before
    // it at all, nothingToAnswer's "only its system prompt" already says why (T03 QA-4).
    review.refusal = `Without ${message.id}, the request would end with ${brain.name}'s own earlier reply, so a plain re-roll has nothing to answer. Give it a steer, or edit the message instead.`;
  }
  const plan: RegeneratePlan = { brain, message, body, ...review };
  if (steer) {
    plan.steer = steer;
    plan.steeredFrom = message.activeVersion;
  }
  if (fresh) {
    const n = fresh.note;
    const text = activeVersion(n.message).content;
    const shown = isAllHidden(text) ? "folded" : findHidden(text).length ? "partly" : "plain";
    plan.thought = thought;
    plan.note = n;
    plan.notes.unshift(
      freshTakeNote({ brain: brain.name, messageId: message.id, noteId: n.message.id, muse: n.muse.name, isNew: n.isNew, version: n.version + 1, same: n.same, museCreated: n.museCreated, shown }),
    );
    if (n.isNew && n.muse.makes?.enabled) plan.notes.push(museMakesNote(n.muse.name, nextMadeName(conv, n.muse.makes).name));
  }
  return plan;
}

/**
 * T17: where a fresh take's note goes, and the ledger the request is built from with it in place (`view`; nothing
 * is saved). The note is written by the Muse, the brain called Muse (a new one, from newMuse, when there is none);
 * it goes right before `message`, or, when the message right before is already the Muse's note (one you wrote,
 * not one it generated), becomes that note's new version (or stays as it is, when it already says exactly this).
 * Refused when the Muse is an image brain (rename it, and the next fresh take adds a text one), or when `message`
 * is the Muse's own note.
 */
export function planMuseNote(conv: Conversation, message: LedgerMessage, brain: Brain, text: string): { note: MuseNotePlan; view: Conversation } {
  const existing = conv.brains.find(isMuse);
  if (existing && existing.kind !== "text") {
    // A 400, not a 409: nothing is running, and the browser reads every `conflict` as "a reply is being written" (T17 QA-3).
    throw new CommandError(
      400,
      "bad_brain",
      `A fresh take's note is written by the brain called ${MUSE_NAME}, and ${existing.name} here is an image brain. Rename it (brain.update --brain "${existing.name}" --name ...), and the next fresh take adds a text ${MUSE_NAME}.`,
    );
  }
  if (existing && existing.id === brain.id) {
    throw badRequest(`${message.id} is ${existing.name}'s own note, so there is no reply to take afresh: edit it, or regenerate it without a thought.`);
  }
  const muse = existing ?? newMuse(conv);
  const at = conv.messages.indexOf(message);
  const prev = at > 0 ? conv.messages[at - 1] : undefined;
  const createdAt = nowIso();
  const version: MessageVersion = { content: text, source: "authored", createdAt };
  // Only a note you wrote (an earlier fresh take's, or one added by hand) is re-versioned. Anything the Muse brain
  // generated on a turn of its own (its own twist, or a poem from a brain that only happens to be called Muse) is
  // its own message, and stays: the fresh take's note goes in after it (T17 QA-1).
  const ours = existing && prev && prev.kind === "text" && prev.author.type === "brain" && prev.author.brainId === existing.id && activeVersion(prev).source === "authored" ? prev : null;
  let note: MuseNotePlan;
  let messages: LedgerMessage[];
  if (ours) {
    const same = activeVersion(ours).content === text;
    const message = same ? ours : { ...ours, versions: [...ours.versions, version], activeVersion: ours.versions.length, updatedAt: createdAt };
    note = { message, version: message.activeVersion, isNew: false, same, muse, museCreated: false };
    messages = conv.messages.map((m) => (m === ours ? message : m));
  } else {
    const message = newMessage({ type: "brain", brainId: muse.id }, "text", version);
    note = { message, version: 0, isNew: true, same: false, muse, museCreated: !existing };
    messages = [...conv.messages.slice(0, at), message, ...conv.messages.slice(at)];
  }
  return { note, view: { ...conv, brains: existing ? conv.brains : [...conv.brains, muse], messages } };
}

/**
 * T15: `--wrap`: the thought inside the conversation's thought template, where {{thought}} is. T17: {{brain}} is the
 * brain the note is for (the one whose message is being taken afresh).
 */
export function wrapThought(conv: Conversation, thought: string, brain: string): string {
  const problem = templateProblem("thought", conv.templates.thought);
  if (problem) throw new CommandError(400, "bad_template", problem);
  return render(conv.templates.thought, { thought, brain });
}

/**
 * The checks every plan shares (planTurn and planRegenerate), so a new plan can't miss one.
 * The send path re-checks the refusal on its own (assertAnswerable in openChatStream).
 */
export function reviewBody(
  brain: Brain,
  body: ChatRequest,
  model: ModelCaps,
  pins: { conv: Pick<Conversation, "messages" | "brains">; pinned: PinnedAt[] } = { conv: { messages: [], brains: [] }, pinned: [] },
): BodyReview {
  const review: BodyReview = { notes: [], pinned: pins.pinned };
  if (pins.pinned.length) {
    const author = (id: string) => {
      const m = pins.conv.messages.find((x) => x.id === id);
      if (!m || m.author.type === "player") return undefined;
      const by = m.author.brainId;
      return pins.conv.brains.find((b) => b.id === by)?.name ?? by;
    };
    review.notes.push(pinnedNote(brain.name, pins.pinned.map((p) => ({ messageId: p.messageId, as: p.as, author: author(p.messageId) }))));
  }
  const refusal = nothingToAnswer(body, brain.name);
  const lastPin = endsOnPin(body, pins.pinned);
  if (refusal) review.refusal = lastPin ? pinnedLastRefusal(brain.name, lastPin) : refusal;
  if (reasoningOn(brain, model)) review.notes.push(REASONING_NOTE);
  if (body.stop?.length) review.notes.push(stopNote(body.stop));
  if (body.stop?.length && reasoningOn(brain, model)) review.notes.push(STOP_REASONING_NOTE);
  return review;
}

/** The pin a body ends on, if it does: nothing in the ledger comes after the messages moved to the top (T16 QA-9). */
export const endsOnPin = (body: Pick<ChatRequest, "messages">, pinned: PinnedAt[]) => pinned.find((p) => p.index === body.messages.length - 1);

/** nothingToAnswer's words when the body ends on a pinned message: it isn't the brain's reply, or a setup message. */
const pinnedLastRefusal = (brain: string, pin: PinnedAt) =>
  `The request would end with ${pin.messageId}, which is pinned to ${brain} and sent ${PIN_AS_WORDS[pin.as]}, so there is nothing after it for ${brain} to answer. Write a message for it first.`;

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
