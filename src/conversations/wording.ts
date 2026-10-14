/**
 * Sentences that both clients show word for word. Dependency-free, so the web app imports the values
 * themselves (as it imports types.ts's types) and can't drift from what the CLI prints.
 */

/** The same words wherever a stop is offered or reported (T03 QA-2: measured live, a stopped reply is billed in full). */
export const STOP_BILL_NOTE =
  "Stopping saves waiting, not money: Venice still writes and bills the whole reply, so its cost is added to the conversation once Venice reports it.";
