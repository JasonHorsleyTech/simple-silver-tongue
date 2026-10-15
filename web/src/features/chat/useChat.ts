import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client.ts";
import { ApiError, errorMessage, isAbortError, retryOf } from "../../api/errors.ts";
import { IMAGE_STOP_NOTE, type Brain, type Conversation, type LedgerMessage, type PinRole, type RetryRequest, type StreamYield } from "../../api/types.ts";
import { forBrowser } from "../../lib/format.ts";
import { refreshConversations } from "../conversations/store.ts";

/**
 * One conversation's state in the browser: the ledger as the server saved it, plus at most one live reply
 * (streaming in, or failed with its partial text). The server is the truth: this only mirrors
 * conversation.get, the results of the ledger commands, and the stream events of `turn`,
 * `message.regenerate` and `generation.follow`, which share one reducer.
 *
 * Leaving the view (or reloading) stops *reading*, never the reply: the server finishes and saves it.
 * Coming back calls generation.follow, which replays what has streamed so far and then streams the rest.
 * A regenerate's live reply carries the id of the message it rewrites, so the scrollback paints it in that
 * message's slot rather than at the bottom (also when it was re-attached by generation.follow).
 *
 * Image brains (T05): the live reply is the prompt streaming in. Once it is saved (`image_pending`) the
 * generation is over and the conversation is free: the live reply ends there, so Send and the chips come back
 * at once, and the image is followed on its own. Every message whose image is pending in this copy of the
 * ledger, however it got there (a turn, a regenerate, an edit, an add, a retry, a reload), has a watcher on
 * `image.follow`, which ends with the message as saved. Messages from different streams can arrive out of
 * order, so an older copy of a message (an earlier `updatedAt`) never replaces a newer one.
 *
 * Dice (T09): a send can carry a roll (`turn` with `roll: true`). The server rolls; the roll arrives as a `message`
 * event, after your text's and before `start`, and is upserted like any message. Until it does, `pendingRoll`
 * stands in for it (a tumbling die, never a number). `roll()` just rolls (message.roll), asking no brain.
 *
 * Brains that make brains (T16): a new message from a maker makes a brain in the same write. The stream says so
 * (`brain_made`, before `done`), as do message.add (`made`) and brain.make, and the brain joins the cast at once,
 * marked `fresh` for this view (its button glows, its message offers a name). The maker's counter moved too, so the
 * conversation is re-read once the reply is over. A delete that took a made brain (or pins) with it patches them out.
 */

export type LiveReply = {
  /** "turn": this tab started it. "follow": re-attached to a reply that was already running. */
  origin: "turn" | "follow";
  /** "regenerate": a new version of `messageId`, streaming in that message's place. */
  kind: "turn" | "regenerate";
  brainId: string | null;
  brainName: string | null;
  /** The id the saved message will have (a turn, once the brain has started), or the message being regenerated. */
  messageId: string | null;
  /** A regenerate's steer, trimmed; null for a plain re-roll or a turn. Display only. */
  steer: string | null;
  /**
   * A fresh take's thought (T15), as sent; null otherwise. Display only: since T17 it is the Muse's note, saved in the
   * ledger right before the message (`muse_note`, before `start`), and `content` is the reply alone.
   */
  thought: string | null;
  content: string;
  reasoning: string;
  phase: "waiting" | "reasoning" | "writing" | "failed";
  error: string | null;
  /**
   * A failed reply: the exact request that retries it, from the server's error (`details.retry`): the same
   * brain for a turn, the same message and steer for a regenerate. Null when the server sent none.
   */
  retry: RetryRequest | null;
  /** An image brain's reply: `content` is its image prompt, streaming in; the image is made once it is saved. */
  image: boolean;
};

/**
 * What a send gives back when it saved nothing (refused up front, or stopped before Venice answered): the text for
 * the composer, and whether the die was armed, so the roll is armed again too (T09). Once anything is saved, the
 * roll included, there is nothing to give back: sending again must not add the text or roll twice.
 */
export type Unsent = { text: string; roll: boolean };

/** A line above the composer: an up-front send failure (error), or what a stop did and didn't save (info). */
export type ChatNotice = { tone: "error" | "info"; message: string; note?: string };

/** How a regenerate is asked: a steer (Revise; blank = a plain re-roll), or a fresh take's thought (T15: the Muse's note, T17), sent as typed. */
export type RegenerateAsk = { steer?: string; thought?: string };

/** Ledger commands resolve to null when done, or to a message to show where the action was taken. */
export type MessageActions = {
  edit(messageId: string, content: string): Promise<string | null>;
  remove(messageId: string): Promise<string | null>;
  /** `version` is 1-based, as the pager shows it. */
  selectVersion(messageId: string, version: number): Promise<string | null>;
  /** T16: pin the message to a brain (brain.pin; `as` changes how an existing pin is sent), or unpin it. Allowed mid-reply. */
  pin(messageId: string, brainId: string, as?: PinRole): Promise<string | null>;
  unpin(messageId: string, brainId: string): Promise<string | null>;
  /** T16: make a brain from the message with its author's blueprint (brain.make): the next name from the pattern, or `name`. */
  make(messageId: string, name?: string): Promise<string | null>;
  /** T16: "Said by": a brain id, or "player" (message.set-author). A ledger edit: refused mid-reply. */
  setAuthor(messageId: string, as: string): Promise<string | null>;
  /** T16: rename a brain (brain.update), from the message it was made from. */
  renameBrain(brainId: string, name: string): Promise<string | null>;
  /** A new version of the last message, streaming in its place. Resolves to an up-front failure's message. */
  regenerate(messageId: string, ask?: RegenerateAsk): Promise<string | null>;
  /**
   * image.retry: paint an image message's prompt again. A failed, blurred or flagged image is replaced; a
   * finished one is kept and the repaint becomes a new version. With `safeModeOff`, the brain's safe mode is
   * turned off first (brain.update), for a blurred image. Resolves once the image is being made (it is then
   * followed like any pending image), or to the reason it wasn't.
   */
  repaint(messageId: string, opts?: { safeModeOff?: boolean }): Promise<string | null>;
};

export type Chat = {
  conv: Conversation | null;
  loadError: ApiError | null;
  /** The player's text while `turn` waits for Venice to accept it (it is saved only then). */
  pendingPlayer: string | null;
  /** T09: a roll is on its way (a roll-and-send before Venice accepts it, or message.roll): a die tumbles in its place. */
  pendingRoll: boolean;
  live: LiveReply | null;
  /** True while a reply is streaming (in this tab or followed). */
  busy: boolean;
  /** True while generation.stop is on its way. */
  stopping: boolean;
  /** T16: brains made while this view was open (by a reply, an add, or by hand): new, and probably still to be named. */
  fresh: ReadonlySet<string>;
  notice: ChatNotice | null;
  /**
   * Send a message (empty = the brain just responds), with a d20 roll after it when `roll` (T09: the server rolls).
   * Resolves to what to give back when nothing was saved (the send failed up front, or was stopped before Venice
   * answered), else null.
   */
  send(content: string, brainId?: string, opts?: { roll?: boolean }): Promise<Unsent | null>;
  /** Stop the running reply (this tab's, or one followed from the CLI or another tab). */
  stop(): Promise<void>;
  /**
   * Retry the failed live reply exactly as the server says to: a turn goes to the brain whose reply broke
   * (never the default brain by accident, T04 QA-1), a regenerate keeps its message and steer.
   */
  retry(): Promise<void>;
  /**
   * Words in a brain's mouth, or yours with no reply (`as`: a brain id, or "player"): message.add. Resolves
   * to null when added, or to the reason it wasn't.
   */
  add(as: string, content: string): Promise<string | null>;
  /** T09: just roll (message.roll): the server rolls a d20 and adds it as your message; no brain is asked. Resolves to null, or why not. */
  roll(): Promise<string | null>;
  actions: MessageActions;
  dismissLive(): void;
  dismissNotice(): void;
  /** After a command that returns the whole document (conversation.update). */
  replaceConversation(conv: Conversation): void;
  /** After brain.update or brain.add, which return the brain: replace it, or add it at the end. */
  replaceBrain(brain: Brain): void;
  /** Any other local change that mirrors a command's result (brain.delete, brain.set-default, setup.*). */
  patch(fn: (c: Conversation) => Conversation): void;
};

/**
 * What the browser says when a ledger change meets a reply in progress (the server's 409). The server's own
 * message names the conversation id, which is noise here; this says what happened and what to do.
 */
export const BUSY_LEDGER =
  "A reply is being written from the messages as they are now, so they can't change until it's done. Wait for it to finish, or stop it.";

/**
 * What the browser says when a change would replace or remove an image Venice is still making (the server's
 * 409 image_busy): an edit of its prompt, its retry, the message's delete.
 */
export const IMAGE_BUSY =
  "Its image is still being made. Venice is already making it (and billing it), so it will be kept: try again once it has landed.";

/** True while any version of this message has an image being made. `active`: only the version on show. */
export function imagePending(m: LedgerMessage, which: "active" | "any" = "any"): boolean {
  if (m.kind !== "image") return false;
  const versions = which === "any" ? m.versions : [m.versions[m.activeVersion]];
  return versions.some((v) => v?.image?.status === "pending");
}

/** Keep our copy of a message when the incoming one is older: events from different streams can cross. */
const newer = (incoming: LedgerMessage, ours: LedgerMessage | undefined) => !ours || incoming.updatedAt >= ours.updatedAt;

/** A re-read conversation, keeping any message of ours that is newer than what the read saw. */
function mergeRead(ours: Conversation | null, read: Conversation): Conversation {
  if (!ours || ours.id !== read.id) return read;
  const mine = new Map(ours.messages.map((m) => [m.id, m]));
  return { ...read, messages: read.messages.map((m) => (newer(m, mine.get(m.id)) ? m : mine.get(m.id)!)) };
}

/** A failed image.follow is tried again after this long (doubling, per message), unless the page reloads it first. */
const WATCH_RETRY_MS = [1000, 2000, 4000, 8000, 15000, 30000];

/**
 * At most this many image.follow streams at once. Each holds a connection, and the browser allows six per host
 * over HTTP/1.1: with more, the next turn would queue behind them. The others start as these finish.
 */
const MAX_WATCHERS = 3;

const EMPTY_BUF = { content: "", reasoning: "" };

/** After a stop, Venice's bill arrives later (the server's drain). Re-read the conversation on this schedule. */
const COST_POLL_MS = [1500, 2500, 4000, 6000, 9000, 14000, 20000];

export function useChat(id: string): Chat {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [pendingPlayer, setPendingPlayer] = useState<string | null>(null);
  const [pendingRoll, setPendingRoll] = useState(false);
  const [live, setLive] = useState<LiveReply | null>(null);
  const [notice, setNotice] = useState<ChatNotice | null>(null);
  const [stopping, setStopping] = useState(false);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  /** A brain was made: its maker's counter moved, so re-read the conversation once nothing is streaming. */
  const rereadAfter = useRef(false);

  const convRef = useRef<Conversation | null>(null);
  convRef.current = conv;
  const liveRef = useRef<LiveReply | null>(null);
  liveRef.current = live;
  const busy = live !== null && live.phase !== "failed";
  const busyRef = useRef(false);
  busyRef.current = busy;
  /** Aborted when the view unmounts: stops reading streams (the server carries on). */
  const alive = useRef<AbortController>(new AbortController());
  /** Set by a stop: the conversation's total should grow once Venice reports the stopped reply's cost. */
  const costWatch = useRef<{ until: number; spentAtStop: number | undefined } | null>(null);
  const costTries = useRef(0);

  // Text deltas arrive far faster than the screen refreshes. Buffer them and paint once per frame, so a long
  // Markdown reply re-renders ~60 times a second at most, however fast the tokens come.
  const buf = useRef({ ...EMPTY_BUF });
  const frame = useRef<number | null>(null);
  const flush = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const { content, reasoning } = buf.current;
    if (!content && !reasoning) return;
    buf.current = { ...EMPTY_BUF };
    setLive((l) => {
      if (!l) return l;
      const next = { ...l, content: l.content + content, reasoning: l.reasoning + reasoning };
      next.phase = next.content ? "writing" : "reasoning";
      return next;
    });
  }, []);
  const schedule = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(flush);
  }, [flush]);

  /**
   * Add a saved message, or replace it by id (a regenerate, an edit or a version switch returns an existing one).
   * An older copy than ours is ignored. `known`: only replace, never add (an image landing for a message that
   * was deleted meanwhile must not bring it back).
   */
  const upsertMessage = useCallback((m: LedgerMessage, opts?: { known?: boolean }) => {
    setConv((c) => {
      if (!c) return c;
      const i = c.messages.findIndex((x) => x.id === m.id);
      if (i === -1 && opts?.known) return c;
      if (i !== -1 && !newer(m, c.messages[i])) return c;
      const messages = i === -1 ? [...c.messages, m] : c.messages.map((x, j) => (j === i ? m : x));
      return { ...c, messages, updatedAt: m.updatedAt > c.updatedAt ? m.updatedAt : c.updatedAt };
    });
  }, []);

  /**
   * A generated reply was saved (a turn's new message, or a regenerate's new version): put it in, with the
   * running total the server sends along in `done`, so the header is right without a re-read. A stopped
   * reply has no cost yet; the re-reads after a stop pick it up.
   */
  const saveReply = useCallback(
    (m: LedgerMessage, spentUsd: number | undefined, opts?: { known?: boolean }) => {
      upsertMessage(m, opts);
      // The total only grows; a stream that read it a moment before another's save can't shrink it.
      if (spentUsd !== undefined) setConv((c) => c && { ...c, spentUsd: Math.max(spentUsd, c.spentUsd ?? 0) });
    },
    [upsertMessage],
  );

  /** T16: a brain was just made (a reply, an add, brain.make): into the cast at once, marked fresh; re-read after. */
  const addMadeBrain = useCallback((brain: Brain) => {
    setConv((c) => {
      if (!c) return c;
      const known = c.brains.some((b) => b.id === brain.id);
      return { ...c, brains: known ? c.brains.map((b) => (b.id === brain.id ? brain : b)) : [...c.brains, brain] };
    });
    setFresh((f) => new Set(f).add(brain.id));
    rereadAfter.current = true;
  }, []);

  /** Re-read the whole conversation, unless a reply started meanwhile (its events are then the fresher truth). */
  const reload = useCallback(async () => {
    const next = await api.call("conversation.get", { id }, { signal: alive.current.signal });
    if (!busyRef.current) setConv((c) => mergeRead(c, next));
  }, [id]);

  const watchCost = useCallback(() => {
    costWatch.current = { until: Date.now() + 60_000, spentAtStop: convRef.current?.spentUsd };
    costTries.current = 0;
  }, []);

  /**
   * The one reducer for turn, message.regenerate and generation.follow events. Returns true at `image_pending`:
   * the image brain's generation is over there (its prompt is saved, the conversation is free), so the caller
   * stops reading and the image is followed on its own (the watchers below).
   */
  const apply = useCallback(
    (ev: StreamYield): boolean => {
      switch (ev.type) {
        case "following":
          setNotice((n) => (n?.tone === "info" ? null : n)); // an earlier stop's note is old news once a new reply runs
          setLive({
            origin: "follow",
            kind: "turn",
            brainId: null,
            brainName: null,
            messageId: null,
            steer: null,
            thought: null,
            content: "",
            reasoning: "",
            phase: "waiting",
            error: null,
            retry: null,
            image: false,
          });
          break;
        case "message":
          flush();
          upsertMessage(ev.message);
          setPendingPlayer(null);
          // Your text comes first, then (T09) your roll: the tumbling die stays until the roll itself is in.
          if (ev.message.versions.some((v) => v.roll)) setPendingRoll(false);
          void refreshConversations();
          break;
        case "start":
          if (ev.imageOnly) break; // only an image is being made (no text streams): the watchers show it
          flush();
          setNotice((n) => (n?.tone === "info" ? null : n));
          setLive((l) => ({
            ...(l ?? { origin: "follow", content: "", reasoning: "", phase: "waiting", error: null, retry: null }),
            kind: ev.regenerate ? "regenerate" : "turn",
            steer: ev.steer ?? null,
            thought: ev.thought ?? null,
            brainId: ev.brainId,
            brainName: ev.brainName,
            messageId: ev.messageId,
            image: ev.kind === "image",
          }));
          break;
        case "reasoning":
          buf.current.reasoning += ev.delta;
          schedule();
          break;
        case "delta":
        case "prompt": // an image brain's prompt, as words: it streams in like a reply
          buf.current.content += ev.delta;
          schedule();
          break;
        case "image_pending":
          // The prompt is saved and the image is with Venice. The reply is over: the composer is free again.
          flush();
          upsertMessage(ev.message);
          setLive(null);
          void refreshConversations();
          return true;
        case "image_done":
        case "image_error":
          // Only reaches a live reply when no image was requested (a stopped or cut-off prompt): it's an error image.
          flush();
          upsertMessage(ev.message);
          break;
        case "brain_made":
          addMadeBrain(ev.brain);
          break;
        case "muse_note":
          // T17: a fresh take's note, saved right before the message being regenerated (and the Muse, if just added:
          // its button glows once, as a made brain's does).
          flush();
          if (ev.brainCreated) setFresh((f) => new Set(f).add(ev.brain.id));
          setConv((c) => {
            if (!c) return c;
            const known = c.brains.some((b) => b.id === ev.brain.id);
            const brains = known ? c.brains.map((b) => (b.id === ev.brain.id ? ev.brain : b)) : [...c.brains, ev.brain];
            const i = c.messages.findIndex((m) => m.id === ev.message.id);
            const at = c.messages.findIndex((m) => m.id === ev.before);
            const messages =
              i !== -1
                ? c.messages.map((m, j) => (j === i && newer(ev.message, m) ? ev.message : m))
                : at === -1
                  ? [...c.messages, ev.message]
                  : [...c.messages.slice(0, at), ev.message, ...c.messages.slice(at)];
            return { ...c, brains, messages };
          });
          break;
        case "done":
          flush();
          if (ev.message) saveReply(ev.message, ev.spentUsd);
          setLive(null);
          void refreshConversations();
          break;
      }
      return false;
    },
    [upsertMessage, saveReply, flush, schedule, addMadeBrain],
  );

  const fail = useCallback(
    (err: unknown) => {
      flush();
      setLive((l) => (l ? { ...l, phase: "failed", error: forBrowser(errorMessage(err)), retry: retryOf(err) } : l));
    },
    [flush],
  );

  /**
   * A stop that left no reply text ends the stream with error `stopped`: not a failure. Say what was kept,
   * calmly. (This tab's own stop() then repeats it with the billing note; a stop from the CLI shows just this.)
   */
  const stoppedEarly = useCallback(
    (err: unknown): boolean => {
      if (!(err instanceof ApiError && err.code === "stopped")) return false;
      flush();
      setLive(null);
      setPendingPlayer(null);
      setPendingRoll(false);
      setNotice((n) => (n?.note ? n : { tone: "info", message: forBrowser(err.message) }));
      watchCost();
      void refreshConversations();
      return true;
    },
    [flush, watchCost],
  );

  /** Re-attach to a running reply, if there is one. */
  const follow = useCallback(async () => {
    const signal = alive.current.signal;
    let running = false;
    try {
      for await (const ev of api.stream("generation.follow", { conversation: id }, { signal })) {
        if (ev.type === "following") running = true;
        if (ev.type === "done" && !running) {
          // Nothing running. If our copy ends with the player's message, the reply may have been saved between
          // our conversation.get and this call: fetch once more to be sure.
          const last = convRef.current?.messages.at(-1);
          if (last?.author.type === "player") {
            const read = await api.call("conversation.get", { id }, { signal });
            setConv((c) => mergeRead(c, read));
          }
          return;
        }
        if (apply(ev)) return; // an image brain's prompt is saved: its image is followed on its own
      }
    } catch (err) {
      if (isAbortError(err) || stoppedEarly(err)) return;
      if (running) fail(err);
      else setNotice({ tone: "error", message: errorMessage(err) });
    }
  }, [apply, fail, stoppedEarly, id]);

  // Load, then pick up a reply that is still being generated (a reload mid-stream lands here).
  useEffect(() => {
    const ac = new AbortController();
    alive.current = ac;
    (async () => {
      try {
        setConv(await api.call("conversation.get", { id }, { signal: ac.signal }));
        await follow();
      } catch (err) {
        if (!isAbortError(err)) setLoadError(err instanceof ApiError ? err : new ApiError(0, "internal", errorMessage(err)));
      }
    })();
    return () => {
      ac.abort();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [id, follow]);

  // Every pending image in our copy is followed to its end with image.follow, one watcher per message, whatever
  // made it pending: a turn or regenerate (their streams stop at image_pending), an edit, an add, a retry, a
  // reload mid-image, or the CLI. image.follow can't miss a result: with nothing being made it answers at once
  // with the message as saved. When a watcher ends, the next pass looks again (a new image may have started).
  const watching = useRef(new Map<string, AbortController>());
  const watchRetry = useRef(new Map<string, { tries: number; at: number }>());
  const [watchPass, setWatchPass] = useState(0);
  const watchImages = useCallback(
    async (messageId: string) => {
      if (watching.current.has(messageId)) return;
      const ac = new AbortController();
      const parent = alive.current.signal;
      const abort = () => ac.abort();
      parent.addEventListener("abort", abort);
      watching.current.set(messageId, ac);
      let retryIn: number | null = null;
      try {
        for await (const ev of api.stream("image.follow", { conversation: id, message: messageId }, { signal: ac.signal })) {
          if (ev.type === "done") {
            if (ev.message) saveReply(ev.message, ev.spentUsd, { known: true });
          } else if (ev.type === "image_pending" || ev.type === "image_done" || ev.type === "image_error") {
            upsertMessage(ev.message, { known: true });
          }
        }
        watchRetry.current.delete(messageId);
        void refreshConversations();
      } catch (err) {
        if (isAbortError(err)) return;
        if (err instanceof ApiError && err.code === "not_found") {
          void reload().catch(() => {}); // the message (or the conversation) is gone: show what is there now
        } else {
          const r = watchRetry.current.get(messageId) ?? { tries: 0, at: 0 };
          retryIn = WATCH_RETRY_MS[Math.min(r.tries, WATCH_RETRY_MS.length - 1)]!;
          watchRetry.current.set(messageId, { tries: r.tries + 1, at: Date.now() + retryIn });
        }
      } finally {
        parent.removeEventListener("abort", abort);
        watching.current.delete(messageId);
        if (!ac.signal.aborted) {
          if (retryIn === null) setWatchPass((n) => n + 1);
          else setTimeout(() => setWatchPass((n) => n + 1), retryIn);
        }
      }
    },
    [id, reload, saveReply, upsertMessage],
  );
  useEffect(() => {
    if (!conv) return;
    const now = Date.now();
    for (const m of conv.messages) {
      if (watching.current.size >= MAX_WATCHERS) break;
      if (!imagePending(m) || watching.current.has(m.id) || (watchRetry.current.get(m.id)?.at ?? 0) > now) continue;
      void watchImages(m.id);
    }
  }, [conv, watchPass, watchImages]);

  // Back to the tab: the CLI or another tab may have changed the conversation, or started a reply.
  useEffect(() => {
    let last = Date.now();
    const onFocus = async () => {
      if (document.visibilityState !== "visible" || busyRef.current || Date.now() - last < 2000) return;
      last = Date.now();
      try {
        await reload();
        await follow();
      } catch (err) {
        if (isAbortError(err)) return;
        if (err instanceof ApiError && err.code === "not_found") setLoadError(err);
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [reload, follow]);

  // A stopped reply's cost lands a little after the stop (the server's drain, from Venice's final chunk).
  // No event says so, so re-read the conversation a few times until it shows up.
  useEffect(() => {
    if (!conv || busy) return;
    const now = Date.now();
    const versionPending = conv.messages.some((m) =>
      m.versions.some((v) => v.stopped && v.costUsd === undefined && now - Date.parse(v.createdAt) < 120_000),
    );
    const w = costWatch.current;
    const totalPending = w !== null && now < w.until && conv.spentUsd === w.spentAtStop;
    if (!versionPending && !totalPending) {
      costWatch.current = null;
      costTries.current = 0;
      return;
    }
    const delay = COST_POLL_MS[costTries.current];
    if (delay === undefined) return;
    costTries.current += 1;
    const t = setTimeout(() => void reload().catch(() => {}), delay);
    return () => clearTimeout(t);
  }, [conv, busy, reload]);

  // T16: a brain was made, so its maker's counter moved: re-read once the reply (or the image prompt) is over.
  useEffect(() => {
    if (busy || !rereadAfter.current) return;
    rereadAfter.current = false;
    void reload().catch(() => {});
  }, [busy, conv, reload]);

  const send = useCallback(
    async (content: string, brainId?: string, opts?: { roll?: boolean }): Promise<Unsent | null> => {
      const roll = opts?.roll === true;
      const hasText = content.trim() !== "";
      const unsent = hasText || roll ? { text: hasText ? content : "", roll } : null;
      const c = convRef.current;
      if (!c || busyRef.current) return unsent;
      const target = c.brains.find((b) => b.id === (brainId ?? c.defaultBrainId)) ?? null;
      busyRef.current = true;
      setNotice(null);
      setPendingPlayer(hasText ? content : null);
      setPendingRoll(roll);
      setLive({
        origin: "turn",
        kind: "turn",
        brainId: target?.id ?? null,
        brainName: target?.name ?? null,
        messageId: null,
        steer: null,
        thought: null,
        content: "",
        reasoning: "",
        phase: "waiting",
        error: null,
        retry: null,
        image: target?.kind === "image",
      });
      let saved = false;
      let started = false;
      try {
        const args = { conversation: id, ...(hasText ? { content } : {}), ...(brainId ? { brain: brainId } : {}), ...(roll ? { roll: true } : {}) };
        for await (const ev of api.stream("turn", args, { signal: alive.current.signal })) {
          if (ev.type === "message") saved = true; // your text and your roll are saved together
          if (ev.type === "start") started = true;
          if (apply(ev)) break; // the prompt is saved: the image is followed on its own, and the table is free
        }
        return null;
      } catch (err) {
        if (isAbortError(err)) return null;
        const giveBack = saved ? null : unsent;
        if (stoppedEarly(err)) return giveBack; // stopped before Venice answered: nothing was saved, the roll included
        setPendingPlayer(null);
        if (started) {
          fail(err); // keep the partial text, with the error and a Retry
        } else {
          flush();
          setLive(null);
          setNotice({ tone: "error", message: errorMessage(err) });
          // Someone else (another tab, the CLI) is replying right now: show that reply as it streams.
          if (err instanceof ApiError && err.code === "conflict") void follow();
        }
        return giveBack;
      } finally {
        setPendingRoll(false);
      }
    },
    [apply, fail, flush, follow, stoppedEarly, id],
  );

  const regenerate = useCallback(
    async (messageId: string, ask: RegenerateAsk = {}): Promise<string | null> => {
      const c = convRef.current;
      if (!c || busyRef.current) return BUSY_LEDGER;
      const m = c.messages.find((x) => x.id === messageId);
      const brain = m?.author.type === "brain" ? (c.brains.find((b) => b.id === (m.author as { brainId: string }).brainId) ?? null) : null;
      // A fresh take's thought is sent exactly as typed (T15); a steer is trimmed, and blank is a plain re-roll.
      const thought = ask.thought ?? null;
      const trimmed = thought === null ? (ask.steer ?? "").trim() : "";
      busyRef.current = true;
      setNotice(null);
      // The message's slot shows the new version from the first moment (typing dots), not the bottom of the list.
      setLive({
        origin: "turn",
        kind: "regenerate",
        brainId: brain?.id ?? null,
        brainName: brain?.name ?? null,
        messageId,
        steer: trimmed || null,
        thought,
        content: "",
        reasoning: "",
        phase: "waiting",
        error: null,
        retry: null,
        image: m?.kind === "image",
      });
      let started = false;
      try {
        const args = { conversation: id, message: messageId, ...(trimmed ? { steer: trimmed } : {}), ...(thought !== null ? { thought } : {}) };
        for await (const ev of api.stream("message.regenerate", args, { signal: alive.current.signal })) {
          if (ev.type === "start") started = true;
          if (apply(ev)) break; // the new prompt is saved: its image is followed on its own
        }
        return null;
      } catch (err) {
        if (isAbortError(err) || stoppedEarly(err)) return null;
        if (started) {
          fail(err); // the partial version stays in the slot, dimmed, with the error and a Retry
          return null;
        }
        flush();
        setLive(null);
        if (err instanceof ApiError && err.code === "conflict") {
          void follow();
          return BUSY_LEDGER;
        }
        return errorMessage(err);
      }
    },
    [apply, fail, flush, follow, stoppedEarly, id],
  );

  const stop = useCallback(async () => {
    if (stopping) return;
    setStopping(true);
    try {
      const r = await api.call("generation.stop", { conversation: id });
      if (r.stopped) {
        // The stream this tab is reading delivers the saved message (or the `stopped` error) by itself.
        const head = r.message ? "Stopped. What had arrived is kept." : r.error ? forBrowser(r.error.message) : "Stopped.";
        setNotice({ tone: "info", message: head, ...(r.note ? { note: r.note } : {}) });
        if (r.made) addMadeBrain(r.made); // the stream says so too; whichever lands first
        watchCost();
      } else if (r.painting?.length) {
        // The prompt was already saved when the stop arrived: what is left is an image, which no stop touches.
        setNotice({ tone: "info", message: "Nothing to stop: the prompt is saved, and its image is being made.", note: IMAGE_STOP_NOTE });
      }
    } catch (err) {
      setNotice({ tone: "error", message: `Couldn't stop the reply. ${errorMessage(err)}` });
    } finally {
      setStopping(false);
    }
  }, [id, stopping, watchCost, addMadeBrain]);

  /** A ledger command's failure, in words for where it happened. A 409 also starts showing that reply. */
  const ledgerFailure = useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError && err.code === "image_busy") {
        void reload().catch(() => {}); // an image we didn't know was being made (the CLI, another tab): show it
        return IMAGE_BUSY;
      }
      if (err instanceof ApiError && err.code === "conflict") {
        void follow(); // a reply this tab didn't know about (the CLI, another tab): show it as it streams
        return BUSY_LEDGER;
      }
      if (err instanceof ApiError && err.code === "not_found") void reload().catch(() => {});
      return errorMessage(err);
    },
    [follow, reload],
  );

  const edit = useCallback(
    async (messageId: string, content: string) => {
      if (busyRef.current) return BUSY_LEDGER;
      const m = convRef.current?.messages.find((x) => x.id === messageId);
      if (m && imagePending(m, "active")) return IMAGE_BUSY;
      try {
        // An image message's new prompt answers at once with its image pending: the watchers follow it.
        upsertMessage((await api.call("message.edit", { conversation: id, message: messageId, content })).message);
        void refreshConversations();
        return null;
      } catch (err) {
        return ledgerFailure(err);
      }
    },
    [id, upsertMessage, ledgerFailure],
  );

  const remove = useCallback(
    async (messageId: string) => {
      if (busyRef.current) return BUSY_LEDGER;
      const m = convRef.current?.messages.find((x) => x.id === messageId);
      if (m && imagePending(m)) return IMAGE_BUSY;
      try {
        const r = await api.call("message.delete", { conversation: id, message: messageId });
        // T16: a brain made from it that never spoke went with it; every other pin of it went too.
        const gone = new Set((r.brainsDeleted ?? []).map((b) => b.brainId));
        setConv(
          (c) =>
            c && {
              ...c,
              messages: c.messages.filter((m) => m.id !== messageId),
              brains: c.brains
                .filter((b) => !gone.has(b.id))
                .map((b) =>
                  b.madeFrom === messageId || b.pins.some((p) => p.messageId === messageId)
                    ? { ...b, pins: b.pins.filter((p) => p.messageId !== messageId), madeFrom: b.madeFrom === messageId ? undefined : b.madeFrom }
                    : b,
                ),
            },
        );
        void reload().catch(() => {}); // the server pinned the running total; pick it up
        void refreshConversations();
        return null;
      } catch (err) {
        return ledgerFailure(err);
      }
    },
    [id, reload, ledgerFailure],
  );

  const selectVersion = useCallback(
    async (messageId: string, version: number) => {
      if (busyRef.current) return BUSY_LEDGER;
      try {
        upsertMessage((await api.call("message.select-version", { conversation: id, message: messageId, version })).message);
        return null;
      } catch (err) {
        return ledgerFailure(err);
      }
    },
    [id, upsertMessage, ledgerFailure],
  );

  const replaceBrain = useCallback(
    (brain: Brain) =>
      setConv((c) => {
        if (!c) return c;
        const known = c.brains.some((b) => b.id === brain.id);
        return { ...c, brains: known ? c.brains.map((b) => (b.id === brain.id ? brain : b)) : [...c.brains, brain] };
      }),
    [],
  );

  const pin = useCallback(
    async (messageId: string, brainId: string, as?: PinRole) => {
      try {
        replaceBrain((await api.call("brain.pin", { conversation: id, brain: brainId, message: messageId, ...(as ? { as } : {}) })).brain);
        return null;
      } catch (err) {
        return ledgerFailure(err);
      }
    },
    [id, replaceBrain, ledgerFailure],
  );

  const unpin = useCallback(
    async (messageId: string, brainId: string) => {
      try {
        replaceBrain((await api.call("brain.unpin", { conversation: id, brain: brainId, message: messageId })).brain);
        return null;
      } catch (err) {
        return ledgerFailure(err);
      }
    },
    [id, replaceBrain, ledgerFailure],
  );

  const make = useCallback(
    async (messageId: string, name?: string) => {
      try {
        const r = await api.call("brain.make", { conversation: id, message: messageId, ...(name ? { name } : {}) });
        addMadeBrain(r.brain);
        if (!busyRef.current) {
          rereadAfter.current = false;
          void reload().catch(() => {});
        }
        return null;
      } catch (err) {
        return ledgerFailure(err);
      }
    },
    [id, addMadeBrain, reload, ledgerFailure],
  );

  const setAuthor = useCallback(
    async (messageId: string, as: string) => {
      if (busyRef.current) return BUSY_LEDGER;
      try {
        upsertMessage((await api.call("message.set-author", { conversation: id, message: messageId, as })).message);
        return null;
      } catch (err) {
        return ledgerFailure(err);
      }
    },
    [id, upsertMessage, ledgerFailure],
  );

  const renameBrain = useCallback(
    async (brainId: string, name: string) => {
      try {
        replaceBrain(await api.call("brain.update", { conversation: id, brain: brainId, name }));
        return null;
      } catch (err) {
        return errorMessage(err);
      }
    },
    [id, replaceBrain],
  );

  const repaint = useCallback(
    async (messageId: string, opts?: { safeModeOff?: boolean }) => {
      const c = convRef.current;
      const m = c?.messages.find((x) => x.id === messageId);
      if (!c || !m) return "That message is gone.";
      if (imagePending(m, "active")) return IMAGE_BUSY;
      try {
        if (opts?.safeModeOff && m.author.type === "brain") {
          const brain = await api.call("brain.update", { conversation: id, brain: m.author.brainId, safeMode: false });
          setConv((x) => x && { ...x, brains: x.brains.map((b) => (b.id === brain.id ? brain : b)) });
        }
        for await (const ev of api.stream("image.retry", { conversation: id, message: messageId }, { signal: alive.current.signal })) {
          if (ev.type === "image_pending") {
            upsertMessage(ev.message); // pending (in place, or as a new version): the watchers follow it from here
            break;
          }
          if (ev.type === "done" && ev.message) saveReply(ev.message, ev.spentUsd);
        }
        void refreshConversations();
        return null;
      } catch (err) {
        if (isAbortError(err)) return null;
        return ledgerFailure(err);
      }
    },
    [id, upsertMessage, saveReply, ledgerFailure],
  );

  const actions = useMemo<MessageActions>(
    () => ({ edit, remove, selectVersion, regenerate, repaint, pin, unpin, make, setAuthor, renameBrain }),
    [edit, remove, selectVersion, regenerate, repaint, pin, unpin, make, setAuthor, renameBrain],
  );

  const retry = useCallback(async () => {
    const l = liveRef.current;
    if (!l || l.phase !== "failed") return;
    const r = l.retry;
    if (r?.command === "message.regenerate") {
      const problem = await regenerate(r.args.message, r.args.thought !== undefined ? { thought: r.args.thought } : { steer: r.args.steer ?? "" });
      if (problem) setNotice({ tone: "error", message: problem });
      return;
    }
    if (r?.command === "image.retry") {
      setLive(null);
      const problem = await repaint(r.args.message);
      if (problem) setNotice({ tone: "error", message: problem });
      return;
    }
    // A turn: the brain the server names, else the one this reply was from. Never a bare turn (the default brain).
    await send("", r?.command === "turn" ? r.args.brain : (l.brainId ?? undefined));
  }, [regenerate, repaint, send]);

  const add = useCallback(
    async (as: string, content: string) => {
      if (busyRef.current) return BUSY_LEDGER;
      try {
        const r = await api.call("message.add", { conversation: id, as, content });
        upsertMessage(r.message);
        if (r.made) addMadeBrain(r.made); // T16: words in a maker's mouth make a brain too
        setNotice(null);
        void refreshConversations();
        return null;
      } catch (err) {
        return ledgerFailure(err);
      }
    },
    [id, upsertMessage, ledgerFailure, addMadeBrain],
  );

  const roll = useCallback(async () => {
    if (busyRef.current) return BUSY_LEDGER;
    setPendingRoll(true); // brings the scrollback to the bottom, where the roll lands
    try {
      upsertMessage((await api.call("message.roll", { conversation: id })).message);
      setNotice(null);
      void refreshConversations();
      return null;
    } catch (err) {
      return ledgerFailure(err);
    } finally {
      setPendingRoll(false);
    }
  }, [id, upsertMessage, ledgerFailure]);

  return {
    conv,
    loadError,
    pendingPlayer,
    pendingRoll,
    live,
    busy,
    stopping,
    fresh,
    notice,
    send,
    stop,
    retry,
    add,
    roll,
    actions,
    dismissLive: useCallback(() => setLive((l) => (l?.phase === "failed" ? null : l)), []),
    dismissNotice: useCallback(() => setNotice(null), []),
    replaceConversation: useCallback((next: Conversation) => setConv(next), []),
    replaceBrain,
    patch: useCallback((fn: (c: Conversation) => Conversation) => setConv((c) => c && fn(c)), []),
  };
}
