import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client.ts";
import { ApiError, errorMessage, isAbortError, retryOf } from "../../api/errors.ts";
import type { Brain, Conversation, LedgerMessage, RetryRequest, StreamYield } from "../../api/types.ts";
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
  content: string;
  reasoning: string;
  phase: "waiting" | "reasoning" | "writing" | "failed";
  error: string | null;
  /**
   * A failed reply: the exact request that retries it, from the server's error (`details.retry`): the same
   * brain for a turn, the same message and steer for a regenerate. Null when the server sent none.
   */
  retry: RetryRequest | null;
};

/** A line above the composer: an up-front send failure (error), or what a stop did and didn't save (info). */
export type ChatNotice = { tone: "error" | "info"; message: string; note?: string };

/** Ledger commands resolve to null when done, or to a message to show where the action was taken. */
export type MessageActions = {
  edit(messageId: string, content: string): Promise<string | null>;
  remove(messageId: string): Promise<string | null>;
  /** `version` is 1-based, as the pager shows it. */
  selectVersion(messageId: string, version: number): Promise<string | null>;
  /** A new version of the last message, streaming in its place. Resolves to an up-front failure's message. */
  regenerate(messageId: string, steer: string): Promise<string | null>;
};

export type Chat = {
  conv: Conversation | null;
  loadError: ApiError | null;
  /** The player's text while `turn` waits for Venice to accept it (it is saved only then). */
  pendingPlayer: string | null;
  live: LiveReply | null;
  /** True while a reply is streaming (in this tab or followed). */
  busy: boolean;
  /** True while generation.stop is on its way. */
  stopping: boolean;
  notice: ChatNotice | null;
  /**
   * Send a message (empty = the brain just responds). Resolves to the text to put back in the composer
   * when the message was not saved (the send failed up front, or was stopped before Venice answered), else null.
   */
  send(content: string, brainId?: string): Promise<string | null>;
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

const EMPTY_BUF = { content: "", reasoning: "" };

/** After a stop, Venice's bill arrives later (the server's drain). Re-read the conversation on this schedule. */
const COST_POLL_MS = [1500, 2500, 4000, 6000, 9000, 14000, 20000];

export function useChat(id: string): Chat {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [pendingPlayer, setPendingPlayer] = useState<string | null>(null);
  const [live, setLive] = useState<LiveReply | null>(null);
  const [notice, setNotice] = useState<ChatNotice | null>(null);
  const [stopping, setStopping] = useState(false);

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

  /** Add a saved message, or replace it by id (a regenerate, an edit or a version switch returns an existing one). */
  const upsertMessage = useCallback((m: LedgerMessage) => {
    setConv((c) => {
      if (!c) return c;
      const i = c.messages.findIndex((x) => x.id === m.id);
      const messages = i === -1 ? [...c.messages, m] : c.messages.map((x, j) => (j === i ? m : x));
      return { ...c, messages, updatedAt: m.updatedAt };
    });
  }, []);

  /**
   * A generated reply was saved (a turn's new message, or a regenerate's new version): put it in, with the
   * running total the server sends along in `done`, so the header is right without a re-read. A stopped
   * reply has no cost yet; the re-reads after a stop pick it up.
   */
  const saveReply = useCallback(
    (m: LedgerMessage, spentUsd: number | undefined) => {
      upsertMessage(m);
      if (spentUsd !== undefined) setConv((c) => c && { ...c, spentUsd });
    },
    [upsertMessage],
  );

  /** Re-read the whole conversation, unless a reply started meanwhile (its events are then the fresher truth). */
  const reload = useCallback(async () => {
    const next = await api.call("conversation.get", { id }, { signal: alive.current.signal });
    if (!busyRef.current) setConv(next);
  }, [id]);

  const watchCost = useCallback(() => {
    costWatch.current = { until: Date.now() + 60_000, spentAtStop: convRef.current?.spentUsd };
    costTries.current = 0;
  }, []);

  /** The one reducer for turn, message.regenerate and generation.follow events. */
  const apply = useCallback(
    (ev: StreamYield) => {
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
            content: "",
            reasoning: "",
            phase: "waiting",
            error: null,
            retry: null,
          });
          break;
        case "message":
          flush();
          upsertMessage(ev.message);
          setPendingPlayer(null);
          void refreshConversations();
          break;
        case "start":
          flush();
          setNotice((n) => (n?.tone === "info" ? null : n));
          setLive((l) => ({
            ...(l ?? { origin: "follow", content: "", reasoning: "", phase: "waiting", error: null, retry: null }),
            kind: ev.regenerate ? "regenerate" : "turn",
            steer: ev.steer ?? null,
            brainId: ev.brainId,
            brainName: ev.brainName,
            messageId: ev.messageId,
          }));
          break;
        case "reasoning":
          buf.current.reasoning += ev.delta;
          schedule();
          break;
        case "delta":
          buf.current.content += ev.delta;
          schedule();
          break;
        case "done":
          flush();
          if (ev.message) saveReply(ev.message, ev.spentUsd);
          setLive(null);
          void refreshConversations();
          break;
        default:
          break; // prompt and image events: image brains (T05), not shown yet
      }
    },
    [upsertMessage, saveReply, flush, schedule],
  );

  const fail = useCallback(
    (err: unknown) => {
      flush();
      setLive((l) => (l ? { ...l, phase: "failed", error: errorMessage(err), retry: retryOf(err) } : l));
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
      setNotice((n) => (n?.note ? n : { tone: "info", message: err.message }));
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
          if (last?.author.type === "player") setConv(await api.call("conversation.get", { id }, { signal }));
          return;
        }
        apply(ev);
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

  const send = useCallback(
    async (content: string, brainId?: string): Promise<string | null> => {
      const c = convRef.current;
      if (!c || busyRef.current) return content;
      const hasText = content.trim() !== "";
      const target = c.brains.find((b) => b.id === (brainId ?? c.defaultBrainId)) ?? null;
      busyRef.current = true;
      setNotice(null);
      setPendingPlayer(hasText ? content : null);
      setLive({
        origin: "turn",
        kind: "turn",
        brainId: target?.id ?? null,
        brainName: target?.name ?? null,
        messageId: null,
        steer: null,
        content: "",
        reasoning: "",
        phase: "waiting",
        error: null,
        retry: null,
      });
      let saved = false;
      let started = false;
      try {
        const args = { conversation: id, ...(hasText ? { content } : {}), ...(brainId ? { brain: brainId } : {}) };
        for await (const ev of api.stream("turn", args, { signal: alive.current.signal })) {
          if (ev.type === "message") saved = true;
          if (ev.type === "start") started = true;
          apply(ev);
        }
        return null;
      } catch (err) {
        if (isAbortError(err)) return null;
        const giveBack = saved || !hasText ? null : content;
        if (stoppedEarly(err)) return giveBack; // stopped before Venice answered: the message wasn't saved
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
      }
    },
    [apply, fail, flush, follow, stoppedEarly, id],
  );

  const regenerate = useCallback(
    async (messageId: string, steer: string): Promise<string | null> => {
      const c = convRef.current;
      if (!c || busyRef.current) return BUSY_LEDGER;
      const m = c.messages.find((x) => x.id === messageId);
      const brain = m?.author.type === "brain" ? (c.brains.find((b) => b.id === (m.author as { brainId: string }).brainId) ?? null) : null;
      const trimmed = steer.trim();
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
        content: "",
        reasoning: "",
        phase: "waiting",
        error: null,
        retry: null,
      });
      let started = false;
      try {
        const args = { conversation: id, message: messageId, ...(trimmed ? { steer: trimmed } : {}) };
        for await (const ev of api.stream("message.regenerate", args, { signal: alive.current.signal })) {
          if (ev.type === "start") started = true;
          apply(ev);
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
        const head = r.message ? "Stopped. What had arrived is kept." : (r.error?.message ?? "Stopped.");
        setNotice({ tone: "info", message: head, ...(r.note ? { note: r.note } : {}) });
        watchCost();
      }
    } catch (err) {
      setNotice({ tone: "error", message: `Couldn't stop the reply. ${errorMessage(err)}` });
    } finally {
      setStopping(false);
    }
  }, [id, stopping, watchCost]);

  /** A ledger command's failure, in words for where it happened. A 409 also starts showing that reply. */
  const ledgerFailure = useCallback(
    (err: unknown): string => {
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
      try {
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
      try {
        await api.call("message.delete", { conversation: id, message: messageId });
        setConv((c) => c && { ...c, messages: c.messages.filter((m) => m.id !== messageId) });
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

  const actions = useMemo<MessageActions>(() => ({ edit, remove, selectVersion, regenerate }), [edit, remove, selectVersion, regenerate]);

  const retry = useCallback(async () => {
    const l = liveRef.current;
    if (!l || l.phase !== "failed") return;
    const r = l.retry;
    if (r?.command === "message.regenerate") {
      const problem = await regenerate(r.args.message, r.args.steer ?? "");
      if (problem) setNotice({ tone: "error", message: problem });
      return;
    }
    // A turn: the brain the server names, else the one this reply was from. Never a bare turn (the default brain).
    await send("", r?.command === "turn" ? r.args.brain : (l.brainId ?? undefined));
  }, [regenerate, send]);

  const add = useCallback(
    async (as: string, content: string) => {
      if (busyRef.current) return BUSY_LEDGER;
      try {
        upsertMessage((await api.call("message.add", { conversation: id, as, content })).message);
        setNotice(null);
        void refreshConversations();
        return null;
      } catch (err) {
        return ledgerFailure(err);
      }
    },
    [id, upsertMessage, ledgerFailure],
  );

  return {
    conv,
    loadError,
    pendingPlayer,
    live,
    busy,
    stopping,
    notice,
    send,
    stop,
    retry,
    add,
    actions,
    dismissLive: useCallback(() => setLive((l) => (l?.phase === "failed" ? null : l)), []),
    dismissNotice: useCallback(() => setNotice(null), []),
    replaceConversation: useCallback((next: Conversation) => setConv(next), []),
    replaceBrain: useCallback(
      (brain: Brain) =>
        setConv((c) => {
          if (!c) return c;
          const known = c.brains.some((b) => b.id === brain.id);
          return { ...c, brains: known ? c.brains.map((b) => (b.id === brain.id ? brain : b)) : [...c.brains, brain] };
        }),
      [],
    ),
    patch: useCallback((fn: (c: Conversation) => Conversation) => setConv((c) => c && fn(c)), []),
  };
}
