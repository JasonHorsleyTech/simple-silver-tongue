import { CommandError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { makeImageBrain, nextColor } from "./defaults.ts";
import type { Brain, BrainMaker, Conversation, LedgerMessage } from "./types.ts";
import { MAKES_NUMBER } from "./wording.ts";

/**
 * T16, brains that make brains (design.md, "Brains that make brains"). A brain with `makes` turns every new message
 * it gets into a new brain: the blueprint, named from the pattern, with that message pinned to it. All of it happens
 * inside the write that adds the message (appendMessage, called from mutateConversation), so a crash can't leave a
 * message without its brain or a brain without its message. Nothing here knows what the made brains are for: a
 * Character Creator's "Character {{n}}" and a Place Creator's "Place {{n}}" are the same code.
 */

/** The word message.add --as uses for you (commands/brains.ts PLAYER), so no brain may be called that. */
const RESERVED = "player";

/** A name a new brain can't take: another brain's (ignoring case), "player", or one that looks like an id. */
function taken(conv: Pick<Conversation, "brains">, name: string): boolean {
  const low = name.toLowerCase();
  return low === RESERVED || /^b_[a-z0-9]+$/.test(name) || conv.brains.some((b) => b.name.toLowerCase() === low);
}

/** The pattern with a number in it: "Character {{n}}" → "Character 4". */
export const madeName = (pattern: string, n: number) => pattern.split(MAKES_NUMBER).join(String(n)).trim();

/**
 * The name the maker's next brain gets, and its number: the counter, moved past any name already taken (a brain
 * someone called "Character 4" by hand), so two brains never share a name.
 */
export function nextMadeName(conv: Pick<Conversation, "brains">, maker: BrainMaker): { name: string; n: number } {
  const start = Math.max(1, Math.floor(maker.next) || 1);
  for (let n = start; n < start + 10_000; n++) {
    const name = madeName(maker.name, n);
    if (!taken(conv, name)) return { name, n };
  }
  // Only a pattern without {{n}} gets here (refused when set; a hand-edited file could have one).
  throw new CommandError(409, "conflict", `Every name the pattern "${maker.name}" makes is taken. Give it ${MAKES_NUMBER} where the number goes.`);
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
  if (bp.kind === "image") {
    if (bp.safeMode !== undefined) brain.safeMode = bp.safeMode;
    if (bp.shape !== undefined) brain.shape = bp.shape;
    if (bp.tool) brain.tool = bp.tool;
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
  conv.messages.push(message);
  const author = message.author;
  if (author.type !== "brain") return null;
  const maker = conv.brains.find((b) => b.id === author.brainId);
  return maker?.makes?.enabled ? makeBrain(conv, maker, message) : null;
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
