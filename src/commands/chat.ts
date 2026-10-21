import { createHash } from "node:crypto";
import { z } from "zod";
import { formatPreview, type Preview } from "../conversations/format.ts";
import {
  beginGeneration,
  followGeneration,
  loadConversation,
  mutateConversation,
  paintingNow,
  stopGeneration,
  type GenerationHandle,
  type StopOutcome,
} from "../conversations/store.ts";
import { beginPainting, endPainting, newImageRecord } from "../conversations/images.ts";
import { followImages, imageNote, painterFor, startPainting, type Painter } from "../conversations/paint.ts";
import { rollD20 } from "../conversations/dice.ts";
import { appendMessage, insertMessage } from "../conversations/makers.ts";
import { promptOf } from "../conversations/tool-call.ts";
import {
  addSpend,
  generatedVersion,
  imageModelUse,
  newMessage,
  planRegenerate,
  planTurn,
  relayReply,
  textModels,
  textModelUse,
  untilAborted,
  type MuseNotePlan,
  type Reply,
} from "../conversations/turn.ts";
import type { Brain, ChatRequest, Conversation, LedgerMessage, MessageVersion, RetryRequest, Usage } from "../conversations/types.ts";
import { IMAGE_STOP_NOTE, isMuse, MUSE_NAME, reasoningRefusedHint, STOP_BILL_NOTE } from "../conversations/wording.ts";
import { badRequest, CommandError, notFound } from "../lib/errors.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { activeVersion } from "../conversations/prompt.ts";
import { command, streamCommand, type Ctx, type StreamEvent } from "../registry.ts";
import { closeVault, forkVault, type Vault } from "../storage/vault.ts";
import { openChatStream, type ChatEvent } from "../venice/chat.ts";
import { formatDiagnostics, forLog, forUser, type ChatDiagnostics, type LastWorked } from "../venice/diagnose.ts";
import { usd, type ModelInfo } from "../venice/models.ts";
import { brainRef } from "./brains.ts";
import { conversationId } from "./conversations.ts";
import { messageId } from "./messages.ts";

const content = z
  .string()
  .optional()
  .describe("Your message (Markdown; @file.md or - for stdin). Empty or omitted: the brain just responds");

const steer = z
  .string()
  .optional()
  .describe('A one-off direction for this regenerate only ("say it\'s blue"). Never sent again. Blank or omitted: a plain re-roll');
const regenerateTarget = messageId.optional().describe("The message to regenerate: it must be the last one, written by a brain (default: the last message)");

const thought = z
  .string()
  .optional()
  .describe(
    "A fresh take: your idea for the brain's next reply, saved as a note from the Muse right before the message (a new note, or a new version of the Muse's note already there), which every brain reads and the player sees folded. The brain answers it, never seeing the reply it replaces. Sent verbatim (--wrap: inside the thought template). Not with --steer, never blank",
  );
const wrap = z
  .boolean()
  .optional()
  .describe("Put --thought into the conversation's thought template (templates.thought, the Muse's ```hidden note by default) where {{thought}} is, with the brain's name for {{brain}}, as the browser's Fresh take box starts");

const roll = z
  .boolean()
  .optional()
  .describe("Roll a d20 and send it too (T09): the server rolls it, never a model. The roll is added after your message, as your own message, then the brain answers");

export const promptPreview = command({
  name: "prompt.preview",
  description: `Show the exact request body a brain would be sent, built by the same code path as turn and message.regenerate.
--brain picks the brain (default: the default brain), so you can see the ledger from each one's point of view.
With --content, it shows what turn --content would send (your message included). With --roll, what turn --roll
would send: the die isn't rolled until you send, so the roll's line has {{roll}} where the number will go (the
only difference), and a note says so. With --regenerate (plus --message, and --steer or --thought [--wrap]), it
shows what message.regenerate would send instead (a fresh take's body has the Muse's note in place, which the
send saves). Nothing is saved, rolled or sent.
--json prints the body byte for byte as it would go to Venice (minus the auth header), plus notes on text the
provider adds that we can't show (reasoning on), and the reason the send would be refused, if it would.
For an image brain it also shows the /image/generate request its prompt goes into: every field but the prompt,
which is the one its generate_image call writes, word for word.`,
  args: z.object({
    conversation: conversationId,
    brain: brainRef.optional(),
    content,
    roll,
    regenerate: z.boolean().optional().describe("Preview message.regenerate instead of turn (the message's own brain answers)"),
    message: regenerateTarget,
    steer,
    thought,
    wrap,
  }),
  examples: [
    "./ss prompt.preview --conversation c_k3j9x0q2ma",
    './ss prompt.preview --conversation c_k3j9x0q2ma --brain "Dice Master"',
    './ss prompt.preview --conversation c_k3j9x0q2ma --content "Next message" --json',
    './ss prompt.preview --conversation c_k3j9x0q2ma --brain "Game Master" --roll',
    './ss prompt.preview --conversation c_k3j9x0q2ma --regenerate --steer "Make it iambic pentameter."',
    './ss prompt.preview --conversation c_k3j9x0q2ma --regenerate --thought "Subvert it: three goblins in a trench coat." --wrap',
  ],
  handler: async (args, ctx): Promise<Preview> => {
    if (!args.regenerate && (args.message !== undefined || args.steer !== undefined || args.thought !== undefined || args.wrap)) {
      throw badRequest("message, steer, thought and wrap only apply to a regenerate preview: add regenerate (--regenerate).");
    }
    if (args.regenerate && (args.content !== undefined || args.brain !== undefined || args.roll)) {
      throw badRequest("A regenerate preview takes no content, roll or brain: the message's own brain answers the messages as they are.");
    }
    const conv = await loadConversation(ctx.requireSession().vault, args.conversation);
    // T18: the plan looks up the model of the brain that answers (its own, or the conversation's).
    const models = await textModels(ctx.deps.venice);
    const plan = args.regenerate
      ? planRegenerate(conv, { message: args.message, steer: args.steer, thought: args.thought, wrap: args.wrap }, models)
      : planTurn(conv, { brain: args.brain, content: args.content, roll: args.roll ? "unrolled" : undefined }, models);
    const preview: Preview = {
      conversationId: conv.id,
      brainId: plan.brain.id,
      brainName: plan.brain.name,
      models: { text: textModelUse(conv, plan.brain, plan.model) },
      body: plan.body,
      notes: plan.notes,
    };
    if (plan.pinned.length) preview.pinned = plan.pinned;
    if (plan.refusal) preview.refusal = plan.refusal;
    if (plan.brain.kind === "image") {
      const painter = await painterFor(ctx.deps.venice, conv, plan.brain);
      const { body, notes } = painter.plan("");
      const { prompt: _prompt, ...params } = body;
      preview.image = { path: "/image/generate", params, notes };
      preview.models.image = imageModelUse(conv, plan.brain, painter.model);
    }
    if ("message" in plan) {
      preview.regenerate = { messageId: plan.message.id, newVersion: plan.message.versions.length + 1 };
      if (plan.steer !== undefined) Object.assign(preview.regenerate, { steer: plan.steer, steeredFrom: plan.steeredFrom });
      if (plan.thought !== undefined) preview.regenerate.thought = plan.thought;
      if (plan.note) {
        const n = plan.note;
        // A new note gets its id when it is saved, so the preview names only one that is already there.
        preview.regenerate.note = { ...(n.isNew ? {} : { messageId: n.message.id }), version: n.version + 1, isNew: n.isNew, same: n.same, muse: n.muse.name, museCreated: n.museCreated };
      }
    }
    return preview;
  },
  format: formatPreview,
});

const turnArgs = z.object({ conversation: conversationId, content, brain: brainRef.optional(), roll });

export const turn = streamCommand({
  name: "turn",
  description: `Send a message and stream a brain's reply. Both are saved to the conversation.
--brain picks who answers (a name or an id; default: the conversation's default brain). Any brain can take any
turn: it sees the whole ledger, its own replies as assistant and everyone else's framed (prompt.preview --brain
shows exactly what it gets). Without --content the brain just responds to the ledger as it stands; that is
refused only when its request would end with its own reply (a brain with a final reminder always has one to
answer). Your message is saved once Venice accepts the request. If the reply then fails, your message stays
and no reply is saved: to retry, run turn again with the same --brain and no --content (the error says so).
--roll rolls a d20 (the server rolls it, never a model) and adds it as your message, after your text if you
gave some, before the brain answers: the roll-and-send of the play loop ("Roll a d20: 15 or higher succeeds" →
turn --brain "Game Master" --roll). Its line is the roll template ("🎲 I rolled a d20: **14**"), which every
brain reads; it is an ordinary message of yours, to edit or delete. prompt.preview --roll shows the request.
One reply at a time per conversation (409 if busy). The reply prints to stdout as it streams; the roll, reasoning
and status lines go to stderr. Hidden notes and reasoning fold to one line each; --reveal shows
them. Another terminal or a reloaded browser can watch it with generation.follow.
An image brain's prompt streams the same way; once it is saved the conversation is free (the next brain can
take its turn) and this stream goes on until the image lands.`,
  args: turnArgs,
  examples: [
    './ss turn --conversation c_k3j9x0q2ma --content "Hello there"',
    "./ss turn --conversation c_k3j9x0q2ma --content @message.md --reveal > reply.md   # --reveal: notes unfolded",
    "./ss turn --conversation c_k3j9x0q2ma   # no message: the brain just responds",
    './ss turn --conversation c_k3j9x0q2ma --brain "Dice Master" --content "I swing at the goblin."',
    './ss turn --conversation c_k3j9x0q2ma --brain "Game Master" --roll   # roll a d20, send it, the GM answers',
  ],
  async *handler(args, ctx) {
    const gen = beginGeneration(ctx.requireSession().vault, args.conversation); // 409 before any event, so it's a real HTTP status
    let image: ImageStarted | void;
    try {
      image = yield* gen.relay(turnEvents(args, ctx, gen));
    } finally {
      gen.release(); // an image brain's generation ends once its prompt is saved: the next brain can go
    }
    if (image) yield* imageTail(ctx, image);
  },
});

async function* turnEvents(args: z.output<typeof turnArgs>, ctx: Ctx, gen: GenerationHandle): AsyncGenerator<StreamEvent, ImageStarted | void, undefined> {
  const { vault } = ctx.requireSession();
  const conv = await gen.load(); // through the write queue, so no edit lands between the lock and this read (T03 QA-1)
  const models = await textModels(ctx.deps.venice); // T18: the plan picks the answering brain's model from these
  // The server rolls here, never a model (T09). Nothing is saved, and the roll is never shown, unless Venice takes the request.
  const plan = planTurn(conv, { brain: args.brain, content: args.content, roll: args.roll ? rollD20() : undefined }, models);
  gen.forBrain(plan.brain.id); // from here on, only this brain is busy (brain.delete, kind changes)
  if (plan.refusal) throw new CommandError(400, "nothing_to_answer", plan.refusal);
  // An image brain's image model is checked now, before its prompt is asked for (and paid for).
  const painter = plan.brain.kind === "image" ? await painterFor(ctx.deps.venice, conv, plan.brain) : null;
  // Up-front refusals (no balance, bad model) throw here, before anything is saved.
  const upstream = await openUpstream(ctx, { conv, body: plan.body, brain: plan.brain, model: plan.model }, gen, "Stopped before the reply started. Nothing was saved.");

  // Your message, then your roll (T09), saved together; each is a `message` event, so a client shows the roll
  // before the reply starts streaming.
  const added = [plan.player, plan.roll].filter((m): m is LedgerMessage => m !== null);
  if (added.length) {
    await mutateConversation(vault, conv.id, (c) => void c.messages.push(...added));
    for (const message of added) yield { type: "message", message };
  }
  const messageId = newId("m");
  // The title lets the CLI say which campaign SS_CONVERSATION sent this to (T07 QA-6).
  yield { type: "start", brainId: plan.brain.id, brainName: plan.brain.name, messageId, kind: plan.brain.kind, ...modelOf(plan), conversationTitle: conv.title };

  const kept = plan.player && plan.roll ? "Your message and your roll are" : plan.roll ? "Your roll is" : plan.player ? "Your message is" : null;
  // Name the brain: with several, a bare "turn" goes to the default brain, which may be another one (T04 QA-1).
  // A roll is already in the ledger: sending again must not roll again.
  const again = plan.roll
    ? `send again to ${plan.brain.name} with no new message and no new roll: turn --brain ${plan.brain.id} without --content or --roll`
    : `send again to ${plan.brain.name} with no new message: turn --brain ${plan.brain.id} without --content`;
  const say: Say = {
    kept: kept ? `${kept} saved; the reply isn't.` : "No reply was saved.",
    retry: `To retry, ${again}, or Retry in the browser.`,
    // A stop is no failure (no Retry button), but re-running the same command would add the text or roll twice (T09 QA-2).
    ...(kept ? { resend: `To get a reply, ${again}.` } : {}),
    again: { command: "turn", args: { conversation: conv.id, brain: plan.brain.id } },
  };
  const reply = yield* collectReply(vault, conv.id, upstream, gen, say);
  if (painter) {
    const author = { type: "brain" as const, brainId: plan.brain.id };
    return yield* paintReply(ctx, gen, conv.id, reply, { painter, brain: plan.brain, textModel: plan.body.model, say, head: plan.brain.name }, (c, version) => {
      const message = newMessage(author, "image", version, messageId);
      return { message, made: appendMessage(c, message) }; // T16: a maker's new message makes its brain in the same write
    });
  }
  const message = newMessage({ type: "brain", brainId: plan.brain.id }, "text", generatedVersion(reply, plan.body.model), messageId);
  let made = null as Brain | null; // set inside the save (TS can't see a callback's assignment)
  const spentUsd = await saveReply(vault, conv.id, reply, (c) => {
    made = appendMessage(c, message); // T16: a maker's new message makes its brain in the same write
    return { messageId, version: 0 };
  });
  if (made) yield brainMade(made, message.id);
  yield { type: "done", message, note: replyNote(plan.brain.name, reply, plan.body.stop), spentUsd };
}

/**
 * T18: the text model a reply is written with, for the `start` event (the CLI's header names it when it is the brain's
 * own, `ownModel`). The saved version records it too (`model`).
 */
const modelOf = (plan: { brain: Brain; body: ChatRequest }) => ({ model: plan.body.model, ...(plan.brain.textModel !== undefined ? { ownModel: true } : {}) });

/**
 * T16: the event that tells a client a brain was just made (its whole document), so its button can appear at once.
 * Sent after the save that made it and before `done` (or, for an image brain, before `image_pending`, where a
 * client stops reading). generation.follow replays it like any event.
 */
const brainMade = (brain: Brain, messageId: string): StreamEvent => ({ type: "brain_made", brain, messageId });

const regenerateArgs = z.object({ conversation: conversationId, message: regenerateTarget, steer, thought, wrap });

export const messageRegenerate = streamCommand({
  name: "message.regenerate",
  description: `Write the last message again, as a new version that becomes the active one. Optionally steer it.
Only the last message can be regenerated, and only when a brain wrote it; that brain writes the new version.
Without --steer it is a fresh re-roll: the brain answers the messages before it. With --steer ("say it's blue")
the brain sees its current version, then your direction, and rewrites it. The steer is sent in this one request
only and stored for display; later requests see just the active version, as if the brain wrote it on its own.
Repeat as often as you like (each steer revises whichever version is active). Old versions are kept: go back
with message.select-version. prompt.preview --regenerate shows the exact request first. One reply at a time
per conversation (409 if busy); generation.follow watches it, generation.stop stops it.
--thought is a fresh take instead (T17): your idea goes in as a note from the Muse, a message of its own right
before this one (the brain called Muse writes it; the first fresh take adds that brain), framed like any helper's,
so every brain reads it from now on and the player sees it folded. It is sent exactly as given (--wrap puts it
in the thought template first: "An idea for <brain>'s next reply, which the player won't see", in a
\`\`\`hidden note). The brain never sees the reply it replaces, and answers the note; the new version is the reply
alone (for an image brain, the new prompt). Another fresh take on the same message gives that note a new version.
The note is saved once Venice takes the request and stays if the reply stops or breaks: a plain regenerate then
answers it. Delete or edit it like any message.`,
  args: regenerateArgs,
  examples: [
    "./ss message.regenerate --conversation c_k3j9x0q2ma",
    './ss message.regenerate --conversation c_k3j9x0q2ma --steer "Say it\'s blue."',
    './ss message.regenerate --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a --steer @direction.md',
    './ss message.regenerate --conversation c_k3j9x0q2ma --thought "Tired trope. Subvert it: three goblins in a trench coat." --wrap',
    "./ss message.regenerate --conversation c_k3j9x0q2ma --thought @thought.md   # verbatim, fences and all",
  ],
  async *handler(args, ctx) {
    const gen = beginGeneration(ctx.requireSession().vault, args.conversation); // 409 before any event
    let image: ImageStarted | void;
    try {
      image = yield* gen.relay(regenerateEvents(args, ctx, gen));
    } finally {
      gen.release();
    }
    if (image) yield* imageTail(ctx, image);
  },
});

async function* regenerateEvents(args: z.output<typeof regenerateArgs>, ctx: Ctx, gen: GenerationHandle): AsyncGenerator<StreamEvent, ImageStarted | void, undefined> {
  const { vault } = ctx.requireSession();
  const conv = await gen.load(); // through the write queue (T03 QA-1): a delete that got in first is seen here
  const plan = planRegenerate(conv, { message: args.message, steer: args.steer, thought: args.thought, wrap: args.wrap }, await textModels(ctx.deps.venice));
  gen.forBrain(plan.brain.id);
  if (plan.refusal) throw new CommandError(400, "nothing_to_answer", plan.refusal);
  const painter = plan.brain.kind === "image" ? await painterFor(ctx.deps.venice, conv, plan.brain) : null;
  const id = plan.message.id;
  const keeps = `${id} keeps its current version.`;
  const upstream = await openUpstream(ctx, { conv, body: plan.body, brain: plan.brain, model: plan.model }, gen, `Stopped before the new version started. ${keeps}`);

  // T17: a fresh take's note, saved now that Venice has the request (as a turn's message is), right before the message.
  let noteSaved: LedgerMessage | null = null;
  if (plan.note) {
    const { result } = await mutateConversation(vault, conv.id, (c) => saveMuseNote(c, plan.note!, id));
    noteSaved = result.message;
    yield { type: "muse_note", message: result.message, before: id, brain: result.muse, ...(result.museCreated ? { brainCreated: true } : {}) };
    if (result.made) yield brainMade(result.made, result.message.id);
  }
  const start: StreamEvent = { type: "start", brainId: plan.brain.id, brainName: plan.brain.name, messageId: id, regenerate: true, kind: plan.brain.kind, ...modelOf(plan), conversationTitle: conv.title };
  if (plan.steer !== undefined) start.steer = plan.steer;
  if (plan.thought !== undefined) start.thought = plan.thought;
  yield start;
  // A fresh take's retry is a plain re-roll: its note is in the ledger now, so sending the thought again would add it twice.
  const again = { conversation: conv.id, message: id, ...(plan.steer !== undefined ? { steer: plan.steer } : {}) };
  const noteKept = noteSaved ? ` The Muse's note ${noteSaved.id} stays, so a plain regenerate (no thought) answers it.` : "";
  const say: Say = {
    kept: `No new version was saved; ${keeps}${noteKept}`,
    retry: "To retry, regenerate again.",
    again: { command: "message.regenerate", args: again },
  };
  const reply = yield* collectReply(vault, conv.id, upstream, gen, say);

  const n = plan.message.versions.length + 1;
  const head = `${plan.brain.name} · version ${n}/${n}${plan.steer !== undefined ? " · steered" : plan.thought !== undefined ? " · fresh take" : ""}`;
  // Ledger edits are refused while this runs, and the plan read the ledger after the lock, so the message
  // is still there; but say so if it isn't.
  const addVersion = (c: Conversation, version: MessageVersion): LedgerMessage => {
    if (plan.steer !== undefined) Object.assign(version, { steer: plan.steer, steeredFrom: plan.steeredFrom });
    if (plan.thought !== undefined) version.thought = plan.thought;
    const m = c.messages.find((x) => x.id === id);
    if (!m) throw new CommandError(409, "conflict", `${id} was deleted while its new version was being written, so the new version wasn't saved.`);
    m.versions.push(version);
    m.activeVersion = m.versions.length - 1;
    m.updatedAt = nowIso(); // stamped in the write queue, so a later write always has a later updatedAt (the browser merges by it)
    return m;
  };
  if (painter) return yield* paintReply(ctx, gen, conv.id, reply, { painter, brain: plan.brain, textModel: plan.body.model, say, head }, (c, v) => ({ message: addVersion(c, v) }));

  const version = generatedVersion(reply, plan.body.model);
  let message!: LedgerMessage;
  const spentUsd = await saveReply(vault, conv.id, reply, (c) => {
    message = addVersion(c, version);
    return { messageId: id, version: message.activeVersion };
  });
  yield { type: "done", message, note: replyNote(head, reply, plan.body.stop), spentUsd };
}

/**
 * T17: save a fresh take's note as planned (planMuseNote), inside mutateConversation, once Venice has taken the
 * request. The Muse is the plan's brain if it is still here, else the brain called Muse now, else the plan's new one,
 * added. A new note goes right before the message (insertMessage: a Muse that makes brains makes one, as for any new
 * message); a note already there gets the text as a new, active version, unless it already says exactly this. Ledger
 * edits are refused while this generation runs, so the message and the note are where the plan saw them.
 */
function saveMuseNote(c: Conversation, plan: MuseNotePlan, beforeId: string): { message: LedgerMessage; muse: Brain; museCreated: boolean; made: Brain | null } {
  let muse = c.brains.find((b) => b.id === plan.muse.id) ?? c.brains.find(isMuse);
  let museCreated = false;
  if (!muse) {
    muse = structuredClone(plan.muse);
    c.brains.push(muse);
    museCreated = true;
  }
  // Not `conflict` (T17 QA-3): the browser reads that as "a reply is being written" and never shows these words.
  if (muse.kind !== "text") throw new CommandError(400, "bad_brain", `${muse.name} became an image brain while this fresh take was being sent, so its note wasn't saved. Rename it (brain.update --brain "${muse.name}" --name ...), and the next fresh take adds a text ${MUSE_NAME}.`);
  if (plan.isNew) {
    const at = c.messages.findIndex((m) => m.id === beforeId);
    if (at < 0) throw notFound(`${beforeId} was deleted while its fresh take was being sent.`);
    const message: LedgerMessage = { ...structuredClone(plan.message), author: { type: "brain", brainId: muse.id } };
    return { message, muse, museCreated, made: insertMessage(c, message, at) };
  }
  const note = c.messages.find((m) => m.id === plan.message.id);
  if (!note) throw notFound(`The Muse's note ${plan.message.id} was deleted while this fresh take was being sent.`);
  const text = activeVersion(plan.message).content;
  if (activeVersion(note).content !== text) {
    note.versions.push(structuredClone(activeVersion(plan.message)));
    note.activeVersion = note.versions.length - 1;
    note.updatedAt = nowIso(); // stamped in the write queue (the browser keeps the newer copy)
  }
  return { message: note, muse, museCreated, made: null };
}

/**
 * What a broken reply's error says was kept and how to retry, plus the retry request itself (details.retry).
 * `resend`: what a stop with no reply says, when a turn's message or roll was kept (a stop has no Retry).
 */
type Say = { kept: string; retry: string; resend?: string; again: RetryRequest };

/** A stop before any reply arrived: what was kept, and how to have it answered without sending it twice. */
const stoppedEarly = (what: string, say: Say) => stopped([`Stopped before ${what}.`, say.kept, say.resend].filter(Boolean).join(" "));

/** Why a prompt that did arrive wasn't painted: it isn't all there. The image's error, to edit or retry from. */
const UNFINISHED = {
  stopped: "Stopped before the image was made, so none was requested. Retry to paint this prompt as it is, or edit it first.",
  length: "The prompt was cut off by max_tokens, so no image was requested. Edit the prompt (or raise max_tokens and regenerate), then retry.",
  open: "The prompt never finished arriving (its closing quote is missing), so no image was requested. Edit the prompt or retry it as it is.",
};

/** An image brain's turn or regenerate once its prompt is saved: the image being made, and the done note so far. */
type ImageStarted = { convId: string; messageId: string; imageId: string; note: string; spentUsd: number; pending?: StreamEvent };

/**
 * An image brain's reply: save its prompt as the image message (put adds it to the ledger: a new message for a
 * turn, a new version for a regenerate), start its image, and say image_pending. That is where the generation
 * ends (T05 triage): the conversation's lock is free while the image is made, so the next brain can take its
 * turn, and the caller's stream follows the image to its end (imageTail). image_pending goes to followers now
 * (announce) and to the caller only after the lock is released, so the client that hears it can go straight on.
 * A prompt that only partly arrived (a stop, max_tokens) is saved, since it was shown and paid for, but not
 * painted: its image is an error to edit or retry from. A reply with no prompt at all saves nothing and fails
 * like a broken reply, with the same retry.
 */
async function* paintReply(
  ctx: Ctx,
  gen: GenerationHandle,
  convId: string,
  reply: Reply,
  opts: { painter: Painter; brain: Brain; textModel: string; say: Say; head: string },
  put: (c: Conversation, version: MessageVersion) => { message: LedgerMessage; made?: Brain | null },
): AsyncGenerator<StreamEvent, ImageStarted | void> {
  const { vault } = ctx.requireSession();
  const { painter, brain, say } = opts;
  const call = promptOf(reply.toolCalls);
  const prompt = call.prompt.trim() ? call.prompt : "";
  if (!prompt) {
    if (reply.rest) {
      drainStopped(vault, convId, reply.rest, null);
      throw stoppedEarly("any of the prompt arrived", say);
    }
    await mutateConversation(vault, convId, (c) => addSpend(c, reply.costUsd)); // billed all the same
    const tool = brain.tool?.name ?? "generate_image";
    const why = call.calls
      ? `${brain.name} called ${tool} without a prompt, so there was nothing to paint.`
      : `${brain.name} answered without calling ${tool}${reply.content.trim() ? " (it wrote text instead)" : ""}, so there was no prompt to paint.`;
    throw new CommandError(502, "no_prompt", `${why} ${say.kept} ${say.retry}`, { retry: say.again });
  }
  const unfinished = reply.stopped ? UNFINISHED.stopped : call.complete ? null : reply.finishReason === "length" ? UNFINISHED.length : UNFINISHED.open;

  const version = generatedVersion(reply, opts.textModel);
  version.content = prompt;
  const image = newImageRecord({ model: painter.model.id, safeMode: painter.safeMode });
  if (unfinished) Object.assign(image, { status: "error", error: unfinished, finishedAt: image.createdAt });
  version.image = image;
  let message!: LedgerMessage;
  let made = null as Brain | null | undefined; // set inside the save
  const spentUsd = await saveReply(vault, convId, reply, (c) => {
    ({ message, made } = put(c, version));
    if (!unfinished) beginPainting(vault, image.id, { convId, messageId: message.id }); // owned before the pending record reaches disk
    return { messageId: message.id, version: message.versions.indexOf(version) };
  }).catch((err) => {
    endPainting(vault, image.id);
    throw err;
  });
  if (made) yield brainMade(made, message.id);
  let extra = call.calls > 1 ? ` · it made ${call.calls} ${brain.tool?.name ?? "tool"} calls; only the first was used` : "";
  if (reply.content.trim()) extra += ` · it also wrote ${reply.content.trim().length} characters of text beside the call, not kept`;
  if (unfinished) {
    const retry: RetryRequest = { command: "image.retry", args: { conversation: convId, message: message.id } };
    yield { type: "image_error", messageId: message.id, imageId: image.id, error: unfinished, image, message, retry };
    yield { type: "done", message, note: `${replyNote(opts.head, reply)} · ${imageNote(image)}${extra}`, spentUsd };
    return;
  }
  startPainting(vault, ctx.deps.venice, convId, { messageId: message.id, image, prompt }, painter);
  const pending: StreamEvent = { type: "image_pending", messageId: message.id, imageId: image.id, model: image.model, message };
  gen.announce(pending);
  return { convId, messageId: message.id, imageId: image.id, note: `${replyNote(opts.head, reply)}${extra}`, spentUsd, pending };
}

/** The rest of an image turn's stream, after its generation has let go: image_pending, the image landing, then done. */
async function* imageTail(ctx: Ctx, s: ImageStarted): AsyncGenerator<StreamEvent, void> {
  if (s.pending) yield s.pending;
  const { message, spentUsd } = yield* followImages(ctx.requireSession().vault, s.convId, s.messageId, { imageId: s.imageId, announced: [s.imageId] });
  const img = message.versions.find((v) => v.image?.id === s.imageId)?.image;
  yield { type: "done", message, note: img ? `${s.note} · ${imageNote(img)}` : s.note, spentUsd: Math.max(spentUsd, s.spentUsd) };
}

/** What a request is for: the conversation as planned, the body sent, who answers and the model's capabilities. */
type Upstream = { conv: Conversation; body: ChatRequest; brain: Brain; model: ModelInfo };

/**
 * Open the Venice stream and wait for its headers, so an up-front refusal throws before anything is saved.
 * A stop that lands before Venice answers says what it left behind; the request itself goes on to a drain,
 * since Venice may well be writing (and billing) it already. A stop before anything was sent sends nothing.
 * A failure, up front or mid-stream, comes out explained (explainFailure).
 */
async function openUpstream(ctx: Ctx, up: Upstream, gen: GenerationHandle, stoppedText: string) {
  if (gen.stopSignal.aborted) throw stopped(stoppedText);
  const { vault } = ctx.requireSession();
  const explain = (err: unknown) => explainFailure(err, up, ctx);
  const pending = openChatStream(ctx.deps.venice, up.body, { signal: gen.upstreamSignal }).catch((err: unknown) => {
    throw explain(withReasoningHint(err, up.body, up.brain.name));
  });
  const events = await Promise.race([pending, untilAborted(gen.stopSignal).then(() => null)]);
  if (events) return explained(events, explain);
  gen.keepUpstream();
  drainStopped(vault, up.conv.id, pending, null);
  throw stopped(stoppedText);
}

/** The stream as is, with a failure explained on its way out. */
async function* explained(events: AsyncGenerator<ChatEvent>, explain: (err: unknown) => unknown): AsyncGenerator<ChatEvent> {
  try {
    yield* events;
  } catch (err) {
    throw explain(err);
  }
}

/**
 * A failed chat request's diagnostics (diagnose.ts), in two views. The user's goes in the error's
 * `details.diagnostics`: who each message is from, the brain asked, Venice's whole answer. The log's goes in
 * `log` (CommandError), which the server log prints and no client ever sees: ids only (the user as a pseudonym),
 * the request described afresh from the body, and Venice's words masked wherever they repeat the request. Both get
 * the model's limits and the newest reply in this conversation that worked, for scale.
 */
function explainFailure(err: unknown, up: Upstream, ctx: Ctx): unknown {
  if (!(err instanceof CommandError)) return err;
  const details = (err.details && typeof err.details === "object" ? err.details : {}) as { diagnostics?: ChatDiagnostics };
  if (!details.diagnostics) return err;
  const core: ChatDiagnostics = { ...details.diagnostics };
  const limits = { contextLength: up.model.contextLength, maxCompletionTokens: up.model.maxCompletionTokens, alwaysReasons: up.model.reasoning?.always };
  const model = Object.fromEntries(Object.entries(limits).filter(([, v]) => v !== undefined)) as ChatDiagnostics["model"];
  if (model && Object.keys(model).length) core.model = model;
  const last = lastWorked(up.conv);
  if (last) core.lastWorked = last;
  const session = ctx.requireSession();
  const ids = { conversation: up.conv.id, brain: up.brain.id, user: userPseudonym(session.username), encrypted: session.encrypted };
  const out = new CommandError(err.status, err.code, err.message, { ...details, diagnostics: forUser(core, up.body, up.brain.name) });
  out.log = formatDiagnostics(forLog(core, up.body, ids));
  return out;
}

/** The newest reply in the conversation with Venice's token count: what a request that worked measured. */
function lastWorked(conv: Conversation): LastWorked | undefined {
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const m = conv.messages[i]!;
    const v = [...m.versions].reverse().find((x) => x.usage);
    if (!v?.usage) continue;
    const w: LastWorked = { messageId: m.id, messagesAgo: conv.messages.length - 1 - i, at: v.createdAt, promptTokens: v.usage.promptTokens, completionTokens: v.usage.completionTokens };
    if (v.model) w.model = v.model;
    if (v.usage.reasoningTokens) w.reasoningTokens = v.usage.reasoningTokens;
    return w;
  }
  return undefined;
}

/**
 * The user in the log: "u_" and the first 10 hex digits of the username's SHA-256, so the log names nobody, yet
 * tells one user's failures from another's (printf %s <name> | shasum -a 256 | cut -c1-10). The conversation id
 * finds the user's folder anyway.
 */
export const userPseudonym = (username: string) => `u_${createHash("sha256").update(username).digest("hex").slice(0, 10)}`;

const stopped = (message: string) => new CommandError(499, "stopped", message);

/**
 * Venice refuses reasoning off for a thinking-only model (GLM 5.3: 400 "GLM-5.3 is a thinking-only model; disabling
 * thinking (reasoning_effort='none') is not supported"). Its words stay; ours add which switch to flip.
 */
function withReasoningHint(err: unknown, body: ChatRequest, brain: string): unknown {
  const off = body.venice_parameters.disable_thinking === true || body.reasoning_effort === "none";
  const status = (err as CommandError)?.details as { status?: unknown } | undefined;
  if (!off || !(err instanceof CommandError) || err.code !== "venice_error" || status?.status !== 400) return err;
  if (!/thinking[- ]only|disabling thinking/i.test(err.message)) return err;
  const out = new CommandError(err.status, err.code, `${err.message} ${reasoningRefusedHint(brain)}`, err.details);
  out.log = err.log;
  return out;
}

/** The same words wherever a stop is reported; the browser shows them next to its Stop button too. */
export { STOP_BILL_NOTE };

/**
 * Relay the reply and return it whole. A broken stream says what was kept and how to retry, in the message
 * the user actually reads (T02 QA-8), and carries the retry request itself in `details.retry`. A stop keeps
 * what had arrived; with no reply text there is nothing to keep, so it ends as a "stopped" error instead,
 * and only the cost is recorded, by the drain.
 */
async function* collectReply(
  vault: Vault,
  convId: string,
  upstream: AsyncIterable<ChatEvent>,
  gen: GenerationHandle,
  say: Say,
): AsyncGenerator<StreamEvent, Reply> {
  let reply: Reply;
  try {
    reply = yield* relayReply(upstream, gen.stopSignal);
    if (reply.rest) gen.keepUpstream(); // the drain reads it from here; release() must not cut it
  } catch (err) {
    if (err instanceof CommandError && err.code === "venice_error") {
      const details = { ...(err.details && typeof err.details === "object" ? err.details : {}), retry: say.again };
      const out = new CommandError(err.status, err.code, `${err.message} ${say.kept} ${say.retry}`, details);
      out.log = err.log; // the failure's record for the server log (explainFailure)
      throw out;
    }
    throw err;
  }
  if (reply.stopped && !reply.content.trim() && !reply.prompt.trim()) {
    drainStopped(vault, convId, reply.rest!, null);
    throw stoppedEarly("any reply text arrived", say);
  }
  return reply;
}

/** Where a stopped reply's late cost goes: the version that holds what had arrived. */
type CostTarget = { messageId: string; version: number };

/**
 * Save a reply: `put` adds it to the ledger and says where it went, and its cost joins the running total
 * (added first, see addSpend). A stopped reply has no cost yet, so its stream goes on to a drain.
 * Returns the running total after the save, for the `done` event (so a UI needn't recompute it).
 */
async function saveReply(vault: Vault, convId: string, reply: Reply, put: (c: Conversation) => CostTarget): Promise<number> {
  let target: CostTarget | null = null;
  try {
    const { conv } = await mutateConversation(vault, convId, (c) => {
      addSpend(c, reply.costUsd);
      target = put(c);
    });
    return conv.spentUsd ?? 0;
  } finally {
    if (reply.rest) drainStopped(vault, convId, reply.rest, target);
  }
}

/**
 * A stop doesn't stop the bill: Venice finishes and charges the whole reply anyway (T03 QA-2, measured live).
 * So the rest of a stopped stream is read here, quietly, after the generation has ended and its lock is free.
 * The text is discarded; the usage and cost Venice reports at the end go on the conversation's running total
 * and on the stopped version, if one was saved. It outlives the request, so it works on its own key copy.
 * A stream that breaks, or a conversation deleted meanwhile, leaves nothing to record.
 */
function drainStopped(vault: Vault, convId: string, rest: AsyncIterable<ChatEvent> | Promise<AsyncIterable<ChatEvent>>, target: CostTarget | null): void {
  const source = Promise.resolve(rest);
  source.catch(() => {}); // a refusal that arrives after the stop has nothing to record
  const own = forkVault(vault);
  void (async () => {
    try {
      let late: { usage: Usage; costUsd?: number } | undefined;
      for await (const ev of await source) if (ev.type === "usage") late = ev;
      if (!late) return;
      const { usage, costUsd } = late;
      await mutateConversation(own, convId, (c) => {
        addSpend(c, costUsd);
        const v = target && c.messages.find((m) => m.id === target.messageId)?.versions[target.version];
        if (v) {
          v.usage = usage;
          if (costUsd !== undefined) v.costUsd = costUsd;
        }
      });
    } catch {
      // Nothing to record: see above. The request's own result has long been reported.
    } finally {
      closeVault(own);
    }
  })();
}

export const generationFollow = streamCommand({
  name: "generation.follow",
  description: `Watch a reply that is being generated right now: from a second terminal, or a browser tab reloaded mid-reply.
It replays what has streamed so far, then streams the rest live and ends the way that turn does (done or error).
For an image brain it follows the image too, like the turn's own stream. When nothing is being generated it ends
at once, with an empty done ("message": null). Images made after a reply (an edit, an add, a retry, or an image
turn whose prompt is done) don't hold the conversation: watch one with image.follow.`,
  args: z.object({ conversation: conversationId }),
  examples: ["./ss generation.follow --conversation c_k3j9x0q2ma"],
  async *handler(args, ctx) {
    const { vault } = ctx.requireSession();
    const live = followGeneration(vault, args.conversation);
    if (live) {
      // An image brain's generation ends at image_pending (T05 triage); carry on with its image, as turn does.
      let pending: StreamEvent | undefined;
      for await (const ev of live) {
        if (ev.type === "image_pending") pending = ev;
        if (ev.type === "done") pending = undefined;
        yield ev;
      }
      if (!pending) return;
      const id = { messageId: String(pending.messageId), imageId: String(pending.imageId) };
      const conv = await loadConversation(vault, args.conversation);
      const brain = brainOf(conv, id.messageId);
      return yield* imageTail(ctx, { convId: args.conversation, ...id, note: brain ?? "image", spentUsd: 0 });
    }
    await loadConversation(vault, args.conversation); // an unknown id is a 404, not "nothing running"
    const images = paintingNow(vault, args.conversation);
    const also = images ? ` ${images.length === 1 ? "An image is" : `${images.length} images are`} still being made (${images.map((i) => i.messageId).join(", ")}): image.follow watches one.` : "";
    yield { type: "done", message: null, note: `Nothing is being generated for this conversation.${also}` };
  },
});

/** The name of the brain that wrote a message, for a note. */
function brainOf(conv: Conversation, messageId: string): string | undefined {
  const m = conv.messages.find((x) => x.id === messageId);
  return m?.author.type === "brain" ? conv.brains.find((b) => b.id === (m.author as { brainId: string }).brainId)?.name : undefined;
}

export const generationStop = command({
  name: "generation.stop",
  description: `Stop the reply being generated right now (turn or message.regenerate), from any terminal or tab.
What had arrived is kept, marked "stopped": a turn's partial reply is saved as the brain's message, and a
regenerate's as a new, active version, so you can edit it, regenerate it or delete it. If no reply text had
arrived yet, nothing is saved: a turn keeps only your message, a regenerate keeps the current version.
An image brain's prompt that is cut short is kept without an image (retry or edit it). Images are never stopped:
once a prompt is saved its image is with Venice, being made and billed, so it is kept when it arrives. The
result lists the conversation's images still being made (painting).
Stopping saves waiting, not money: Venice still writes and bills the whole reply. So the server keeps reading
it quietly in the background, discards the text, and adds the real cost to the stopped version and to the
conversation's total once Venice reports it. It returns once the stopped reply is saved.`,
  args: z.object({ conversation: conversationId }),
  examples: ["./ss generation.stop --conversation c_k3j9x0q2ma"],
  handler: async (args, ctx): Promise<StopOutcome> => {
    const { vault } = ctx.requireSession();
    const outcome = (await stopGeneration(vault, args.conversation)) ?? { stopped: false, message: null };
    if (!outcome.stopped) await loadConversation(vault, args.conversation); // an unknown id is a 404, not "nothing running"
    const painting = paintingNow(vault, args.conversation);
    if (painting) outcome.painting = painting;
    if (outcome.stopped) outcome.note = STOP_BILL_NOTE;
    return outcome;
  },
  format: (r: StopOutcome) => {
    const m = r.message;
    // Without a message, the stopped generation's own error says what it left behind ("Stopped before ...").
    const head = !r.stopped
      ? "Nothing is being generated for this conversation."
      : m
        ? `Stopped. What had arrived is saved: ${m.id}, version ${m.activeVersion + 1}/${m.versions.length}.`
        : r.error?.code === "stopped"
          ? r.error.message
          : `Stopped. ${r.error ? r.error.message : "Nothing was saved."}`;
    const lines = [head];
    if (r.stopped && m && r.error) lines.push(r.error.message);
    if (r.made) lines.push(`It made a new brain, ${r.made.name} (${r.made.id}), with the stopped reply pinned to it.`);
    if (r.painting) lines.push(`Still being made: ${r.painting.map((p) => `${p.imageId} (${p.messageId})`).join(", ")}. ${IMAGE_STOP_NOTE}`);
    if (r.note) lines.push(r.note);
    return lines.join("\n");
  },
});

/** The one-line summary the CLI prints after a reply. An empty reply says why, since it is saved as is (T02 QA-6). */
function replyNote(head: string, reply: Reply, stops?: string[]): string {
  const note = [head];
  if (reply.usage) note.push(`${reply.usage.promptTokens} in / ${reply.usage.completionTokens} out`);
  if (reply.costUsd !== undefined) note.push(usd(reply.costUsd));
  const empty = !reply.content.trim() && !reply.prompt.trim();
  if (reply.stopped) {
    note.push("stopped: what had arrived is saved (Venice still bills the whole reply; its cost is added once Venice reports it)");
  } else if (reply.finishReason === "length") {
    note.push(empty && reply.reasoning ? "cut off by max_tokens while reasoning: no reply text" : "cut off by max_tokens");
  } else if (empty) {
    // A reply that began with a stop sequence is cut to nothing (T07 triage): say which, so it isn't a mystery.
    note.push(stops?.length ? `no reply text (a stop sequence may have cut it, in the reply or its reasoning: ${stops.map((x) => JSON.stringify(x)).join(", ")}); regenerate it` : "no reply text");
  }
  return note.join(" · ");
}

export default [promptPreview, turn, messageRegenerate, generationFollow, generationStop];
