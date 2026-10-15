/**
 * Sentences (and a palette) that both clients show as they are. Dependency-free, so the web app imports the
 * values themselves (as it imports types.ts's types) and can't drift from what the CLI prints.
 */

import type { PinRole, Roll } from "./types.ts";

/** The same words wherever a stop is offered or reported (T03 QA-2: measured live, a stopped reply is billed in full). */
export const STOP_BILL_NOTE =
  "Stopping saves waiting, not money: Venice still writes and bills the whole reply, so its cost is added to the conversation once Venice reports it.";

/**
 * T05 triage: why an image being made isn't stopped. Once its prompt is saved the image is with Venice, so a stop
 * would save nothing; the image is its message's own job, and the conversation is free meanwhile.
 */
export const IMAGE_STOP_NOTE =
  "An image can't be stopped once its prompt is saved: Venice is already making it, and billing it, so it is kept when it arrives.";

/** The payload view's and the brain editor's words for reasoning (design.md, "Reasoning on adds provider-side text"). */
export const REASONING_NOTE = "Reasoning on: the provider adds a small hidden instruction we can't see or edit.";

/**
 * Brain badge colors, handed out in order to new brains (nextColor); the browser's color picker offers the same ones.
 * T16 frontend: fourteen, not eight, since a brain per character puts a dozen or more at one table; they repeat after.
 */
export const BRAIN_COLORS = [
  "#60a5fa",
  "#f59e0b",
  "#34d399",
  "#f472b6",
  "#a78bfa",
  "#f87171",
  "#22d3ee",
  "#a3e635",
  "#fb923c",
  "#2dd4bf",
  "#818cf8",
  "#e879f9",
  "#fde047",
  "#fda4af",
] as const;

/**
 * The editable example every brain's final reminder starts with (T04). It is on for brains added beside the
 * default one, where it is the last message they see, and off (but filled in) for the default brain. It names
 * no brain, so it stays true when a brain is renamed.
 */
export const REMINDER_EXAMPLE =
  "<!-- System reminder -->\nStay in your role: do only the job your system prompt describes, and reply only as yourself.";

/**
 * T07 triage (QA-2): the stop sequence every text brain starts with. The framing marks who wrote each message,
 * and a model will continue that pattern: live, the GM once wrote a whole fake exchange ("<!-- from: Dice
 * Master -->", a roll, "<!-- from: the player --> I got an 11"). With this as a stop sequence, Venice ends the
 * reply just before such a line. It matches the default templates' prefix; edit it per brain (brain.update --stop).
 */
export const FRAMING_STOP = "<!-- from:";
/** Venice (like OpenAI) takes at most this many stop sequences. */
export const MAX_STOPS = 4;
/** The payload view's line about a request's stop sequences, so it is plain that they are sent and what they do. */
export const stopNote = (stops: readonly string[]) =>
  `Stop sequences: ${stops.map((s) => JSON.stringify(s)).join(", ")}. Venice ends the reply just before any of them, so this brain can't write a framing line for someone else. A request setting, not text the model reads.`;

/**
 * Measured live (T07 triage, deepseek-v4-1-flash): Venice applies stop sequences to the reasoning as well. A
 * reasoning brain that thought "...user messages start with <!-- from: the user -->" was cut there, and its reply
 * had no text at all. Reasoning is off by default; when someone turns it on, say so wherever both are shown.
 */
export const STOP_REASONING_NOTE =
  "Reasoning is on, and Venice applies stop sequences to the reasoning too: if this brain thinks about a framing line, its reply ends right there, with no text. Turn reasoning off, or clear its stop sequences, if that happens.";

/** Image brains' tool text (T05 sends it). All of it reaches the model, and all of it is editable per brain. */
export const DEFAULT_TOOL = {
  name: "generate_image",
  description: "Generate an image from a text prompt. The image is shown to the player.",
  promptParamDescription: "The exact image prompt: a detailed description of what the image shows.",
  // T07: true whether the image is still being made, done or failed (the brain sees it on its next request).
  resultContent: "The prompt was sent to the image model. The player sees the image once it is made.",
} as const;

/** A new setup message's label, and its pre-fill, an HTML comment the models can see: "<!-- This is the World Bible. -->". */
export const DEFAULT_SETUP_LABEL = "World Bible";
export const setupPrefill = (label: string) => `<!-- This is the ${label}. -->`;

/**
 * T09: a roll as both clients show it, apart from the line every brain reads: "🎲 d20: 14". Once that line is
 * edited (the honor system), the line is the roll every brain was told, and the die's own number is only
 * history: "🎲 d20 said 14", shown beside the edited line, never as the roll itself (T09 QA-1).
 */
export const rollLabel = (roll: Roll, edited = false) => `🎲 ${roll.die}${edited ? " said " : ": "}${roll.result}`;

/**
 * T09: the payload view's note for a roll-and-send that hasn't been sent. The server rolls only when the turn is
 * sent, so the preview can't know the number: it leaves the placeholder where the number will go.
 */
export const ROLL_PREVIEW_NOTE =
  "The d20 isn't rolled yet. When you send, the server rolls it and puts the number (1 to 20) where {{roll}} is in your roll's line, the newest player message (a {{roll}} anywhere else is sent as written). The rest of this body is exactly what is sent.";

/**
 * T15: the payload view's note for a fresh take whose request ends on the thought: a brain with no final reminder
 * (the plain "Assistant"), so nothing comes after the brain's own words and the model continues them (a prefill).
 * Measured live (2026-10-15, design.md, "Prompt assembly"); the send path allows this one trailing assistant message.
 */
export const THOUGHT_LAST_NOTE =
  "This brain has no final reminder, so the request ends on your thought, as its own unfinished reply, and the model carries on from it. Live, that worked on DeepSeek V4.1 Flash about 2 runs in 3 (the others wrote code, answered with a tag, came back empty or gave the thought away), broke on GLM 5.3 and on Gemma with reasoning off, and held on Grok 4.7 and Kimi K3. With the final reminder on, a user message comes after the thought, and that worked 6 runs in 6.";

/**
 * T16: how a pinned message is sent to the brain it is pinned to, in words for the payload view, brain.list and the
 * brain card's pin list (design.md, "Pinned messages").
 */
export const PIN_AS_WORDS: Record<PinRole, string> = {
  ledger: "as it appears in the ledger, framed with who wrote it",
  system: "as a system message, its text verbatim",
  assistant: "as the brain's own words, its text verbatim",
};

/**
 * T16: the payload view's line for the messages pinned to this brain, which are sent right after the setup. `author`
 * is the brain that wrote each one; none means yours (T16 QA-6: it said "your's").
 */
export const pinnedNote = (brain: string, pins: ReadonlyArray<{ messageId: string; as: PinRole; author?: string | undefined }>) =>
  `Pinned to ${brain}: ${pins.map((p) => `${p.messageId} (${p.author === undefined ? "yours" : `${p.author}'s`}), ${PIN_AS_WORDS[p.as]}`).join("; ")}. ${pins.length === 1 ? "It is" : "They are"} sent right after the setup messages, as ${pins.length === 1 ? "it stands" : "they stand"} now, and not again at ${pins.length === 1 ? "its place" : "their places"} in the ledger.`;

/**
 * T16: the payload view's line for a brain that makes brains (`makes`): sending to it is a side effect, since its
 * reply makes a new brain. `name` is the name it would get now.
 */
export const makesNote = (brain: string, name: string) =>
  `${brain} makes a brain from each new message: this reply will make a new brain, ${name}, with the reply pinned to it. A regenerate of the reply later makes none (the pin follows the version you pick).`;

/** T16: where the number goes in a maker's name pattern ("Character {{n}}"). */
export const MAKES_NUMBER = "{{n}}";
