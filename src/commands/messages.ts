import { z } from "zod";
import { formatMessage, imageLine, type MessageView } from "../conversations/format.ts";
import { assertImageIdle, imageIdsOf } from "../conversations/images.ts";
import { activeVersion, resolveBrain } from "../conversations/prompt.ts";
import { addImageMessage, editImagePrompt, type Started } from "../conversations/repaint.ts";
import { assertLedgerIdle, loadConversation, mutateConversation } from "../conversations/store.ts";
import { addSpend, newMessage } from "../conversations/turn.ts";
import type { Author, Conversation, LedgerMessage } from "../conversations/types.ts";
import { CommandError, conflict, notFound } from "../lib/errors.ts";
import { nowIso } from "../lib/ids.ts";
import { removeImageFiles } from "../images/files.ts";
import { command } from "../registry.ts";
import { authorRef, PLAYER } from "./brains.ts";
import { conversationId } from "./conversations.ts";

/**
 * Ledger edits (docs/design.md, "Turns, regeneration and edits"). Every brain reads the ledger fresh on each
 * request, so an edit, a delete or a version switch is what the history "always was" from the next request
 * on. They are refused (409) while a reply is being generated: that reply answers the messages as they were.
 * Regenerating is a generating command, so it lives with turn in chat.ts.
 */

export const MESSAGE_ID_RE = /^m_[a-z0-9]{4,32}$/;
export const messageId = z.string().regex(MESSAGE_ID_RE, "Message ids look like m_k3j9x0q2ma").describe("Message id (m_...), from conversation.get");

function findMessage(conv: Conversation, id: string): LedgerMessage {
  const m = conv.messages.find((x) => x.id === id);
  if (!m) throw notFound(`No message ${id} in conversation ${conv.id}.`);
  return m;
}

export function viewOf(conv: Conversation, m: LedgerMessage): MessageView {
  const author = m.author.type === "player" ? "you" : (conv.brains.find((b) => b.id === (m.author as { brainId: string }).brainId)?.name ?? m.author.brainId);
  return { conversationId: conv.id, author, message: m };
}

/** message.edit and message.add: the message, plus the image being made for it now, if they started one (T05). */
export type ImageMessageView = MessageView & { painting?: { imageId: string; model: string } };

const startedView = (s: Started): ImageMessageView => ({ ...viewOf(s.conv, s.message), ...(s.painting ? { painting: s.painting } : {}) });

/** The CLI's words for an edit or add of an image message. */
function paintingLine(r: ImageMessageView): string {
  const v = activeVersion(r.message);
  if (!r.painting) return v.image ? ` It keeps its ${imageLine(v.image)}.` : "";
  const keeps = v.image?.previous ? ` ${v.image.previous.id} stays until it is ready.` : "";
  return ` Making its image ${r.painting.imageId} with ${r.painting.model}.${keeps} Other brains can go on meanwhile. Watch it: ./ss image.follow --conversation ${r.conversationId} --message ${r.message.id}`;
}

const target = { conversation: conversationId, message: messageId };

const messageText = (blank: string, describe: string) =>
  z
    .string()
    .refine((s) => s.trim() !== "", blank)
    .describe(describe);

export const messageAdd = command({
  name: "message.add",
  description: `Add a message you wrote to the end of the ledger, without asking any brain to reply.
--as player adds it as your own message. --as <brain> puts the words in that brain's mouth, e.g. the Game
Master's opening scene: that brain sees them as its own past reply (assistant), every other brain sees them
framed with its name, exactly as if it had written them. Then send a turn, to any brain, to carry on.
--as <image brain> makes the content its image prompt, and its image is made from it: this answers at once,
and the image is painted after (image.follow watches it; conversation.get shows its state).
Refused while a reply is being generated (it would land after your message, answering what came before it).`,
  args: z.object({
    conversation: conversationId,
    as: authorRef.describe(`Who says it: "${PLAYER}" (you), or a brain's name or id`),
    content: messageText("The message can't be empty", "The message (Markdown; @file.md or - for stdin)"),
  }),
  examples: [
    './ss message.add --conversation c_k3j9x0q2ma --as "Game Master" --content @opening-scene.md',
    './ss message.add --conversation c_k3j9x0q2ma --as player --content "I look around the tavern."',
  ],
  handler: async (args, ctx): Promise<ImageMessageView> => {
    const { vault } = ctx.requireSession();
    const player = args.as.trim().toLowerCase() === PLAYER;
    if (!player && resolveBrain(await loadConversation(vault, args.conversation), args.as).kind === "image") {
      // A prompt in an image brain's mouth: saved, then painted as a job of its own (repaint.ts).
      return startedView(await addImageMessage(vault, ctx.deps.venice, args.conversation, args.as, args.content));
    }
    const { conv, result } = await mutateConversation(vault, args.conversation, (c) => {
      assertLedgerIdle(vault, c.id);
      let author: Author = { type: "player" };
      if (!player) {
        const brain = resolveBrain(c, args.as);
        if (brain.kind !== "text") throw conflict(`${brain.name} became an image brain while you were adding this. Try again.`);
        author = { type: "brain", brainId: brain.id };
      }
      const m = newMessage(author, "text", { content: args.content, source: "authored", createdAt: nowIso() });
      c.messages.push(m);
      return m;
    });
    return viewOf(conv, result);
  },
  format: (r: ImageMessageView) => {
    const who = r.message.author.type === "player" ? "your message" : r.message.kind === "image" ? `an image prompt in ${r.author}'s mouth` : `in ${r.author}'s mouth`;
    return `Added ${r.message.id} (${who}). Every brain sees it from the next request.${r.message.kind === "image" ? paintingLine(r) : ""}`;
  },
});

export const messageGet = command({
  name: "message.get",
  description: `Show one message with every version: its text, and the steer that produced it, if any.
The active version is the one every brain sees. Switch with message.select-version.`,
  args: z.object(target),
  examples: ["./ss message.get --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a"],
  handler: async (args, ctx): Promise<MessageView> => {
    const conv = await loadConversation(ctx.requireSession().vault, args.conversation);
    return viewOf(conv, findMessage(conv, args.message));
  },
  format: formatMessage,
});

export const messageEdit = command({
  name: "message.edit",
  description: `Replace a message's text: any message, yours or a brain's, at any depth.
It edits the active version in place (marked edited). From the next request on, every brain sees the new text as
what was always there; prompt.preview shows it. To edit another version, select it first. Refused while a reply
is being generated. For an image message the text is its prompt, and a new image is made from the new prompt:
the edit answers at once, the old image stays until the new one is ready, and then the new one replaces it
(image.follow watches it). If the new one fails, the old one is still there, and image.retry tries again.
While this version's image is still being made, its prompt can't be edited (409): wait for it to land.`,
  args: z.object({
    ...target,
    content: messageText("The new text can't be empty. To remove a message, delete it", "The new text (Markdown; @file.md or - for stdin)"),
  }),
  examples: [
    './ss message.edit --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a --content "I order the plum wine."',
    "./ss message.edit --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a --content @fixed.md",
  ],
  handler: async (args, ctx): Promise<ImageMessageView> => {
    const { vault } = ctx.requireSession();
    // A message's kind never changes, so this read can decide which path it takes.
    if (findMessage(await loadConversation(vault, args.conversation), args.message).kind === "image") {
      return startedView(await editImagePrompt(vault, ctx.deps.venice, args.conversation, args.message, args.content));
    }
    const { conv, result } = await mutateConversation(vault, args.conversation, (c) => {
      assertLedgerIdle(vault, c.id);
      const m = findMessage(c, args.message);
      const v = activeVersion(m);
      if (v.content !== args.content) {
        v.content = args.content;
        v.edited = true;
        m.updatedAt = nowIso();
      }
      return m;
    });
    return viewOf(conv, result);
  },
  format: (r: ImageMessageView) =>
    `Edited ${r.message.id} (${r.author}, version ${r.message.activeVersion + 1}/${r.message.versions.length}). Every brain sees the new ${r.message.kind === "image" ? "prompt" : "text"} from the next request.${r.message.kind === "image" ? paintingLine(r) : ""}`,
});

export const messageDelete = command({
  name: "message.delete",
  description: `Delete a message, with all its versions: any message, yours or a brain's, at any depth.
From the next request on, it is as if it was never there. What it cost stays in the conversation's total.
An image message's image files (every version's) are deleted with it. Refused while a reply is being generated,
and while any of the message's images is still being made (Venice is making and billing it: wait for it to land).`,
  args: z.object(target),
  examples: ["./ss message.delete --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a"],
  handler: async (args, ctx) => {
    const { vault } = ctx.requireSession();
    const { conv, result: gone } = await mutateConversation(vault, args.conversation, (c) => {
      assertLedgerIdle(vault, c.id);
      const m = findMessage(c, args.message);
      assertImageIdle(vault, m, "all", "delete");
      addSpend(c); // pin the running total first: the money is spent, even when the message goes (T03 QA-2)
      c.messages.splice(c.messages.indexOf(m), 1);
      return m;
    });
    // After the save: a failed removal leaves an unreferenced file, never a message whose image is missing.
    const images = imageIdsOf([gone]);
    await removeImageFiles(vault, images);
    return { conversationId: conv.id, deleted: args.message, messageCount: conv.messages.length, ...(images.length ? { imagesDeleted: images } : {}) };
  },
  format: (r: { deleted: string; messageCount: number; imagesDeleted?: string[] }) =>
    `Deleted ${r.deleted}${r.imagesDeleted ? ` and its image${r.imagesDeleted.length === 1 ? "" : "s"} (${r.imagesDeleted.join(", ")})` : ""}. ${r.messageCount} message${r.messageCount === 1 ? "" : "s"} left.`,
});

export const messageSelectVersion = command({
  name: "message.select-version",
  description: `Make another version of a message the active one: the one every brain sees from the next request on.
Versions are numbered from 1 (the original), as conversation.get and message.get show them ("version 2/3").
Go back to an earlier version and keep playing from it; a later regenerate adds a new version after the others.
Refused while a reply is being generated.`,
  args: z.object({
    ...target,
    version: z.number().int().min(1).describe("Version number, from 1 (the original)"),
  }),
  examples: ["./ss message.select-version --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a --version 2"],
  handler: async (args, ctx): Promise<MessageView> => {
    const { vault } = ctx.requireSession();
    const { conv, result } = await mutateConversation(vault, args.conversation, (c) => {
      assertLedgerIdle(vault, c.id);
      const m = findMessage(c, args.message);
      if (args.version > m.versions.length) {
        throw new CommandError(400, "no_such_version", `${m.id} has ${m.versions.length} version${m.versions.length === 1 ? "" : "s"}, so there is no version ${args.version}.`);
      }
      if (m.activeVersion !== args.version - 1) {
        m.activeVersion = args.version - 1;
        m.updatedAt = nowIso();
      }
      return m;
    });
    return viewOf(conv, result);
  },
  format: (r: MessageView) => {
    const v = activeVersion(r.message);
    const why = v.steer !== undefined ? ` (steer: "${v.steer}")` : "";
    return `${r.message.id} now shows version ${r.message.activeVersion + 1}/${r.message.versions.length}${why}. Every brain sees it from the next request.\n\n${v.content}`;
  },
});

export default [messageAdd, messageGet, messageEdit, messageDelete, messageSelectVersion];
