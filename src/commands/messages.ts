import { z } from "zod";
import { formatMessage, type MessageView } from "../conversations/format.ts";
import { activeVersion } from "../conversations/prompt.ts";
import { assertLedgerIdle, loadConversation, mutateConversation } from "../conversations/store.ts";
import type { Conversation, LedgerMessage } from "../conversations/types.ts";
import { CommandError, notFound } from "../lib/errors.ts";
import { nowIso } from "../lib/ids.ts";
import { command } from "../registry.ts";
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

const target = { conversation: conversationId, message: messageId };

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
is being generated. Image messages (their prompt) can be edited from T05.`,
  args: z.object({
    ...target,
    content: z
      .string()
      .refine((s) => s.trim() !== "", "The new text can't be empty. To remove a message, delete it")
      .describe("The new text (Markdown; @file.md or - for stdin)"),
  }),
  examples: [
    './ss message.edit --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a --content "I order the plum wine."',
    "./ss message.edit --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a --content @fixed.md",
  ],
  handler: async (args, ctx): Promise<MessageView> => {
    const { vault } = ctx.requireSession();
    const { conv, result } = await mutateConversation(vault, args.conversation, (c) => {
      assertLedgerIdle(vault, c.id);
      const m = findMessage(c, args.message);
      if (m.kind !== "text") throw new CommandError(400, "not_supported", `${m.id} is an image message; editing its prompt arrives with image brains (T05).`);
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
  format: (r: MessageView) => `Edited ${r.message.id} (${r.author}, version ${r.message.activeVersion + 1}/${r.message.versions.length}). Every brain sees the new text from the next request.`,
});

export const messageDelete = command({
  name: "message.delete",
  description: `Delete a message, with all its versions: any message, yours or a brain's, at any depth.
From the next request on, it is as if it was never there. Refused while a reply is being generated.`,
  args: z.object(target),
  examples: ["./ss message.delete --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a"],
  handler: async (args, ctx) => {
    const { vault } = ctx.requireSession();
    const { conv } = await mutateConversation(vault, args.conversation, (c) => {
      assertLedgerIdle(vault, c.id);
      const m = findMessage(c, args.message);
      if (m.versions.some((v) => v.image)) throw new CommandError(400, "not_supported", `${m.id} has images; deleting those arrives with image brains (T05).`);
      c.messages.splice(c.messages.indexOf(m), 1);
    });
    return { conversationId: conv.id, deleted: args.message, messageCount: conv.messages.length };
  },
  format: (r: { deleted: string; messageCount: number }) => `Deleted ${r.deleted}. ${r.messageCount} message${r.messageCount === 1 ? "" : "s"} left.`,
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

export default [messageGet, messageEdit, messageDelete, messageSelectVersion];
