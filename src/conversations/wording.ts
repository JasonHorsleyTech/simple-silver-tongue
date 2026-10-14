/**
 * Sentences that both clients show word for word. Dependency-free, so the web app imports the values
 * themselves (as it imports types.ts's types) and can't drift from what the CLI prints.
 */

/** The same words wherever a stop is offered or reported (T03 QA-2: measured live, a stopped reply is billed in full). */
export const STOP_BILL_NOTE =
  "Stopping saves waiting, not money: Venice still writes and bills the whole reply, so its cost is added to the conversation once Venice reports it.";

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
  resultContent: "The image was generated and is now on the player's screen.",
} as const;

/** A new setup message's label, and its pre-fill, an HTML comment the models can see: "<!-- This is the World Bible. -->". */
export const DEFAULT_SETUP_LABEL = "World Bible";
export const setupPrefill = (label: string) => `<!-- This is the ${label}. -->`;
