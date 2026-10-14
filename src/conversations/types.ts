/**
 * The conversation document: one JSON file per conversation (docs/design.md, "Conversation document").
 * Everything a model ever sees comes from fields in here, and every one of them is user-editable.
 * Later tickets fill in what T02 only stores: setup messages and more brains (T04), steer and versions (T03),
 * image brains and images (T05). The prompt builder (prompt.ts) already handles all of them.
 */

/**
 * 2 (T07 triage): every brain has `stop`. 3 (T09): templates.roll. 4 (T13): every setup message has a `role`.
 * loadConversation upgrades older files (upgradeConversation, defaults.ts), in memory; the next write saves them.
 */
export const SCHEMA_VERSION = 4;

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

/**
 * Used by T05. Only the fields the chosen image model supports are sent. The picture's shape is each image
 * brain's own (Brain.shape), so a portraitist and a scene painter can share a conversation.
 */
export type ImageSettings = {
  /** For models with a resolution list (1K, 2K, 4K): one they list. Absent: the model's default. */
  resolution?: string;
  format: "webp" | "png" | "jpeg";
  hideWatermark: boolean;
  negativePrompt?: string;
};

/**
 * Framing strings. Placeholders are literal, single-pass replacements: {{content}} {{brain}} {{prompt}} {{instruction}}
 * {{roll}}. Four are applied each time a request is built; `roll` (T09) once, when the server rolls: the roll's
 * message holds the line it makes, so every brain reads that line framed as a player message.
 */
export type Templates = {
  player: string;
  otherBrainText: string;
  otherBrainImage: string;
  steer: string;
  /** T09: a roll's message, with {{roll}} for the number. Default ROLL_TEMPLATE: "🎲 I rolled a d20: **{{roll}}**". */
  roll: string;
};

/**
 * T13: the role a setup message is sent with. `user` (the default, and all there was before T13); `assistant`,
 * which every brain reads as its own words (a staged exchange); or `system`, a second system message where it
 * stands in the order. Never merged into the brain's system prompt: a separator would be text nobody wrote.
 */
export const SETUP_ROLES = ["user", "assistant", "system"] as const;
export type SetupRole = (typeof SETUP_ROLES)[number];

export type SetupMessage = { id: string; label: string; role: SetupRole; content: string };

export type Brain = {
  id: string; // b_...
  name: string;
  color: string;
  kind: "text" | "image";
  /** Disabled → reasoning_effort "none" (or disable_thinking on models without effort levels). */
  reasoning: { enabled: boolean; effort: string };
  /** Image brains only → Venice safe_mode. */
  safeMode?: boolean;
  /**
   * Image brains only: the picture's shape (default landscape). Sent as a width × height or the nearest aspect
   * ratio the image model offers (buildImageRequest).
   */
  shape?: ImageShape;
  /** Never empty (design.md hard rule 1). */
  systemPrompt: string;
  finalReminder: { enabled: boolean; content: string };
  /**
   * Stop sequences (T07 triage), sent as the request's `stop` when not empty: Venice ends the reply just before
   * any of them. Text brains start with ["<!-- from:"] (FRAMING_STOP), so a brain can't continue the framing
   * pattern and write lines for another speaker. A request setting, not text the model reads; at most 4.
   */
  stop: string[];
  /** Image brains only. All of this text reaches the model. */
  tool?: BrainTool;
};

export type ImageShape = "portrait" | "square" | "landscape";

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

/**
 * One image of an image message's version (T05). The file is images/<id>.<ext> in the user's folder (ciphertext
 * for encrypted users), written before the status says done. Pending means a job is painting it right now
 * (its own job since T05 triage, not the conversation's generation): a pending image that no running job owns
 * (the server stopped mid-image) is settled on the next read, as done if its file made it to disk, or as an
 * error to retry (settleStaleImages, images.ts).
 */
export type ImageRecord = {
  id: string; // img_...
  status: "pending" | "done" | "error";
  /** The image model it was (or is being) made with. */
  model: string;
  /** What was sent as safe_mode: the brain's toggle at the time. */
  safeMode: boolean;
  /** status error: what went wrong, in words for the user. */
  error?: string;
  /** done: the type sniffed from the bytes (image/webp, image/png, ...), whatever format was asked for. */
  mime?: string;
  /** done: Venice says it blurred the image (safe mode on, adult content). */
  blurred?: true;
  /** done: Venice says the prompt broke its content policy. */
  contentViolation?: true;
  /** The model's list price for this image, added to spentUsd once Venice has made it. */
  costUsd?: number;
  createdAt: string;
  finishedAt?: string;
  /**
   * While a new image for an edited or retried prompt is pending, or has failed: the last finished image,
   * still shown in its place. Deleted (file included) once the new one is done.
   */
  previous?: ImageRecord;
};

export type MessageVersion = {
  /** Text: Markdown. Image: the exact image prompt. */
  content: string;
  /** Image messages: this version's image. */
  image?: ImageRecord;
  /** Display only, never sent (hard rule 4). */
  steer?: string;
  /** With a steer: the index of the version the steer revised (the one that was active). Display only. */
  steeredFrom?: number;
  /**
   * T05 triage: image.retry of a finished image. This version paints the same prompt as version `repaintOf`
   * (an index) again, so both images are kept. Display only.
   */
  repaintOf?: number;
  /** Display only, never sent (hard rule 4). */
  reasoning?: string;
  /**
   * T09: this player message is a roll the server made (turn --roll, message.roll). Display only: brains read
   * `content`, the roll template's line. It is the honor system, so the content can be edited like any message
   * (`edited` then says so) while this keeps what the die said.
   */
  roll?: Roll;
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

/** T09: one die roll, made by the server's random number generator (dice.ts), never by a model. d20 only for now. */
export type Roll = { die: "d20"; result: number };

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
  /** The brain's stop sequences (T07 triage); omitted when it has none. */
  stop?: string[];
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

/**
 * The exact request that retries a reply whose stream broke: the same command with the same brain (a turn)
 * or the same message and steer (a regenerate). It rides on the stream's error event as `error.details.retry`,
 * so a client's Retry replays it instead of guessing who should answer (T04 QA-1).
 */
export type RetryRequest =
  | { command: "turn"; args: { conversation: string; brain: string } }
  | { command: "message.regenerate"; args: { conversation: string; message: string; steer?: string } }
  /** A failed image (T05): paint the active version's prompt again. Rides on image_error events as `retry`. */
  | { command: "image.retry"; args: { conversation: string; message: string } };

/**
 * The exact /image/generate body (T05), minus the auth header. buildImageRequest (src/images/request.ts) makes
 * it from the conversation's image settings, the model's constraints and the brain's safe mode and shape; the prompt is
 * the image message's content, word for word.
 */
export type ImageRequest = {
  model: string;
  prompt: string;
  safe_mode: boolean;
  format: ImageSettings["format"];
  hide_watermark: boolean;
  width?: number;
  height?: number;
  aspect_ratio?: string;
  resolution?: string;
  negative_prompt?: string;
};
