import { z } from "zod";
import { DEFAULT_SETUP_LABEL, newSetup } from "../conversations/defaults.ts";
import { loadConversation, mutateConversation } from "../conversations/store.ts";
import { SETUP_ROLES, type Conversation, type SetupMessage } from "../conversations/types.ts";
import { badRequest, CommandError, notFound } from "../lib/errors.ts";
import { command } from "../registry.ts";
import { conversationId } from "./conversations.ts";

/**
 * Setup messages (World Bible, Module, ...): sent verbatim, in order, to every brain right after its system
 * prompt (docs/design.md, "Prompt assembly", step 2), each with its role (T13): user (the default), assistant
 * (every brain reads it as its own words) or system (a second system message). The label is for you only; the
 * content is what the models read. Blank ones are skipped when sending. They can change at any time, mid-reply
 * too: the next request uses them.
 */

const setupRef = z.string().min(1).describe("Setup message id (s_...) or its label (case-insensitive)");
const label = z.string().trim().min(1, "The label can't be empty").max(100).describe("A name for you (not sent to the models)");
const content = z.string().describe("The text every brain sees, verbatim (Markdown; @file.md or - for stdin). Blank: not sent");
const position = z.number().int().min(1).describe("Position, from 1 (sent first)");
const role = z
  .enum(SETUP_ROLES)
  .describe("The role it is sent with: user (default), assistant (every brain reads it as its own words) or system (a second system message)");

function findSetup(conv: Conversation, ref: string): SetupMessage {
  const want = ref.trim();
  const byId = conv.setup.find((s) => s.id === want);
  if (byId) return byId;
  const byLabel = conv.setup.filter((s) => s.label.toLowerCase() === want.toLowerCase());
  if (byLabel.length === 1) return byLabel[0]!;
  if (byLabel.length > 1) throw badRequest(`${byLabel.length} setup messages are labelled "${want}" (${byLabel.map((s) => s.id).join(", ")}). Use an id.`);
  const known = conv.setup.length ? ` Setup messages: ${conv.setup.map((s) => `${s.label} (${s.id})`).join(", ")}.` : " This conversation has none yet.";
  throw notFound(`No setup message "${want}" in this conversation.${known}`);
}

/** A 1-based position, checked against the number of places there are; returns the 0-based index. */
function checkPosition(pos: number, max: number): number {
  if (pos > max) throw new CommandError(400, "bad_position", `Position ${pos} is past the end: there ${max === 1 ? "is 1 place" : `are ${max} places`}.`);
  return pos - 1;
}

/** Every setup command answers with the whole list, in order, so a client can just replace its copy. */
export type SetupListing = { conversationId: string; setup: SetupMessage[]; changed?: string; deleted?: string };

const listing = (conv: Conversation, extra: Partial<SetupListing> = {}): SetupListing => ({ conversationId: conv.id, setup: conv.setup, ...extra });

function formatListing(r: SetupListing): string {
  const head = r.deleted ? `Deleted setup message ${r.deleted}.` : r.changed ? `Saved setup message ${r.changed}.` : "";
  if (!r.setup.length) return [head, "No setup messages. Add one: ./ss setup.add --conversation <id> --content @world-bible.md"].filter(Boolean).join("\n");
  const rows = r.setup.map((s, i) => {
    const sent = s.content.trim() ? `${s.role} · ${s.content.length} chars` : `${s.role} · blank: not sent`;
    return `── ${i + 1}. ${s.label} (${s.id}) · ${sent}${s.id === r.changed ? " · changed" : ""} ──\n${s.content}`;
  });
  return [head, `Every brain sees these, in this order, right after its system prompt:`, ...rows].filter(Boolean).join("\n\n");
}

export const setupList = command({
  name: "setup.list",
  description: `Show a conversation's setup messages (World Bible, ...) in the order every brain sees them, in full.`,
  args: z.object({ conversation: conversationId }),
  examples: ["./ss setup.list --conversation c_k3j9x0q2ma"],
  handler: async (args, ctx): Promise<SetupListing> => listing(await loadConversation(ctx.requireSession().vault, args.conversation)),
  format: formatListing,
});

export const setupAdd = command({
  name: "setup.add",
  description: `Add a setup message (World Bible, module, house rules) that every brain sees after its system prompt.
Setup messages are sent verbatim, in order, each as its own message with its --role: user (default), assistant (every brain reads
it as its own words, for a staged exchange) or system (a second system message, never merged into the brain's prompt). Without
--content it is pre-filled with "<!-- This is the <label>. -->", for you to edit (setup.update). The label (default
"${DEFAULT_SETUP_LABEL}") is for you only and isn't sent.`,
  args: z.object({
    conversation: conversationId,
    label: label.optional(),
    role: role.optional(),
    content: content.optional(),
    position: position.optional().describe("Where it goes, from 1 (default: last)"),
  }),
  examples: [
    "./ss setup.add --conversation c_k3j9x0q2ma --content @world-bible.md",
    './ss setup.add --conversation c_k3j9x0q2ma --label "House rules" --content "Keep replies under 150 words." --position 1',
    './ss setup.add --conversation c_k3j9x0q2ma --label "Rules, understood" --role assistant --content "Understood. I will keep to those rules."',
  ],
  handler: async (args, ctx): Promise<SetupListing> => {
    const { vault } = ctx.requireSession();
    const { conv, result } = await mutateConversation(vault, args.conversation, (c) => {
      const s = newSetup({ label: args.label, role: args.role, content: args.content });
      const at = args.position === undefined ? c.setup.length : checkPosition(args.position, c.setup.length + 1);
      c.setup.splice(at, 0, s);
      return s;
    });
    return listing(conv, { changed: result.id });
  },
  format: formatListing,
});

export const setupUpdate = command({
  name: "setup.update",
  description: `Change a setup message's text, label or role (user, assistant, system). Every brain sees the change from its next request.`,
  args: z.object({ conversation: conversationId, setup: setupRef, label: label.optional(), role: role.optional(), content: content.optional() }),
  examples: [
    './ss setup.update --conversation c_k3j9x0q2ma --setup "World Bible" --content @world-bible.md',
    './ss setup.update --conversation c_k3j9x0q2ma --setup "World Bible" --role system',
  ],
  handler: async (args, ctx): Promise<SetupListing> => {
    if (args.label === undefined && args.content === undefined && args.role === undefined) throw badRequest("Nothing to change. Pass --content, --label or --role.");
    const { vault } = ctx.requireSession();
    const { conv, result } = await mutateConversation(vault, args.conversation, (c) => {
      const s = findSetup(c, args.setup);
      if (args.label !== undefined) s.label = args.label;
      if (args.role !== undefined) s.role = args.role;
      if (args.content !== undefined) s.content = args.content;
      return s;
    });
    return listing(conv, { changed: result.id });
  },
  format: formatListing,
});

export const setupMove = command({
  name: "setup.move",
  description: `Move a setup message to another position (from 1). Every brain sees them in this order.`,
  args: z.object({ conversation: conversationId, setup: setupRef, position }),
  examples: ['./ss setup.move --conversation c_k3j9x0q2ma --setup "House rules" --position 1'],
  handler: async (args, ctx): Promise<SetupListing> => {
    const { vault } = ctx.requireSession();
    const { conv, result } = await mutateConversation(vault, args.conversation, (c) => {
      const s = findSetup(c, args.setup);
      const to = checkPosition(args.position, c.setup.length);
      c.setup.splice(c.setup.indexOf(s), 1);
      c.setup.splice(to, 0, s);
      return s;
    });
    return listing(conv, { changed: result.id });
  },
  format: formatListing,
});

export const setupDelete = command({
  name: "setup.delete",
  description: `Delete a setup message. From the next request on, no brain sees it.`,
  args: z.object({ conversation: conversationId, setup: setupRef }),
  examples: ['./ss setup.delete --conversation c_k3j9x0q2ma --setup "House rules"'],
  handler: async (args, ctx): Promise<SetupListing> => {
    const { vault } = ctx.requireSession();
    const { conv, result } = await mutateConversation(vault, args.conversation, (c) => {
      const s = findSetup(c, args.setup);
      c.setup.splice(c.setup.indexOf(s), 1);
      return s;
    });
    return listing(conv, { deleted: result.id });
  },
  format: formatListing,
});

export default [setupList, setupAdd, setupUpdate, setupMove, setupDelete];
