import { z } from "zod";
import { formatPreview, type Preview } from "../conversations/format.ts";
import { beginGeneration, followGeneration, loadConversation, mutateConversation, stopGeneration, type StopOutcome } from "../conversations/store.ts";
import {
  generatedVersion,
  isStopped,
  lookupModel,
  newMessage,
  planRegenerate,
  planTurn,
  relayReply,
  type Reply,
} from "../conversations/turn.ts";
import type { ChatRequest, LedgerMessage } from "../conversations/types.ts";
import { badRequest, CommandError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { command, streamCommand, type Ctx, type StreamEvent } from "../registry.ts";
import { openChatStream } from "../venice/chat.ts";
import { usd } from "../venice/models.ts";
import { brainRef } from "./brains.ts";
import { conversationId } from "./conversations.ts";
import { messageId } from "./messages.ts";

const content = z
  .string()
  .optional()
  .describe("Your message (Markdown; @file.md or - for stdin). Empty or omitted: the brain just responds");

const steer = z
  .string()
  .optional()
  .describe('A one-off direction for this regenerate only ("say it\'s blue"). Never sent again. Blank or omitted: a plain re-roll');
const regenerateTarget = messageId.optional().describe("The message to regenerate: it must be the last one, written by a brain (default: the last message)");

export const promptPreview = command({
  name: "prompt.preview",
  description: `Show the exact request body a brain would be sent, built by the same code path as turn and message.regenerate.
With --content, it shows what turn --content would send (your message included). With --regenerate (plus
--message and --steer), it shows what message.regenerate would send instead. Nothing is saved or sent.
--json prints the body byte for byte as it would go to Venice (minus the auth header), plus notes on text the
provider adds that we can't show (reasoning on), and the reason the send would be refused, if it would.`,
  args: z.object({
    conversation: conversationId,
    brain: brainRef.optional(),
    content,
    regenerate: z.boolean().optional().describe("Preview message.regenerate instead of turn (the message's own brain answers)"),
    message: regenerateTarget,
    steer,
  }),
  examples: [
    "./ss prompt.preview --conversation c_k3j9x0q2ma",
    './ss prompt.preview --conversation c_k3j9x0q2ma --content "Next message" --json',
    './ss prompt.preview --conversation c_k3j9x0q2ma --regenerate --steer "Make it iambic pentameter."',
  ],
  handler: async (args, ctx): Promise<Preview> => {
    if (!args.regenerate && (args.message !== undefined || args.steer !== undefined)) {
      throw badRequest("message and steer only apply to a regenerate preview: add regenerate (--regenerate).");
    }
    if (args.regenerate && (args.content !== undefined || args.brain !== undefined)) {
      throw badRequest("A regenerate preview takes no content or brain: the message's own brain answers the messages as they are.");
    }
    const conv = await loadConversation(ctx.requireSession().vault, args.conversation);
    const model = await lookupModel(ctx.deps.venice, "text", conv.settings.textModel);
    const plan = args.regenerate
      ? planRegenerate(conv, { message: args.message, steer: args.steer }, model)
      : planTurn(conv, { brain: args.brain, content: args.content }, model);
    const preview: Preview = { conversationId: conv.id, brainId: plan.brain.id, brainName: plan.brain.name, body: plan.body, notes: plan.notes };
    if (plan.refusal) preview.refusal = plan.refusal;
    if ("message" in plan) {
      preview.regenerate = { messageId: plan.message.id, newVersion: plan.message.versions.length + 1 };
      if (plan.steer !== undefined) Object.assign(preview.regenerate, { steer: plan.steer, steeredFrom: plan.steeredFrom });
    }
    return preview;
  },
  format: formatPreview,
});

const turnArgs = z.object({ conversation: conversationId, content, brain: brainRef.optional() });

export const turn = streamCommand({
  name: "turn",
  description: `Send a message and stream the brain's reply. Both are saved to the conversation.
Your message is saved once Venice accepts the request. If the reply then fails, your message stays and no
reply is saved: run turn again without --content to retry. One reply at a time per conversation (409 if busy).
Without --content the brain answers the ledger as it stands, which is refused when the brain's own reply is
already the last message (there is nothing new to answer). The reply prints to stdout as it streams;
reasoning and status lines go to stderr. Another terminal or a reloaded browser can watch it with
generation.follow.`,
  args: turnArgs,
  examples: [
    './ss turn --conversation c_k3j9x0q2ma --content "Hello there"',
    "./ss turn --conversation c_k3j9x0q2ma --content @message.md > reply.md",
    "./ss turn --conversation c_k3j9x0q2ma   # no message: the brain just responds",
  ],
  async *handler(args, ctx) {
    const gen = beginGeneration(ctx.requireSession().vault, args.conversation); // 409 before any event, so it's a real HTTP status
    try {
      yield* gen.relay(turnEvents(args, ctx, gen.signal));
    } finally {
      gen.release();
    }
  },
});

async function* turnEvents(args: z.output<typeof turnArgs>, ctx: Ctx, signal: AbortSignal): AsyncGenerator<StreamEvent, void, undefined> {
  const { vault } = ctx.requireSession();
  const conv = await loadConversation(vault, args.conversation);
  const model = await lookupModel(ctx.deps.venice, "text", conv.settings.textModel);
  const plan = planTurn(conv, { brain: args.brain, content: args.content }, model);
  if (plan.refusal) throw new CommandError(400, "nothing_to_answer", plan.refusal);
  if (plan.brain.kind !== "text") {
    throw new CommandError(400, "not_supported", `"${plan.brain.name}" is an image brain; image replies arrive in T05.`);
  }
  // Up-front refusals (no balance, bad model) throw here, before anything is saved.
  const upstream = await openUpstream(ctx, plan.body, signal, "Stopped before the reply started. Nothing was saved.");

  if (plan.player) {
    const player = plan.player;
    await mutateConversation(vault, conv.id, (c) => void c.messages.push(player));
    yield { type: "message", message: player };
  }
  const messageId = newId("m");
  yield { type: "start", brainId: plan.brain.id, brainName: plan.brain.name, messageId };

  const reply = yield* collectReply(upstream, {
    kept: plan.player ? "Your message is saved; the reply isn't." : "No reply was saved.",
    retry: "To retry, send again with no new message: turn without --content, or Retry in the browser.",
  });
  const message = newMessage({ type: "brain", brainId: plan.brain.id }, "text", generatedVersion(reply, plan.body.model), messageId);
  await mutateConversation(vault, conv.id, (c) => void c.messages.push(message));
  yield { type: "done", message, note: replyNote(plan.brain.name, reply) };
}

const regenerateArgs = z.object({ conversation: conversationId, message: regenerateTarget, steer });

export const messageRegenerate = streamCommand({
  name: "message.regenerate",
  description: `Write the last message again, as a new version that becomes the active one. Optionally steer it.
Only the last message can be regenerated, and only when a brain wrote it; that brain writes the new version.
Without --steer it is a fresh re-roll: the brain answers the messages before it. With --steer ("say it's blue")
the brain sees its current version, then your direction, and rewrites it. The steer is sent in this one request
only and stored for display; later requests see just the active version, as if the brain wrote it on its own.
Repeat as often as you like (each steer revises whichever version is active). Old versions are kept: go back
with message.select-version. prompt.preview --regenerate shows the exact request first. One reply at a time
per conversation (409 if busy); generation.follow watches it, generation.stop stops it.`,
  args: regenerateArgs,
  examples: [
    "./ss message.regenerate --conversation c_k3j9x0q2ma",
    './ss message.regenerate --conversation c_k3j9x0q2ma --steer "Say it\'s blue."',
    './ss message.regenerate --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a --steer @direction.md',
  ],
  async *handler(args, ctx) {
    const gen = beginGeneration(ctx.requireSession().vault, args.conversation); // 409 before any event
    try {
      yield* gen.relay(regenerateEvents(args, ctx, gen.signal));
    } finally {
      gen.release();
    }
  },
});

async function* regenerateEvents(args: z.output<typeof regenerateArgs>, ctx: Ctx, signal: AbortSignal): AsyncGenerator<StreamEvent, void, undefined> {
  const { vault } = ctx.requireSession();
  const conv = await loadConversation(vault, args.conversation);
  const model = await lookupModel(ctx.deps.venice, "text", conv.settings.textModel);
  const plan = planRegenerate(conv, { message: args.message, steer: args.steer }, model);
  if (plan.refusal) throw new CommandError(400, "nothing_to_answer", plan.refusal);
  if (plan.brain.kind !== "text") {
    throw new CommandError(400, "not_supported", `"${plan.brain.name}" is an image brain; regenerating images arrives in T05.`);
  }
  const id = plan.message.id;
  const keeps = `${id} keeps its current version.`;
  const upstream = await openUpstream(ctx, plan.body, signal, `Stopped before the new version started. ${keeps}`);

  const start: StreamEvent = { type: "start", brainId: plan.brain.id, brainName: plan.brain.name, messageId: id, regenerate: true };
  if (plan.steer !== undefined) start.steer = plan.steer;
  yield start;
  const reply = yield* collectReply(upstream, { kept: `No new version was saved; ${keeps}`, retry: "To retry, regenerate again." });

  const version = generatedVersion(reply, plan.body.model);
  if (plan.steer !== undefined) Object.assign(version, { steer: plan.steer, steeredFrom: plan.steeredFrom });
  const { result: message } = await mutateConversation(vault, conv.id, (c): LedgerMessage => {
    // Ledger edits are refused while this runs, so the message is still there; but say so if it isn't.
    const m = c.messages.find((x) => x.id === id);
    if (!m) throw new CommandError(409, "conflict", `${id} was deleted while its new version was being written, so the new version wasn't saved.`);
    m.versions.push(version);
    m.activeVersion = m.versions.length - 1;
    m.updatedAt = version.createdAt;
    return m;
  });
  const n = message.versions.length;
  yield { type: "done", message, note: replyNote(`${plan.brain.name} · version ${n}/${n}${plan.steer !== undefined ? " · steered" : ""}`, reply) };
}

/**
 * Open the Venice stream and wait for its headers, so an up-front refusal throws before anything is saved.
 * A stop that lands before Venice answers says what it left behind.
 */
async function openUpstream(ctx: Ctx, body: ChatRequest, signal: AbortSignal, stoppedText: string) {
  try {
    return await openChatStream(ctx.deps.venice, body, { signal });
  } catch (err) {
    throw isStopped(err) ? stopped(stoppedText) : err;
  }
}

const stopped = (message: string) => new CommandError(499, "stopped", message);

/**
 * Relay the reply and return it whole. A broken stream says what was kept and how to retry, in the message
 * the user actually reads (T02 QA-8). A stop keeps what had arrived; with no reply text there is nothing to
 * keep, so it ends as a "stopped" error instead.
 */
async function* collectReply(upstream: Parameters<typeof relayReply>[0], say: { kept: string; retry: string }): AsyncGenerator<StreamEvent, Reply> {
  let reply: Reply;
  try {
    reply = yield* relayReply(upstream);
  } catch (err) {
    if (err instanceof CommandError && err.code === "venice_error") {
      throw new CommandError(err.status, err.code, `${err.message} ${say.kept} ${say.retry}`, err.details);
    }
    throw err;
  }
  if (reply.stopped && !reply.content.trim()) throw stopped(`Stopped before any reply text arrived. ${say.kept}`);
  return reply;
}

export const generationFollow = streamCommand({
  name: "generation.follow",
  description: `Watch a reply that is being generated right now: from a second terminal, or a browser tab reloaded mid-reply.
It replays what has streamed so far, then streams the rest live and ends the way that turn does (done or error).
When nothing is being generated it ends at once, with an empty done ("message": null).`,
  args: z.object({ conversation: conversationId }),
  examples: ["./ss generation.follow --conversation c_k3j9x0q2ma"],
  async *handler(args, ctx) {
    const { vault } = ctx.requireSession();
    const live = followGeneration(vault, args.conversation);
    if (live) return yield* live;
    await loadConversation(vault, args.conversation); // an unknown id is a 404, not "nothing running"
    yield { type: "done", message: null, note: "Nothing is being generated for this conversation." };
  },
});

export const generationStop = command({
  name: "generation.stop",
  description: `Stop the reply being generated right now (turn or message.regenerate), from any terminal or tab.
What had arrived is kept, marked "stopped": a turn's partial reply is saved as the brain's message, and a
regenerate's as a new, active version, so you can edit it, regenerate it or delete it. If no reply text had
arrived yet, nothing is saved: a turn keeps only your message, a regenerate keeps the current version.
Venice reports no usage or cost for a stopped reply, so it isn't counted in the conversation's cost.
It returns once the stopped reply is saved.`,
  args: z.object({ conversation: conversationId }),
  examples: ["./ss generation.stop --conversation c_k3j9x0q2ma"],
  handler: async (args, ctx): Promise<StopOutcome> => {
    const { vault } = ctx.requireSession();
    const outcome = await stopGeneration(vault, args.conversation);
    if (outcome) return outcome;
    await loadConversation(vault, args.conversation); // an unknown id is a 404, not "nothing running"
    return { stopped: false, message: null };
  },
  format: (r: StopOutcome) => {
    if (!r.stopped) return "Nothing is being generated for this conversation.";
    const m = r.message;
    if (m) return `Stopped. What had arrived is saved: ${m.id}, version ${m.activeVersion + 1}/${m.versions.length}.`;
    // The stopped generation's own error says what it left behind ("Stopped before ... Nothing was saved.").
    return r.error?.code === "stopped" ? r.error.message : `Stopped. ${r.error ? r.error.message : "Nothing was saved."}`;
  },
});

/** The one-line summary the CLI prints after a reply. An empty reply says why, since it is saved as is (T02 QA-6). */
function replyNote(head: string, reply: Reply): string {
  const note = [head];
  if (reply.usage) note.push(`${reply.usage.promptTokens} in / ${reply.usage.completionTokens} out`);
  if (reply.costUsd !== undefined) note.push(usd(reply.costUsd));
  const empty = !reply.content.trim();
  if (reply.stopped) {
    note.push("stopped: what had arrived is saved (Venice reports no usage or cost for a stopped reply)");
  } else if (reply.finishReason === "length") {
    note.push(empty && reply.reasoning ? "cut off by max_tokens while reasoning: no reply text" : "cut off by max_tokens");
  } else if (empty) {
    note.push("no reply text");
  }
  return note.join(" · ");
}

export default [promptPreview, turn, messageRegenerate, generationFollow, generationStop];
