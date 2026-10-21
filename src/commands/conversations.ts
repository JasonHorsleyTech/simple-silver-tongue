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
import { imageIdsOf } from "../conversations/images.ts";
import { lookupModel } from "../conversations/turn.ts";
import { templateProblem } from "../conversations/prompt.ts";
import type { Brain, Conversation, ImageSettings, Templates } from "../conversations/types.ts";
import { removeImageFiles } from "../images/files.ts";
import { imageSettingsProblem } from "../images/request.ts";
import { badRequest } from "../lib/errors.ts";
import { command } from "../registry.ts";
import type { ModelInfo } from "../venice/models.ts";

export const conversationId = z.string().regex(CONVERSATION_ID_RE, "Conversation ids look like c_k3j9x0q2ma").describe("Conversation id (c_...)");
export const MESSAGE_ID_RE = /^m_[a-z0-9]{4,32}$/;
export const messageId = z.string().regex(MESSAGE_ID_RE, "Message ids look like m_k3j9x0q2ma").describe("Message id (m_...), from conversation.get");

/** A system prompt is required and must have real text in it (design.md hard rule 1). */
export const systemPrompt = z
  .string()
  .refine((s) => s.trim() !== "", "The system prompt can't be empty: some Venice models inject their own when there is none")
  .describe("The brain's system prompt, sent verbatim as the first message. Must not be empty");

export const title = z.string().trim().min(1, "The title can't be empty").max(200);

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
The text view prints each message's active version, hidden notes folded to one line: --reveal
shows them. --json gives the complete document (reasoning, versions, usage).`,
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

export const templates = z
  .object({
    player: template("player", "How a brain sees the player's messages. Must contain {{content}}, the message"),
    otherBrainText: template("otherBrainText", "How a brain sees another brain's text. {{brain}}, and {{content}} (required)"),
    otherBrainImage: template("otherBrainImage", "How a brain sees another brain's image prompt. {{brain}}, and {{prompt}} (required)"),
    steer: template("steer", "How a steer is sent when regenerating. Must contain {{instruction}}, the steer"),
    roll: template("roll", "The line a roll adds as your message (turn --roll, message.roll). Must contain {{roll}}, the number. Used when you roll: earlier rolls keep their text"),
    thought: template(
      "thought",
      "What a fresh take's note from the Muse starts as (T17): the browser's Fresh take box opens with it, the caret at {{thought}}, and message.regenerate --thought --wrap puts your text there. {{brain}} is the brain the note is for. Must contain {{thought}}",
    ),
  })
  .partial();

/** The image settings image brains' requests are built from (src/images/request.ts). null unsets one. */
export const imageSettings = z
  .object({
    resolution: z.string().min(1).nullable().describe("For models with a resolution list (1K, 2K, 4K), one they list; it sets the price. null: the model's default"),
    format: z.enum(["webp", "png", "jpeg"]).describe("The format to ask for (default webp). The stored type is what Venice really sends"),
    hideWatermark: z.boolean().describe("Ask Venice to leave its watermark off (default true: no watermark)"),
    negativePrompt: z.string().nullable().describe("What the image should not show, sent as negative_prompt with every image. null or blank: not sent"),
  })
  .partial();

export const conversationUpdate = command({
  name: "conversation.update",
  description: `Change a conversation's title, settings or framing templates. Only the fields you pass change.
Unset maxTokens or temperature with null: --settings.max-tokens null.
The text and image models are the conversation's defaults (T18): every brain without a model of its own uses them,
so changing one moves those brains. A brain with its own (brain.update --text-model / --image-model) keeps it; the
answer names them.
Image brains' images use the image model and --settings.image.* (resolution, format, watermark, negative prompt);
each image brain has its own shape (brain.update --shape). Only what the model takes is sent: prompt.preview
--brain <image brain> shows the exact image request and says what was left out. A resolution that neither the
image model nor any image brain's own model lists is refused.
Templates are sent to the models, so they are yours to edit; prompt.preview shows the effect. Each one must keep
its placeholder ({{content}}, {{prompt}}, {{instruction}}, {{roll}} or {{thought}}), where the text goes. The roll
template (T09) makes a roll's message when you roll, so a change shows in later rolls; earlier ones keep their
text. The thought template is what a fresh take's note from the Muse starts as (message.regenerate --thought --wrap;
{{brain}} there is the brain the note is for).`,
  args: z.object({
    id: conversationId,
    title: title.optional(),
    settings: z
      .object({
        textModel: z.string().min(1).describe("Venice text model id"),
        maxTokens: z.number().int().positive().nullable().describe("max_tokens for replies (null: no limit)"),
        temperature: z.number().min(0).max(2).nullable().describe("Sampling temperature (null: the model's default)"),
        imageModel: z.string().min(1).describe("Venice image model id (used by image brains)"),
        image: imageSettings.describe("How image brains' images are made"),
      })
      .partial()
      .optional(),
    templates: templates.optional(),
  }),
  examples: [
    "./ss conversation.update --id c_k3j9x0q2ma --title 'Gilded Goat'",
    "./ss conversation.update --id c_k3j9x0q2ma --settings.text-model venice-uncensored-1-2 --settings.max-tokens 400",
    "./ss conversation.update --id c_k3j9x0q2ma --templates.player '{{content}}'",
    "./ss conversation.update --id c_k3j9x0q2ma --templates.roll 'I roll the d20 and get {{roll}}.'",
    "./ss conversation.update --id c_k3j9x0q2ma --settings.image-model krea-2-turbo --settings.image.resolution 2K --settings.image.format png",
  ],
  handler: async (args, ctx): Promise<Conversation> => {
    const { vault } = ctx.requireSession();
    const s = args.settings ?? {};
    if (args.title === undefined && !Object.keys(s).length && !Object.keys(args.templates ?? {}).length) {
      throw badRequest("Nothing to change. Pass --title, --settings.<field> or --templates.<name>.");
    }
    if (s.textModel) await lookupModel(ctx.deps.venice, "text", s.textModel);
    const imageModel = s.imageModel ? await lookupModel(ctx.deps.venice, "image", s.imageModel) : null;
    const img = s.image ?? {};
    const sizing = img.resolution !== undefined && img.resolution !== null;
    // A resolution is checked against the models it will be sent to: the conversation's image model (the new one, if
    // this call changes it) and, T18, any image brain's own. One of them listing it is enough: the others leave it
    // out, and their payload view says so (buildImageRequest's notes).
    const sizeModels: ModelInfo[] = [];
    if (sizing) {
      const before = await loadConversation(vault, args.id);
      sizeModels.push(imageModel ?? (await lookupModel(ctx.deps.venice, "image", before.settings.imageModel)));
      const own = new Set(before.brains.flatMap((b: Brain) => (b.kind === "image" && b.imageModel ? [b.imageModel] : [])));
      for (const id of own) {
        const m = await lookupModel(ctx.deps.venice, "image", id).catch(() => null); // a model Venice dropped takes nothing
        if (m && !sizeModels.some((x) => x.id === m.id)) sizeModels.push(m);
      }
    }
    const { conv } = await mutateConversation(vault, args.id, (c) => {
      if (args.title !== undefined) c.title = args.title;
      if (s.textModel) c.settings.textModel = s.textModel;
      if (s.imageModel) c.settings.imageModel = s.imageModel;
      for (const key of ["maxTokens", "temperature"] as const) {
        if (s[key] === null) delete c.settings[key];
        else if (s[key] !== undefined) c.settings[key] = s[key];
      }
      const next: ImageSettings = { ...c.settings.image };
      for (const [k, v] of Object.entries(img) as [keyof ImageSettings, unknown][]) {
        if (v === null) delete next[k];
        else if (v !== undefined) Object.assign(next, { [k]: v });
      }
      const changing = (Object.keys(img) as (keyof ImageSettings)[]).filter((k) => img[k] !== null && img[k] !== undefined);
      const problems = sizeModels.map((m) => imageSettingsProblem(next, m, changing));
      if (problems.length && problems.every(Boolean)) {
        const others = sizeModels.slice(1).map((m) => m.id);
        throw badRequest(`${problems[0]}${others.length ? ` Nor does ${others.join(" or ")}, an image brain's own model.` : ""}`);
      }
      c.settings.image = next;
      Object.assign(c.templates, args.templates ?? {});
    });
    return conv;
  },
  format: (c: Conversation) => {
    const st = c.settings;
    const im = st.image;
    const size = im.resolution ?? "default resolution";
    const line = `Updated ${c.id} "${c.title}" · ${st.textModel} · max_tokens ${st.maxTokens ?? "-"} · temperature ${st.temperature ?? "-"} · images ${st.imageModel}, ${size}, ${im.format}${im.hideWatermark ? ", no watermark" : ""}${im.negativePrompt?.trim() ? ", negative prompt" : ""}`;
    // T18: the conversation's models are the defaults; a brain with its own keeps it.
    const own = c.brains.flatMap((b) => [b.textModel ? `${b.name} (${b.textModel})` : "", b.kind === "image" && b.imageModel ? `${b.name} (images: ${b.imageModel})` : ""].filter(Boolean));
    return own.length ? `${line}
Brains on a model of their own, which they keep: ${own.join(", ")}. The others use the conversation's.` : line;
  },
});

export const conversationDelete = command({
  name: "conversation.delete",
  description: "Delete a conversation for good, with its images. Refused (409) while a reply or an image is being generated.",
  args: z.object({ id: conversationId }),
  handler: async (args, ctx) => {
    const { vault } = ctx.requireSession();
    const conv = await deleteConversationFile(vault, args.id);
    await removeImageFiles(vault, imageIdsOf(conv.messages)); // after the document: never a message without its image
    return { deleted: args.id };
  },
  format: (r: { deleted: string }) => `Deleted ${r.deleted}.`,
});

export default [conversationCreate, conversationList, conversationGet, conversationUpdate, conversationDelete];
