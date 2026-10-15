import { z } from "zod";
import { formatMessage, imageLine, revealMessage, shown, type MessageView } from "../conversations/format.ts";
import { revealHint } from "../conversations/hidden.ts";
import { assertImageIdle, imageIdsOf } from "../conversations/images.ts";
import { activeVersion, resolveBrain } from "../conversations/prompt.ts";
import { addImageMessage, editImagePrompt, type Started } from "../conversations/repaint.ts";
import { assertLedgerIdle, loadConversation, mutateConversation } from "../conversations/store.ts";
import { rollD20 } from "../conversations/dice.ts";
import { addSpend, newMessage, rollMessage } from "../conversations/turn.ts";
import type { Author, Brain, Conversation, LedgerMessage } from "../conversations/types.ts";
import { appendMessage, forgetMessage, type Forgotten } from "../conversations/makers.ts";
import { isMuse, rollLabel } from "../conversations/wording.ts";
import { newMuse } from "../conversations/defaults.ts";
import { badRequest, CommandError, conflict, notFound } from "../lib/errors.ts";
import { nowIso } from "../lib/ids.ts";
import { removeImageFiles } from "../images/files.ts";
import { command } from "../registry.ts";
import { authorRef, PLAYER } from "./brains.ts";
import { conversationId, messageId } from "./conversations.ts";

/**
 * Ledger edits (docs/design.md, "Turns, regeneration and edits"). Every brain reads the ledger fresh on each
 * request, so an edit, a delete or a version switch is what the history "always was" from the next request
 * on. They are refused (409) while a reply is being generated: that reply answers the messages as they were.
 * Regenerating is a generating command, so it lives with turn in chat.ts.
 */

// Defined beside conversationId, so brains.ts can use it too without an import cycle (brains.ts ↔ messages.ts).
export { MESSAGE_ID_RE, messageId } from "./conversations.ts";

function findMessage(conv: Conversation, id: string): LedgerMessage {
  const m = conv.messages.find((x) => x.id === id);
  if (!m) throw notFound(`No message ${id} in conversation ${conv.id}.`);
  return m;
}

export function viewOf(conv: Conversation, m: LedgerMessage): MessageView {
  const author = m.author.type === "player" ? "you" : (conv.brains.find((b) => b.id === (m.author as { brainId: string }).brainId)?.name ?? m.author.brainId);
  return { conversationId: conv.id, author, message: m };
}

/**
 * message.edit and message.add: the message, plus the image being made for it now, if they started one (T05), and
 * (T16, message.add) the brain it made, when its author makes brains.
 */
export type ImageMessageView = MessageView & { painting?: { imageId: string; model: string }; made?: Brain; museAdded?: Brain };

/**
 * T17: the brain `as` names, inside mutateConversation. "Muse" when no brain is called Muse adds one (newMuse), as a
 * fresh take does, so a note from the Muse can be written by hand from the start.
 */
function authorBrain(c: Conversation, as: string): { brain: Brain; museAdded: Brain | null } {
  if (isMuse({ name: as }) && !c.brains.some(isMuse)) {
    const brain = newMuse(c);
    c.brains.push(brain);
    return { brain, museAdded: brain };
  }
  return { brain: resolveBrain(c, as), museAdded: null };
}

/** The CLI's line for a Muse a hand-written note added (T17). */
const museLine = (b: Brain) => `Added a brain called ${b.name} (${b.id}): fresh takes' notes are its. Its system prompt is used only if you ask it for a turn.`;

const startedView = (s: Started): ImageMessageView => ({ ...viewOf(s.conv, s.message), ...(s.painting ? { painting: s.painting } : {}), ...(s.made ? { made: s.made } : {}) });

/** The CLI's line for a brain a new message made (T16). */
export const madeLine = (b: Brain, conversationId: string) =>
  `It made a new brain, ${b.name} (${b.id}), with this message pinned to it. Rename it once you know who it is: ./ss brain.update --conversation ${conversationId} --brain ${b.id} --name "..."`;

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
In the mouth of a brain that makes brains (T16, brain.update --makes), it makes a new brain, as a reply would.
--as Muse writes a note from the Muse (T17), as a fresh take does: a hidden idea for the next reply, which every
brain reads; with no brain called Muse yet, it adds one.
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
    './ss message.add --conversation c_k3j9x0q2ma --as Muse --content @idea.md   # a note from the Muse; then turn --brain "Game Master"',
  ],
  handler: async (args, ctx): Promise<ImageMessageView> => {
    const { vault } = ctx.requireSession();
    const player = args.as.trim().toLowerCase() === PLAYER;
    const before = await loadConversation(vault, args.conversation);
    const newMuseNow = isMuse({ name: args.as }) && !before.brains.some(isMuse); // T17: added below, a text brain
    if (!player && !newMuseNow && resolveBrain(before, args.as).kind === "image") {
      // A prompt in an image brain's mouth: saved, then painted as a job of its own (repaint.ts).
      return startedView(await addImageMessage(vault, ctx.deps.venice, args.conversation, args.as, args.content));
    }
    const { conv, result } = await mutateConversation(vault, args.conversation, (c) => {
      assertLedgerIdle(vault, c.id);
      let author: Author = { type: "player" };
      let museAdded: Brain | null = null;
      if (!player) {
        const found = authorBrain(c, args.as);
        museAdded = found.museAdded;
        if (found.brain.kind !== "text") throw conflict(`${found.brain.name} became an image brain while you were adding this. Try again.`);
        author = { type: "brain", brainId: found.brain.id };
      }
      const m = newMessage(author, "text", { content: args.content, source: "authored", createdAt: nowIso() });
      return { m, museAdded, made: appendMessage(c, m) }; // T16: in a maker's mouth, it makes a brain in the same write
    });
    return { ...viewOf(conv, result.m), ...(result.made ? { made: result.made } : {}), ...(result.museAdded ? { museAdded: result.museAdded } : {}) };
  },
  format: (r: ImageMessageView) => {
    const who = r.message.author.type === "player" ? "your message" : r.message.kind === "image" ? `an image prompt in ${r.author}'s mouth` : `in ${r.author}'s mouth`;
    return `Added ${r.message.id} (${who}). Every brain sees it from the next request.${r.message.kind === "image" ? paintingLine(r) : ""}${r.museAdded ? `\n${museLine(r.museAdded)}` : ""}${r.made ? `\n${madeLine(r.made, r.conversationId)}` : ""}`;
  },
});

export const messageRoll = command({
  name: "message.roll",
  description: `Roll a d20 and add it to the ledger as your message, without asking any brain to reply.
The server's random number generator rolls it, never a model: a whole number from 1 to 20, each as likely.
The message is the conversation's roll template with the number in it ("🎲 I rolled a d20: **14**"; change the
wording with conversation.update --templates.roll), and every brain reads it framed like any message of yours.
It runs on the honor system: it is an ordinary message, to edit or delete. To roll and have a brain answer in one
go, use turn --roll. Refused while a reply is being generated.`,
  args: z.object({ conversation: conversationId }),
  examples: ["./ss message.roll --conversation c_k3j9x0q2ma"],
  handler: async (args, ctx): Promise<MessageView> => {
    const { vault } = ctx.requireSession();
    const { conv, result } = await mutateConversation(vault, args.conversation, (c) => {
      assertLedgerIdle(vault, c.id);
      const m = rollMessage(c, rollD20());
      c.messages.push(m);
      return m;
    });
    return viewOf(conv, result);
  },
  format: (r: MessageView) => {
    const v = activeVersion(r.message);
    return `${v.roll ? rollLabel(v.roll) : v.content}\nAdded ${r.message.id} (your roll). Every brain sees it from the next request. Have a brain answer it: ./ss turn --conversation ${r.conversationId} --brain <name>`;
  },
});

export const messageGet = command({
  name: "message.get",
  description: `Show one message with every version: its text, and the steer (or fresh take) that produced it, if any.
The active version is the one every brain sees. Switch with message.select-version. Hidden notes fold to one
line: --reveal shows them.`,
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
T16: every pin of it goes too, and a brain made from it (brain.update --makes, brain.make) is deleted with it while
that brain has never spoken; one that has spoken stays and only loses the pin. The answer says which brain lost what.
An image message's image files (every version's) are deleted with it. Refused while a reply is being generated,
and while any of the message's images is still being made (Venice is making and billing it: wait for it to land).`,
  args: z.object(target),
  examples: ["./ss message.delete --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a"],
  handler: async (args, ctx) => {
    const { vault } = ctx.requireSession();
    const { conv, result } = await mutateConversation(vault, args.conversation, (c) => {
      assertLedgerIdle(vault, c.id);
      const m = findMessage(c, args.message);
      assertImageIdle(vault, m, "all", "delete");
      addSpend(c); // pin the running total first: the money is spent, even when the message goes (T03 QA-2)
      c.messages.splice(c.messages.indexOf(m), 1);
      // T16: its pins go, and a brain made from it goes too while it has never spoken. In the same write.
      return { gone: m, forgotten: forgetMessage(c, m.id) };
    });
    // After the save: a failed removal leaves an unreferenced file, never a message whose image is missing.
    const images = imageIdsOf([result.gone]);
    await removeImageFiles(vault, images);
    const { brainsDeleted, unpinned } = result.forgotten;
    return {
      conversationId: conv.id,
      deleted: args.message,
      messageCount: conv.messages.length,
      ...(images.length ? { imagesDeleted: images } : {}),
      ...(brainsDeleted.length ? { brainsDeleted } : {}),
      ...(unpinned.length ? { unpinned } : {}),
    };
  },
  format: (r: MessageDeleted) => {
    const out = [
      `Deleted ${r.deleted}${r.imagesDeleted ? ` and its image${r.imagesDeleted.length === 1 ? "" : "s"} (${r.imagesDeleted.join(", ")})` : ""}. ${r.messageCount} message${r.messageCount === 1 ? "" : "s"} left.`,
    ];
    for (const b of r.brainsDeleted ?? []) out.push(`Deleted brain ${b.name} (${b.brainId}) too: it was made from this message and had never spoken.`);
    for (const b of r.unpinned ?? []) {
      out.push(
        b.madeFrom
          ? `${b.name} (${b.brainId}) was made from this message and stays (it has spoken, or is the default brain); it no longer has it pinned.`
          : `${b.name} (${b.brainId}) had it pinned; the pin is gone.`,
      );
    }
    return out.join("\n");
  },
});

/** What message.delete answers. T16: the brains it deleted with the message, and the brains that lost their pin of it. */
export type MessageDeleted = { conversationId: string; deleted: string; messageCount: number; imagesDeleted?: string[] } & Partial<Forgotten>;

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
  format: (r: MessageView, opts) => {
    const v = activeVersion(r.message);
    const why = v.steer !== undefined ? ` (steer: "${v.steer}")` : v.thought !== undefined ? " (a fresh take)" : "";
    const count = { folded: 0 };
    const text = shown(v.content, r.message.kind, opts, count);
    const hint = count.folded ? `\n\n${revealHint(count.folded, revealMessage(r.conversationId, r.message.id))}` : "";
    return `${r.message.id} now shows version ${r.message.activeVersion + 1}/${r.message.versions.length}${why}. Every brain sees it from the next request.\n\n${text}${hint}`;
  },
});

export const messageSetAuthor = command({
  name: "message.set-author",
  description: `Change who said a message: any message, at any depth, to another brain of its kind, or to or from you.
An edit like any other: from the next request on, history "always was" that way. The new author reads the message
as its own words (assistant), and every other brain sees it framed with the new name. A text message can go to any
text brain or to you ("player"); an image prompt only to another image brain. A brain's message comes to you only
with a single version (yours have one), and a roll the server made stays yours. Its versions, pins and the brain it
made (if any) stay as they are, and it makes no new brain (brain.make does that by hand). Refused while a reply is
being generated.`,
  args: z.object({
    ...target,
    as: authorRef.describe(`Who said it now: "${PLAYER}" (you), or a brain's name or id`),
  }),
  examples: [
    './ss message.set-author --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a --as "Character 2"',
    "./ss message.set-author --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a --as player",
  ],
  handler: async (args, ctx): Promise<MessageView & { from: string; changed: boolean; museAdded?: Brain }> => {
    const { vault } = ctx.requireSession();
    const { conv, result } = await mutateConversation(vault, args.conversation, (c) => {
      assertLedgerIdle(vault, c.id);
      const m = findMessage(c, args.message);
      const from = viewOf(c, m).author;
      const player = args.as.trim().toLowerCase() === PLAYER;
      // T17: --as Muse with no brain called Muse adds one, as message.add does (dropped below if the move is refused).
      const found = player ? null : authorBrain(c, args.as);
      const to: Author = found ? { type: "brain", brainId: found.brain.id } : { type: "player" };
      const same = to.type === m.author.type && (to.type === "player" || to.brainId === (m.author as { brainId: string }).brainId);
      if (same) return { m, from, changed: false, museAdded: null };
      if (to.type === "player") {
        if (m.kind === "image") throw badRequest(`${m.id} is an image prompt, and only an image brain can say one. Move it to another image brain.`);
        if (m.versions.length > 1) {
          throw badRequest(`${m.id} has ${m.versions.length} versions, and a message of yours has exactly one. Move it to another brain instead, or copy the version you want into a message of yours (message.add --as player).`);
        }
      } else {
        const brain = c.brains.find((b) => b.id === to.brainId)!;
        if (brain.kind !== m.kind) {
          throw badRequest(`${m.id} is ${m.kind === "image" ? "an image prompt" : "a text message"}, and ${brain.name} is ${brain.kind === "image" ? "an image" : "a text"} brain. A message moves only to a brain of its kind.`);
        }
        if (m.versions.some((v) => v.roll)) throw badRequest(`${m.id} is a roll the server made for you, so it stays yours. Edit or delete it instead.`);
      }
      m.author = to;
      m.updatedAt = nowIso(); // stamped in the write queue (the browser keeps the newer copy)
      return { m, from, changed: true, museAdded: found?.museAdded ?? null };
    });
    return { ...viewOf(conv, result.m), from: result.from, changed: result.changed, ...(result.museAdded ? { museAdded: result.museAdded } : {}) };
  },
  format: (r: MessageView & { from: string; changed: boolean; museAdded?: Brain }) =>
    (r.changed
      ? `${r.message.id} is now said by ${r.author} (was ${r.from}). Every brain sees it that way from the next request: ${r.author === "you" ? "framed as yours" : `${r.author} reads it as its own words, and the other brains see it framed with that name`}.`
      : `${r.message.id} is already said by ${r.author}. Nothing changed.`) + (r.museAdded ? `\n${museLine(r.museAdded)}` : ""),
});

export default [messageAdd, messageRoll, messageGet, messageEdit, messageDelete, messageSelectVersion, messageSetAuthor];
