import { newId, nowIso } from "../lib/ids.ts";
import { freeNumber } from "./makers.ts";
import { imageModelOf, type Brain, type Conversation, type ImageRecord, type LedgerMessage, type MessageVersion } from "./types.ts";

/**
 * A new conversation from another one's configuration (T07). conversation.clone copies one of yours ("we're
 * doing Pathfinder", from the D&D campaign's brains and setup); conversation.import builds one from a campaign
 * file (examples/*.json, or a conversation.get --json). Either way it gets fresh ids and today's dates, and it
 * has cost nothing yet (spentUsd 0). Each version's history (steer, model, usage) comes along as it was.
 *
 * `keep` is how many of the ledger's messages come, from the start: all of them, none (--without-messages), or the
 * ledger up to and including one message (conversation.clone --through: the story as it stood there, to play the
 * next turn with another model). What hangs off the messages left behind stays behind with them (see below).
 */

/**
 * A finished image whose file the caller copies to the new id (clone). If the file can't be read, `missing()`
 * fixes the new record before it is saved: the image becomes an error to retry, or a `previous` is dropped.
 */
export type ImageCopy = { from: string; to: string; missing(): void };

/** A campaign file holds prompts, not pictures, so an imported image is an error to retry (it paints the prompt). */
export const NOT_IMPORTED = "This image wasn't imported: a campaign file holds only the prompt. Retry to paint it.";
/** A clone copies finished images; one still being made has nothing to copy yet. */
export const NOT_COPIED = "This image was still being made when the campaign was copied, so there was nothing to copy. Retry to paint it.";
/** A clone found no file for an image the original says is finished. */
export const FILE_MISSING = "This image's file was missing when the campaign was copied. Retry to paint it again.";

export function rebuild(
  src: Conversation,
  opts: { title: string; keep: number; images: "copy" | "none" },
): { conv: Conversation; copies: ImageCopy[] } {
  const now = nowIso();
  const brainIds = new Map(src.brains.map((b) => [b.id, newId("b")]));
  const copies: ImageCopy[] = [];
  const failed = (img: Pick<ImageRecord, "model" | "safeMode"> & { createdAt?: string }, error: string): ImageRecord => ({
    id: newId("img"),
    status: "error",
    model: img.model,
    safeMode: img.safeMode,
    error,
    createdAt: img.createdAt ?? now,
    finishedAt: now,
  });

  const image = (img: ImageRecord | undefined, brain: Brain | undefined): ImageRecord => {
    if (!img || opts.images === "none") return failed(img ?? { model: brain ? imageModelOf(src, brain) : src.settings.imageModel, safeMode: brain?.safeMode ?? true }, NOT_IMPORTED);
    if (img.status === "pending") return failed(img, NOT_COPIED);
    const { previous, ...rest } = img;
    const copy: ImageRecord = { ...structuredClone(rest), id: newId("img") };
    if (copy.status === "done") copies.push({ from: img.id, to: copy.id, missing: () => fileMissing(copy) });
    if (previous?.status === "done") {
      copy.previous = { ...structuredClone(previous), id: newId("img") };
      copies.push({ from: previous.id, to: copy.previous.id, missing: () => void delete copy.previous });
    }
    return copy;
  };

  const messageIds = new Map<string, string>(); // old → new, so pins and madeFrom (T16) follow their messages
  const keptMessages = src.messages.slice(0, Math.max(0, opts.keep));
  const whole = keptMessages.length === src.messages.length;
  const messages: LedgerMessage[] = keptMessages.map((m) => {
    const author: LedgerMessage["author"] = m.author.type === "player" ? { type: "player" } : { type: "brain", brainId: brainIds.get(m.author.brainId)! };
    const brain = m.author.type === "brain" ? src.brains.find((b) => b.id === (m.author as { brainId: string }).brainId) : undefined;
    const versions = m.versions.map((v): MessageVersion => {
      const { image: img, ...rest } = v;
      const copy: MessageVersion = structuredClone(rest);
      if (m.kind === "image") copy.image = image(img, brain);
      return copy;
    });
    const id = newId("m");
    messageIds.set(m.id, id);
    return { ...m, id, author, versions };
  });

  // T16 QA-4: a brain made from a message that doesn't come stays behind with it (its prompt is about a pinned
  // message that isn't coming), unless it speaks in what does come (message.set-author can give it an earlier
  // message): then it comes without that pin, as a message delete would leave it. If that would leave no brain at
  // all, they all come.
  const spoke = new Set(keptMessages.flatMap((m) => (m.author.type === "brain" ? [m.author.brainId] : [])));
  const behind = whole ? [] : src.brains.filter((b) => b.madeFrom !== undefined && !messageIds.has(b.madeFrom) && !spoke.has(b.id));
  const kept = src.brains.filter((b) => !behind.includes(b));
  const brains = kept.length ? kept : src.brains;
  const defaultBrain = brains.find((b) => b.id === src.defaultBrainId) ?? brains[0]!;

  const conv: Conversation = {
    schemaVersion: src.schemaVersion,
    id: newId("c"),
    title: opts.title,
    createdAt: now,
    updatedAt: now,
    settings: structuredClone(src.settings),
    templates: { ...src.templates },
    setup: src.setup.map((s) => ({ ...s, id: newId("s") })),
    brains: brains.map((b) => {
      // T16: pins and madeFrom point at the new copies of their messages; without the ledger there are none.
      const { madeFrom, ...rest } = structuredClone(b);
      const brain: Brain = { ...rest, id: brainIds.get(b.id)!, pins: (b.pins ?? []).flatMap((p) => (messageIds.has(p.messageId) ? [{ ...p, messageId: messageIds.get(p.messageId)! }] : [])) };
      if (madeFrom && messageIds.has(madeFrom)) brain.madeFrom = messageIds.get(madeFrom)!;
      // Without the ledger each maker counts from 1 again: a fresh start on the same kit.
      if (!keptMessages.length && brain.makes) brain.makes.next = 1;
      return brain;
    }),
    defaultBrainId: brainIds.get(defaultBrain.id)!,
    messages,
    spentUsd: 0,
  };
  // Cut after a message: the brains left behind hand their numbers back, newest first, as deleting their messages
  // from the end would (freeNumber, T16 QA-8), so the copy's next "Character {{n}}" is the one the story was at.
  if (keptMessages.length && brains === kept) for (const b of [...behind].reverse()) freeNumber(conv, b);
  return { conv, copies };
}

function fileMissing(r: ImageRecord): void {
  for (const k of ["mime", "blurred", "contentViolation"] as const) delete r[k];
  Object.assign(r, { status: "error", error: FILE_MISSING, finishedAt: nowIso() });
}
