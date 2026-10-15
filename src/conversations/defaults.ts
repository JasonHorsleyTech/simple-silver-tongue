import { DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL } from "../config.ts";
import { DEFAULT_SHAPE } from "../images/request.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { DEFAULT_PIN_AS, SCHEMA_VERSION, SETUP_ROLES, type Brain, type Conversation, type SetupMessage, type SetupRole, type Templates } from "./types.ts";
import { BRAIN_COLORS, DEFAULT_SETUP_LABEL, DEFAULT_TOOL, FRAMING_STOP, MUSE_NAME, MUSE_REMINDER, MUSE_SYSTEM_PROMPT, REMINDER_EXAMPLE, setupPrefill } from "./wording.ts";

/**
 * Starting values for new conversations, brains and setup messages. Every string here reaches a model, so
 * each one is stored in the conversation document, shown by prompt.preview and editable by the user.
 */
export const DEFAULT_TEMPLATES: Templates = {
  player: "<!-- from: the user -->\n{{content}}",
  otherBrainText: "<!-- from: {{brain}} -->\n{{content}}",
  // T07: says only what is always true. Since T05 triage the next brain can answer while the image is still
  // being made (or after it failed), so "that image is now on the player's screen" often wasn't.
  otherBrainImage: "<!-- from: {{brain}}. It called generate_image with this exact prompt: -->\n{{prompt}}",
  steer:
    "<!-- Behind-the-scenes direction from the user. This is not part of the conversation. Write your previous response again, following this direction: -->\n{{instruction}}",
  // T09: the line a roll adds as the player's message, which every brain then reads framed like any of theirs.
  // Applied once, when the server rolls; earlier rolls keep their text.
  roll: "🎲 I rolled a d20: **{{roll}}**",
  // T17: the Muse's note for a fresh take, the caret where {{thought}} is and {{brain}} the brain it is for. A hidden
  // note, so it folds on screen; its first line says whose reply it is for, since every brain reads it. The wording
  // was probed live (T17 ticket): a helper's hidden note right before the turn, never the brain's own words.
  thought: "```hidden\nAn idea for {{brain}}'s next reply, which the player won't see:\n\n{{thought}}\n```",
};

/**
 * T15's thought template, the default until T17: the thought was the brain's own words then. Schema 7 swaps it for
 * the Muse's note (upgradeTemplates); a template someone changed is theirs and is kept.
 */
export const T15_THOUGHT_TEMPLATE = "```hidden\n{{thought}}\n\nThat sounds good, I'll respond next.\n```";

/** T17 (schema 7): the T15 thought template, untouched, becomes the Muse's note. A campaign import runs it too. */
export function upgradeTemplates(t: Partial<Templates>): void {
  if (t.thought === T15_THOUGHT_TEMPLATE) t.thought = DEFAULT_TEMPLATES.thought;
}

export const DEFAULT_BRAIN_NAME = "Assistant";

// The pre-fills (reminder, tool text, setup) are in wording.ts, which has no dependencies, so the web imports them too.
// So is the badge palette, which the browser's color picker offers.
export { BRAIN_COLORS, DEFAULT_SETUP_LABEL, DEFAULT_TOOL, FRAMING_STOP, REMINDER_EXAMPLE, setupPrefill };
/** T16: in types.ts (dependency-free), so the browser imports the same value. */
export { DEFAULT_PIN_AS };

/**
 * A new brain's stop sequences (T07 triage): a text brain stops before a framing line it would write for someone
 * else. An image brain answers with a forced tool call, so it can't write one, and starts with none.
 */
export const defaultStop = (kind: Brain["kind"]): string[] => (kind === "text" ? [FRAMING_STOP] : []);

/** The first badge color no brain uses yet; once all are taken, they repeat. */
export function nextColor(conv: Pick<Conversation, "brains">): string {
  const used = new Set(conv.brains.map((b) => b.color.toLowerCase()));
  return BRAIN_COLORS.find((c) => !used.has(c)) ?? BRAIN_COLORS[conv.brains.length % BRAIN_COLORS.length]!;
}

export function newBrain(opts: { name: string; systemPrompt: string; color?: string; isDefault: boolean; kind?: Brain["kind"] }): Brain {
  const brain: Brain = {
    id: newId("b"),
    name: opts.name,
    color: opts.color ?? BRAIN_COLORS[0]!,
    kind: opts.kind ?? "text",
    // Off by default: with reasoning on, the provider adds a small hidden instruction (T02 QA-1). On is an opt-in.
    reasoning: { enabled: false, effort: "low" },
    systemPrompt: opts.systemPrompt,
    finalReminder: { enabled: !opts.isDefault, content: REMINDER_EXAMPLE },
    stop: defaultStop(opts.kind ?? "text"),
    pins: [],
  };
  if (brain.kind === "image") makeImageBrain(brain);
  return brain;
}

/**
 * Bring a file written by an older version up to SCHEMA_VERSION, in memory (the next write saves it). Version 2
 * (T07 triage): a brain without `stop` gets defaultStop, so a text brain in a campaign made before stop
 * sequences existed is guarded too; prompt.preview and brain.list show it, and brain.update --stop changes it.
 * A brain whose list is empty keeps it empty. Version 3 (T09): templates without `roll` get the default, so
 * every conversation can roll. Since 2026-10-14 an image brain has a shape (landscape if it has none), and the
 * conversation-wide width, height and aspect ratio it replaced are dropped. Version 4 (T13): a setup message
 * without a role gets `user`, which is how it was always sent. Version 5 (T15): templates without `thought` get
 * the default, so every conversation can take a fresh take. Version 6 (T16): a brain without `pins` gets none (a
 * file from before pinned messages). Version 7 (T17): the T15 thought template, if nobody changed it, becomes the
 * Muse's note (upgradeTemplates). Tolerates a partial document (listConversations reports those).
 */
export function upgradeConversation(conv: Conversation): Conversation {
  if (typeof conv !== "object" || conv === null) return conv;
  for (const b of Array.isArray(conv.brains) ? conv.brains : []) {
    if (b && !Array.isArray(b.stop)) b.stop = defaultStop(b.kind === "image" ? "image" : "text");
    if (b?.kind === "image") b.shape ??= DEFAULT_SHAPE;
    if (b && !Array.isArray(b.pins)) b.pins = []; // version 6 (T16)
  }
  if (conv.templates && typeof conv.templates === "object") {
    if (typeof conv.templates.roll !== "string") conv.templates.roll = DEFAULT_TEMPLATES.roll;
    if (typeof conv.templates.thought !== "string") conv.templates.thought = DEFAULT_TEMPLATES.thought; // version 5 (T15)
    // Version 7 (T17), once: a file already at 7 keeps whatever template it has, T15's wording too (T17 QA-2).
    if (!(conv.schemaVersion >= 7)) upgradeTemplates(conv.templates);
  }
  // Version 4 (T13): a setup message without a role (or with one we don't know) was sent as a user message, and still is.
  for (const s of Array.isArray(conv.setup) ? conv.setup : []) if (s && !SETUP_ROLES.includes(s.role)) s.role = "user";
  // Image sizes moved from the conversation to each image brain's shape (2026-10-14): drop the old fields.
  const image = conv.settings?.image as Record<string, unknown> | undefined;
  if (image && typeof image === "object") for (const k of ["width", "height", "aspectRatio"]) delete image[k];
  if (!(conv.schemaVersion >= SCHEMA_VERSION)) conv.schemaVersion = SCHEMA_VERSION;
  return conv;
}

/**
 * T17: the Muse, as the first fresh take (or message.add --as Muse) adds it: a text brain called Muse, with the
 * pre-filled system prompt and the next free color, never the default. Its reminder is on, as any added brain's, with
 * words of its own (MUSE_REMINDER).
 */
export function newMuse(conv: Pick<Conversation, "brains">): Brain {
  const muse = newBrain({ name: MUSE_NAME, systemPrompt: MUSE_SYSTEM_PROMPT, color: nextColor(conv), isDefault: false });
  muse.finalReminder.content = MUSE_REMINDER; // T17 triage: its own, for its own turns (the note's lines, the dice)
  return muse;
}

/** What a brain needs to be an image brain: tool text, safe mode (on by default) and a shape. Existing values are kept. */
export function makeImageBrain(brain: Brain): void {
  brain.kind = "image";
  brain.safeMode ??= true;
  brain.shape ??= DEFAULT_SHAPE;
  brain.tool ??= { ...DEFAULT_TOOL };
}

/** A new setup message, pre-filled with an HTML comment that names it: "<!-- This is the World Bible. -->". */
export function newSetup(opts: { label?: string; role?: SetupRole; content?: string }): SetupMessage {
  const label = opts.label ?? DEFAULT_SETUP_LABEL;
  return { id: newId("s"), label, role: opts.role ?? "user", content: opts.content ?? setupPrefill(label) };
}

export function newConversation(opts: { title: string; systemPrompt: string; textModel?: string }): Conversation {
  const now = nowIso();
  const brain = newBrain({ name: DEFAULT_BRAIN_NAME, systemPrompt: opts.systemPrompt, isDefault: true });
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId("c"),
    title: opts.title,
    createdAt: now,
    updatedAt: now,
    settings: {
      textModel: opts.textModel ?? DEFAULT_TEXT_MODEL,
      imageModel: DEFAULT_IMAGE_MODEL,
      image: { format: "webp", hideWatermark: true }, // T07: a personal scratch pad, so no Venice watermark by default
    },
    templates: { ...DEFAULT_TEMPLATES },
    setup: [],
    brains: [brain],
    defaultBrainId: brain.id,
    messages: [],
    spentUsd: 0,
  };
}
