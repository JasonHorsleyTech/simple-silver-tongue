import { CommandError, imageBusy, isUnreadable } from "../lib/errors.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { readImageFile, removeImageFiles } from "../images/files.ts";
import type { StreamEvent } from "../registry.ts";
import type { Vault } from "../storage/vault.ts";
import type { Conversation, ImageRecord, LedgerMessage } from "./types.ts";

/**
 * Which images are being painted right now, in this server's memory (T05). A job adds its image here before
 * the pending record reaches disk and takes it out after the final status has. So a pending image that isn't
 * here belongs to no one: the server stopped while painting it. loadConversation settles those as it reads,
 * so no message stays "pending" forever, and the next write saves the settled status.
 *
 * T05 triage: an image no longer holds the conversation's generation lock. Each image is tracked here on its
 * own, per message, and the changes that would replace or remove it wait for it (assertImageIdle). Anyone can
 * wait for one (`settled`): image.follow, a turn's stream, and a graceful shutdown.
 */

/** What a finished job hands its waiters: its image_done / image_error event and the message as saved. */
export type PaintResult = { event: StreamEvent; message: LedgerMessage; image: ImageRecord; spentUsd: number };
export type PaintJob = { convId: string; messageId: string; imageId: string; settled: Promise<PaintResult | null> };
type Entry = PaintJob & { resolve(r: PaintResult | null): void };

const painting = new Map<string, Entry>();
const keyOf = (vault: Vault, imageId: string) => `${vault.dir}\0${imageId}`;

/** Own an image before its pending record is written (inside the mutateConversation fn that writes it). */
export function beginPainting(vault: Vault, imageId: string, where: { convId: string; messageId: string }): void {
  let resolve!: (r: PaintResult | null) => void;
  const settled = new Promise<PaintResult | null>((r) => (resolve = r));
  painting.set(keyOf(vault, imageId), { ...where, imageId, settled, resolve });
}

/** Let it go, after its final status is written (or when the pending record never made it). Null: no result. */
export function endPainting(vault: Vault, imageId: string, result: PaintResult | null = null): void {
  const key = keyOf(vault, imageId);
  const e = painting.get(key);
  if (!e) return;
  painting.delete(key);
  e.resolve(result);
}

export function paintJob(vault: Vault, imageId: string): PaintJob | undefined {
  return painting.get(keyOf(vault, imageId));
}

/** This conversation's images being made right now. */
export function paintingIn(vault: Vault, convId: string): PaintJob[] {
  const prefix = `${vault.dir}\0`;
  return [...painting].filter(([k, j]) => k.startsWith(prefix) && j.convId === convId).map(([, j]) => j);
}

/** Every image being made for the user whose folder is `dir`, in any conversation (user.delete waits for them). */
export function paintingFor(dir: string): PaintJob[] {
  const prefix = `${dir}\0`;
  return [...painting].filter(([k]) => k.startsWith(prefix)).map(([, j]) => j);
}

/** Every image this server is making, for any user (a graceful shutdown waits for them). */
export function allPaintJobs(): PaintJob[] {
  return [...painting.values()];
}

/**
 * A change that would replace or remove an image still being made waits for it: Venice is already making (and
 * billing) it, so it must land somewhere. `which` is the message's active version's image (edit, retry) or
 * every version's (delete). Call it inside mutateConversation, like assertLedgerIdle: beginPainting runs in
 * the same queue, so a check and a job starting can't cross.
 */
export function assertImageIdle(vault: Vault, m: LedgerMessage, which: "active" | "all", doing: string): void {
  const versions = which === "all" ? m.versions : [m.versions[m.activeVersion]];
  const busy = versions.map((v) => v?.image?.id).find((id) => id !== undefined && painting.has(keyOf(vault, id)));
  if (busy) {
    throw imageBusy(
      `Can't ${doing} ${m.id} yet: its image ${busy} is still being made. Venice is already making it (and billing it), so it will be kept. Wait for it to arrive (image.follow watches it), then try again.`,
    );
  }
}

export const INTERRUPTED =
  "The image wasn't finished: the server stopped while it was being made. Retry it to paint this prompt again.";

/**
 * Settle every pending image that no job owns. If its file made it to disk before the stop, the image is
 * there and is done (Venice made it and billed it, so it is kept), and it swaps in as paint() would have done:
 * the image shown meanwhile (`previous`) goes, file and all (T05 QA-4). Otherwise it is an error, to retry.
 */
export async function settleStaleImages(vault: Vault, conv: Conversation): Promise<void> {
  if (!Array.isArray(conv?.messages)) return;
  const replaced: string[] = [];
  for (const m of conv.messages) {
    if (m?.kind !== "image" || !Array.isArray(m.versions)) continue;
    for (const v of m.versions) {
      const img = v?.image;
      if (!img || img.status !== "pending" || painting.has(keyOf(vault, img.id))) continue;
      // The bytes say what the image is: an encrypted user's file name doesn't (img_….bin, T06).
      const file = await readImageFile(vault, img.id).catch((err) => {
        if (err instanceof CommandError && !isUnreadable(err)) throw err; // session_ended and the like
        return null; // an unreadable file is no image
      });
      img.finishedAt = nowIso();
      if (file?.kind) {
        img.status = "done";
        img.mime = file.kind.mime;
        if (img.previous) replaced.push(img.previous.id);
        delete img.previous;
      } else {
        img.status = "error";
        img.error = INTERRUPTED;
      }
    }
  }
  // Nothing shows a done image's `previous`, so its file can go now, before the next write drops the field.
  if (replaced.length) await removeImageFiles(vault, replaced).catch(() => {});
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
