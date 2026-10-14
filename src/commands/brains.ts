import { z } from "zod";
import { makeImageBrain, newBrain, nextColor } from "../conversations/defaults.ts";
import { REASONING_NOTE, resolveBrain } from "../conversations/prompt.ts";
import { assertBrainIdle, loadConversation, mutateConversation } from "../conversations/store.ts";
import type { Brain, Conversation, ImageShape } from "../conversations/types.ts";
import { FRAMING_STOP, MAX_STOPS, STOP_REASONING_NOTE } from "../conversations/wording.ts";
import { DEFAULT_SHAPE, IMAGE_SHAPES } from "../images/request.ts";
import { badRequest, CommandError, conflict } from "../lib/errors.ts";
import { command } from "../registry.ts";
import { conversationId, systemPrompt } from "./conversations.ts";

/**
 * Brains (docs/design.md, "Turns, regeneration and edits"): named personas sharing one ledger. Add or edit
 * them at any time, mid-campaign included; every request is built fresh from the document, so the next one
 * uses the change. A brain that has spoken can't be deleted, and its kind is locked.
 */

/** A blank ref is a mistake, not "the default brain": only an omitted --brain means that (T04 QA-2). */
const ref = (blank: string) => z.string().refine((s) => s.trim() !== "", blank);
export const brainRef = ref("A blank brain names no one: give a brain's name or id, or leave it out for the default brain").describe(
  "Brain name or id (default: the conversation's default brain)",
);
const brainTarget = ref("A blank brain names no one: give a brain's name or id").describe("Brain name (case-insensitive) or id (b_...)");

/** Venice's documented reasoning effort levels. Each model supports a subset (./ss models.list --type text). */
export const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** The word message.add --as uses for you, so no brain can be called that. */
export const PLAYER = "player";
/** message.add --as: you, or a brain. */
export const authorRef = ref(`Say who wrote it: "${PLAYER}" (you), or a brain's name or id`);

/** One line of visible text: it is framed into every other brain's prompt and listed in every view (T04 QA-3). */
export const brainName = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((s) => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(s), "A brain name is one line, with no line breaks, tabs or control characters")
  .refine((s) => /[\p{L}\p{N}\p{P}\p{S}]/u.test(s), "A brain name needs at least one visible character");
export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colors look like #60a5fa").describe("Badge color, #rrggbb");
export const kind = z.enum(["text", "image"]);
export const reasoning = z
  .object({
    enabled: z.boolean().describe("Reasoning on or off (default off). On: the provider adds a small hidden instruction we can't see or edit"),
    effort: z.enum(EFFORTS).describe("Effort level when on, if the model supports levels"),
  })
  .partial();
export const finalReminder = z
  .object({
    enabled: z.boolean().describe("Send the reminder as the last message"),
    content: z.string().describe("The reminder text, sent verbatim"),
  })
  .partial();
const text = (what: string) => z.string().refine((s) => s.trim() !== "", `The ${what} can't be blank`);
export const tool = z
  .object({
    name: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, "A tool name is 1-64 letters, digits, _ or -")
      .describe("The function the model calls (default generate_image)"),
    description: text("tool description").describe("What the tool does, as the model reads it"),
    promptParamDescription: text("prompt description").describe("How the model should write the prompt argument"),
    resultContent: text("tool result").describe("The tool result the brain sees after each of its own images"),
  })
  .partial();
/** Stop sequences (T07 triage): a request setting, sent as `stop`. Whitespace counts, so they aren't trimmed. */
export const stop = z
  .array(z.string().max(200).refine((s) => s.trim() !== "", "A stop sequence can't be blank"))
  .max(MAX_STOPS, `At most ${MAX_STOPS} stop sequences (Venice's limit)`)
  .describe(
    `Stop sequences: Venice ends the reply just before any of them (at most ${MAX_STOPS}). Text brains start with "${FRAMING_STOP}", so a brain can't write a framing line for someone else. Repeat the flag for several; --stop '[]' clears them`,
  );
export const safeMode = z.boolean().describe("Image brains: Venice safe_mode, which blurs adult content (default on)");
export const shape = z
  .enum(IMAGE_SHAPES as [ImageShape, ...ImageShape[]])
  .describe("Image brains: the picture's shape, portrait, square or landscape (default landscape). Sent as a width × height, or the nearest aspect ratio the image model offers");

/**
 * A new or changed name must be unique (case-insensitive), not look like an id, and not be "player". `hint` ends the
 * clash's message with the way out (brain.import: "Add it under another name with --name").
 */
export function checkName(conv: Conversation, value: string, self?: Brain, hint = ""): void {
  if (/^b_[a-z0-9]+$/.test(value)) throw badRequest("A brain name can't look like a brain id (b_...).");
  if (value.toLowerCase() === PLAYER) throw badRequest(`"${value}" is reserved: message.add --as player means you.${hint}`);
  const clash = conv.brains.find((b) => b !== self && b.name.toLowerCase() === value.toLowerCase());
  if (clash) throw conflict(`Another brain is already called "${clash.name}".${hint}`);
}

const messagesBy = (conv: Conversation, brain: Brain) => conv.messages.filter((m) => m.author.type === "brain" && m.author.brainId === brain.id).length;

/** Safe mode, shape and tool text only mean something for an image brain. */
function imageOnly(brain: Brain, args: { safeMode?: boolean; shape?: ImageShape; tool?: object }): void {
  if (brain.kind === "image") return;
  if (args.safeMode !== undefined || args.shape !== undefined || (args.tool && Object.keys(args.tool).length)) {
    throw badRequest(`Safe mode, shape and tool text are for image brains, and ${brain.name} is a text brain. Pass --kind image too.`);
  }
}

function applyImageFields(brain: Brain, args: { safeMode?: boolean; shape?: ImageShape; tool?: z.output<typeof tool> }): void {
  imageOnly(brain, args);
  if (args.safeMode !== undefined) brain.safeMode = args.safeMode;
  if (args.shape !== undefined) brain.shape = args.shape;
  if (args.tool) Object.assign(brain.tool!, args.tool);
}

/** What a brain with reasoning on should know: the provider's hidden text, and that stop sequences cut reasoning too. */
export const reasoningNotes = (b: Brain) => (b.reasoning.enabled ? `\n${REASONING_NOTE}${b.stop.length ? `\n${STOP_REASONING_NOTE}` : ""}` : "");

/** The CLI's one-line summary of a brain. */
export function brainLine(b: Brain, conv?: Pick<Conversation, "defaultBrainId">): string {
  const bits = [`${b.name} (${b.id})`, b.kind];
  if (conv?.defaultBrainId === b.id) bits.push("default");
  bits.push(`reasoning ${b.reasoning.enabled ? b.reasoning.effort : "off"}`, `final reminder ${b.finalReminder.enabled && b.finalReminder.content.trim() ? "on" : "off"}`);
  bits.push(b.stop.length ? `stops at ${b.stop.map((x) => JSON.stringify(x)).join(", ")}` : "no stop sequences");
  if (b.kind === "image") bits.push(`safe mode ${b.safeMode === false ? "off" : "on"}`, b.shape ?? DEFAULT_SHAPE);
  return bits.join(" · ");
}

export type BrainListing = { conversationId: string; defaultBrainId: string; brains: Array<Brain & { messageCount: number }> };

export const brainList = command({
  name: "brain.list",
  description: `Show every brain in a conversation, with its system prompt, final reminder and tool text in full.
These are sent to the models word for word; prompt.preview --brain <name> shows a brain's whole request.
Each brain's stop sequences are listed too: Venice ends its reply just before any of them.`,
  args: z.object({ conversation: conversationId }),
  examples: ["./ss brain.list --conversation c_k3j9x0q2ma"],
  handler: async (args, ctx): Promise<BrainListing> => {
    const conv = await loadConversation(ctx.requireSession().vault, args.conversation);
    return { conversationId: conv.id, defaultBrainId: conv.defaultBrainId, brains: conv.brains.map((b) => ({ ...b, messageCount: messagesBy(conv, b) })) };
  },
  format: (r: BrainListing) =>
    r.brains
      .map((b) => {
        const out = [`── ${brainLine(b, r)} · ${b.color} · ${b.messageCount} message${b.messageCount === 1 ? "" : "s"} ──`, "System prompt:", b.systemPrompt];
        const sent = b.finalReminder.enabled && b.finalReminder.content.trim();
        out.push(`Final reminder (${sent ? "on: sent last" : b.finalReminder.enabled ? "on, but blank: not sent" : "off: not sent"}):`, b.finalReminder.content || "(empty)");
        out.push(`Stop sequences (Venice ends the reply just before any of them): ${b.stop.length ? b.stop.map((x) => JSON.stringify(x)).join(", ") : "none"}`);
        if (b.kind === "image" && b.tool) {
          out.push(`Tool ${b.tool.name}:`, `  description: ${b.tool.description}`, `  prompt: ${b.tool.promptParamDescription}`, `  result: ${b.tool.resultContent}`);
        }
        return out.join("\n");
      })
      .join("\n\n"),
});

export const brainAdd = command({
  name: "brain.add",
  description: `Add a brain to a conversation: a named persona with its own system prompt, sharing the ledger.
Works mid-conversation: from its first request it sees everything said so far (its own replies as assistant,
everyone else's framed with the templates). Talk to it with turn --brain <name>.
Its final reminder is on and pre-filled with an editable example, sent as the last message of its requests;
change it with --final-reminder.content, or turn it off with --no-final-reminder.enabled.
An image brain (--kind image) answers with a forced generate_image call: its reply is an image prompt, which is
painted with the conversation's image model. It gets editable tool text, safe mode on (Venice blurs adult content)
and a shape (--shape portrait, square or landscape; landscape by default).
A text brain stops before "${FRAMING_STOP}" (--stop), so it can't write a framing line for another speaker.`,
  args: z.object({
    conversation: conversationId,
    name: brainName.describe("The brain's name, unique in the conversation (other brains see it in the framing)"),
    systemPrompt,
    color: color.optional(),
    kind: kind.optional().describe("text (default) or image. Locked once the brain has messages"),
    reasoning: reasoning.optional(),
    finalReminder: finalReminder.optional(),
    safeMode: safeMode.optional(),
    shape: shape.optional(),
    tool: tool.optional(),
    stop: stop.optional(),
  }),
  examples: [
    './ss brain.add --conversation c_k3j9x0q2ma --name "Dice Master" --system-prompt @dice.md',
    './ss brain.add --conversation c_k3j9x0q2ma --name "Dice Master" --system-prompt "You roll dice." --final-reminder.content "<!-- System reminder --> Only roll."',
    './ss brain.add --conversation c_k3j9x0q2ma --name "Scene Painter" --kind image --system-prompt "You paint the scene."',
    './ss brain.add --conversation c_k3j9x0q2ma --name "Portraitist" --kind image --shape portrait --system-prompt @portraits.md',
  ],
  handler: async (args, ctx): Promise<Brain> => {
    const { vault } = ctx.requireSession();
    const { result } = await mutateConversation(vault, args.conversation, (c) => {
      checkName(c, args.name);
      const brain = newBrain({ name: args.name, systemPrompt: args.systemPrompt, color: args.color ?? nextColor(c), isDefault: false, kind: args.kind });
      applyImageFields(brain, args);
      Object.assign(brain.reasoning, args.reasoning ?? {});
      Object.assign(brain.finalReminder, args.finalReminder ?? {});
      if (args.stop) brain.stop = args.stop;
      c.brains.push(brain);
      return brain;
    });
    return result;
  },
  format: (b: Brain) => `Added brain ${brainLine(b)}\nTalk to it with turn --brain "${b.name}"; prompt.preview --brain "${b.name}" shows what it sees.${reasoningNotes(b)}`,
});

export const brainUpdate = command({
  name: "brain.update",
  description: `Edit a brain: name, color, system prompt, reasoning, final reminder, kind, safe mode, shape, tool text, stop sequences.
Only the fields you pass change, and any time is fine, mid-conversation included: the next request uses them
(prompt.preview shows it). The system prompt can't be empty. Kind is locked once the brain has messages.
Reasoning is off by default. Turning it on is an opt-in: the provider then adds a small hidden instruction.`,
  args: z.object({
    conversation: conversationId,
    brain: brainRef.optional(),
    name: brainName.optional().describe("New name (unique in the conversation)"),
    color: color.optional(),
    systemPrompt: systemPrompt.optional(),
    reasoning: reasoning.optional(),
    finalReminder: finalReminder.optional(),
    kind: kind.optional().describe("text or image. Only while the brain has no messages"),
    safeMode: safeMode.optional(),
    shape: shape.optional(),
    tool: tool.optional(),
    stop: stop.optional(),
  }),
  examples: [
    './ss brain.update --conversation c_k3j9x0q2ma --system-prompt "You are a terse pirate."',
    "./ss brain.update --conversation c_k3j9x0q2ma --system-prompt @prompt.md --reasoning.effort high",
    './ss brain.update --conversation c_k3j9x0q2ma --brain "Dice Master" --final-reminder.content @reminder.md',
    "./ss brain.update --conversation c_k3j9x0q2ma --no-reasoning.enabled",
    `./ss brain.update --conversation c_k3j9x0q2ma --brain "Game Master" --stop "${FRAMING_STOP}" --stop "<!-- System"`,
    "./ss brain.update --conversation c_k3j9x0q2ma --stop '[]'   # no stop sequences",
    './ss brain.update --conversation c_k3j9x0q2ma --brain "Character Portraitist" --shape portrait',
  ],
  handler: async (args, ctx): Promise<Brain> => {
    const { vault } = ctx.requireSession();
    const fields = ["name", "color", "systemPrompt", "reasoning", "finalReminder", "kind", "safeMode", "shape", "tool", "stop"] as const;
    if (!fields.some((f) => args[f] !== undefined)) {
      throw badRequest("Nothing to change. Pass --name, --color, --system-prompt, --reasoning.<field>, --final-reminder.<field>, --kind, --safe-mode, --shape, --tool.<field> or --stop.");
    }
    const { result } = await mutateConversation(vault, args.conversation, (c) => {
      const brain = resolveBrain(c, args.brain);
      if (args.name !== undefined) checkName(c, args.name, brain);
      if (args.kind !== undefined && args.kind !== brain.kind) {
        const n = messagesBy(c, brain);
        if (n) {
          throw new CommandError(
            409,
            "kind_locked",
            `${brain.name} has ${n} message${n === 1 ? "" : "s"}, so it stays a ${brain.kind} brain. Add a new ${args.kind} brain instead.`,
          );
        }
        assertBrainIdle(vault, c.id, brain, "change the kind of");
        if (args.kind === "image") makeImageBrain(brain);
        else brain.kind = "text"; // its tool text and safe mode are kept, unused, in case it goes back
      }
      applyImageFields(brain, args);
      if (args.name !== undefined) brain.name = args.name;
      if (args.color !== undefined) brain.color = args.color;
      if (args.systemPrompt !== undefined) brain.systemPrompt = args.systemPrompt;
      Object.assign(brain.reasoning, args.reasoning ?? {});
      Object.assign(brain.finalReminder, args.finalReminder ?? {});
      if (args.stop) brain.stop = args.stop;
      return brain;
    });
    return result;
  },
  format: (b: Brain) => `Updated brain ${brainLine(b)} · system prompt ${b.systemPrompt.length} chars${reasoningNotes(b)}`,
});

export const brainDelete = command({
  name: "brain.delete",
  description: `Delete a brain that has never spoken.
A brain with messages in the ledger can't be deleted: every other brain still sees those lines under its name. Rename it or change its system prompt instead (brain.update).
The default brain can't be deleted either: make another one the default first (brain.set-default). Refused
while the brain is writing a reply.`,
  args: z.object({ conversation: conversationId, brain: brainTarget }),
  examples: ['./ss brain.delete --conversation c_k3j9x0q2ma --brain "Joke Teller"'],
  handler: async (args, ctx) => {
    const { vault } = ctx.requireSession();
    const { conv, result } = await mutateConversation(vault, args.conversation, (c) => {
      const brain = resolveBrain(c, args.brain);
      if (brain.id === c.defaultBrainId) {
        throw new CommandError(409, "default_brain", `${brain.name} is the default brain. Make another brain the default first (brain.set-default), then delete it.`);
      }
      const n = messagesBy(c, brain);
      if (n) {
        throw new CommandError(
          409,
          "brain_in_use",
          `${brain.name} has ${n} message${n === 1 ? "" : "s"} in this conversation, so it can't be deleted: the other brains still see ${n === 1 ? "it" : "them"} under its name. Rename it or change its system prompt instead.`,
        );
      }
      assertBrainIdle(vault, c.id, brain, "delete"); // in the queue, after the lock-holder's read (T03 QA-1)
      c.brains.splice(c.brains.indexOf(brain), 1);
      return brain;
    });
    return { conversationId: conv.id, deleted: result.id, name: result.name, brains: conv.brains.map((b) => b.name) };
  },
  format: (r: { deleted: string; name: string; brains: string[] }) => `Deleted brain ${r.name} (${r.deleted}). Brains left: ${r.brains.join(", ")}.`,
});

export const brainSetDefault = command({
  name: "brain.set-default",
  description: `Make a brain the default: the one turn talks to without --brain (and the browser's big Send button).
Nothing else changes: each brain keeps its own final reminder setting.`,
  args: z.object({ conversation: conversationId, brain: brainTarget }),
  examples: ['./ss brain.set-default --conversation c_k3j9x0q2ma --brain "Game Master"'],
  handler: async (args, ctx): Promise<Brain> => {
    const { vault } = ctx.requireSession();
    const { result } = await mutateConversation(vault, args.conversation, (c) => {
      const brain = resolveBrain(c, args.brain);
      c.defaultBrainId = brain.id;
      return brain;
    });
    return result;
  },
  format: (b: Brain) => `${b.name} (${b.id}) is now the default brain.`,
});

export default [brainList, brainAdd, brainUpdate, brainDelete, brainSetDefault];
