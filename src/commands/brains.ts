import { z } from "zod";
import { resolveBrain } from "../conversations/prompt.ts";
import { mutateConversation } from "../conversations/store.ts";
import type { Brain } from "../conversations/types.ts";
import { badRequest, conflict } from "../lib/errors.ts";
import { command } from "../registry.ts";
import { conversationId, systemPrompt } from "./conversations.ts";

export const brainRef = z.string().min(1).describe("Brain name or id (default: the conversation's default brain)");

/** Venice's documented reasoning effort levels. Each model supports a subset (./ss models.list --type text). */
export const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export const brainUpdate = command({
  name: "brain.update",
  description: `Edit a brain: name, color, system prompt, reasoning and final reminder. Only the fields you pass change.
Takes effect from the next request; prompt.preview shows the result. The system prompt can't be empty.`,
  args: z.object({
    conversation: conversationId,
    brain: brainRef.optional(),
    name: z.string().trim().min(1).max(60).optional().describe("New name (unique in the conversation)"),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colors look like #60a5fa").optional().describe("Badge color, #rrggbb"),
    systemPrompt: systemPrompt.optional(),
    reasoning: z
      .object({
        enabled: z.boolean().describe("Reasoning on or off (off sends reasoning_effort none)"),
        effort: z.enum(EFFORTS).describe("Effort level when on, if the model supports levels"),
      })
      .partial()
      .optional(),
    finalReminder: z
      .object({
        enabled: z.boolean().describe("Send the reminder as the last message"),
        content: z.string().describe("The reminder text, sent verbatim"),
      })
      .partial()
      .optional(),
  }),
  examples: [
    './ss brain.update --conversation c_k3j9x0q2ma --system-prompt "You are a terse pirate."',
    "./ss brain.update --conversation c_k3j9x0q2ma --system-prompt @prompt.md --reasoning.effort high",
    "./ss brain.update --conversation c_k3j9x0q2ma --no-reasoning.enabled",
  ],
  handler: async (args, ctx): Promise<Brain> => {
    const { vault } = ctx.requireSession();
    const fields = ["name", "color", "systemPrompt", "reasoning", "finalReminder"] as const;
    if (!fields.some((f) => args[f] !== undefined)) {
      throw badRequest("Nothing to change. Pass --name, --color, --system-prompt, --reasoning.<field> or --final-reminder.<field>.");
    }
    const { result } = await mutateConversation(vault, args.conversation, (c) => {
      const brain = resolveBrain(c, args.brain);
      if (args.name !== undefined) {
        if (/^b_[a-z0-9]+$/.test(args.name)) throw badRequest("A brain name can't look like a brain id (b_...).");
        const clash = c.brains.find((b) => b.id !== brain.id && b.name.toLowerCase() === args.name!.toLowerCase());
        if (clash) throw conflict(`Another brain is already called "${clash.name}".`);
        brain.name = args.name;
      }
      if (args.color !== undefined) brain.color = args.color;
      if (args.systemPrompt !== undefined) brain.systemPrompt = args.systemPrompt;
      Object.assign(brain.reasoning, args.reasoning ?? {});
      Object.assign(brain.finalReminder, args.finalReminder ?? {});
      return brain;
    });
    return result;
  },
  format: (b: Brain) =>
    `Updated brain ${b.name} (${b.id}) · reasoning ${b.reasoning.enabled ? b.reasoning.effort : "off"} · final reminder ${
      b.finalReminder.enabled ? "on" : "off"
    } · system prompt ${b.systemPrompt.length} chars`,
});

export default [brainUpdate];
