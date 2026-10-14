import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client.ts";
import { ApiError, errorMessage, isAbortError } from "../../api/errors.ts";
import type { Brain, Conversation, LedgerMessage, StreamYield } from "../../api/types.ts";
import { refreshConversations } from "../conversations/store.ts";

/**
 * One conversation's state in the browser: the ledger as the server saved it, plus at most one live reply
 * (streaming in, or failed with its partial text). The server is the truth: this only mirrors
 * conversation.get and the stream events of `turn` and `generation.follow`, which share one reducer.
 *
 * Leaving the view (or reloading) stops *reading*, never the reply: the server finishes and saves it.
 * Coming back calls generation.follow, which replays what has streamed so far and then streams the rest.
 *
 * T03 (regenerate, edit, delete, versions) and T04 (send to any brain) plug in here: a generating command
 * is one more `run(api.stream(...))`, and an edit is one more `replaceConversation(result)`.
 */

export type LiveReply = {
  /** "turn": this tab sent it. "follow": re-attached to a reply that was already running. */
  origin: "turn" | "follow";
  brainId: string | null;
  brainName: string | null;
  /** The id the saved message will have, once the brain has started. */
  messageId: string | null;
  content: string;
  reasoning: string;
  phase: "waiting" | "reasoning" | "writing" | "failed";
  error: string | null;
};

export type Chat = {
  conv: Conversation | null;
  loadError: ApiError | null;
  /** The player's text while `turn` waits for Venice to accept it (it is saved only then). */
  pendingPlayer: string | null;
  live: LiveReply | null;
  /** True while a reply is streaming (in this tab or followed). */
  busy: boolean;
  /** An error from a send that failed before any reply started (409, 400 nothing_to_answer, 502, ...). */
  sendError: string | null;
  /**
   * Send a message (empty = the brain just responds). Resolves to the text to put back in the composer
   * when the message was not saved (the send failed up front), else null.
   */
  send(content: string, brainId?: string): Promise<string | null>;
  dismissLive(): void;
  dismissSendError(): void;
  /** After a command that returns the whole document (conversation.update). */
  replaceConversation(conv: Conversation): void;
  /** After brain.update, which returns the brain. */
  replaceBrain(brain: Brain): void;
};

const EMPTY_BUF = { content: "", reasoning: "" };

export function useChat(id: string): Chat {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [pendingPlayer, setPendingPlayer] = useState<string | null>(null);
  const [live, setLive] = useState<LiveReply | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const convRef = useRef<Conversation | null>(null);
  convRef.current = conv;
  const busy = live !== null && live.phase !== "failed";
  const busyRef = useRef(false);
  busyRef.current = busy;
  /** Aborted when the view unmounts: stops reading streams (the server carries on). */
  const alive = useRef<AbortController>(new AbortController());

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

  /** Add a saved message, or replace it by id (T03's regenerate returns an existing message with a new version). */
  const upsertMessage = useCallback((m: LedgerMessage) => {
    setConv((c) => {
      if (!c) return c;
      const i = c.messages.findIndex((x) => x.id === m.id);
      const messages = i === -1 ? [...c.messages, m] : c.messages.map((x, j) => (j === i ? m : x));
      return { ...c, messages, updatedAt: m.updatedAt };
    });
  }, []);

  /** The one reducer for turn and generation.follow events. */
  const apply = useCallback(
    (ev: StreamYield) => {
      switch (ev.type) {
        case "following":
          setLive({ origin: "follow", brainId: null, brainName: null, messageId: null, content: "", reasoning: "", phase: "waiting", error: null });
          break;
        case "message":
          flush();
          upsertMessage(ev.message);
          setPendingPlayer(null);
          void refreshConversations();
          break;
        case "start":
          flush();
          setLive((l) => ({
            ...(l ?? { origin: "follow", content: "", reasoning: "", phase: "waiting", error: null }),
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
          if (ev.message) upsertMessage(ev.message);
          setLive(null);
          void refreshConversations();
          break;
        default:
          break; // tool_args and image events arrive with image brains (T05)
      }
    },
    [upsertMessage, flush, schedule],
  );

  const fail = useCallback(
    (err: unknown) => {
      flush();
      setLive((l) => (l ? { ...l, phase: "failed", error: errorMessage(err) } : l));
    },
    [flush],
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
      if (isAbortError(err)) return;
      if (running) fail(err);
      else setSendError(errorMessage(err));
    }
  }, [apply, fail, id]);

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
        setConv(await api.call("conversation.get", { id }, { signal: alive.current.signal }));
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
  }, [id, follow]);

  const send = useCallback(
    async (content: string, brainId?: string): Promise<string | null> => {
      const c = convRef.current;
      if (!c || busyRef.current) return content;
      const hasText = content.trim() !== "";
      const target = c.brains.find((b) => b.id === (brainId ?? c.defaultBrainId)) ?? null;
      busyRef.current = true;
      setSendError(null);
      setPendingPlayer(hasText ? content : null);
      setLive({
        origin: "turn",
        brainId: target?.id ?? null,
        brainName: target?.name ?? null,
        messageId: null,
        content: "",
        reasoning: "",
        phase: "waiting",
        error: null,
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
        setPendingPlayer(null);
        if (started) {
          fail(err); // keep the partial text, with the error and a Retry
        } else {
          flush();
          setLive(null);
          setSendError(errorMessage(err));
          // Someone else (another tab, the CLI) is replying right now: show that reply as it streams.
          if (err instanceof ApiError && err.code === "conflict") void follow();
        }
        return saved || !hasText ? null : content;
      }
    },
    [apply, fail, flush, follow, id],
  );

  return {
    conv,
    loadError,
    pendingPlayer,
    live,
    busy,
    sendError,
    send,
    dismissLive: useCallback(() => setLive((l) => (l?.phase === "failed" ? null : l)), []),
    dismissSendError: useCallback(() => setSendError(null), []),
    replaceConversation: useCallback((next: Conversation) => setConv(next), []),
    replaceBrain: useCallback(
      (brain: Brain) => setConv((c) => c && { ...c, brains: c.brains.map((b) => (b.id === brain.id ? brain : b)) }),
      [],
    ),
  };
}
