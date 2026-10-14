import { CommandError, upstreamError } from "../lib/errors.ts";
import { nowIso } from "../lib/ids.ts";
import { removeImageFiles, saveImageFile } from "../images/files.ts";
import { buildImageRequest, imagePriceUsd, type ImagePlan } from "../images/request.ts";
import { sniffImage } from "../images/sniff.ts";
import type { StreamEvent } from "../registry.ts";
import { closeVault, forkVault, type Vault } from "../storage/vault.ts";
import type { VeniceClient } from "../venice/client.ts";
import { generateImage } from "../venice/images.ts";
import type { ModelInfo } from "../venice/models.ts";
import { endPainting } from "./images.ts";
import { mutateConversation, type GenerationHandle } from "./store.ts";
import { addSpend, lookupModel } from "./turn.ts";
import type { Brain, Conversation, ImageRecord, LedgerMessage, RetryRequest } from "./types.ts";

/**
 * Painting one image (design.md, "Image generation"). Every image is made inside a generation: it holds the
 * conversation's lock from the prompt to the settled image, so nothing can edit, delete or regenerate the
 * message under it, and generation.follow can watch it like any reply. A stop doesn't cut the image short:
 * once the request is with Venice it is being made and billed, so it is waited for and kept.
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

export type Painted = { message: LedgerMessage; image: ImageRecord; spentUsd: number };

/**
 * Make the image for a pending record that is already saved and owned (beginPainting), then settle it.
 * The bytes reach disk before the status says done, so a crash in between leaves a file that the next read
 * recovers (settleStaleImages). The image's list price joins the running total as soon as Venice has made
 * it, even if storing it then fails. Yields image_done or image_error, and returns the saved message.
 */
export async function* paint(
  vault: Vault,
  venice: VeniceClient,
  convId: string,
  target: { messageId: string; image: ImageRecord; prompt: string },
  painter: Painter,
): AsyncGenerator<StreamEvent, Painted> {
  const id = target.image.id;
  const outcome: Partial<ImageRecord> = {};
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
  let replaced: string | undefined;
  let spentUsd = 0;
  try {
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
      m.updatedAt = img.finishedAt!;
      message = m;
      image = img;
    });
    spentUsd = conv.spentUsd ?? 0;
  } finally {
    endPainting(vault, id);
  }
  if (replaced) await removeImageFiles(vault, [replaced]).catch(() => {});
  if (!message || !image) {
    // Unreachable while the lock is held (ledger edits and conversation.delete are refused), but say so if it happens.
    await removeImageFiles(vault, [id]).catch(() => {});
    throw new CommandError(409, "conflict", `${target.messageId} was deleted while its image was being made, so the image wasn't kept.`);
  }
  if (image.status === "done") {
    yield { type: "image_done", messageId: message.id, imageId: id, image, message };
  } else {
    const retry: RetryRequest = { command: "image.retry", args: { conversation: convId, message: message.id } };
    yield { type: "image_error", messageId: message.id, imageId: id, error: image.error, image, message, retry };
  }
  return { message, image, spentUsd };
}

/**
 * Run a generation's events after the request that started it has returned: message.edit and message.add
 * save a prompt and answer at once, and the image is painted here. It works on its own key copy (the request's
 * is closed when it returns) and holds the conversation's lock until the image is settled, so generation.follow
 * shows it, a browser can reload, and logout doesn't stop it.
 */
export function runDetached(gen: GenerationHandle, vault: Vault, events: (own: Vault) => AsyncIterable<StreamEvent>): void {
  const own = forkVault(vault);
  void (async () => {
    try {
      for await (const _ev of gen.relay(events(own))) {
        // Followers get each event through relay; nobody else is listening.
      }
    } catch {
      // relay has handed the error to followers, and the image's own record says what happened.
    } finally {
      gen.release();
      closeVault(own);
    }
  })();
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
