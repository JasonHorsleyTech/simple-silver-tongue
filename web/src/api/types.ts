/**
 * The commands the web app calls, with their argument and result shapes. They mirror the server's zod
 * schemas (`./sst help <name>` shows each one). When a ticket gives the UI a new command, add a line here:
 * the client is typed from these maps, so a typo in a command name or an argument is a type error.
 *
 * The conversation document and model types are the server's own (type-only imports of dependency-free
 * files), so the UI can't drift from what is on disk. Command args are still written out here by hand.
 */
import type {
  Brain,
  BrainBlueprint,
  BrainMaker,
  BrainTool,
  ChatMessage,
  ChatRequest,
  Conversation,
  ImageRecord,
  ImageRequest,
  ImageShape,
  LedgerMessage,
  MessageVersion,
  Pin,
  PinRole,
  RetryRequest,
  Roll,
  SetupMessage,
  SetupRole,
  Templates,
} from "../../../src/conversations/types.ts";
import type { ModelInfo } from "../../../src/venice/models.ts";

export type { Brain, BrainBlueprint, BrainMaker, BrainTool, ChatMessage, ChatRequest, Conversation, ImageRecord, ImageRequest, ImageShape, LedgerMessage, MessageVersion, ModelInfo, Pin, PinRole, RetryRequest, Roll, SetupMessage, SetupRole, Templates };

/** T13: the roles a setup message can be sent with (user, assistant, system), in the server's order. */
export { SETUP_ROLES } from "../../../src/conversations/types.ts";

/**
 * T16: how a pinned message is sent to its brain (ledger, system, assistant; PIN_AS_WORDS says each in words), and
 * the one brain.pin and a new maker setting use when nobody says.
 */
export { DEFAULT_PIN_AS, PIN_ROLES } from "../../../src/conversations/types.ts";

/** T18: the model a brain uses, the server's own rule: its own, or the conversation's. */
export { imageModelOf, textModelOf } from "../../../src/conversations/types.ts";

/**
 * T16: how a maker names the brains it makes, the server's own rule: the name the next one gets (`freeMadeName`, which
 * skips names already taken), and whether a made brain still has the name its pattern gave it (`isPatternName`).
 */
export { freeMadeName, isPatternName, madeName } from "../../../src/conversations/naming.ts";

/**
 * The server's own image request rule: an image brain's shapes and what each is sent as, and what an image costs
 * with the conversation's settings (the image model picker shows it). Pure, so the browser runs the same code.
 */
export { buildImageRequest, DEFAULT_SHAPE, IMAGE_SHAPES, imagePriceUsd, resolutionsOf, SHAPE_SIZES } from "../../../src/images/request.ts";

/**
 * The server's own words and values, shown as they are: what a stop does and doesn't save (and why an image
 * isn't stopped), the reasoning warning, the badge palette new brains get their colors from, and the setup
 * message pre-fill's default label.
 */
export {
  /** 2026-10-19: what reasoning off does on a model that always reasons (src/venice/model-facts.ts, ALWAYS_REASONS). */
  alwaysReasonsNote,
  /** T18 QA-3: a brain's effort level its model doesn't list (sent as set). */
  effortNote,
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
  /** T17: a fresh take's note is the Muse's: the brain called Muse (isMuse), added by the first fresh take. */
  MUSE_NAME,
  isMuse,
  /** T16: a pin's role in words, the payload view's notes for pins and makers, and the {{n}} of a name pattern. */
  PIN_AS_WORDS,
  pinnedNote,
  makesNote,
  MAKES_NUMBER,
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
 * 2026-10-20: a failed chat request's diagnostics (`details.diagnostics` on a venice_error from turn or
 * message.regenerate): everything about the request but its words. `formatDiagnostics` is the block the CLI prints
 * under the error, so the browser's Details shows the same text. See design.md, "Diagnosing a failed chat request".
 */
export { formatDiagnostics, type ChatDiagnostics } from "../../../src/venice/diagnose.ts";

/**
 * T06 triage: the server ends a session after `minutes` without activity, `secondsLeft` from now if nothing uses it
 * (auth.whoami doesn't count as use). Null: sessions never time out (SST_SESSION_IDLE_MINUTES=0).
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
  /** T06 frontend: the idle limit (SST_SESSION_IDLE_MINUTES; 0 = never), for the login screen after a reload. */
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
/**
 * T18: which model a request uses, and whose: `own` (the brain's own) or the conversation's (`conversation`, the
 * conversation's model either way). `name` is Venice's display name, when it lists the model.
 */
export type ModelUse = { id: string; name?: string; own: boolean; conversation: string };

export type Preview = {
  conversationId: string;
  brainId: string;
  brainName: string;
  /** T18: the brain's text model (body.model) and, for an image brain, its image model (image.params.model), and whose each is. */
  models: { text: ModelUse; image?: ModelUse };
  body: ChatRequest;
  notes: string[];
  refusal?: string;
  /**
   * prompt.preview with regenerate: which message gets the new version, and the steer or thought it is asked with.
   * T17: a fresh take's `note`, the Muse's note it would save right before the message (`version` 1-based; `isNew`:
   * a new message, whose id comes when it is saved, so no `messageId`; `same`: the note already says this;
   * `museCreated`: no brain is called Muse yet, so one is added).
   */
  regenerate?: {
    messageId: string;
    newVersion: number;
    steer?: string;
    steeredFrom?: number;
    thought?: string;
    note?: { messageId?: string; version: number; isNew: boolean; same: boolean; muse: string; museCreated: boolean };
  };
  /** Image brains (T05): the /image/generate body their prompt goes into, minus `prompt` itself, and what was left out. */
  image?: { path: "/image/generate"; params: Omit<ImageRequest, "prompt">; notes: string[] };
  /**
   * T16: the messages pinned to this brain: where each went in body.messages (the index of its first chat message,
   * right after the setup) and how it is sent. Absent without pins. `notes` says the same in words.
   */
  pinned?: Array<{ index: number; messageId: string; as: PinRole }>;
};

/** message.get, .edit and .select-version: the message, with every version, and who wrote it. */
export type MessageView = { conversationId: string; author: string; message: LedgerMessage };

/**
 * message.edit and message.add: for an image message (T05), `painting` names the image being made for it now.
 * T16: `made` (message.add) is the brain the message made, when its author makes brains: add it to the brain list.
 */
export type ImageMessageView = MessageView & { painting?: { imageId: string; model: string }; made?: Brain };

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
  /** T16: the brain the stopped reply made (a stopped reply is a new message too). */
  made?: Brain;
};

export type ConversationUpdate = {
  id: string;
  title?: string;
  settings?: Partial<{
    textModel: string;
    maxTokens: number | null;
    temperature: number | null;
    imageModel: string;
    /** T05: how image brains' images are made (each image brain has its own shape). null unsets a field. A resolution the model doesn't list is a 400. */
    image: Partial<{
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
  /** Image brains only: portrait, square or landscape. */
  shape?: ImageShape;
  tool?: Partial<BrainTool>;
  /** T07 triage: the whole list (at most 4, none blank); [] clears it. Text brains start with ["<!-- from:"]. */
  stop?: string[];
  /**
   * T16: "Each new message makes a new brain". Merged like the brain's own fields; starting one needs `name` (with
   * {{n}}) and `blueprint.systemPrompt`. `enabled: false` keeps it and makes nothing; null removes it.
   */
  makes?: MakesUpdate | null;
  /**
   * T18: the brain's own text model (any Venice id; checked, 400 unknown_model), used instead of the conversation's.
   * null: back to the conversation's. `imageModel`: an image brain's own image model (400 on a text brain).
   */
  textModel?: string | null;
  imageModel?: string | null;
};

/** T16: what brain.add / brain.update take for the maker setting: any of its fields, the blueprint's merged. */
export type MakesUpdate = Partial<Omit<BrainMaker, "blueprint">> & {
  blueprint?: Partial<Omit<BrainBlueprint, "reasoning" | "finalReminder" | "tool" | "textModel" | "imageModel">> & {
    reasoning?: Partial<Brain["reasoning"]>;
    finalReminder?: Partial<Brain["finalReminder"]>;
    tool?: Partial<BrainTool>;
    /** T18: the made brains' own models; null: they use the conversation's. */
    textModel?: string | null;
    imageModel?: string | null;
  };
};

/** T16: brain.pin, brain.unpin and brain.make: the brain as it is now (replace it), and whether anything changed. */
export type BrainPinned = { conversationId: string; brain: Brain; messageId: string; changed: boolean };

export type BrainUpdate = BrainFields & { conversation: string; brain?: string };

/** Every setup command answers with the whole ordered list: replace conv.setup with it. */
export type SetupListing = { conversationId: string; setup: SetupMessage[]; changed?: string; deleted?: string };

/**
 * A brain as examples.list and presets.list show it: its badge, and (T10) one line on its job, for pickers.
 * `reasoning`: its effort, present only when the file switches reasoning on (a labeled opt-in: show it).
 */
export type LibraryBrain = {
  name: string;
  kind: Brain["kind"];
  color?: string;
  about?: string;
  reasoning?: string;
  /** T16: a brain that makes brains, its name pattern ("Character {{n}}"), when the setting is on. */
  makes?: string;
  /** T18: the brain's own models, when the file gives it some (else it uses the conversation's). */
  textModel?: string;
  imageModel?: string;
};

/** examples.list (T07): a committed campaign in examples/, ready to import. `error`: the file can't be imported. */
export type ExampleInfo = {
  name: string;
  title: string;
  about?: string;
  brains: LibraryBrain[];
  setup: string[];
  messages: number;
  error?: string;
};

/** presets.list (T10): a committed kit of brains in presets/, with no setup and no messages. `error`: the file can't be used. */
export type PresetInfo = { name: string; title: string; about?: string; brains: LibraryBrain[]; error?: string };

/**
 * brain.import (T10): the brain as added (fresh id, never the default; its file's color unless one here has it), where
 * it came from, and `notes`, sentences for the user: the templates it left behind when they differ, and for an
 * example's brain, that its prompt was written for that campaign.
 */
export type BrainImport = { conversationId: string; brain: Brain; from: { preset?: string; example?: string; title: string }; notes: string[] };

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
    /** The models the model list enables (models.ini, src/venice/model-list.ts), with the file in `source`; `all`: every model Venice has. */
    args: { type?: "text" | "image"; all?: boolean; refresh?: boolean };
    result: { models: ModelInfo[]; defaults: { text: string; image: string } };
  };
  "conversation.list": { args: NoArgs; result: { conversations: ConversationSummary[]; unreadable: UnreadableConversation[] } };
  "conversation.create": { args: { title?: string; systemPrompt: string; textModel?: string }; result: Conversation };
  "conversation.get": { args: { id: string }; result: Conversation };
  "conversation.update": { args: ConversationUpdate; result: Conversation };
  "conversation.delete": { args: { id: string }; result: { deleted: string } };
  /** T07: the committed example campaigns. No login needed. */
  "examples.list": { args: NoArgs; result: { examples: ExampleInfo[] } };
  /** T10: the committed presets: brains with good instructions and no world. No login needed. */
  "presets.list": { args: NoArgs; result: { presets: PresetInfo[] } };
  /**
   * T07: a new conversation from an example (or a campaign document): its brains, setup, templates, settings and opening.
   * T10: or from a preset (`preset`): its brains, no setup and no messages, so point at the Setup tab for the World Bible.
   * Exactly one of example, preset and campaign.
   */
  "conversation.import": {
    args: { example?: string; preset?: string; campaign?: Record<string, unknown>; title?: string; withoutMessages?: boolean };
    result: Conversation;
  };
  /** T07: a new conversation from one of yours: same brains, setup, templates and settings; the ledger and images too unless withoutMessages. */
  "conversation.clone": { args: { id: string; title?: string; withoutMessages?: boolean; through?: string; textModel?: string }; result: Conversation };
  "brain.update": { args: BrainUpdate; result: Brain };
  /** Without color: the first unused badge color. Without finalReminder: on, pre-filled with REMINDER_EXAMPLE. */
  "brain.add": { args: BrainFields & { conversation: string; name: string; systemPrompt: string }; result: Brain };
  /** Only a brain that has never spoken, isn't the default and isn't writing (409 brain_in_use / default_brain / conflict). */
  "brain.delete": { args: { conversation: string; brain: string }; result: { conversationId: string; deleted: string; name: string; brains: string[] } };
  "brain.set-default": { args: { conversation: string; brain: string }; result: Brain };
  /**
   * T10: one brain from a preset (or an example: exactly one of the two), whole, by its name in that file
   * (case-insensitive). A brain here with that name is a 409 `conflict`; `name` adds it under another one.
   */
  "brain.import": { args: { conversation: string; preset?: string; example?: string; brain: string; name?: string }; result: BrainImport };
  /**
   * T16: pin a message to a brain (sent right after the setup in its requests, not at its place; a live link). `as`
   * defaults to DEFAULT_PIN_AS; pinning again only changes `as`. Any time, mid-reply too (it isn't a ledger edit).
   */
  "brain.pin": { args: { conversation: string; brain: string; message: string; as?: PinRole }; result: BrainPinned };
  "brain.unpin": { args: { conversation: string; brain: string; message: string }; result: BrainPinned };
  /**
   * T16: make a brain from a message by hand, with its author's maker setting (on or off): the next name, or `name`.
   * 400 when the author has no setting; 409 when the message already made a brain that is still here.
   */
  "brain.make": { args: { conversation: string; message: string; name?: string }; result: BrainPinned };
  /** Without content: pre-filled "<!-- This is the <label>. -->" (label default "World Bible"). Positions are 1-based. */
  "setup.add": { args: { conversation: string; label?: string; role?: SetupRole; content?: string; position?: number }; result: SetupListing };
  "setup.update": { args: { conversation: string; setup: string; label?: string; role?: SetupRole; content?: string }; result: SetupListing };
  "setup.move": { args: { conversation: string; setup: string; position: number }; result: SetupListing };
  "setup.delete": { args: { conversation: string; setup: string }; result: SetupListing };
  /** Words in a brain's mouth (or yours, as "player"), appended without generating anything. 409 while a reply is being generated. */
  "message.add": { args: { conversation: string; as: string; content: string }; result: ImageMessageView };
  /** T09: roll a d20 (the server rolls) and add it as your message, without asking a brain. 409 while generating. */
  "message.roll": { args: { conversation: string }; result: MessageView };
  /** T09: `roll` previews turn --roll; the roll's line keeps {{roll}} where the number will go (ROLL_PREVIEW_NOTE). */
  "prompt.preview": {
    args: { conversation: string; brain?: string; content?: string; roll?: boolean; regenerate?: boolean; message?: string; steer?: string; thought?: string };
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
    /**
     * T16: `brainsDeleted`, brains made from it that had never spoken (gone with it: drop them); `unpinned`, brains
     * that lost their pin of it (`madeFrom`: made from it, kept because it spoke or is the default). Re-read or patch.
     */
    result: {
      conversationId: string;
      deleted: string;
      messageCount: number;
      imagesDeleted?: string[];
      brainsDeleted?: Array<{ brainId: string; name: string }>;
      unpinned?: Array<{ brainId: string; name: string; madeFrom?: true }>;
    };
  };
  /**
   * T16: change who said a message ("Said by"): `as` is "player" or a brain (name or id) of the message's kind. A
   * brain's message comes to you only with one version; a roll stays yours. 409 while a reply is being generated.
   */
  "message.set-author": { args: { conversation: string; message: string; as: string }; result: MessageView & { from: string; changed: boolean } };
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
  /**
   * A new, active version of the last message (a brain's). With a steer, the brain rewrites its current version.
   * With a thought (a fresh take; never with a steer; T17), the thought is the Muse's note: saved in the ledger
   * right before the message (a `muse_note` event, before `start`), and the brain answers it. The new version is
   * the reply alone, with `thought` (display only) saying what note it answered.
   */
  "message.regenerate": { args: { conversation: string; message?: string; steer?: string; thought?: string } };
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
   * and `steer` is the direction it was given, if any (T15: or `thought`, a fresh take's).
   */
  | {
      type: "start";
      brainId: string;
      brainName: string;
      messageId: string;
      regenerate?: true;
      steer?: string;
      thought?: string;
      /** T05: "image" for an image brain. `imageOnly`: no text streams (image.retry, or an edit or add of a prompt). */
      kind?: "text" | "image";
      imageOnly?: true;
      /** T18: the text model the reply is written with (turn, message.regenerate); `ownModel`: the brain's own, not the conversation's. */
      model?: string;
      ownModel?: true;
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
   * T16: the reply just saved made a brain (its author makes brains): add `brain` to the cast at once. It comes
   * after the save and before `done` (an image brain's: before `image_pending`, where a client stops reading).
   */
  | { type: "brain_made"; brain: Brain; messageId: string }
  /**
   * T17, a fresh take: the Muse's note was saved (Venice took the request), before `start`. `message` is the note as
   * saved (a new message, or a new version of the note already there), and it sits right before `before`, the
   * message getting the new version: insert it there, not at the end. `brain` is the Muse (the brain called Muse);
   * `brainCreated` when this fresh take just added it to the conversation.
   */
  | { type: "muse_note"; message: LedgerMessage; before: string; brain: Brain; brainCreated?: true }
  /**
   * The saved brain message. Null only from generation.follow when nothing was running. `spentUsd` is the
   * conversation's running total once this reply's cost was added (a stopped reply's cost comes later).
   */
  | { type: "done"; message: LedgerMessage | null; note?: string; spentUsd?: number }
  /** A broken reply (`venice_error`) from turn or message.regenerate carries `details.retry`: see `retryOf`. */
  | { type: "error"; error: { code: string; message: string; details?: unknown } };

/** What a stream consumer receives: every event except `error`, which arrives as a thrown ApiError. */
export type StreamYield = Exclude<StreamEvent, { type: "error" }>;
