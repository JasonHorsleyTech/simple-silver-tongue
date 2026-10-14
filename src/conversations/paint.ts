import { CommandError, notFound, upstreamError } from "../lib/errors.ts";
import { nowIso } from "../lib/ids.ts";
import { removeImageFiles, saveImageFile } from "../images/files.ts";
import { buildImageRequest, imagePriceUsd, type ImagePlan } from "../images/request.ts";
import { sniffImage } from "../images/sniff.ts";
import type { StreamEvent } from "../registry.ts";
import { closeVault, forkVault, type Vault } from "../storage/vault.ts";
import type { VeniceClient } from "../venice/client.ts";
import { generateImage } from "../venice/images.ts";
import type { ModelInfo } from "../venice/models.ts";
import { endPainting, paintJob, type PaintResult } from "./images.ts";
import { loadConversation, mutateConversation } from "./store.ts";
import { addSpend, lookupModel } from "./turn.ts";
import type { Brain, Conversation, ImageRecord, LedgerMessage, RetryRequest } from "./types.ts";

/**
 * Painting one image (design.md, "Image generation"). An image is a job of its own (T05 triage): it starts
 * once its prompt is saved, and the conversation's generation lock is free from then on, so the next brain
 * can take its turn while the image is made. The job is tracked per image (images.ts): whatever would replace
 * or remove its image waits for it, and anyone can watch it land (followImages). No stop cuts it short: once
 * the request is with Venice the image is being made and billed, so it is kept.
 */

/** Who paints, with what: the conversation's image model (from /models) and the brain's safe mode. */
export type Painter = { model: ModelInfo; safeMode: boolean; plan(prompt: string): ImagePlan };

/** An unknown image model is refused here, before the brain is asked for a prompt or anything is spent. */
export async function painterFor(venice: VeniceClient, conv: Conversation, brain: Brain): Promise<Painter> {
  const model = await lookupModel(venice, "image", conv.settings.imageModel);
  const safeMode = brain.safeMode !== false;
  const settings = structuredClone(conv.settings);
  return { model, safeMode, plan: (prompt) => buildImageRequest(settings, model, prompt, safeMode) };
}

export type PaintTarget = { messageId: string; image: ImageRecord; prompt: string };

/**
 * Make the image for a pending record that is already saved and owned (beginPainting), in the background, on
 * its own key copy: it outlives the request that started it, and logout doesn't stop it. The job settles its
 * record and hands the result to whoever waits for it (endPainting).
 */
export function startPainting(vault: Vault, venice: VeniceClient, convId: string, target: PaintTarget, painter: Painter): void {
  const own = forkVault(vault);
  void paint(own, venice, convId, target, painter)
    .catch(() => {}) // the record says what happened; waiters got null and re-read it
    .finally(() => closeVault(own));
}

/**
 * The bytes reach disk before the status says done, so a crash in between leaves a file that the next read
 * recovers (settleStaleImages). The image's list price joins the running total as soon as Venice has made
 * it, even if storing it then fails.
 */
async function paint(vault: Vault, venice: VeniceClient, convId: string, target: PaintTarget, painter: Painter): Promise<void> {
  const id = target.image.id;
  const outcome: Partial<ImageRecord> = {};
  let result: PaintResult | null = null;
  let replaced: string | undefined;
  try {
    try {
      const plan = painter.plan(target.prompt);
      if (plan.problem) throw new CommandError(400, "prompt_too_long", plan.problem);
      const got = await generateImage(venice, plan.body);
      const cost = imagePriceUsd(painter.model, plan.body);
      if (cost !== undefined) outcome.costUsd = cost;
      const kind = sniffImage(got.bytes);
      if (!kind) throw upstreamError("Venice sent something that isn't a PNG, JPEG, WebP or GIF image, so nothing was kept.");
      await saveImageFile(vault, id, kind, got.bytes);
      Object.assign(outcome, { status: "done", mime: kind.mime }, got.blurred ? { blurred: true } : {}, got.contentViolation ? { contentViolation: true } : {});
    } catch (err) {
      outcome.status = "error";
      outcome.error = err instanceof CommandError ? err.message : `The image couldn't be stored (${(err as Error)?.message ?? "unknown error"}).`;
    }
    outcome.finishedAt = nowIso();

    let message: LedgerMessage | undefined;
    let image: ImageRecord | undefined;
    const { conv } = await mutateConversation(vault, convId, (c) => {
      addSpend(c, outcome.costUsd); // Venice made it, so it is billed, whatever happens to it next
      const m = c.messages.find((x) => x.id === target.messageId);
      const v = m?.versions.find((x) => x.image?.id === id);
      if (!m || !v?.image) return;
      const img: ImageRecord = { ...v.image, ...outcome };
      if (img.status === "done" && img.previous) {
        replaced = img.previous.id; // the new image has swapped in: the one shown meanwhile goes
        delete img.previous;
      }
      v.image = img;
      m.updatedAt = nowIso(); // in the write queue: later than any earlier write's (the browser merges by it)
      message = m;
      image = img;
    });
    if (message && image) result = { event: imageEvent(convId, message, image), message, image, spentUsd: conv.spentUsd ?? 0 };
    if (replaced) await removeImageFiles(vault, [replaced]).catch(() => {}); // before waiters hear it is done
  } finally {
    endPainting(vault, id, result); // after the final status is on disk
  }
  // Unreachable while delete waits for the image (assertImageIdle), but an image nothing points at can't be shown.
  if (!result) await removeImageFiles(vault, [id]).catch(() => {});
}

/** image_done, or image_error with the image.retry request that paints it again. */
export function imageEvent(convId: string, message: LedgerMessage, image: ImageRecord): StreamEvent {
  if (image.status === "done") return { type: "image_done", messageId: message.id, imageId: image.id, image, message };
  const retry: RetryRequest = { command: "image.retry", args: { conversation: convId, message: message.id } };
  return { type: "image_error", messageId: message.id, imageId: image.id, error: image.error, image, message, retry };
}

/**
 * Watch a message's images being made (one image, with `imageId`): image_pending for each one not yet
 * `announced`, then image_done or image_error as each lands. Returns the message as saved once none of them is
 * pending. It never misses a result (T05 QA-2): it reads the message, waits for each pending image's job, and
 * reads again, so an image that landed before it looked, or between its read and its wait, is still reported
 * from the saved record. A pending image whose job is gone is settled by the read itself (settleStaleImages).
 */
export async function* followImages(
  vault: Vault,
  convId: string,
  messageId: string,
  opts: { imageId?: string; announced?: string[] } = {},
): AsyncGenerator<StreamEvent, { message: LedgerMessage; spentUsd: number }> {
  const announced = new Set(opts.announced);
  const reported = new Set<string>();
  const mine = (img: ImageRecord | undefined): img is ImageRecord => img !== undefined && (opts.imageId === undefined || img.id === opts.imageId);
  for (;;) {
    const conv = await loadConversation(vault, convId);
    const m = conv.messages.find((x) => x.id === messageId);
    if (!m) throw notFound(`No message ${messageId} in conversation ${convId}.`);
    const images = m.versions.map((v) => v.image).filter(mine);
    const pending = images.filter((img) => img.status === "pending");
    if (!pending.length) {
      for (const img of images) if (announced.has(img.id) && !reported.has(img.id)) yield imageEvent(convId, m, img);
      return { message: m, spentUsd: conv.spentUsd ?? 0 };
    }
    for (const img of pending) {
      if (announced.has(img.id)) continue;
      announced.add(img.id);
      yield { type: "image_pending", messageId: m.id, imageId: img.id, model: img.model, message: m };
    }
    for (const img of pending) {
      const r = await paintJob(vault, img.id)?.settled; // gone already: the next read has its final status
      if (!r) continue;
      reported.add(img.id);
      yield r.event;
    }
  }
}

/** The done note's image part: "image img_… done (z-image-turbo, $0.01)", or what went wrong. */
export function imageNote(image: ImageRecord): string {
  if (image.status === "done") {
    const bits = [image.model, image.mime?.replace("image/", "")];
    if (image.costUsd !== undefined) bits.push(`$${image.costUsd}`);
    if (image.blurred) bits.push("blurred by safe mode");
    if (image.contentViolation) bits.push("flagged by Venice's content policy");
    return `image ${image.id} done (${bits.filter(Boolean).join(", ")})`;
  }
  return `image ${image.status === "pending" ? "pending" : "failed"}: ${image.error ?? image.id}`;
}
