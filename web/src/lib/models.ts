import { imageModelOf, resolutionsOf, textModelOf, type Brain, type Conversation, type ModelInfo } from "../api/types.ts";

/**
 * T18: a model per brain, as the browser reads it. A brain may have its own text model, and an image brain its own
 * image model; absent means the conversation's (textModelOf / imageModelOf, the server's one rule). DOM-free, so
 * test/web-api.test.ts checks it against the server.
 */

/** A brain with a model of its own: its text model, and (an image brain's) its image model, when it has them. */
export type OwnModels = { brain: Brain; text?: string; image?: string };

/** The brains on a model of their own, in cast order (an image model left on a text brain is unused: not counted). */
export function ownModels(conv: Pick<Conversation, "brains">): OwnModels[] {
  return conv.brains.flatMap((brain) => {
    const image = brain.kind === "image" ? brain.imageModel : undefined;
    if (!brain.textModel && !image) return [];
    return [{ brain, ...(brain.textModel ? { text: brain.textModel } : {}), ...(image ? { image } : {}) }];
  });
}

/** The brains whose requests use another text model than the conversation's (the chat header's "+N"). */
export const otherTextModels = (conv: Pick<Conversation, "brains" | "settings">): OwnModels[] =>
  ownModels(conv).filter((o) => o.text !== undefined && textModelOf(conv, o.brain) !== conv.settings.textModel);

/** One image model a conversation paints with: the conversation's (for every image brain without one), or a brain's own. */
export type ImageModelUse = { id: string; conversation: boolean; brains: Brain[] };

/**
 * The image models a conversation paints with, once each: the conversation's first (even with no image brain on it
 * yet), then each image brain's own. `brains`: the image brains that paint with it. conversation.update accepts a
 * resolution any of them lists.
 */
export function imageModelsInUse(conv: Pick<Conversation, "brains" | "settings">): ImageModelUse[] {
  const uses: ImageModelUse[] = [{ id: conv.settings.imageModel, conversation: true, brains: [] }];
  for (const b of conv.brains) {
    if (b.kind !== "image") continue;
    const id = imageModelOf(conv, b);
    const use = uses.find((u) => u.id === id);
    if (use) use.brains.push(b);
    else uses.push({ id, conversation: false, brains: [b] });
  }
  return uses;
}

/** The resolutions to offer: every one an image model in use lists, in their order. `find` as useModels gives it. */
export function resolutionChoices(uses: ImageModelUse[], find: (id: string) => ModelInfo | null | undefined): string[] {
  const out: string[] = [];
  for (const u of uses) {
    const m = find(u.id);
    if (m) for (const r of resolutionsOf(m)) if (!out.includes(r)) out.push(r);
  }
  return out;
}

/** Who paints with an image model, in words: "the conversation's", "Scene Painter's", "the conversation's and Scene Painter's". */
export function whoseImageModel(use: ImageModelUse): string {
  const own = use.brains.filter((b) => b.imageModel === use.id).map((b) => `${b.name}'s`);
  return [use.conversation ? "the conversation's" : null, ...own].filter(Boolean).join(" and ") || "the conversation's";
}
