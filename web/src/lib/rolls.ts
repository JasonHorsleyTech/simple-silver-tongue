import { rollLabel, type MessageVersion, type Roll } from "../api/types.ts";

/**
 * T09: how a player's roll shows in the scrollback (design.md, "Dice rolls"). DOM-free, so node:test runs it.
 *
 * Unedited: the die with its number, named by `rollLabel` ("🎲 d20: 14"), beside its line (what every brain reads).
 * Edited (the honor system): the line *is* the roll, since it is what every brain was told, so the die shows no
 * number and the line is the face. The die's own number is only history beside "edited" ("🎲 d20 said 12"),
 * never shown as the roll (T09 QA-1).
 */
export type RollView = {
  roll: Roll;
  /** The number on the die, or null when the line was edited. */
  face: number | null;
  /** What the roll is called (its accessible name). */
  label: string;
  /** "🎲 d20 said 12", for an edited roll's footer; null otherwise. */
  history: string | null;
};

export function rollView(v: MessageVersion): RollView | null {
  if (!v.roll) return null;
  return v.edited
    ? { roll: v.roll, face: null, label: "Your roll (its line was edited)", history: rollLabel(v.roll, true) }
    : { roll: v.roll, face: v.roll.result, label: rollLabel(v.roll), history: null };
}

/**
 * The index in a roll preview's messages (prompt.preview --roll) of the roll's own line: the last ledger message,
 * so the last message, or the one before a brain's final reminder (always last, verbatim). Only there does the
 * server put the number; a {{roll}} anywhere else is sent as written (ROLL_PREVIEW_NOTE). -1 if it isn't there.
 * Only for a roll preview (ROLL_PREVIEW_NOTE among its notes): in any other body, a {{roll}} you typed last would
 * look like one.
 */
export function rollLineIndex(messages: Array<{ role: string; content: string }>, finalReminder: { enabled: boolean; content: string } | null): number {
  const last = messages.length - 1;
  const reminderLast = !!finalReminder?.enabled && finalReminder.content.trim() !== "" && messages[last]?.content === finalReminder.content;
  const i = reminderLast ? last - 1 : last;
  const m = messages[i];
  return m && m.role === "user" && m.content.includes("{{roll}}") ? i : -1;
}
