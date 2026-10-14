import { newId, nowIso } from "../lib/ids.ts";
import type { Conversation, ImageRecord, LedgerMessage, MessageVersion } from "./types.ts";

/**
 * A new conversation from another one's configuration (T07). conversation.clone copies one of yours ("we're
 * doing Pathfinder", from the D&D campaign's brains and setup); conversation.import builds one from a campaign
 * file (examples/*.json, or a conversation.get --json). Either way it gets fresh ids and today's dates, and it
 * has cost nothing yet (spentUsd 0). Each version's history (steer, model, usage) comes along as it was.
 */

/**
 * A finished image whose file the caller copies to the new id (clone). If the file can't be read, `missing()`
 * fixes the new record before it is saved: the image becomes an error to retry, or a `previous` is dropped.
 */
export type ImageCopy = { from: string; to: string; missing(): void };

/** A campaign file holds prompts, not pictures, so an imported image is an error to retry (it paints the prompt). */
export const NOT_IMPORTED = "This image wasn't imported: a campaign file holds only the prompt. Retry to paint it.";
/** A clone copies finished images; one still being made has nothing to copy yet. */
export const NOT_COPIED = "This image was still being made when the campaign was copied, so there was nothing to copy. Retry to paint it.";
/** A clone found no file for an image the original says is finished. */
export const FILE_MISSING = "This image's file was missing when the campaign was copied. Retry to paint it again.";

export function rebuild(
  src: Conversation,
  opts: { title: string; messages: boolean; images: "copy" | "none" },
): { conv: Conversation; copies: ImageCopy[] } {
  const now = nowIso();
  const brainIds = new Map(src.brains.map((b) => [b.id, newId("b")]));
  const copies: ImageCopy[] = [];
  const failed = (img: Pick<ImageRecord, "model" | "safeMode"> & { createdAt?: string }, error: string): ImageRecord => ({
    id: newId("img"),
    status: "error",
    model: img.model,
    safeMode: img.safeMode,
    error,
    createdAt: img.createdAt ?? now,
    finishedAt: now,
  });

  const image = (img: ImageRecord | undefined, safeMode: boolean): ImageRecord => {
    if (!img || opts.images === "none") return failed(img ?? { model: src.settings.imageModel, safeMode }, NOT_IMPORTED);
    if (img.status === "pending") return failed(img, NOT_COPIED);
    const { previous, ...rest } = img;
    const copy: ImageRecord = { ...structuredClone(rest), id: newId("img") };
    if (copy.status === "done") copies.push({ from: img.id, to: copy.id, missing: () => fileMissing(copy) });
    if (previous?.status === "done") {
      copy.previous = { ...structuredClone(previous), id: newId("img") };
      copies.push({ from: previous.id, to: copy.previous.id, missing: () => void delete copy.previous });
    }
    return copy;
  };

  const messages: LedgerMessage[] = !opts.messages
    ? []
    : src.messages.map((m) => {
        const author: LedgerMessage["author"] = m.author.type === "player" ? { type: "player" } : { type: "brain", brainId: brainIds.get(m.author.brainId)! };
        const brain = m.author.type === "brain" ? src.brains.find((b) => b.id === (m.author as { brainId: string }).brainId) : undefined;
        const versions = m.versions.map((v): MessageVersion => {
          const { image: img, ...rest } = v;
          const copy: MessageVersion = structuredClone(rest);
          if (m.kind === "image") copy.image = image(img, brain?.safeMode ?? true);
          return copy;
        });
        return { ...m, id: newId("m"), author, versions };
      });

  const conv: Conversation = {
    schemaVersion: src.schemaVersion,
    id: newId("c"),
    title: opts.title,
    createdAt: now,
    updatedAt: now,
    settings: structuredClone(src.settings),
    templates: { ...src.templates },
    setup: src.setup.map((s) => ({ ...s, id: newId("s") })),
    brains: src.brains.map((b) => ({ ...structuredClone(b), id: brainIds.get(b.id)! })),
    defaultBrainId: brainIds.get(src.defaultBrainId)!,
    messages,
    spentUsd: 0,
  };
  return { conv, copies };
}

function fileMissing(r: ImageRecord): void {
  for (const k of ["mime", "blurred", "contentViolation"] as const) delete r[k];
  Object.assign(r, { status: "error", error: FILE_MISSING, finishedAt: nowIso() });
}
