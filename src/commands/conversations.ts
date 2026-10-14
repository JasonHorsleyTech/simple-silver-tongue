import { z } from "zod";
import { newConversation } from "../conversations/defaults.ts";
import { formatConversation, formatList, summarize, type ConversationSummary, type UnreadableConversation } from "../conversations/format.ts";
import {
  CONVERSATION_ID_RE,
  createConversationFile,
  deleteConversationFile,
  listConversations,
  loadConversation,
  mutateConversation,
} from "../conversations/store.ts";
import { lookupModel } from "../conversations/turn.ts";
import { templateProblem } from "../conversations/prompt.ts";
import type { Conversation, Templates } from "../conversations/types.ts";
import { badRequest } from "../lib/errors.ts";
import { command } from "../registry.ts";

export const conversationId = z.string().regex(CONVERSATION_ID_RE, "Conversation ids look like c_k3j9x0q2ma").describe("Conversation id (c_...)");

/** A system prompt is required and must have real text in it (design.md hard rule 1). */
export const systemPrompt = z
  .string()
  .refine((s) => s.trim() !== "", "The system prompt can't be empty: some Venice models inject their own when there is none")
  .describe("The brain's system prompt, sent verbatim as the first message. Must not be empty");

const title = z.string().trim().min(1, "The title can't be empty").max(200);

export const conversationCreate = command({
  name: "conversation.create",
  description: `Start a conversation with one default text brain, "Assistant", using your system prompt.
The system prompt is sent exactly as written, and nothing else is added (Venice's own prompt is always off).
Reasoning is off. Turning it on (brain.update --reasoning.enabled) is an opt-in: the provider then adds a small
hidden instruction we can't see or edit. Change the model or limits later with conversation.update.`,
  args: z.object({
    title: title.optional().describe('Title (default "New conversation")'),
    systemPrompt,
    textModel: z.string().min(1).optional().describe("Venice text model (default deepseek-v4-1-flash). See ./ss models.list --type text"),
  }),
  examples: [
    './ss conversation.create --title "Haiku bot" --system-prompt "You answer only in haiku."',
    "./ss conversation.create --title Tavern --system-prompt @gm-prompt.md",
  ],
  handler: async (args, ctx): Promise<Conversation> => {
    const { vault } = ctx.requireSession();
    if (args.textModel) await lookupModel(ctx.deps.venice, "text", args.textModel);
    const conv = newConversation({ title: args.title ?? "New conversation", systemPrompt: args.systemPrompt, textModel: args.textModel });
    await createConversationFile(vault, conv);
    return conv;
  },
  format: (c: Conversation) =>
    `Created ${c.id} "${c.title}" · ${c.settings.textModel} · brain ${c.brains[0]!.name}\nSend a message: ./ss turn --conversation ${c.id} --content "..."`,
});

type ConversationList = { conversations: ConversationSummary[]; unreadable: UnreadableConversation[] };

export const conversationList = command({
  name: "conversation.list",
  description: `List your conversations, most recently updated first, with message count and total cost.
A file that can't be read (bad JSON, wrong encryption, missing fields) is listed under unreadable, with why.`,
  args: z.object({}),
  handler: async (_args, ctx): Promise<ConversationList> => {
    const { conversations, unreadable } = await listConversations(ctx.requireSession().vault);
    return { conversations: conversations.map(summarize), unreadable };
  },
  format: (r: ConversationList) => formatList(r.conversations, r.unreadable),
});

export const conversationGet = command({
  name: "conversation.get",
  description: `Show a whole conversation: settings, templates, brains and the full ledger.
The text view prints each message's active version; --json gives the complete document (reasoning, versions, usage).`,
  args: z.object({ id: conversationId }),
  examples: ["./ss conversation.get --id c_k3j9x0q2ma", "./ss conversation.get --id c_k3j9x0q2ma --json"],
  handler: async (args, ctx): Promise<Conversation> => loadConversation(ctx.requireSession().vault, args.id),
  format: formatConversation,
});

/** A template must keep the placeholder its text goes into, or that text would silently go missing (T03 QA-3). */
const template = (name: keyof Templates, describe: string) =>
  z
    .string()
    .refine((s) => templateProblem(name, s) === null, templateProblem(name, "")!)
    .describe(describe);

const templates = z
  .object({
    player: template("player", "How a brain sees the player's messages. Must contain {{content}}, the message"),
    otherBrainText: template("otherBrainText", "How a brain sees another brain's text. {{brain}}, and {{content}} (required)"),
    otherBrainImage: template("otherBrainImage", "How a brain sees another brain's image prompt. {{brain}}, and {{prompt}} (required)"),
    steer: template("steer", "How a steer is sent when regenerating. Must contain {{instruction}}, the steer"),
  })
  .partial();

export const conversationUpdate = command({
  name: "conversation.update",
  description: `Change a conversation's title, settings or framing templates. Only the fields you pass change.
Unset maxTokens or temperature with null: --settings '{"maxTokens": null}'.
Templates are sent to the models, so they are yours to edit; prompt.preview shows the effect. Each one must keep
its placeholder ({{content}}, {{prompt}} or {{instruction}}), where the text goes.`,
  args: z.object({
    id: conversationId,
    title: title.optional(),
    settings: z
      .object({
        textModel: z.string().min(1).describe("Venice text model id"),
        maxTokens: z.number().int().positive().nullable().describe("max_tokens for replies (null: no limit)"),
        temperature: z.number().min(0).max(2).nullable().describe("Sampling temperature (null: the model's default)"),
        imageModel: z.string().min(1).describe("Venice image model id (used by image brains)"),
      })
      .partial()
      .optional(),
    templates: templates.optional(),
  }),
  examples: [
    "./ss conversation.update --id c_k3j9x0q2ma --title 'Gilded Goat'",
    "./ss conversation.update --id c_k3j9x0q2ma --settings.text-model venice-uncensored-1-2 --settings.max-tokens 400",
    "./ss conversation.update --id c_k3j9x0q2ma --templates.player '{{content}}'",
  ],
  handler: async (args, ctx): Promise<Conversation> => {
    const { vault } = ctx.requireSession();
    const s = args.settings ?? {};
    if (args.title === undefined && !Object.keys(s).length && !Object.keys(args.templates ?? {}).length) {
      throw badRequest("Nothing to change. Pass --title, --settings.<field> or --templates.<name>.");
    }
    if (s.textModel) await lookupModel(ctx.deps.venice, "text", s.textModel);
    if (s.imageModel) await lookupModel(ctx.deps.venice, "image", s.imageModel);
    const { conv } = await mutateConversation(vault, args.id, (c) => {
      if (args.title !== undefined) c.title = args.title;
      if (s.textModel) c.settings.textModel = s.textModel;
      if (s.imageModel) c.settings.imageModel = s.imageModel;
      for (const key of ["maxTokens", "temperature"] as const) {
        if (s[key] === null) delete c.settings[key];
        else if (s[key] !== undefined) c.settings[key] = s[key];
      }
      Object.assign(c.templates, args.templates ?? {});
    });
    return conv;
  },
  format: (c: Conversation) => {
    const st = c.settings;
    return `Updated ${c.id} "${c.title}" · ${st.textModel} · max_tokens ${st.maxTokens ?? "-"} · temperature ${st.temperature ?? "-"}`;
  },
});

export const conversationDelete = command({
  name: "conversation.delete",
  description: "Delete a conversation for good. Refused (409) while a reply is being generated.",
  args: z.object({ id: conversationId }),
  handler: async (args, ctx) => {
    await deleteConversationFile(ctx.requireSession().vault, args.id);
    return { deleted: args.id };
  },
  format: (r: { deleted: string }) => `Deleted ${r.deleted}.`,
});

export default [conversationCreate, conversationList, conversationGet, conversationUpdate, conversationDelete];
