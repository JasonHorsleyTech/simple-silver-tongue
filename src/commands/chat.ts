import { z } from "zod";
import { formatPreview, type Preview } from "../conversations/format.ts";
import { beginGeneration, followGeneration, loadConversation, mutateConversation } from "../conversations/store.ts";
import { generatedVersion, lookupModel, newMessage, planTurn, relayReply, type Reply } from "../conversations/turn.ts";
import { CommandError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { command, streamCommand, type Ctx, type StreamEvent } from "../registry.ts";
import { openChatStream } from "../venice/chat.ts";
import { usd } from "../venice/models.ts";
import { brainRef } from "./brains.ts";
import { conversationId } from "./conversations.ts";

const content = z
  .string()
  .optional()
  .describe("Your message (Markdown; @file.md or - for stdin). Empty or omitted: the brain just responds");

export const promptPreview = command({
  name: "prompt.preview",
  description: `Show the exact request body a brain would be sent, built by the same code path as turn.
With --content, it shows what turn --content would send (your message included). Nothing is saved or sent.
--json prints the body byte for byte as it would go to Venice (minus the auth header), plus notes on text the
provider adds that we can't show (reasoning on), and the reason turn would refuse the body, if it would.`,
  args: z.object({ conversation: conversationId, brain: brainRef.optional(), content }),
  examples: [
    "./ss prompt.preview --conversation c_k3j9x0q2ma",
    './ss prompt.preview --conversation c_k3j9x0q2ma --content "Next message" --json',
  ],
  handler: async (args, ctx): Promise<Preview> => {
    const conv = await loadConversation(ctx.requireSession().vault, args.conversation);
    const model = await lookupModel(ctx.deps.venice, "text", conv.settings.textModel);
    const plan = planTurn(conv, { brain: args.brain, content: args.content }, model);
    const { brain, body, notes, refusal } = plan;
    const preview: Preview = { conversationId: conv.id, brainId: brain.id, brainName: brain.name, body, notes };
    if (refusal) preview.refusal = refusal;
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
  const upstream = await openChatStream(ctx.deps.venice, plan.body, { signal });

  if (plan.player) {
    const player = plan.player;
    await mutateConversation(vault, conv.id, (c) => void c.messages.push(player));
    yield { type: "message", message: player };
  }
  const messageId = newId("m");
  yield { type: "start", brainId: plan.brain.id, brainName: plan.brain.name, messageId };

  let reply: Reply;
  try {
    reply = yield* relayReply(upstream);
  } catch (err) {
    // Say what was kept and how to retry, in the message the user actually reads (T02 QA-8).
    if (err instanceof CommandError && err.code === "venice_error") {
      const kept = plan.player ? "Your message is saved; the reply isn't." : "No reply was saved.";
      throw new CommandError(err.status, err.code, `${err.message} ${kept} To retry, send again with no new message: turn without --content, or Retry in the browser.`, err.details);
    }
    throw err;
  }
  const message = newMessage({ type: "brain", brainId: plan.brain.id }, "text", generatedVersion(reply, plan.body.model), messageId);
  await mutateConversation(vault, conv.id, (c) => void c.messages.push(message));
  yield { type: "done", message, note: replyNote(plan.brain.name, reply) };
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

/** The one-line summary the CLI prints after a reply. An empty reply says why, since it is saved as is (T02 QA-6). */
function replyNote(brainName: string, reply: Reply): string {
  const note = [brainName];
  if (reply.usage) note.push(`${reply.usage.promptTokens} in / ${reply.usage.completionTokens} out`);
  if (reply.costUsd !== undefined) note.push(usd(reply.costUsd));
  const empty = !reply.content.trim();
  if (reply.finishReason === "length") {
    note.push(empty && reply.reasoning ? "cut off by max_tokens while reasoning: no reply text" : "cut off by max_tokens");
  } else if (empty) {
    note.push("no reply text");
  }
  return note.join(" · ");
}

export default [promptPreview, turn, generationFollow];
