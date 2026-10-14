import { DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL } from "../config.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { SCHEMA_VERSION, type Brain, type Conversation, type SetupMessage, type Templates } from "./types.ts";
import { BRAIN_COLORS, DEFAULT_SETUP_LABEL, DEFAULT_TOOL, FRAMING_STOP, REMINDER_EXAMPLE, setupPrefill } from "./wording.ts";

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
};

export const DEFAULT_BRAIN_NAME = "Assistant";

// The pre-fills (reminder, tool text, setup) are in wording.ts, which has no dependencies, so the web imports them too.
// So is the badge palette, which the browser's color picker offers.
export { BRAIN_COLORS, DEFAULT_SETUP_LABEL, DEFAULT_TOOL, FRAMING_STOP, REMINDER_EXAMPLE, setupPrefill };

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
  };
  if (brain.kind === "image") makeImageBrain(brain);
  return brain;
}

/**
 * Bring a file written by an older version up to SCHEMA_VERSION, in memory (the next write saves it). Version 2
 * (T07 triage): a brain without `stop` gets defaultStop, so a text brain in a campaign made before stop
 * sequences existed is guarded too; prompt.preview and brain.list show it, and brain.update --stop changes it.
 * A brain whose list is empty keeps it empty. Version 3 (T09): templates without `roll` get the default, so
 * every conversation can roll. Tolerates a partial document (listConversations reports those).
 */
export function upgradeConversation(conv: Conversation): Conversation {
  if (typeof conv !== "object" || conv === null) return conv;
  for (const b of Array.isArray(conv.brains) ? conv.brains : []) {
    if (b && !Array.isArray(b.stop)) b.stop = defaultStop(b.kind === "image" ? "image" : "text");
  }
  if (conv.templates && typeof conv.templates === "object" && typeof conv.templates.roll !== "string") conv.templates.roll = DEFAULT_TEMPLATES.roll;
  if (!(conv.schemaVersion >= SCHEMA_VERSION)) conv.schemaVersion = SCHEMA_VERSION;
  return conv;
}

/** What a brain needs to be an image brain: tool text and safe mode (on by default). Existing values are kept. */
export function makeImageBrain(brain: Brain): void {
  brain.kind = "image";
  brain.safeMode ??= true;
  brain.tool ??= { ...DEFAULT_TOOL };
}

/** A new setup message, pre-filled with an HTML comment that names it: "<!-- This is the World Bible. -->". */
export function newSetup(opts: { label?: string; content?: string }): SetupMessage {
  const label = opts.label ?? DEFAULT_SETUP_LABEL;
  return { id: newId("s"), label, content: opts.content ?? setupPrefill(label) };
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
