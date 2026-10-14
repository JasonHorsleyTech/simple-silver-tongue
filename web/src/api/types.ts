/**
 * The commands the web app calls, with their argument and result shapes. They mirror the server's zod
 * schemas (`./ss help <name>` shows each one). When a ticket gives the UI a new command, add a line here:
 * the client is typed from these maps, so a typo in a command name or an argument is a type error.
 *
 * The conversation document and model types are the server's own (type-only imports of dependency-free
 * files), so the UI can't drift from what is on disk. Command args are still written out here by hand.
 */
import type {
  Brain,
  BrainTool,
  ChatMessage,
  ChatRequest,
  Conversation,
  ImageRecord,
  ImageRequest,
  LedgerMessage,
  MessageVersion,
  RetryRequest,
  Roll,
  SetupMessage,
  Templates,
} from "../../../src/conversations/types.ts";
import type { ModelInfo } from "../../../src/venice/models.ts";

export type { Brain, BrainTool, ChatMessage, ChatRequest, Conversation, ImageRecord, ImageRequest, LedgerMessage, MessageVersion, ModelInfo, RetryRequest, Roll, SetupMessage, Templates };

/**
 * The server's own words and values, shown as they are: what a stop does and doesn't save (and why an image
 * isn't stopped), the reasoning warning, the badge palette new brains get their colors from, and the setup
 * message pre-fill's default label.
 */
export {
  BRAIN_COLORS,
  DEFAULT_SETUP_LABEL,
  FRAMING_STOP,
  IMAGE_STOP_NOTE,
  MAX_STOPS,
  REASONING_NOTE,
  ROLL_PREVIEW_NOTE,
  rollLabel,
  STOP_BILL_NOTE,
  STOP_REASONING_NOTE,
  stopNote,
} from "../../../src/conversations/wording.ts";

/**
 * T08: the one rule for hidden notes (```hidden blocks), shared with the CLI so the two can't disagree about
 * what is folded: `splitHidden(text)` cuts a message into visible text and notes (render each text part as
 * Markdown and each note as a fold, so a note's words never reach the Markdown renderer, even mid-stream),
 * `hiddenSummary(block, {writing})` is the fold's words, `isAllHidden(text)` spots a reply with nothing else,
 * `isHiddenInfo(lang)` recognises a note's fence word, and `couldOpenHidden(partialLine)` says whether a streaming
 * reply's unfinished last line could still become a note's opening fence. See design.md, "Hidden notes".
 */
export {
  HIDDEN_TITLE,
  couldOpenHidden,
  hiddenSummary,
  isAllHidden,
  isHiddenInfo,
  splitHidden,
  type HiddenBlock,
  type HiddenSegment,
} from "../../../src/conversations/hidden.ts";

/**
 * T06 triage: the server ends a session after `minutes` without activity, `secondsLeft` from now if nothing uses it
 * (auth.whoami doesn't count as use). Null: sessions never time out (SS_SESSION_IDLE_MINUTES=0).
 */
export type Idle = { minutes: number; secondsLeft: number | null } | null;
export type User = { username: string; encrypted: boolean; idle: Idle };
export type Who = User | { username: null };

export type UserSummary = { username: string; encrypted: boolean; createdAt: string };
/** A user whose user.json is damaged: listed apart, so it doesn't silently vanish (T06 QA-5). */
export type UnreadableUser = { username: string; error: string };

export type Health = {
  ok: true;
  mode: "live" | "mock";
  venice: string;
  url: string;
  pid: number;
  startedAt: string;
  uptimeSec: number;
  web: "built" | "not built";
  commands: number;
  /** T06 frontend: the idle limit (SS_SESSION_IDLE_MINUTES; 0 = never), for the login screen after a reload. */
  sessionIdleMinutes: number;
};

/** A row of conversation.list (src/conversations/format.ts). */
export type ConversationSummary = {
  id: string;
  title: string;
  textModel: string;
  messageCount: number;
  costUsd: number;
  createdAt: string;
  updatedAt: string;
};

/** A conversation file the server couldn't read, with a content-free reason (T02 QA-4). */
export type UnreadableConversation = { id: string; error: string };

/** prompt.preview: the exact body turn would send, plus notes and the reason turn would refuse it. */
export type Preview = {
  conversationId: string;
  brainId: string;
  brainName: string;
  body: ChatRequest;
  notes: string[];
  refusal?: string;
  /** prompt.preview with regenerate: which message gets the new version, and the steer it is asked with. */
  regenerate?: { messageId: string; newVersion: number; steer?: string; steeredFrom?: number };
  /** Image brains (T05): the /image/generate body their prompt goes into, minus `prompt` itself, and what was left out. */
  image?: { path: "/image/generate"; params: Omit<ImageRequest, "prompt">; notes: string[] };
};

/** message.get, .edit and .select-version: the message, with every version, and who wrote it. */
export type MessageView = { conversationId: string; author: string; message: LedgerMessage };

/** message.edit and message.add: for an image message (T05), `painting` names the image being made for it now. */
export type ImageMessageView = MessageView & { painting?: { imageId: string; model: string } };

/**
 * generation.stop. `message` is what the stopped reply saved (null when no text had arrived; `error` says so).
 * `painting` (T05 triage): the conversation's images still being made, which no stop touches (IMAGE_STOP_NOTE).
 */
export type StopOutcome = {
  stopped: boolean;
  message: LedgerMessage | null;
  error?: { code: string; message: string };
  note?: string;
  painting?: Array<{ messageId: string; imageId: string }>;
};

export type ConversationUpdate = {
  id: string;
  title?: string;
  settings?: Partial<{
    textModel: string;
    maxTokens: number | null;
    temperature: number | null;
    imageModel: string;
    /** T05: how image brains' images are made. null unsets a field. A size the model can't take is a 400. */
    image: Partial<{
      width: number | null;
      height: number | null;
      aspectRatio: string | null;
      resolution: string | null;
      format: "webp" | "png" | "jpeg";
      hideWatermark: boolean;
      negativePrompt: string | null;
    }>;
  }>;
  templates?: Partial<Templates>;
};

/** The fields brain.update and brain.add take. Safe mode and tool text are refused on a text brain (400). */
export type BrainFields = {
  name?: string;
  color?: string;
  systemPrompt?: string;
  /** Locked once the brain has messages (409 kind_locked). */
  kind?: Brain["kind"];
  reasoning?: Partial<Brain["reasoning"]>;
  finalReminder?: Partial<Brain["finalReminder"]>;
  safeMode?: boolean;
  tool?: Partial<BrainTool>;
  /** T07 triage: the whole list (at most 4, none blank); [] clears it. Text brains start with ["<!-- from:"]. */
  stop?: string[];
};

export type BrainUpdate = BrainFields & { conversation: string; brain?: string };

/** Every setup command answers with the whole ordered list: replace conv.setup with it. */
export type SetupListing = { conversationId: string; setup: SetupMessage[]; changed?: string; deleted?: string };

/** examples.list (T07): a committed campaign in examples/, ready to import. `error`: the file can't be imported. */
export type ExampleInfo = {
  name: string;
  title: string;
  about?: string;
  brains: Array<{ name: string; kind: Brain["kind"]; color?: string }>;
  setup: string[];
  messages: number;
  error?: string;
};

/** For commands that take no arguments: they can then be called as api.call("auth.whoami"). */
export type NoArgs = Record<string, never>;

/** JSON commands: POST /api/<name> with args, answered with result. */
export type Commands = {
  health: { args: NoArgs; result: Health };
  "user.list": { args: NoArgs; result: { users: UserSummary[]; unreadable: UnreadableUser[] } };
  "auth.login": { args: { username: string; password: string }; result: User };
  "auth.logout": { args: { all?: boolean }; result: { loggedOut: string | null; sessions?: number } };
  "auth.whoami": { args: NoArgs; result: Who };
  /**
   * T06 frontend: the current password unwraps the data key, the new one rewraps it (no file is touched), and the
   * user is logged out everywhere, this tab included. user.create and user.delete stay terminal-only.
   */
  "user.change-password": { args: { username: string; password: string; newPassword: string }; result: { username: string; loggedOut: number } };
  "models.list": {
    args: { type?: "text" | "image"; refresh?: boolean };
    result: { models: ModelInfo[]; defaults: { text: string; image: string } };
  };
  "conversation.list": { args: NoArgs; result: { conversations: ConversationSummary[]; unreadable: UnreadableConversation[] } };
  "conversation.create": { args: { title?: string; systemPrompt: string; textModel?: string }; result: Conversation };
  "conversation.get": { args: { id: string }; result: Conversation };
  "conversation.update": { args: ConversationUpdate; result: Conversation };
  "conversation.delete": { args: { id: string }; result: { deleted: string } };
  /** T07: the committed example campaigns. No login needed. */
  "examples.list": { args: NoArgs; result: { examples: ExampleInfo[] } };
  /** T07: a new conversation from an example (or a campaign document): its brains, setup, templates, settings and opening. */
  "conversation.import": {
    args: { example?: string; campaign?: Record<string, unknown>; title?: string; withoutMessages?: boolean };
    result: Conversation;
  };
  /** T07: a new conversation from one of yours: same brains, setup, templates and settings; the ledger and images too unless withoutMessages. */
  "conversation.clone": { args: { id: string; title?: string; withoutMessages?: boolean }; result: Conversation };
  "brain.update": { args: BrainUpdate; result: Brain };
  /** Without color: the first unused badge color. Without finalReminder: on, pre-filled with REMINDER_EXAMPLE. */
  "brain.add": { args: BrainFields & { conversation: string; name: string; systemPrompt: string }; result: Brain };
  /** Only a brain that has never spoken, isn't the default and isn't writing (409 brain_in_use / default_brain / conflict). */
  "brain.delete": { args: { conversation: string; brain: string }; result: { conversationId: string; deleted: string; name: string; brains: string[] } };
  "brain.set-default": { args: { conversation: string; brain: string }; result: Brain };
  /** Without content: pre-filled "<!-- This is the <label>. -->" (label default "World Bible"). Positions are 1-based. */
  "setup.add": { args: { conversation: string; label?: string; content?: string; position?: number }; result: SetupListing };
  "setup.update": { args: { conversation: string; setup: string; label?: string; content?: string }; result: SetupListing };
  "setup.move": { args: { conversation: string; setup: string; position: number }; result: SetupListing };
  "setup.delete": { args: { conversation: string; setup: string }; result: SetupListing };
  /** Words in a brain's mouth (or yours, as "player"), appended without generating anything. 409 while a reply is being generated. */
  "message.add": { args: { conversation: string; as: string; content: string }; result: ImageMessageView };
  /** T09: roll a d20 (the server rolls) and add it as your message, without asking a brain. 409 while generating. */
  "message.roll": { args: { conversation: string }; result: MessageView };
  /** T09: `roll` previews turn --roll; the roll's line keeps {{roll}} where the number will go (ROLL_PREVIEW_NOTE). */
  "prompt.preview": {
    args: { conversation: string; brain?: string; content?: string; roll?: boolean; regenerate?: boolean; message?: string; steer?: string };
    result: Preview;
  };
  /**
   * Any message, any depth: the active version's text, in place. 409 while a reply is being generated. An image
   * message's text is its prompt: a new one answers at once with `painting`, and its image follows (image.follow);
   * 409 `image_busy` while that version's own image is still being made.
   */
  "message.edit": { args: { conversation: string; message: string; content: string }; result: ImageMessageView };
  /**
   * Any message, with all its versions (and their image files). Its cost stays in spentUsd. 409 while a reply is
   * being generated, and 409 `image_busy` while any of its images is still being made.
   */
  "message.delete": {
    args: { conversation: string; message: string };
    result: { conversationId: string; deleted: string; messageCount: number; imagesDeleted?: string[] };
  };
  /** `version` is 1-based (what the pager shows); the document's activeVersion is 0-based. 409 while generating. */
  "message.select-version": { args: { conversation: string; message: string; version: number }; result: MessageView };
  "generation.stop": { args: { conversation: string }; result: StopOutcome };
};

/** NDJSON stream commands: POST /api/<name> with args, answered with StreamEvent lines. */
export type StreamCommands = {
  /**
   * T09: `roll` rolls a d20 on the server and adds it after your text (if any). Each saved message (yours, then the
   * roll, whose version has `roll: {die, result}`) arrives as a `message` event before the reply starts.
   */
  turn: { args: { conversation: string; content?: string; brain?: string; roll?: boolean } };
  /** Re-attach to a reply that is being generated right now (after a reload, or from another tab). */
  "generation.follow": { args: { conversation: string } };
  /** A new, active version of the last message (a brain's). With a steer, the brain rewrites its current version. */
  "message.regenerate": { args: { conversation: string; message?: string; steer?: string } };
  /**
   * T05: paint an image message's active prompt again. A failed, interrupted or blurred image is replaced; a
   * finished one is kept, and the retry becomes a new version with the same prompt (`repaintOf`). 409 while
   * that version's image is still being made.
   */
  "image.retry": { args: { conversation: string; message: string } };
  /**
   * T05 triage: watch a message's images being made: image_pending, then image_done / image_error, then done
   * with the message as saved. Nothing being made: done at once with the message as it is. Follow every
   * pending image in your copy of the ledger with it (after a load, an edit, an add): it can't miss a result.
   */
  "image.follow": { args: { conversation: string; message: string } };
};

/**
 * The NDJSON events of docs/design.md ("Command surface"). Every stream ends with exactly one `done` or
 * `error`. The client turns `error` into a thrown ApiError, so a consumer only ever sees the rest.
 */
export type StreamEvent =
  /** generation.follow only, first: a reply is running. What has streamed so far follows, then the rest. */
  | { type: "following"; startedAt: string }
  /** A player message was saved: your text, then (T09, turn --roll) your roll, each its own event. */
  | { type: "message"; message: LedgerMessage }
  /**
   * The brain starts; messageId is the id its saved message will have. For message.regenerate (also when
   * replayed by generation.follow), `regenerate` is true, messageId is the message getting a new version,
   * and `steer` is the direction it was given, if any.
   */
  | {
      type: "start";
      brainId: string;
      brainName: string;
      messageId: string;
      regenerate?: true;
      steer?: string;
      /** T05: "image" for an image brain. `imageOnly`: no text streams (image.retry, or an edit or add of a prompt). */
      kind?: "text" | "image";
      imageOnly?: true;
    }
  | { type: "reasoning"; delta: string }
  | { type: "delta"; delta: string }
  /** T05: an image brain's prompt as it streams, decoded from its generate_image call (words, not JSON). */
  | { type: "prompt"; delta: string }
  /** The prompt is saved (message.image is pending): show a loader. */
  | { type: "image_pending"; messageId: string; imageId: string; model: string; message: LedgerMessage }
  | { type: "image_done"; messageId: string; imageId: string; image: ImageRecord; message: LedgerMessage }
  /** The message is saved; its image isn't. `retry` is the image.retry request. The stream still ends with done. */
  | { type: "image_error"; messageId: string; imageId: string; error: string; image: ImageRecord; message: LedgerMessage; retry: RetryRequest }
  /**
   * The saved brain message. Null only from generation.follow when nothing was running. `spentUsd` is the
   * conversation's running total once this reply's cost was added (a stopped reply's cost comes later).
   */
  | { type: "done"; message: LedgerMessage | null; note?: string; spentUsd?: number }
  /** A broken reply (`venice_error`) from turn or message.regenerate carries `details.retry`: see `retryOf`. */
  | { type: "error"; error: { code: string; message: string; details?: unknown } };

/** What a stream consumer receives: every event except `error`, which arrives as a thrown ApiError. */
export type StreamYield = Exclude<StreamEvent, { type: "error" }>;
