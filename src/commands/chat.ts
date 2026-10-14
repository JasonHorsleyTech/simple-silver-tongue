import { z } from "zod";
import { formatPreview, type Preview } from "../conversations/format.ts";
import {
  beginGeneration,
  followGeneration,
  loadConversation,
  mutateConversation,
  stopGeneration,
  type GenerationHandle,
  type StopOutcome,
} from "../conversations/store.ts";
import {
  addSpend,
  generatedVersion,
  lookupModel,
  newMessage,
  planRegenerate,
  planTurn,
  relayReply,
  untilAborted,
  type Reply,
} from "../conversations/turn.ts";
import type { ChatRequest, Conversation, LedgerMessage, Usage } from "../conversations/types.ts";
import { STOP_BILL_NOTE } from "../conversations/wording.ts";
import { badRequest, CommandError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { command, streamCommand, type Ctx, type StreamEvent } from "../registry.ts";
import { closeVault, forkVault, type Vault } from "../storage/vault.ts";
import { openChatStream, type ChatEvent } from "../venice/chat.ts";
import { usd } from "../venice/models.ts";
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

export const promptPreview = command({
  name: "prompt.preview",
  description: `Show the exact request body a brain would be sent, built by the same code path as turn and message.regenerate.
--brain picks the brain (default: the default brain), so you can see the ledger from each one's point of view.
With --content, it shows what turn --content would send (your message included). With --regenerate (plus
--message and --steer), it shows what message.regenerate would send instead. Nothing is saved or sent.
--json prints the body byte for byte as it would go to Venice (minus the auth header), plus notes on text the
provider adds that we can't show (reasoning on), and the reason the send would be refused, if it would.`,
  args: z.object({
    conversation: conversationId,
    brain: brainRef.optional(),
    content,
    regenerate: z.boolean().optional().describe("Preview message.regenerate instead of turn (the message's own brain answers)"),
    message: regenerateTarget,
    steer,
  }),
  examples: [
    "./ss prompt.preview --conversation c_k3j9x0q2ma",
    './ss prompt.preview --conversation c_k3j9x0q2ma --brain "Dice Master"',
    './ss prompt.preview --conversation c_k3j9x0q2ma --content "Next message" --json',
    './ss prompt.preview --conversation c_k3j9x0q2ma --regenerate --steer "Make it iambic pentameter."',
  ],
  handler: async (args, ctx): Promise<Preview> => {
    if (!args.regenerate && (args.message !== undefined || args.steer !== undefined)) {
      throw badRequest("message and steer only apply to a regenerate preview: add regenerate (--regenerate).");
    }
    if (args.regenerate && (args.content !== undefined || args.brain !== undefined)) {
      throw badRequest("A regenerate preview takes no content or brain: the message's own brain answers the messages as they are.");
    }
    const conv = await loadConversation(ctx.requireSession().vault, args.conversation);
    const model = await lookupModel(ctx.deps.venice, "text", conv.settings.textModel);
    const plan = args.regenerate
      ? planRegenerate(conv, { message: args.message, steer: args.steer }, model)
      : planTurn(conv, { brain: args.brain, content: args.content }, model);
    const preview: Preview = { conversationId: conv.id, brainId: plan.brain.id, brainName: plan.brain.name, body: plan.body, notes: plan.notes };
    if (plan.refusal) preview.refusal = plan.refusal;
    if ("message" in plan) {
      preview.regenerate = { messageId: plan.message.id, newVersion: plan.message.versions.length + 1 };
      if (plan.steer !== undefined) Object.assign(preview.regenerate, { steer: plan.steer, steeredFrom: plan.steeredFrom });
    }
    return preview;
  },
  format: formatPreview,
});

const turnArgs = z.object({ conversation: conversationId, content, brain: brainRef.optional() });

export const turn = streamCommand({
  name: "turn",
  description: `Send a message and stream a brain's reply. Both are saved to the conversation.
--brain picks who answers (a name or an id; default: the conversation's default brain). Any brain can take any
turn: it sees the whole ledger, its own replies as assistant and everyone else's framed (prompt.preview --brain
shows exactly what it gets). Without --content the brain just responds to the ledger as it stands; that is
refused only when its request would end with its own reply (a brain with a final reminder always has one to
answer). Your message is saved once Venice accepts the request. If the reply then fails, your message stays
and no reply is saved: run turn again without --content to retry. One reply at a time per conversation (409
if busy). The reply prints to stdout as it streams; reasoning and status lines go to stderr. Another terminal
or a reloaded browser can watch it with generation.follow.`,
  args: turnArgs,
  examples: [
    './ss turn --conversation c_k3j9x0q2ma --content "Hello there"',
    "./ss turn --conversation c_k3j9x0q2ma --content @message.md > reply.md",
    "./ss turn --conversation c_k3j9x0q2ma   # no message: the brain just responds",
    './ss turn --conversation c_k3j9x0q2ma --brain "Dice Master" --content "I swing at the goblin."',
  ],
  async *handler(args, ctx) {
    const gen = beginGeneration(ctx.requireSession().vault, args.conversation); // 409 before any event, so it's a real HTTP status
    try {
      yield* gen.relay(turnEvents(args, ctx, gen));
    } finally {
      gen.release();
    }
  },
});

async function* turnEvents(args: z.output<typeof turnArgs>, ctx: Ctx, gen: GenerationHandle): AsyncGenerator<StreamEvent, void, undefined> {
  const { vault } = ctx.requireSession();
  const conv = await gen.load(); // through the write queue, so no edit lands between the lock and this read (T03 QA-1)
  const model = await lookupModel(ctx.deps.venice, "text", conv.settings.textModel);
  const plan = planTurn(conv, { brain: args.brain, content: args.content }, model);
  gen.forBrain(plan.brain.id); // from here on, only this brain is busy (brain.delete, kind changes)
  if (plan.refusal) throw new CommandError(400, "nothing_to_answer", plan.refusal);
  if (plan.brain.kind !== "text") {
    throw new CommandError(400, "not_supported", `"${plan.brain.name}" is an image brain; image replies arrive in T05.`);
  }
  // Up-front refusals (no balance, bad model) throw here, before anything is saved.
  const upstream = await openUpstream(ctx, conv.id, plan.body, gen, "Stopped before the reply started. Nothing was saved.");

  if (plan.player) {
    const player = plan.player;
    await mutateConversation(vault, conv.id, (c) => void c.messages.push(player));
    yield { type: "message", message: player };
  }
  const messageId = newId("m");
  yield { type: "start", brainId: plan.brain.id, brainName: plan.brain.name, messageId };

  const reply = yield* collectReply(vault, conv.id, upstream, gen, {
    kept: plan.player ? "Your message is saved; the reply isn't." : "No reply was saved.",
    retry: "To retry, send again with no new message: turn without --content, or Retry in the browser.",
  });
  const message = newMessage({ type: "brain", brainId: plan.brain.id }, "text", generatedVersion(reply, plan.body.model), messageId);
  const spentUsd = await saveReply(vault, conv.id, reply, (c) => {
    c.messages.push(message);
    return { messageId, version: 0 };
  });
  yield { type: "done", message, note: replyNote(plan.brain.name, reply), spentUsd };
}

const regenerateArgs = z.object({ conversation: conversationId, message: regenerateTarget, steer });

export const messageRegenerate = streamCommand({
  name: "message.regenerate",
  description: `Write the last message again, as a new version that becomes the active one. Optionally steer it.
Only the last message can be regenerated, and only when a brain wrote it; that brain writes the new version.
Without --steer it is a fresh re-roll: the brain answers the messages before it. With --steer ("say it's blue")
the brain sees its current version, then your direction, and rewrites it. The steer is sent in this one request
only and stored for display; later requests see just the active version, as if the brain wrote it on its own.
Repeat as often as you like (each steer revises whichever version is active). Old versions are kept: go back
with message.select-version. prompt.preview --regenerate shows the exact request first. One reply at a time
per conversation (409 if busy); generation.follow watches it, generation.stop stops it.`,
  args: regenerateArgs,
  examples: [
    "./ss message.regenerate --conversation c_k3j9x0q2ma",
    './ss message.regenerate --conversation c_k3j9x0q2ma --steer "Say it\'s blue."',
    './ss message.regenerate --conversation c_k3j9x0q2ma --message m_7f2k9d0x1a --steer @direction.md',
  ],
  async *handler(args, ctx) {
    const gen = beginGeneration(ctx.requireSession().vault, args.conversation); // 409 before any event
    try {
      yield* gen.relay(regenerateEvents(args, ctx, gen));
    } finally {
      gen.release();
    }
  },
});

async function* regenerateEvents(args: z.output<typeof regenerateArgs>, ctx: Ctx, gen: GenerationHandle): AsyncGenerator<StreamEvent, void, undefined> {
  const { vault } = ctx.requireSession();
  const conv = await gen.load(); // through the write queue (T03 QA-1): a delete that got in first is seen here
  const model = await lookupModel(ctx.deps.venice, "text", conv.settings.textModel);
  const plan = planRegenerate(conv, { message: args.message, steer: args.steer }, model);
  gen.forBrain(plan.brain.id);
  if (plan.refusal) throw new CommandError(400, "nothing_to_answer", plan.refusal);
  if (plan.brain.kind !== "text") {
    throw new CommandError(400, "not_supported", `"${plan.brain.name}" is an image brain; regenerating images arrives in T05.`);
  }
  const id = plan.message.id;
  const keeps = `${id} keeps its current version.`;
  const upstream = await openUpstream(ctx, conv.id, plan.body, gen, `Stopped before the new version started. ${keeps}`);

  const start: StreamEvent = { type: "start", brainId: plan.brain.id, brainName: plan.brain.name, messageId: id, regenerate: true };
  if (plan.steer !== undefined) start.steer = plan.steer;
  yield start;
  const reply = yield* collectReply(vault, conv.id, upstream, gen, { kept: `No new version was saved; ${keeps}`, retry: "To retry, regenerate again." });

  const version = generatedVersion(reply, plan.body.model);
  if (plan.steer !== undefined) Object.assign(version, { steer: plan.steer, steeredFrom: plan.steeredFrom });
  let message!: LedgerMessage;
  const spentUsd = await saveReply(vault, conv.id, reply, (c) => {
    // Ledger edits are refused while this runs, and the plan read the ledger after the lock, so the message
    // is still there; but say so if it isn't.
    const m = c.messages.find((x) => x.id === id);
    if (!m) throw new CommandError(409, "conflict", `${id} was deleted while its new version was being written, so the new version wasn't saved.`);
    m.versions.push(version);
    m.activeVersion = m.versions.length - 1;
    m.updatedAt = version.createdAt;
    message = m;
    return { messageId: id, version: m.activeVersion };
  });
  const n = message.versions.length;
  yield { type: "done", message, note: replyNote(`${plan.brain.name} · version ${n}/${n}${plan.steer !== undefined ? " · steered" : ""}`, reply), spentUsd };
}

/**
 * Open the Venice stream and wait for its headers, so an up-front refusal throws before anything is saved.
 * A stop that lands before Venice answers says what it left behind; the request itself goes on to a drain,
 * since Venice may well be writing (and billing) it already. A stop before anything was sent sends nothing.
 */
async function openUpstream(ctx: Ctx, convId: string, body: ChatRequest, gen: GenerationHandle, stoppedText: string) {
  if (gen.stopSignal.aborted) throw stopped(stoppedText);
  const { vault } = ctx.requireSession();
  const pending = openChatStream(ctx.deps.venice, body, { signal: gen.upstreamSignal });
  const events = await Promise.race([pending, untilAborted(gen.stopSignal).then(() => null)]);
  if (events) return events;
  gen.keepUpstream();
  drainStopped(vault, convId, pending, null);
  throw stopped(stoppedText);
}

const stopped = (message: string) => new CommandError(499, "stopped", message);

/** The same words wherever a stop is reported; the browser shows them next to its Stop button too. */
export { STOP_BILL_NOTE };

/**
 * Relay the reply and return it whole. A broken stream says what was kept and how to retry, in the message
 * the user actually reads (T02 QA-8). A stop keeps what had arrived; with no reply text there is nothing to
 * keep, so it ends as a "stopped" error instead, and only the cost is recorded, by the drain.
 */
async function* collectReply(
  vault: Vault,
  convId: string,
  upstream: AsyncIterable<ChatEvent>,
  gen: GenerationHandle,
  say: { kept: string; retry: string },
): AsyncGenerator<StreamEvent, Reply> {
  let reply: Reply;
  try {
    reply = yield* relayReply(upstream, gen.stopSignal);
    if (reply.rest) gen.keepUpstream(); // the drain reads it from here; release() must not cut it
  } catch (err) {
    if (err instanceof CommandError && err.code === "venice_error") {
      throw new CommandError(err.status, err.code, `${err.message} ${say.kept} ${say.retry}`, err.details);
    }
    throw err;
  }
  if (reply.stopped && !reply.content.trim()) {
    drainStopped(vault, convId, reply.rest!, null);
    throw stopped(`Stopped before any reply text arrived. ${say.kept}`);
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
When nothing is being generated it ends at once, with an empty done ("message": null).`,
  args: z.object({ conversation: conversationId }),
  examples: ["./ss generation.follow --conversation c_k3j9x0q2ma"],
  async *handler(args, ctx) {
    const { vault } = ctx.requireSession();
    const live = followGeneration(vault, args.conversation);
    if (live) return yield* live;
    await loadConversation(vault, args.conversation); // an unknown id is a 404, not "nothing running"
    yield { type: "done", message: null, note: "Nothing is being generated for this conversation." };
  },
});

export const generationStop = command({
  name: "generation.stop",
  description: `Stop the reply being generated right now (turn or message.regenerate), from any terminal or tab.
What had arrived is kept, marked "stopped": a turn's partial reply is saved as the brain's message, and a
regenerate's as a new, active version, so you can edit it, regenerate it or delete it. If no reply text had
arrived yet, nothing is saved: a turn keeps only your message, a regenerate keeps the current version.
Stopping saves waiting, not money: Venice still writes and bills the whole reply. So the server keeps reading
it quietly in the background, discards the text, and adds the real cost to the stopped version and to the
conversation's total once Venice reports it. It returns once the stopped reply is saved.`,
  args: z.object({ conversation: conversationId }),
  examples: ["./ss generation.stop --conversation c_k3j9x0q2ma"],
  handler: async (args, ctx): Promise<StopOutcome> => {
    const { vault } = ctx.requireSession();
    const outcome = await stopGeneration(vault, args.conversation);
    if (outcome) return { ...outcome, note: STOP_BILL_NOTE };
    await loadConversation(vault, args.conversation); // an unknown id is a 404, not "nothing running"
    return { stopped: false, message: null };
  },
  format: (r: StopOutcome) => {
    if (!r.stopped) return "Nothing is being generated for this conversation.";
    const m = r.message;
    // Without a message, the stopped generation's own error says what it left behind ("Stopped before ...").
    const head = m
      ? `Stopped. What had arrived is saved: ${m.id}, version ${m.activeVersion + 1}/${m.versions.length}.`
      : r.error?.code === "stopped"
        ? r.error.message
        : `Stopped. ${r.error ? r.error.message : "Nothing was saved."}`;
    return r.note ? `${head}\n${r.note}` : head;
  },
});

/** The one-line summary the CLI prints after a reply. An empty reply says why, since it is saved as is (T02 QA-6). */
function replyNote(head: string, reply: Reply): string {
  const note = [head];
  if (reply.usage) note.push(`${reply.usage.promptTokens} in / ${reply.usage.completionTokens} out`);
  if (reply.costUsd !== undefined) note.push(usd(reply.costUsd));
  const empty = !reply.content.trim();
  if (reply.stopped) {
    note.push("stopped: what had arrived is saved (Venice still bills the whole reply; its cost is added once Venice reports it)");
  } else if (reply.finishReason === "length") {
    note.push(empty && reply.reasoning ? "cut off by max_tokens while reasoning: no reply text" : "cut off by max_tokens");
  } else if (empty) {
    note.push("no reply text");
  }
  return note.join(" · ");
}

export default [promptPreview, turn, messageRegenerate, generationFollow, generationStop];
