import { isMuse, type Brain, type Conversation, type LedgerMessage, type MessageVersion } from "../api/types.ts";

/**
 * T15: what the Fresh take box starts with, from the conversation's thought template (templates.thought): the
 * template with its {{thought}} marker taken out, and the caret where the (first) marker was. T17: {{brain}} becomes
 * the name of the brain the Muse's note is for, as message.regenerate --wrap fills it. Whatever the box holds when
 * you send is sent word for word, so no marker may be left in it. DOM-free, so node:test runs it.
 */
export function prefillThought(template: string, brain = ""): { text: string; caret: number } {
  const MARK = "{{thought}}";
  // One pass, as the server's render: a brain name that itself says {{thought}} is never taken for the marker.
  const parts = template.split(MARK).map((p) => p.split("{{brain}}").join(brain));
  if (parts.length === 1) return { text: parts[0]!, caret: parts[0]!.length };
  return { text: parts.join(""), caret: parts[0]!.length };
}

/**
 * T17: what a fresh take on `messageId` (the last message) does with the Muse's note, by the server's own rule
 * (planMuseNote), so the Fresh take box can say it before you send:
 *   new      a new note goes in right before the reply (`muse` null: there is no Muse yet, so the first fresh take adds one)
 *   after    the message right before is the Muse's own idea (generated): it stays, and the note goes in after it
 *   version  the message right before is a Muse note you wrote: your text becomes its version `version` (1-based),
 *            or leaves it as it is when it already says exactly that (`text` is what it says now)
 *   own      the message is the Muse's own: no fresh take (edit it, or re-roll it)
 *   image    the brain called Muse is an image brain, which can't write a note (rename it)
 */
export type FreshTakeTarget =
  | { kind: "new"; muse: string | null }
  | { kind: "after"; muse: string }
  | { kind: "version"; muse: string; noteId: string; version: number; text: string }
  | { kind: "own"; muse: string }
  | { kind: "image"; muse: string };

export function freshTakeTarget(conv: Pick<Conversation, "brains" | "messages">, messageId: string): FreshTakeTarget {
  const muse = conv.brains.find(isMuse);
  if (!muse) return { kind: "new", muse: null };
  const at = conv.messages.findIndex((m) => m.id === messageId);
  const message = conv.messages[at];
  if (message && authorId(message) === muse.id) return { kind: "own", muse: muse.name };
  if (muse.kind !== "text") return { kind: "image", muse: muse.name };
  const prev = at > 0 ? conv.messages[at - 1] : undefined;
  if (!prev || prev.kind !== "text" || authorId(prev) !== muse.id) return { kind: "new", muse: muse.name };
  const v = prev.versions[prev.activeVersion];
  if (v?.source !== "authored") return { kind: "after", muse: muse.name };
  return { kind: "version", muse: muse.name, noteId: prev.id, version: prev.versions.length + 1, text: v.content };
}

/**
 * T17: whether an image version's fresh-take thought still goes above its picture. Since T17 the idea is the Muse's
 * note right before the message (`prev`), so showing it again would repeat it; a T15 version's thought was in no
 * message (it was kept beside the prompt), and neither is one whose note was deleted since: those still show it.
 */
export function thoughtBesideImage(v: Pick<MessageVersion, "thought">, prev: LedgerMessage | undefined, brains: ReadonlyArray<Brain>): boolean {
  if (v.thought === undefined) return false;
  if (!prev || prev.kind !== "text" || prev.author.type !== "brain") return true;
  const by = authorId(prev);
  const author = brains.find((b) => b.id === by);
  return !(author && isMuse(author)) && !prev.versions.some((x) => x.content === v.thought);
}

/** T15 text versions were saved merged (the thought, a blank line, the reply); T17's are the reply alone. */
export const mergedThought = (v: Pick<MessageVersion, "thought" | "content">) => v.thought !== undefined && v.content.startsWith(v.thought);

const authorId = (m: LedgerMessage) => (m.author.type === "brain" ? m.author.brainId : null);
