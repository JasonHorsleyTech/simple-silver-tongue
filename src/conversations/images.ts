import { newId, nowIso } from "../lib/ids.ts";
import { findImageFile } from "../images/files.ts";
import type { Vault } from "../storage/vault.ts";
import type { Conversation, ImageRecord, LedgerMessage } from "./types.ts";

/**
 * Which images are being painted right now, in this server's memory (T05). A job adds its image here before
 * the pending record reaches disk and takes it out after the final status has. So a pending image that isn't
 * here belongs to no one: the server stopped while painting it. loadConversation settles those as it reads,
 * so no message stays "pending" forever, and the next write saves the settled status.
 */
const painting = new Set<string>();
const keyOf = (vault: Vault, imageId: string) => `${vault.dir}\0${imageId}`;

export function beginPainting(vault: Vault, imageId: string): void {
  painting.add(keyOf(vault, imageId));
}

export function endPainting(vault: Vault, imageId: string): void {
  painting.delete(keyOf(vault, imageId));
}

export const INTERRUPTED =
  "The image wasn't finished: the server stopped while it was being made. Retry it to paint this prompt again.";

/**
 * Settle every pending image that no job owns. If its file made it to disk before the stop, the image is
 * there and is done (Venice made it and billed it, so it is kept); otherwise it is an error, to retry.
 */
export async function settleStaleImages(vault: Vault, conv: Conversation): Promise<void> {
  if (!Array.isArray(conv?.messages)) return;
  for (const m of conv.messages) {
    if (m?.kind !== "image" || !Array.isArray(m.versions)) continue;
    for (const v of m.versions) {
      const img = v?.image;
      if (!img || img.status !== "pending" || painting.has(keyOf(vault, img.id))) continue;
      const file = await findImageFile(vault, img.id);
      img.finishedAt = nowIso();
      if (file) {
        img.status = "done";
        img.mime = file.kind.mime;
      } else {
        img.status = "error";
        img.error = INTERRUPTED;
      }
    }
  }
}

/** A new image for a prompt: pending until the job settles it. The last finished image stays as `previous`. */
export function newImageRecord(opts: { model: string; safeMode: boolean; replacing?: ImageRecord }): ImageRecord {
  const img: ImageRecord = { id: newId("img"), status: "pending", model: opts.model, safeMode: opts.safeMode, createdAt: nowIso() };
  const prev = opts.replacing?.status === "done" ? opts.replacing : opts.replacing?.previous;
  if (prev) {
    const { previous: _drop, ...keep } = prev;
    img.previous = keep;
  }
  return img;
}

/** Every image file a message holds: each version's image, and the previous one still shown in its place. */
export function imageIdsOf(messages: LedgerMessage[]): string[] {
  const ids: string[] = [];
  for (const m of messages) {
    for (const v of m.versions) {
      if (v.image) ids.push(v.image.id);
      if (v.image?.previous) ids.push(v.image.previous.id);
    }
  }
  return ids;
}
