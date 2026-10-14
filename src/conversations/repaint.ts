import { CommandError, conflict, notFound } from "../lib/errors.ts";
import { nowIso } from "../lib/ids.ts";
import type { StreamEvent } from "../registry.ts";
import type { Vault } from "../storage/vault.ts";
import type { VeniceClient } from "../venice/client.ts";
import { beginPainting, endPainting, newImageRecord } from "./images.ts";
import { imageNote, paint, painterFor, runDetached, type Painter } from "./paint.ts";
import { activeVersion, resolveBrain } from "./prompt.ts";
import { beginGeneration, mutateConversation, type GenerationHandle } from "./store.ts";
import { newMessage } from "./turn.ts";
import type { Brain, Conversation, ImageRecord, LedgerMessage } from "./types.ts";

/**
 * Making an image from a prompt that is already in the ledger (T05): retrying it (image.retry), editing it
 * (message.edit), or writing it yourself in an image brain's mouth (message.add). No brain is asked; the prompt
 * is painted as it stands. Each holds the conversation's lock from the save to the settled image.
 */

/** A new image for a message that is in the ledger, saved as pending and owned by this generation. */
export type Repaint = { message: LedgerMessage; brain: Brain; painter: Painter; image: ImageRecord; prompt: string; changed: boolean };

/**
 * Give an image message's active version a new pending image (and, for an edit, its new prompt), keeping the
 * one it had as `previous` until the new one is done. Call it holding the lock, after gen.load().
 * With `content` equal to the current prompt nothing changes and no image is made (changed: false).
 */
export async function prepareRepaint(venice: VeniceClient, vault: Vault, gen: GenerationHandle, conv: Conversation, id: string, opts: { content?: string }): Promise<Repaint> {
  const m = conv.messages.find((x) => x.id === id);
  if (!m) throw notFound(`No message ${id} in conversation ${conv.id}.`);
  if (m.kind !== "image" || m.author.type !== "brain") {
    throw new CommandError(400, "not_an_image", `${m.id} is a text message, so it has no image to make. Only an image brain's messages have one.`);
  }
  const brainId = m.author.brainId;
  const brain = conv.brains.find((b) => b.id === brainId);
  if (!brain) throw new Error(`message ${m.id}: author brain ${brainId} is missing from conversation ${conv.id}`);
  gen.forBrain(brain.id);
  const painter = await painterFor(venice, conv, brain); // an unknown image model: 400, nothing changed
  if (opts.content !== undefined && activeVersion(m).content === opts.content) {
    return { message: m, brain, painter, image: activeVersion(m).image!, prompt: opts.content, changed: false };
  }
  let image!: ImageRecord;
  let prompt = "";
  try {
    const { result } = await mutateConversation(vault, conv.id, (c) => {
      const mm = c.messages.find((x) => x.id === id);
      if (!mm) throw notFound(`No message ${id} in conversation ${conv.id}.`);
      const v = activeVersion(mm);
      if (opts.content !== undefined) {
        v.content = opts.content;
        v.edited = true;
      }
      image = newImageRecord({ model: painter.model.id, safeMode: painter.safeMode, replacing: v.image });
      v.image = image;
      prompt = v.content;
      mm.updatedAt = nowIso();
      beginPainting(vault, image.id); // owned before the pending record reaches disk
      return mm;
    });
    return { message: result, brain, painter, image, prompt, changed: true };
  } catch (err) {
    if (image) endPainting(vault, image.id);
    throw err;
  }
}

/** The events of an image-only generation (retry, edit, add): no text streams, the message is already saved. */
export async function* repaintEvents(job: Repaint, vault: Vault, venice: VeniceClient, convId: string): AsyncGenerator<StreamEvent, void> {
  const { message, brain, image } = job;
  try {
    yield { type: "start", brainId: brain.id, brainName: brain.name, messageId: message.id, kind: "image", imageOnly: true };
    yield { type: "image_pending", messageId: message.id, imageId: image.id, model: image.model, message };
  } catch (err) {
    endPainting(vault, image.id); // a generator that never reaches paint() still gives its image up
    throw err;
  }
  const painted = yield* paint(vault, venice, convId, { messageId: message.id, image, prompt: job.prompt }, job.painter);
  yield { type: "done", message: painted.message, note: `${brain.name} · ${imageNote(painted.image)}`, spentUsd: painted.spentUsd };
}

/** What an edit or add that makes an image answers: the conversation as saved, the message, and its new image. */
export type Started = { conv: Conversation; message: LedgerMessage; painting?: { imageId: string; model: string } };

/**
 * message.edit on an image message: the prompt is edited in place, and a new image is made from it. The old
 * image stays (as `previous`) until the new one is ready, then the new one swaps in. The edit answers at once;
 * the image is painted after it, holding the lock (generation.follow shows it). The same prompt: no change.
 */
export async function editImagePrompt(vault: Vault, venice: VeniceClient, convId: string, id: string, content: string): Promise<Started> {
  const gen = beginGeneration(vault, convId); // 409 while another generation runs, like any ledger edit
  let handedOff = false;
  try {
    const conv = await gen.load();
    const job = await prepareRepaint(venice, vault, gen, conv, id, { content });
    if (!job.changed) return { conv, message: job.message };
    runDetached(gen, vault, (own) => repaintEvents(job, own, venice, conv.id));
    handedOff = true;
    return { conv, message: job.message, painting: { imageId: job.image.id, model: job.image.model } };
  } finally {
    if (!handedOff) gen.release();
  }
}

/**
 * message.add --as <image brain>: a prompt you wrote, in the brain's mouth, and the image it makes. Every other
 * brain sees the prompt framed, as if the brain had written it. Answers at once; the image is painted after.
 */
export async function addImageMessage(vault: Vault, venice: VeniceClient, convId: string, as: string, content: string): Promise<Started> {
  const gen = beginGeneration(vault, convId);
  let handedOff = false;
  try {
    const conv = await gen.load();
    const brain = resolveBrain(conv, as);
    gen.forBrain(brain.id);
    const painter = await painterFor(venice, conv, brain);
    let image!: ImageRecord;
    try {
      const { conv: saved, result } = await mutateConversation(vault, conv.id, (c) => {
        const now = c.brains.find((b) => b.id === brain.id);
        if (now?.kind !== "image") throw conflict(`${brain.name} changed while you were adding this. Try again.`);
        image = newImageRecord({ model: painter.model.id, safeMode: painter.safeMode });
        const m = newMessage({ type: "brain", brainId: brain.id }, "image", { content, source: "authored", createdAt: nowIso(), image });
        c.messages.push(m);
        beginPainting(vault, image.id);
        return m;
      });
      const job: Repaint = { message: result, brain, painter, image, prompt: content, changed: true };
      runDetached(gen, vault, (own) => repaintEvents(job, own, venice, conv.id));
      handedOff = true;
      return { conv: saved, message: result, painting: { imageId: image.id, model: image.model } };
    } catch (err) {
      if (image && !handedOff) endPainting(vault, image.id);
      throw err;
    }
  } finally {
    if (!handedOff) gen.release();
  }
}

