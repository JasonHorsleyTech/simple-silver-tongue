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
  LedgerMessage,
  MessageVersion,
  RetryRequest,
  SetupMessage,
  Templates,
} from "../../../src/conversations/types.ts";
import type { ModelInfo } from "../../../src/venice/models.ts";

export type { Brain, BrainTool, ChatMessage, ChatRequest, Conversation, LedgerMessage, MessageVersion, ModelInfo, RetryRequest, SetupMessage, Templates };

/**
 * The server's own words and values, shown as they are: what a stop does and doesn't save, the reasoning
 * warning, the badge palette new brains get their colors from, and the setup message pre-fill's default label.
 */
export { BRAIN_COLORS, DEFAULT_SETUP_LABEL, REASONING_NOTE, STOP_BILL_NOTE } from "../../../src/conversations/wording.ts";

export type User = { username: string; encrypted: boolean };
export type Who = User | { username: null };

export type UserSummary = { username: string; encrypted: boolean; createdAt: string };

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
};

/** message.get, .edit and .select-version: the message, with every version, and who wrote it. */
export type MessageView = { conversationId: string; author: string; message: LedgerMessage };

/** generation.stop. `message` is what the stopped reply saved (null when no text had arrived; `error` says so). */
export type StopOutcome = { stopped: boolean; message: LedgerMessage | null; error?: { code: string; message: string }; note?: string };

export type ConversationUpdate = {
  id: string;
  title?: string;
  settings?: Partial<{ textModel: string; maxTokens: number | null; temperature: number | null; imageModel: string }>;
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
};

export type BrainUpdate = BrainFields & { conversation: string; brain?: string };

/** Every setup command answers with the whole ordered list: replace conv.setup with it. */
export type SetupListing = { conversationId: string; setup: SetupMessage[]; changed?: string; deleted?: string };

/** For commands that take no arguments: they can then be called as api.call("auth.whoami"). */
export type NoArgs = Record<string, never>;

/** JSON commands: POST /api/<name> with args, answered with result. */
export type Commands = {
  health: { args: NoArgs; result: Health };
  "user.list": { args: NoArgs; result: { users: UserSummary[] } };
  "auth.login": { args: { username: string; password: string }; result: User };
  "auth.logout": { args: NoArgs; result: { loggedOut: string | null } };
  "auth.whoami": { args: NoArgs; result: Who };
  "models.list": {
    args: { type?: "text" | "image"; refresh?: boolean };
    result: { models: ModelInfo[]; defaults: { text: string; image: string } };
  };
  "conversation.list": { args: NoArgs; result: { conversations: ConversationSummary[]; unreadable: UnreadableConversation[] } };
  "conversation.create": { args: { title?: string; systemPrompt: string; textModel?: string }; result: Conversation };
  "conversation.get": { args: { id: string }; result: Conversation };
  "conversation.update": { args: ConversationUpdate; result: Conversation };
  "conversation.delete": { args: { id: string }; result: { deleted: string } };
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
  "message.add": { args: { conversation: string; as: string; content: string }; result: MessageView };
  "prompt.preview": {
    args: { conversation: string; brain?: string; content?: string; regenerate?: boolean; message?: string; steer?: string };
    result: Preview;
  };
  /** Any message, any depth: the active version's text, in place. 409 while a reply is being generated. */
  "message.edit": { args: { conversation: string; message: string; content: string }; result: MessageView };
  /** Any message, with all its versions. Its cost stays in spentUsd. 409 while a reply is being generated. */
  "message.delete": { args: { conversation: string; message: string }; result: { conversationId: string; deleted: string; messageCount: number } };
  /** `version` is 1-based (what the pager shows); the document's activeVersion is 0-based. 409 while generating. */
  "message.select-version": { args: { conversation: string; message: string; version: number }; result: MessageView };
  "generation.stop": { args: { conversation: string }; result: StopOutcome };
};

/** NDJSON stream commands: POST /api/<name> with args, answered with StreamEvent lines. */
export type StreamCommands = {
  turn: { args: { conversation: string; content?: string; brain?: string } };
  /** Re-attach to a reply that is being generated right now (after a reload, or from another tab). */
  "generation.follow": { args: { conversation: string } };
  /** A new, active version of the last message (a brain's). With a steer, the brain rewrites its current version. */
  "message.regenerate": { args: { conversation: string; message?: string; steer?: string } };
};

/**
 * The NDJSON events of docs/design.md ("Command surface"). Every stream ends with exactly one `done` or
 * `error`. The client turns `error` into a thrown ApiError, so a consumer only ever sees the rest.
 */
export type StreamEvent =
  /** generation.follow only, first: a reply is running. What has streamed so far follows, then the rest. */
  | { type: "following"; startedAt: string }
  /** The player message was saved. */
  | { type: "message"; message: LedgerMessage }
  /**
   * The brain starts; messageId is the id its saved message will have. For message.regenerate (also when
   * replayed by generation.follow), `regenerate` is true, messageId is the message getting a new version,
   * and `steer` is the direction it was given, if any.
   */
  | { type: "start"; brainId: string; brainName: string; messageId: string; regenerate?: true; steer?: string }
  | { type: "reasoning"; delta: string }
  | { type: "delta"; delta: string }
  | { type: "tool_args"; delta: string }
  | { type: "image_pending"; messageId: string; imageId: string }
  | { type: "image_done"; messageId: string; imageId: string }
  | { type: "image_error"; messageId: string; error: string }
  /**
   * The saved brain message. Null only from generation.follow when nothing was running. `spentUsd` is the
   * conversation's running total once this reply's cost was added (a stopped reply's cost comes later).
   */
  | { type: "done"; message: LedgerMessage | null; note?: string; spentUsd?: number }
  /** A broken reply (`venice_error`) from turn or message.regenerate carries `details.retry`: see `retryOf`. */
  | { type: "error"; error: { code: string; message: string; details?: unknown } };

/** What a stream consumer receives: every event except `error`, which arrives as a thrown ApiError. */
export type StreamYield = Exclude<StreamEvent, { type: "error" }>;
