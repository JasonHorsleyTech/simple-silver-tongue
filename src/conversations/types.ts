/**
 * The conversation document: one JSON file per conversation (docs/design.md, "Conversation document").
 * Everything a model ever sees comes from fields in here, and every one of them is user-editable.
 * Later tickets fill in what T02 only stores: setup messages and more brains (T04), steer and versions (T03),
 * image brains and images (T05). The prompt builder (prompt.ts) already handles all of them.
 */

export const SCHEMA_VERSION = 1;

export type Conversation = {
  schemaVersion: number;
  id: string; // c_...
  title: string;
  createdAt: string;
  updatedAt: string;
  settings: Settings;
  templates: Templates;
  setup: SetupMessage[];
  brains: Brain[];
  /** Exactly one default brain, by construction: `turn` without --brain talks to it. */
  defaultBrainId: string;
  messages: LedgerMessage[];
  /**
   * Everything this conversation has cost, in USD (T03 QA-2). It only grows: each reply's cost is added when
   * it is saved, a stopped reply's when the drain hears it from Venice, and deleting a message doesn't take
   * its cost back. Absent in files from before it: totalCost() then sums the versions.
   */
  spentUsd?: number;
};

export type Settings = {
  textModel: string;
  maxTokens?: number;
  temperature?: number;
  imageModel: string;
  image: ImageSettings;
};

/** Used by T05. Only the fields the chosen image model supports are sent. */
export type ImageSettings = {
  width?: number;
  height?: number;
  aspectRatio?: string;
  resolution?: string;
  format: "webp" | "png" | "jpeg";
  hideWatermark: boolean;
  negativePrompt?: string;
};

/** Framing strings. Placeholders are literal, single-pass replacements: {{content}} {{brain}} {{prompt}} {{instruction}}. */
export type Templates = {
  player: string;
  otherBrainText: string;
  otherBrainImage: string;
  steer: string;
};

export type SetupMessage = { id: string; label: string; content: string };

export type Brain = {
  id: string; // b_...
  name: string;
  color: string;
  kind: "text" | "image";
  /** Disabled → reasoning_effort "none" (or disable_thinking on models without effort levels). */
  reasoning: { enabled: boolean; effort: string };
  /** Image brains only → Venice safe_mode. */
  safeMode?: boolean;
  /** Never empty (design.md hard rule 1). */
  systemPrompt: string;
  finalReminder: { enabled: boolean; content: string };
  /** Image brains only. All of this text reaches the model. */
  tool?: BrainTool;
};

export type BrainTool = {
  name: string;
  description: string;
  promptParamDescription: string;
  /** Content of the role:"tool" message after each of this brain's own past calls. */
  resultContent: string;
};

export type Author = { type: "player" } | { type: "brain"; brainId: string };

export type LedgerMessage = {
  id: string; // m_...
  author: Author;
  kind: "text" | "image";
  /** Player messages have exactly one. */
  versions: MessageVersion[];
  /** Index into versions: what every brain sees. */
  activeVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type MessageVersion = {
  /** Text: Markdown. Image: the exact image prompt. */
  content: string;
  image?: { id: string; status: "pending" | "done" | "error"; error?: string; model: string };
  /** Display only, never sent (hard rule 4). */
  steer?: string;
  /** With a steer: the index of the version the steer revised (the one that was active). Display only. */
  steeredFrom?: number;
  /** Display only, never sent (hard rule 4). */
  reasoning?: string;
  /** authored = typed by the user (a player message, or words put in a brain's mouth). */
  source: "generated" | "authored";
  edited?: boolean;
  /** Generated versions: the text model that wrote it. */
  model?: string;
  /** Generated versions: Venice's finish_reason ("stop", "length" = cut off by max_tokens, "tool_calls"). */
  finishReason?: string;
  /**
   * Generated versions: cut short by generation.stop. The text is what had arrived. Venice finishes and bills
   * the whole reply anyway, so usage and costUsd arrive a little later, from the drain, and are the whole reply's.
   */
  stopped?: true;
  usage?: Usage;
  /** From the final chunk's cost.usd. The conversation's total is spentUsd, not a sum of these. */
  costUsd?: number;
  createdAt: string;
};

export type Usage = { promptTokens: number; completionTokens: number; reasoningTokens?: number; cachedTokens?: number };

/** One OpenAI-style chat message, exactly as sent to Venice. */
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

/** The full /chat/completions request body. prompt.preview returns exactly this; turn sends exactly this. */
export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  stream: true;
  stream_options: { include_usage: true };
  venice_parameters: {
    include_venice_system_prompt: false;
    enable_web_search: "off";
    enable_web_scraping: false;
    disable_thinking?: true;
  };
  reasoning_effort?: string;
  max_tokens?: number;
  temperature?: number;
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: {
        type: "object";
        properties: { prompt: { type: "string"; description: string } };
        required: ["prompt"];
      };
    };
  }>;
  tool_choice?: { type: "function"; function: { name: string } };
};
