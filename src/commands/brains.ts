import { z } from "zod";
import { DEFAULT_PIN_AS, defaultStop, makeImageBrain, newBrain, nextColor, REMINDER_EXAMPLE } from "../conversations/defaults.ts";
import { freeNumber, makeBrain, madeName, nextMadeName } from "../conversations/makers.ts";
import { REASONING_NOTE, resolveBrain } from "../conversations/prompt.ts";
import { assertBrainIdle, loadConversation, mutateConversation } from "../conversations/store.ts";
import { PIN_ROLES, type Brain, type BrainBlueprint, type Conversation, type ImageShape, type PinRole } from "../conversations/types.ts";
import { FRAMING_STOP, MAKES_NUMBER, MAX_STOPS, PIN_AS_WORDS, STOP_REASONING_NOTE } from "../conversations/wording.ts";
import { DEFAULT_SHAPE, IMAGE_SHAPES } from "../images/request.ts";
import { badRequest, CommandError, conflict, notFound } from "../lib/errors.ts";
import { command } from "../registry.ts";
import { conversationId, messageId, systemPrompt } from "./conversations.ts";

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

/** T16: how a pinned message is sent to the brain it is pinned to. */
export const pinAs = z
  .enum(PIN_ROLES)
  .describe(
    `How the pinned message is sent, right after the setup messages: ${PIN_ROLES.map((r) => `${r} (${PIN_AS_WORDS[r]})`).join(", ")}. Default ${DEFAULT_PIN_AS}`,
  );

/** T16: a maker's name pattern: one line, with {{n}} where the number goes. */
const makesName = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .refine((s) => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(s), "A name pattern is one line, with no line breaks, tabs or control characters")
  .refine((s) => s.includes(MAKES_NUMBER), `The name pattern needs ${MAKES_NUMBER} where the number goes ("Character ${MAKES_NUMBER}"), or every brain it made would have the same name`)
  .refine((s) => /[\p{L}\p{N}\p{P}\p{S}]/u.test(s.replaceAll(MAKES_NUMBER, "")) || s.replaceAll(MAKES_NUMBER, "").trim() === "", "A name pattern is visible text")
  // T16 QA-3: the names it makes must be names a brain can have. Only digits change from one to the next, so the first tells.
  .refine((s) => !/^b_[a-z0-9]+$/.test(madeName(s, 1)), "The names this pattern makes would look like brain ids (b_...), which a brain name can't")
  .describe(`The new brain's name, with ${MAKES_NUMBER} where its number goes: "Character ${MAKES_NUMBER}"`);

/** T16: the brain a maker makes: everything brain.add takes but its name (the pattern) and color (the next free one). */
export const blueprint = z
  .object({
    kind: kind.describe("text (default) or image"),
    systemPrompt: z.string().refine((s) => s.trim() !== "", "The blueprint's system prompt can't be empty (design.md hard rule 1)").describe("The new brain's system prompt, verbatim"),
    reasoning,
    finalReminder,
    stop,
    safeMode,
    shape,
    tool,
  })
  .partial()
  .describe("The new brain: everything brain.add takes but its name and color");

/** T16: "Each new message makes a new brain". null removes the setting. */
export const makes = z
  .object({
    enabled: z.boolean().describe("On: every new message of this brain makes a brain. Off: the setting is kept (brain.make still uses it)"),
    name: makesName,
    next: z.number().int().min(1).max(1_000_000).describe("The number the next brain gets (it counts up; default 1)"),
    pinAs,
    blueprint,
  })
  .partial()
  .nullable()
  .describe(
    `Each new message makes a new brain (T16): a generated reply (a stopped one too) or one written with message.add --as makes a brain from the blueprint, named from the pattern, with that message pinned to it. A new version makes none. null removes the setting`,
  );

/**
 * Set or change a brain's maker setting (brain.add, brain.update). A new setting needs a name pattern and the
 * blueprint's system prompt; the rest starts as a new brain would (reminder on with the example, reasoning off, the
 * kind's stop sequences), enabled, numbered from 1. A change merges, as brain.update does for a brain.
 */
export function applyMakes(brain: Brain, args: z.output<typeof makes> | undefined): void {
  if (args === undefined) return;
  if (args === null) {
    delete brain.makes;
    return;
  }
  const bp = args.blueprint ?? {};
  let m = brain.makes;
  if (!m) {
    if (args.name === undefined || bp.systemPrompt === undefined) {
      throw badRequest(`${brain.name} doesn't make brains yet. To start, give the new brains' name pattern and system prompt: --makes.name "Character ${MAKES_NUMBER}" --makes.blueprint.system-prompt @prompt.md (or --makes @makes.json).`);
    }
    const kindNow = bp.kind ?? "text";
    m = {
      enabled: true,
      name: args.name,
      next: 1,
      pinAs: DEFAULT_PIN_AS,
      blueprint: { kind: kindNow, systemPrompt: bp.systemPrompt, reasoning: { enabled: false, effort: "low" }, finalReminder: { enabled: true, content: REMINDER_EXAMPLE }, stop: defaultStop(kindNow) },
    };
  }
  const b: BrainBlueprint = m.blueprint;
  if (bp.kind !== undefined && bp.kind !== b.kind) {
    b.kind = bp.kind;
    if (bp.stop === undefined) b.stop = defaultStop(bp.kind); // a new kind starts with its own stop sequences
  }
  // An image blueprint has what a new image brain has (tool text, safe mode, shape), filling only what is missing.
  // T16 QA-2: one made as image from the start had no tool text, so brain.list couldn't show the words its brains
  // would get, and --makes.blueprint.tool.* was a 500.
  if (b.kind === "image") fillImageBlueprint(b);
  if (b.kind !== "image" && (bp.safeMode !== undefined || bp.shape !== undefined || (bp.tool && Object.keys(bp.tool).length))) {
    throw badRequest(`Safe mode, shape and tool text are for image brains, and ${brain.name} makes text brains. Pass --makes.blueprint.kind image too.`);
  }
  if (bp.systemPrompt !== undefined) b.systemPrompt = bp.systemPrompt;
  Object.assign(b.reasoning, bp.reasoning ?? {});
  Object.assign(b.finalReminder, bp.finalReminder ?? {});
  if (bp.stop) b.stop = bp.stop;
  if (bp.safeMode !== undefined) b.safeMode = bp.safeMode;
  if (bp.shape !== undefined) b.shape = bp.shape;
  if (bp.tool) Object.assign(b.tool!, bp.tool);
  if (args.enabled !== undefined) m.enabled = args.enabled;
  if (args.name !== undefined) m.name = args.name;
  if (args.next !== undefined) m.next = args.next;
  if (args.pinAs !== undefined) m.pinAs = args.pinAs;
  if (madeName(m.name, m.next).length > 60) throw badRequest(`"${madeName(m.name, m.next)}" is too long for a brain name (60 characters): shorten the pattern.`);
  brain.makes = m;
}

/** An image blueprint's tool text, safe mode and shape, as makeImageBrain gives a brain (it keeps what is set). */
function fillImageBlueprint(b: BrainBlueprint): void {
  const probe = { ...b, id: "", name: "", color: "", pins: [] } as Brain;
  makeImageBrain(probe);
  b.safeMode = probe.safeMode;
  b.shape = probe.shape;
  b.tool = probe.tool;
}

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

export const messagesBy = (conv: Conversation, brain: Brain) => conv.messages.filter((m) => m.author.type === "brain" && m.author.brainId === brain.id).length;

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
  if (b.pins?.length) bits.push(`${b.pins.length} pinned`);
  if (b.makes) bits.push(`makes "${b.makes.name}"${b.makes.enabled ? "" : " (off)"}`);
  return bits.join(" · ");
}

/** The next made brain's name for a listing; a pattern with no free name (only a hand-edited file has one) says so. */
function nextFree(conv: Pick<Conversation, "brains">, m: NonNullable<Brain["makes"]>): string {
  try {
    return nextMadeName(conv, m).name;
  } catch {
    return "none (no name this pattern makes is free: change it with --makes.name)";
  }
}

/** T16: brain.list's lines for a brain's pins and its maker setting, every word of the blueprint included. */
function pinAndMakerLines(b: Brain, conv: { messages: Array<{ id: string; author: Conversation["messages"][number]["author"] }>; brains: Brain[] }): string[] {
  const out: string[] = [];
  if (b.madeFrom) out.push(`Made from ${b.madeFrom}.`);
  if (b.pins.length) {
    out.push("Pinned (sent right after the setup messages, not at their place):");
    for (const p of b.pins) {
      const m = conv.messages.find((x) => x.id === p.messageId);
      const by = !m ? "missing" : m.author.type === "player" ? "yours" : `${conv.brains.find((x) => x.id === (m.author as { brainId: string }).brainId)?.name ?? "?"}'s`;
      out.push(`  ${p.messageId} (${by}), ${PIN_AS_WORDS[p.as]}`);
    }
  }
  const m = b.makes;
  if (m) {
    const bp = m.blueprint;
    out.push(
      `Makes a brain from each new message (${m.enabled ? "on" : "off: brain.make still uses it"}): named "${m.name}", next ${nextFree(conv, m)}, the message pinned ${PIN_AS_WORDS[m.pinAs]}.`,
      `  Each one: ${bp.kind} · reasoning ${bp.reasoning.enabled ? bp.reasoning.effort : "off"} · final reminder ${bp.finalReminder.enabled && bp.finalReminder.content.trim() ? "on" : "off"} · ${bp.stop.length ? `stops at ${bp.stop.map((x) => JSON.stringify(x)).join(", ")}` : "no stop sequences"}${bp.kind === "image" ? ` · safe mode ${bp.safeMode === false ? "off" : "on"} · ${bp.shape ?? DEFAULT_SHAPE}` : ""}`,
      "  Its system prompt:",
      bp.systemPrompt,
      "  Its final reminder:",
      bp.finalReminder.content || "(empty)",
    );
    if (bp.kind === "image" && bp.tool) out.push(`  Its tool ${bp.tool.name}:`, `    description: ${bp.tool.description}`, `    prompt: ${bp.tool.promptParamDescription}`, `    result: ${bp.tool.resultContent}`);
  }
  return out;
}

/** `messages` (T16): who wrote each message a brain has pinned, so the listing can say whose it is. */
export type BrainListing = {
  conversationId: string;
  defaultBrainId: string;
  brains: Array<Brain & { messageCount: number }>;
  messages: Array<{ id: string; author: Conversation["messages"][number]["author"] }>;
};

export const brainList = command({
  name: "brain.list",
  description: `Show every brain in a conversation, with its system prompt, final reminder and tool text in full.
These are sent to the models word for word; prompt.preview --brain <name> shows a brain's whole request.
Each brain's stop sequences are listed too: Venice ends its reply just before any of them. So are its pinned
messages (T16) and, for a brain that makes brains, its name pattern and the whole blueprint.`,
  args: z.object({ conversation: conversationId }),
  examples: ["./ss brain.list --conversation c_k3j9x0q2ma"],
  handler: async (args, ctx): Promise<BrainListing> => {
    const conv = await loadConversation(ctx.requireSession().vault, args.conversation);
    const pinned = new Set(conv.brains.flatMap((b) => b.pins.map((p) => p.messageId)));
    return {
      conversationId: conv.id,
      defaultBrainId: conv.defaultBrainId,
      brains: conv.brains.map((b) => ({ ...b, messageCount: messagesBy(conv, b) })),
      messages: conv.messages.filter((m) => pinned.has(m.id)).map((m) => ({ id: m.id, author: m.author })),
    };
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
        out.push(...pinAndMakerLines(b, r));
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
A text brain stops before "${FRAMING_STOP}" (--stop), so it can't write a framing line for another speaker.
--makes (T16) makes it a brain that makes brains: see brain.update.`,
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
    makes: makes.optional(),
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
      applyMakes(brain, args.makes);
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
Reasoning is off by default. Turning it on is an opt-in: the provider then adds a small hidden instruction.
--makes (T16): "Each new message makes a new brain". Every new message this brain gets (a reply, a stopped one too,
or one written with message.add --as) makes a brain from the blueprint (--makes.blueprint.*: everything brain.add
takes), named from the pattern (--makes.name "Character ${MAKES_NUMBER}", numbered by a counter that only counts up),
with that message pinned to it (--makes.pin-as). New versions of the message make none. --no-makes.enabled keeps the
setting and makes nothing; --makes null removes it. Starting one needs the pattern and the blueprint's system prompt.`,
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
    makes: makes.optional(),
  }),
  examples: [
    './ss brain.update --conversation c_k3j9x0q2ma --system-prompt "You are a terse pirate."',
    "./ss brain.update --conversation c_k3j9x0q2ma --system-prompt @prompt.md --reasoning.effort high",
    './ss brain.update --conversation c_k3j9x0q2ma --brain "Dice Master" --final-reminder.content @reminder.md',
    "./ss brain.update --conversation c_k3j9x0q2ma --no-reasoning.enabled",
    `./ss brain.update --conversation c_k3j9x0q2ma --brain "Game Master" --stop "${FRAMING_STOP}" --stop "<!-- System"`,
    "./ss brain.update --conversation c_k3j9x0q2ma --stop '[]'   # no stop sequences",
    './ss brain.update --conversation c_k3j9x0q2ma --brain "Character Portraitist" --shape portrait',
    `./ss brain.update --conversation c_k3j9x0q2ma --brain "Place Creator" --makes.name "Place ${MAKES_NUMBER}" --makes.blueprint.system-prompt @place.md`,
    "./ss brain.update --conversation c_k3j9x0q2ma --brain \"Character Creator\" --no-makes.enabled   # keep the setting, make nothing",
    "./ss brain.update --conversation c_k3j9x0q2ma --brain \"Character Creator\" --makes @makes.json   # the whole setting as JSON",
  ],
  handler: async (args, ctx): Promise<Brain> => {
    const { vault } = ctx.requireSession();
    const fields = ["name", "color", "systemPrompt", "reasoning", "finalReminder", "kind", "safeMode", "shape", "tool", "stop", "makes"] as const;
    if (!fields.some((f) => args[f] !== undefined)) {
      throw badRequest("Nothing to change. Pass --name, --color, --system-prompt, --reasoning.<field>, --final-reminder.<field>, --kind, --safe-mode, --shape, --tool.<field>, --stop or --makes.<field>.");
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
      applyMakes(brain, args.makes);
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
      freeNumber(c, brain); // the newest made brain gives its number back (T16 QA-8)
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

/** brain.pin, brain.unpin and brain.make answer with the brain as it is now (T16). */
export type BrainPinned = { conversationId: string; brain: Brain; messageId: string; changed: boolean };

const findMessage = (conv: Conversation, id: string) => {
  const m = conv.messages.find((x) => x.id === id);
  if (!m) throw notFound(`No message ${id} in conversation ${conv.id}.`);
  return m;
};

export const brainPin = command({
  name: "brain.pin",
  description: `Pin a ledger message to a brain (T16): in that brain's requests it is sent right after the setup messages,
and not again at its place; every other brain still sees it where it is. A live link, not a copy: edit the message,
regenerate it or pick another version, and the brain gets that from its next request. --as says how it is sent:
${PIN_ROLES.map((r) => `${r} (${PIN_AS_WORDS[r]})`).join("; ")}. Default ${DEFAULT_PIN_AS}. Pinning it again changes
only --as. Any message, yours or a brain's, any time (it changes the brain's next request, not the ledger).
prompt.preview --brain shows where it goes.`,
  args: z.object({ conversation: conversationId, brain: brainTarget, message: messageId, as: pinAs.optional() }),
  examples: [
    './ss brain.pin --conversation c_k3j9x0q2ma --brain "Character 1" --message m_7f2k9d0x1a',
    './ss brain.pin --conversation c_k3j9x0q2ma --brain "Game Master" --message m_7f2k9d0x1a --as system',
  ],
  handler: async (args, ctx): Promise<BrainPinned> => {
    const { vault } = ctx.requireSession();
    const { conv, result } = await mutateConversation(vault, args.conversation, (c) => {
      const brain = resolveBrain(c, args.brain);
      findMessage(c, args.message);
      const pin = brain.pins.find((p) => p.messageId === args.message);
      const as: PinRole = args.as ?? pin?.as ?? DEFAULT_PIN_AS;
      if (pin?.as === as) return { brain, changed: false };
      if (pin) pin.as = as;
      else brain.pins.push({ messageId: args.message, as });
      return { brain, changed: true };
    });
    return { conversationId: conv.id, brain: result.brain, messageId: args.message, changed: result.changed };
  },
  format: (r: BrainPinned) => {
    const pin = r.brain.pins.find((p) => p.messageId === r.messageId)!;
    return `${r.changed ? "Pinned" : "Already pinned:"} ${r.messageId} to ${r.brain.name} (${r.brain.id}), ${PIN_AS_WORDS[pin.as]}. ${r.brain.name} gets it right after the setup messages from its next request (prompt.preview --brain "${r.brain.name}" shows it).`;
  },
});

export const brainUnpin = command({
  name: "brain.unpin",
  description: `Unpin a message from a brain (T16): from its next request on, the brain sees it at its place in the ledger again.`,
  args: z.object({ conversation: conversationId, brain: brainTarget, message: messageId }),
  examples: ['./ss brain.unpin --conversation c_k3j9x0q2ma --brain "Character 1" --message m_7f2k9d0x1a'],
  handler: async (args, ctx): Promise<BrainPinned> => {
    const { vault } = ctx.requireSession();
    const { conv, result } = await mutateConversation(vault, args.conversation, (c) => {
      const brain = resolveBrain(c, args.brain);
      const before = brain.pins.length;
      brain.pins = brain.pins.filter((p) => p.messageId !== args.message);
      return { brain, changed: brain.pins.length !== before };
    });
    return { conversationId: conv.id, brain: result.brain, messageId: args.message, changed: result.changed };
  },
  format: (r: BrainPinned) =>
    r.changed
      ? `Unpinned ${r.messageId} from ${r.brain.name} (${r.brain.id}): it sees it at its place in the ledger again.`
      : `${r.messageId} wasn't pinned to ${r.brain.name}. Nothing changed.`,
});

export const brainMake = command({
  name: "brain.make",
  description: `Make a brain from a message by hand (T16), as its author's maker setting would have when it was new: the
author's blueprint, the next name from its pattern (or --name), the message pinned to it. For messages written
before the author made brains (a character sheet from before the setting existed), or while the setting is off.
The author must have a maker setting (brain.update --makes). A message that already made a brain that is still
here makes no second one.`,
  args: z.object({
    conversation: conversationId,
    message: messageId,
    name: brainName.optional().describe("The new brain's name (default: the next one from the author's pattern, which then counts up)"),
  }),
  examples: [
    "./ss brain.make --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a",
    './ss brain.make --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a --name "Ada Quon"',
  ],
  handler: async (args, ctx): Promise<BrainPinned> => {
    const { vault } = ctx.requireSession();
    const { conv, result } = await mutateConversation(vault, args.conversation, (c) => {
      const m = findMessage(c, args.message);
      if (m.author.type !== "brain") throw badRequest(`${m.id} is your own message. A brain is made from a message by a brain that makes brains (brain.update --makes).`);
      const authorId = m.author.brainId;
      const maker = c.brains.find((b) => b.id === authorId)!;
      if (!maker.makes) {
        throw badRequest(`${maker.name} doesn't make brains. Give it the setting first: brain.update --brain "${maker.name}" --makes.name "Character ${MAKES_NUMBER}" --makes.blueprint.system-prompt @prompt.md`);
      }
      const already = c.brains.find((b) => b.madeFrom === m.id);
      if (already) throw conflict(`${m.id} already made ${already.name} (${already.id}). To give another brain this message, pin it: brain.pin --brain <name> --message ${m.id}`);
      if (args.name !== undefined) checkName(c, args.name);
      return makeBrain(c, maker, m, args.name !== undefined ? { name: args.name } : {});
    });
    return { conversationId: conv.id, brain: result, messageId: args.message, changed: true };
  },
  format: (r: BrainPinned) =>
    `Made ${r.brain.name} (${r.brain.id}) from ${r.messageId}, which is pinned to it ${PIN_AS_WORDS[r.brain.pins[0]!.as]}.\n${brainLine(r.brain)}\nTalk to it with turn --brain "${r.brain.name}"; prompt.preview --brain "${r.brain.name}" shows what it sees.${reasoningNotes(r.brain)}`,
});

export default [brainList, brainAdd, brainUpdate, brainDelete, brainSetDefault, brainPin, brainUnpin, brainMake];
