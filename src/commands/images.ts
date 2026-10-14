import { z } from "zod";
import { followImages, imageNote } from "../conversations/paint.ts";
import { retryImage } from "../conversations/repaint.ts";
import { notFound } from "../lib/errors.ts";
import { IMAGE_ID_RE, readImageFile } from "../images/files.ts";
import { binaryCommand, streamCommand } from "../registry.ts";
import { conversationId } from "./conversations.ts";
import { messageId } from "./messages.ts";

/**
 * Images (T05). An image brain's reply is a prompt (the message's content) and an image made from it. turn and
 * message.regenerate get the prompt from the brain and paint it (chat.ts). These are the other ways an image
 * gets made, all from a prompt that is already in the ledger: retrying it, editing it, and writing it yourself.
 * Since T05 triage an image is a job of its own, not part of the conversation's generation (paint.ts), and
 * image.follow watches one.
 */

export const imageId = z.string().regex(IMAGE_ID_RE, "Image ids look like img_k3j9x0q2ma").describe("Image id (img_...), from conversation.get or a stream's image events");

export const imageGet = binaryCommand({
  name: "image.get",
  description: `Fetch an image's bytes (decrypted, for an encrypted user). GET /api/image.get?id=img_... works too, for <img src>.
The Content-Type is what the bytes really are (sniffed), whatever format was asked for. From the terminal, save
it with --out, or pipe it. An image that is still being made, failed or was deleted is a 404.`,
  args: z.object({ id: imageId }),
  examples: ["./ss image.get --id img_k3j9x0q2ma --out scene.webp", "./ss image.get --id img_k3j9x0q2ma > scene.png"],
  handler: async (args, ctx) => {
    const file = await readImageFile(ctx.requireSession().vault, args.id);
    if (!file) throw notFound(`No image ${args.id}: it is still being made, it failed, or it was deleted. conversation.get shows each image's state.`);
    const kind = file.kind ?? { mime: "application/octet-stream", ext: "bin" }; // sniffed from the decrypted bytes
    return { contentType: kind.mime, bytes: file.bytes, filename: `${args.id}.${kind.ext}` };
  },
});

const target = z.object({ conversation: conversationId, message: messageId.describe("The image message (m_...): its active version's prompt is painted") });

export const imageRetry = streamCommand({
  name: "image.retry",
  description: `Paint an image message's prompt again, with the conversation's image model and the brain's safe mode as
they are now. No brain is asked. A failed, interrupted or blurred image is replaced: it stays until the new one is
ready (for a blurred one, turn safe mode off first: brain.update --no-safe-mode). A finished image is never thrown
away: retrying it makes a new version with the same prompt, so you keep both and can page back to the first.
Streams like turn: image_pending, then image_done or image_error, then done. It doesn't hold the conversation, so
other brains can take their turn meanwhile; it is refused (409) while this version's own image is still being made.`,
  args: target,
  examples: ["./ss image.retry --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a"],
  async *handler(args, ctx) {
    const { vault } = ctx.requireSession();
    const s = await retryImage(vault, ctx.deps.venice, args.conversation, args.message); // 409 / 400 before any event
    const { imageId, model } = s.painting;
    yield { type: "start", brainId: s.brain.id, brainName: s.brain.name, messageId: s.message.id, kind: "image", imageOnly: true };
    yield { type: "image_pending", messageId: s.message.id, imageId, model, message: s.message };
    const { message, spentUsd } = yield* followImages(vault, args.conversation, s.message.id, { imageId, announced: [imageId] });
    const img = message.versions.find((v) => v.image?.id === imageId)?.image;
    yield { type: "done", message, note: `${s.brain.name} · ${img ? imageNote(img) : imageId}`, spentUsd };
  },
});

export const imageFollow = streamCommand({
  name: "image.follow",
  description: `Watch a message's image being made, until it lands. Images don't hold the conversation (other brains
can take their turn meanwhile), so this is how a client that saw a pending image learns how it ended: after an
edit or an add, after a reload, from another terminal. It streams image_pending for each image of the message
being made, then image_done or image_error as each lands, and ends with done and the message as saved. When none
is being made it ends at once with done and the message as it is, so a result that landed first is never missed.`,
  args: z.object({ conversation: conversationId, message: messageId.describe("The image message (m_...)") }),
  examples: ["./ss image.follow --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a"],
  async *handler(args, ctx) {
    const { vault } = ctx.requireSession();
    const { message, spentUsd } = yield* followImages(vault, args.conversation, args.message);
    const img = message.versions[message.activeVersion]?.image;
    yield { type: "done", message, note: img ? imageNote(img) : `${message.id} has no image`, spentUsd };
  },
});

export default [imageGet, imageRetry, imageFollow];
