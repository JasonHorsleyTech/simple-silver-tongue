import { z } from "zod";
import { prepareRepaint, repaintEvents } from "../conversations/repaint.ts";
import { beginGeneration, type GenerationHandle } from "../conversations/store.ts";
import { notFound } from "../lib/errors.ts";
import { IMAGE_ID_RE, readImageFile } from "../images/files.ts";
import { sniffImage } from "../images/sniff.ts";
import { binaryCommand, streamCommand, type Ctx, type StreamEvent } from "../registry.ts";
import { conversationId } from "./conversations.ts";
import { messageId } from "./messages.ts";

/**
 * Images (T05). An image brain's reply is a prompt (the message's content) and an image made from it. turn and
 * message.regenerate get the prompt from the brain and paint it (chat.ts). These are the other ways an image
 * gets made, all from a prompt that is already in the ledger: retrying it, editing it, and writing it yourself.
 * Each one holds the conversation's lock until the image is settled (paint.ts).
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
    const kind = sniffImage(file.bytes) ?? file.kind;
    return { contentType: kind.mime, bytes: file.bytes, filename: `${args.id}.${kind.ext}` };
  },
});

const target = z.object({ conversation: conversationId, message: messageId.describe("The image message (m_...): its active version's prompt is painted") });

export const imageRetry = streamCommand({
  name: "image.retry",
  description: `Paint an image message's prompt again: for an image that failed, was interrupted, or came back blurred.
It paints the active version's prompt as it stands, with the conversation's image model and the brain's safe mode
as they are now (for a blurred image, turn safe mode off first: brain.update --no-safe-mode). No brain is asked. The current image stays until the new one is ready, then the new one replaces it. Streams like turn:
image_pending, then image_done or image_error, then done. One generation at a time per conversation (409).`,
  args: target,
  examples: ["./ss image.retry --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a"],
  async *handler(args, ctx) {
    const { vault } = ctx.requireSession();
    const gen = beginGeneration(vault, args.conversation); // 409 before any event
    try {
      yield* gen.relay(retryEvents(args, ctx, gen));
    } finally {
      gen.release();
    }
  },
});

async function* retryEvents(args: z.output<typeof target>, ctx: Ctx, gen: GenerationHandle): AsyncGenerator<StreamEvent, void> {
  const { vault } = ctx.requireSession();
  const conv = await gen.load(); // through the queue, after the lock (T03 QA-1)
  const job = await prepareRepaint(ctx.deps.venice, vault, gen, conv, args.message, {});
  yield* repaintEvents(job, vault, ctx.deps.venice, conv.id);
}

export default [imageGet, imageRetry];
