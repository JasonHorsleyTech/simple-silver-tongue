import { CommandError, conflict, notFound } from "../lib/errors.ts";
import { nowIso } from "../lib/ids.ts";
import type { Vault } from "../storage/vault.ts";
import type { VeniceClient } from "../venice/client.ts";
import { assertImageIdle, beginPainting, endPainting, newImageRecord } from "./images.ts";
import { appendMessage } from "./makers.ts";
import { painterFor, startPainting, type Painter } from "./paint.ts";
import { activeVersion, resolveBrain } from "./prompt.ts";
import { assertAcceptingWork, assertLedgerIdle, loadConversation, mutateConversation } from "./store.ts";
import { newMessage } from "./turn.ts";
import type { Brain, Conversation, ImageRecord, LedgerMessage, MessageVersion } from "./types.ts";

/**
 * Making an image from a prompt that is already in the ledger (T05): retrying it (image.retry), editing it
 * (message.edit), or writing it yourself in an image brain's mouth (message.add). No brain is asked; the prompt
 * is painted as it stands. Since T05 triage none of them holds the conversation's lock while the image is
 * made: the prompt is saved with a pending image, the image is a job of its own (startPainting), and only
 * what would replace or remove that image waits for it (assertImageIdle).
 */

/** An image message, and the brain whose mouth it is in, with the painter for that brain. */
async function imageMessage(venice: VeniceClient, conv: Conversation, id: string): Promise<{ message: LedgerMessage; brain: Brain; painter: Painter }> {
  const m = conv.messages.find((x) => x.id === id);
  if (!m) throw notFound(`No message ${id} in conversation ${conv.id}.`);
  if (m.kind !== "image" || m.author.type !== "brain") {
    throw new CommandError(400, "not_an_image", `${m.id} is a text message, so it has no image to make. Only an image brain's messages have one.`);
  }
  const brainId = m.author.brainId;
  const brain = conv.brains.find((b) => b.id === brainId);
  if (!brain) throw new Error(`message ${m.id}: author brain ${brainId} is missing from conversation ${conv.id}`);
  return { message: m, brain, painter: await painterFor(venice, conv, brain) }; // an unknown image model: 400, nothing changed
}

/**
 * What an edit, add or retry that makes an image answers: the conversation as saved, the message, and its new image.
 * `made` (T16): the brain an add made, when the image brain makes brains.
 */
export type Started = { conv: Conversation; message: LedgerMessage; brain: Brain; painting?: { imageId: string; model: string }; made?: Brain };

/**
 * Save `change` (which gives the message a new pending image and returns it) and start painting that image.
 * The image is owned before the pending record reaches disk, and given up if the save fails.
 */
async function saveAndPaint(
  vault: Vault,
  venice: VeniceClient,
  convId: string,
  painter: Painter,
  change: (c: Conversation) => { message: LedgerMessage; image: ImageRecord; prompt: string } | null,
): Promise<{ conv: Conversation; message: LedgerMessage | null; image?: ImageRecord }> {
  const owned = { id: "" };
  try {
    const { conv, result: made } = await mutateConversation(vault, convId, (c) => {
      const made = change(c);
      if (made) beginPainting(vault, (owned.id = made.image.id), { convId, messageId: made.message.id }); // the write comes next
      return made;
    });
    if (!made) return { conv, message: null };
    startPainting(vault, venice, convId, { messageId: made.message.id, image: made.image, prompt: made.prompt }, painter);
    return { conv, message: made.message, image: made.image };
  } catch (err) {
    if (owned.id) endPainting(vault, owned.id);
    throw err;
  }
}

/**
 * message.edit on an image message: the prompt is edited in place, and a new image is made from it. The old
 * image stays (as `previous`) until the new one is ready, then the new one swaps in. The edit answers at once,
 * and the image is painted after it. Refused while a reply is being written (it answers the prompt as it was),
 * and while this version's own image is still being made (it would be replaced before it was ever shown).
 * The same prompt: no change, no image.
 */
export async function editImagePrompt(vault: Vault, venice: VeniceClient, convId: string, id: string, content: string): Promise<Started> {
  assertAcceptingWork();
  const conv = await loadConversation(vault, convId);
  const { message: m, brain, painter } = await imageMessage(venice, conv, id);
  if (activeVersion(m).content === content) return { conv, message: m, brain }; // nothing to change, nothing to paint
  const saved = await saveAndPaint(vault, venice, convId, painter, (c) => {
    assertLedgerIdle(vault, c.id);
    const mm = c.messages.find((x) => x.id === id);
    if (!mm) throw notFound(`No message ${id} in conversation ${c.id}.`);
    const v = activeVersion(mm);
    if (v.content === content) return null;
    assertImageIdle(vault, mm, "active", "edit");
    v.content = content;
    v.edited = true;
    v.image = newImageRecord({ model: painter.model.id, safeMode: painter.safeMode, replacing: v.image });
    mm.updatedAt = nowIso();
    return { message: mm, image: v.image, prompt: content };
  });
  const message = saved.message ?? saved.conv.messages.find((x) => x.id === id) ?? m;
  return { conv: saved.conv, message, brain, ...(saved.image ? { painting: { imageId: saved.image.id, model: saved.image.model } } : {}) };
}

/**
 * message.add --as <image brain>: a prompt you wrote, in the brain's mouth, and the image it makes. Every other
 * brain sees the prompt framed, as if the brain had written it. Answers at once; the image is painted after.
 */
export async function addImageMessage(vault: Vault, venice: VeniceClient, convId: string, as: string, content: string): Promise<Started> {
  assertAcceptingWork();
  const conv = await loadConversation(vault, convId);
  const brain = resolveBrain(conv, as);
  const painter = await painterFor(venice, conv, brain);
  let made = null as Brain | null; // set inside the save
  const saved = await saveAndPaint(vault, venice, convId, painter, (c) => {
    assertLedgerIdle(vault, c.id); // a reply being written would land after it, answering what came before it
    const now = c.brains.find((b) => b.id === brain.id);
    if (now?.kind !== "image") throw conflict(`${brain.name} changed while you were adding this. Try again.`);
    const image = newImageRecord({ model: painter.model.id, safeMode: painter.safeMode });
    const m = newMessage({ type: "brain", brainId: brain.id }, "image", { content, source: "authored", createdAt: nowIso(), image });
    made = appendMessage(c, m); // T16: a maker's new message makes its brain in the same write
    return { message: m, image, prompt: content };
  });
  return { conv: saved.conv, message: saved.message!, brain, painting: { imageId: saved.image!.id, model: saved.image!.model }, ...(made ? { made } : {}) };
}

/**
 * image.retry: paint the active version's prompt again, with the image model and safe mode as they are now.
 * A failed, interrupted or blurred image is replaced in place (it stays as `previous`, if it was shown, until
 * the new one is done). A finished, clean image is never thrown away (T05 QA-5): the retry adds a new version
 * with the same prompt, so both images are kept and the pager goes back to the first. Not a ledger edit (no
 * brain sees anything new), so a reply being written doesn't stop it; this version's image being made does.
 */
export async function retryImage(vault: Vault, venice: VeniceClient, convId: string, id: string): Promise<Started & { painting: { imageId: string; model: string } }> {
  assertAcceptingWork();
  const { brain, painter } = await imageMessage(venice, await loadConversation(vault, convId), id);
  const saved = await saveAndPaint(vault, venice, convId, painter, (c) => {
    const mm = c.messages.find((x) => x.id === id);
    if (!mm) throw notFound(`No message ${id} in conversation ${c.id}.`);
    assertImageIdle(vault, mm, "active", "retry the image of");
    const v = activeVersion(mm);
    const img = v.image;
    const keep = img?.status === "done" && !img.blurred && !img.contentViolation;
    const image = newImageRecord({ model: painter.model.id, safeMode: painter.safeMode, ...(keep ? {} : { replacing: img }) });
    if (keep) {
      const again: MessageVersion = { content: v.content, source: v.source, repaintOf: mm.activeVersion, image, createdAt: image.createdAt };
      if (v.edited) again.edited = true;
      if (v.model) again.model = v.model;
      mm.versions.push(again);
      mm.activeVersion = mm.versions.length - 1;
    } else {
      v.image = image;
    }
    mm.updatedAt = nowIso();
    return { message: mm, image, prompt: v.content };
  });
  return { conv: saved.conv, message: saved.message!, brain, painting: { imageId: saved.image!.id, model: saved.image!.model } };
}
