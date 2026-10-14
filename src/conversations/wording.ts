/**
 * Sentences (and a palette) that both clients show as they are. Dependency-free, so the web app imports the
 * values themselves (as it imports types.ts's types) and can't drift from what the CLI prints.
 */

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

/** Brain badge colors, handed out in order to new brains (nextColor); the browser's color picker offers the same ones. */
export const BRAIN_COLORS = ["#60a5fa", "#f59e0b", "#34d399", "#f472b6", "#a78bfa", "#f87171", "#22d3ee", "#a3e635"] as const;

/**
 * The editable example every brain's final reminder starts with (T04). It is on for brains added beside the
 * default one, where it is the last message they see, and off (but filled in) for the default brain. It names
 * no brain, so it stays true when a brain is renamed.
 */
export const REMINDER_EXAMPLE =
  "<!-- System reminder -->\nStay in your role: do only the job your system prompt describes, and reply only as yourself.";

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
