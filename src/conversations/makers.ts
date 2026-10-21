import { CommandError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { makeImageBrain, nextColor } from "./defaults.ts";
import { freeMadeName, madeName } from "./naming.ts";
import type { Brain, BrainMaker, Conversation, LedgerMessage } from "./types.ts";
import { MAKES_NUMBER } from "./wording.ts";

/**
 * T16, brains that make brains (design.md, "Brains that make brains"). A brain with `makes` turns every new message
 * it gets into a new brain: the blueprint, named from the pattern, with that message pinned to it. All of it happens
 * inside the write that adds the message (appendMessage, called from mutateConversation), so a crash can't leave a
 * message without its brain or a brain without its message. Nothing here knows what the made brains are for: a
 * Character Creator's "Character {{n}}" and a Place Creator's "Place {{n}}" are the same code.
 */

/** The pattern with a number in it: "Character {{n}}" → "Character 4" (naming.ts, shared with the browser). */
export { madeName };

/**
 * The name the maker's next brain gets, and its number: the counter, moved past any name already taken (a brain
 * someone called "Character 4" by hand), so two brains never share a name.
 */
export function nextMadeName(conv: Pick<Conversation, "brains">, maker: BrainMaker): { name: string; n: number } {
  const free = freeMadeName(conv.brains, maker);
  if (free) return free;
  // Only a pattern without {{n}}, or one whose names look like ids, gets here: both are refused when set, so only a
  // hand-edited file could have one (T16 QA-3).
  throw new CommandError(
    409,
    "conflict",
    `No name the pattern "${maker.name}" makes is free: each is taken by another brain, or isn't a name a brain can have. Change the pattern with brain.update --makes.name "Character ${MAKES_NUMBER}".`,
  );
}

/**
 * Make a brain from `message` with `maker`'s blueprint: the next name (or `name`), the next free color, the message
 * pinned to it. The counter counts up only when the pattern named it. The caller is inside mutateConversation.
 */
export function makeBrain(conv: Conversation, maker: Brain, message: LedgerMessage, opts: { name?: string } = {}): Brain {
  const m = maker.makes;
  if (!m) throw new Error(`brain ${maker.id} has no maker setting`);
  const named = opts.name === undefined ? nextMadeName(conv, m) : null;
  const bp = structuredClone(m.blueprint);
  const brain: Brain = {
    id: newId("b"),
    name: named?.name ?? opts.name!,
    color: nextColor(conv),
    kind: bp.kind,
    reasoning: bp.reasoning,
    systemPrompt: bp.systemPrompt,
    finalReminder: bp.finalReminder,
    stop: bp.stop,
    pins: [{ messageId: message.id, as: m.pinAs }],
    madeFrom: message.id,
  };
  // T18: a blueprint may give the made brains models of their own; without, they use the conversation's.
  if (bp.textModel !== undefined) brain.textModel = bp.textModel;
  if (bp.kind === "image") {
    if (bp.safeMode !== undefined) brain.safeMode = bp.safeMode;
    if (bp.shape !== undefined) brain.shape = bp.shape;
    if (bp.tool) brain.tool = bp.tool;
    if (bp.imageModel !== undefined) brain.imageModel = bp.imageModel;
    makeImageBrain(brain); // fills what the blueprint left out
  }
  if (named) m.next = named.n + 1;
  conv.brains.push(brain);
  return brain;
}

/**
 * Add a new message to the end of the ledger, and make a brain from it when its author makes brains: the one way
 * a new message goes in (turn, message.add, an image turn, an image added by hand), so none can forget the rule.
 * Returns the brain it made, if any. New versions never come through here, so they make nothing.
 */
export function appendMessage(conv: Conversation, message: LedgerMessage): Brain | null {
  return insertMessage(conv, message, conv.messages.length);
}

/**
 * appendMessage at a place in the ledger (T17: a fresh take's Muse note goes in right before the message it is for).
 * The same rule: a new message by a maker makes its brain, in the same write.
 */
export function insertMessage(conv: Conversation, message: LedgerMessage, at: number): Brain | null {
  conv.messages.splice(at, 0, message);
  const author = message.author;
  if (author.type !== "brain") return null;
  const maker = conv.brains.find((b) => b.id === author.brainId);
  return maker?.makes?.enabled ? makeBrain(conv, maker, message) : null;
}

/**
 * A brain that goes while it still has the name its maker's newest number gave it hands the number back (T16 QA-8),
 * so undoing a slip (delete the message, and the never-spoken brain it made goes too) leaves no gap: the next brain
 * gets the same name. A renamed brain, or an older number, changes nothing; the counter still never goes back past a
 * brain that is here, so renaming "Character 1" doesn't free "1".
 */
export function freeNumber(conv: Pick<Conversation, "brains">, gone: Pick<Brain, "name">): void {
  for (const b of conv.brains) {
    const m = b.makes;
    if (m && m.next > 1 && madeName(m.name, m.next - 1) === gone.name) m.next -= 1;
  }
}

/** What a message delete did to the brains (T16): the brains it deleted, and the brains that lost their pin of it. */
export type Forgotten = {
  /** Made from the message and never spoken (and not the default): deleted with it. */
  brainsDeleted: Array<{ brainId: string; name: string }>;
  /** Kept, but the message's pin is gone. `madeFrom`: it was made from the message, and has spoken (or is the default). */
  unpinned: Array<{ brainId: string; name: string; madeFrom?: true }>;
};

/**
 * After `messageId` has left the ledger (message.delete): every pin of it goes, and a brain made from it goes too
 * while it has never spoken (it was only ever that message's brain). One that has spoken stays, with what it said,
 * and only loses the pin. Inside the same mutateConversation as the delete.
 */
export function forgetMessage(conv: Conversation, messageId: string): Forgotten {
  const out: Forgotten = { brainsDeleted: [], unpinned: [] };
  const spoke = (b: Brain) => conv.messages.some((m) => m.author.type === "brain" && m.author.brainId === b.id);
  for (const b of [...conv.brains]) {
    const pinned = b.pins.some((p) => p.messageId === messageId);
    b.pins = b.pins.filter((p) => p.messageId !== messageId);
    if (b.madeFrom === messageId) {
      delete b.madeFrom;
      if (!spoke(b) && b.id !== conv.defaultBrainId) {
        conv.brains.splice(conv.brains.indexOf(b), 1);
        freeNumber(conv, b);
        out.brainsDeleted.push({ brainId: b.id, name: b.name });
        continue;
      }
      out.unpinned.push({ brainId: b.id, name: b.name, madeFrom: true });
    } else if (pinned) {
      out.unpinned.push({ brainId: b.id, name: b.name });
    }
  }
  return out;
}
