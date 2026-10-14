import { z } from "zod";
import { formatPreview, type Preview } from "../conversations/format.ts";
import { beginGeneration, loadConversation, mutateConversation } from "../conversations/store.ts";
import { generatedVersion, lookupModel, newMessage, planTurn, relayReply } from "../conversations/turn.ts";
import { CommandError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { command, streamCommand } from "../registry.ts";
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
--json prints the body byte for byte as it would go to Venice (minus the auth header).`,
  args: z.object({ conversation: conversationId, brain: brainRef.optional(), content }),
  examples: [
    "./ss prompt.preview --conversation c_k3j9x0q2ma",
    './ss prompt.preview --conversation c_k3j9x0q2ma --content "Next message" --json',
  ],
  handler: async (args, ctx): Promise<Preview> => {
    const conv = await loadConversation(ctx.requireSession().vault, args.conversation);
    const model = await lookupModel(ctx.deps.venice, "text", conv.settings.textModel);
    const plan = planTurn(conv, { brain: args.brain, content: args.content }, model);
    const preview: Preview = { conversationId: conv.id, brainId: plan.brain.id, brainName: plan.brain.name, body: plan.body };
    if (plan.refusal) preview.refusal = plan.refusal;
    return preview;
  },
  format: formatPreview,
});

export const turn = streamCommand({
  name: "turn",
  description: `Send a message and stream the brain's reply. Both are saved to the conversation.
Your message is saved once Venice accepts the request. If the reply then fails, your message stays and no
reply is saved: run turn again without --content to retry. One reply at a time per conversation (409 if busy).
Without --content the brain answers the ledger as it stands, which is refused when the brain's own reply is
already the last message (there is nothing new to answer). The reply prints to stdout as it streams;
reasoning and status lines go to stderr.`,
  args: z.object({ conversation: conversationId, content, brain: brainRef.optional() }),
  examples: [
    './ss turn --conversation c_k3j9x0q2ma --content "Hello there"',
    "./ss turn --conversation c_k3j9x0q2ma --content @message.md > reply.md",
    "./ss turn --conversation c_k3j9x0q2ma   # no message: the brain just responds",
  ],
  async *handler(args, ctx) {
    const { vault } = ctx.requireSession();
    const gen = beginGeneration(vault, args.conversation); // 409 before any event, so it's a real HTTP status
    try {
      const conv = await loadConversation(vault, args.conversation);
      const model = await lookupModel(ctx.deps.venice, "text", conv.settings.textModel);
      const plan = planTurn(conv, { brain: args.brain, content: args.content }, model);
      if (plan.refusal) throw new CommandError(400, "nothing_to_answer", plan.refusal);
      if (plan.brain.kind !== "text") {
        throw new CommandError(400, "not_supported", `"${plan.brain.name}" is an image brain; image replies arrive in T05.`);
      }
      // Up-front refusals (no balance, bad model) throw here, before anything is saved.
      const upstream = await openChatStream(ctx.deps.venice, plan.body, { signal: gen.signal });

      if (plan.player) {
        const player = plan.player;
        await mutateConversation(vault, conv.id, (c) => void c.messages.push(player));
        yield { type: "message", message: player };
      }
      const messageId = newId("m");
      yield { type: "start", brainId: plan.brain.id, brainName: plan.brain.name, messageId };

      const reply = yield* relayReply(upstream);
      const message = newMessage({ type: "brain", brainId: plan.brain.id }, "text", generatedVersion(reply, plan.body.model), messageId);
      await mutateConversation(vault, conv.id, (c) => void c.messages.push(message));

      const note = [plan.brain.name];
      if (reply.usage) note.push(`${reply.usage.promptTokens} in / ${reply.usage.completionTokens} out`);
      if (reply.costUsd !== undefined) note.push(usd(reply.costUsd));
      if (reply.finishReason === "length") note.push("cut off by max_tokens");
      yield { type: "done", message, note: note.join(" · ") };
    } finally {
      gen.release();
    }
  },
});

export default [promptPreview, turn];
