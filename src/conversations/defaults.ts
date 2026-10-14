import { DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL } from "../config.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { SCHEMA_VERSION, type Brain, type Conversation, type Templates } from "./types.ts";

/**
 * Starting values for new conversations and brains. Every string here reaches a model, so each one is
 * stored in the conversation document, shown by prompt.preview and editable by the user.
 */
export const DEFAULT_TEMPLATES: Templates = {
  player: "<!-- from: the user -->\n{{content}}",
  otherBrainText: "<!-- from: {{brain}} -->\n{{content}}",
  otherBrainImage:
    "<!-- from: {{brain}}. It called generate_image with this exact prompt, and that image is now on the player's screen: -->\n{{prompt}}",
  steer:
    "<!-- Behind-the-scenes direction from the user. This is not part of the conversation. Write your previous response again, following this direction: -->\n{{instruction}}",
};

export const DEFAULT_BRAIN_NAME = "Assistant";

/** Brain badge colors, handed out in order. */
export const BRAIN_COLORS = ["#60a5fa", "#f59e0b", "#34d399", "#f472b6", "#a78bfa", "#f87171", "#22d3ee", "#a3e635"];

export function newBrain(opts: { name: string; systemPrompt: string; color?: string; isDefault: boolean }): Brain {
  return {
    id: newId("b"),
    name: opts.name,
    color: opts.color ?? BRAIN_COLORS[0]!,
    kind: "text",
    // Off by default: with reasoning on, the provider adds a small hidden instruction (T02 QA-1). On is an opt-in.
    reasoning: { enabled: false, effort: "low" },
    systemPrompt: opts.systemPrompt,
    // T04 pre-fills an editable example for non-default brains, which have it on by default.
    finalReminder: { enabled: !opts.isDefault, content: "" },
  };
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
      image: { format: "webp", hideWatermark: false },
    },
    templates: { ...DEFAULT_TEMPLATES },
    setup: [],
    brains: [brain],
    defaultBrainId: brain.id,
    messages: [],
    spentUsd: 0,
  };
}
