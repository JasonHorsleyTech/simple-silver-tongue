import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Conversation } from "../../api/types.ts";
import { Markdown } from "../../components/Markdown.tsx";
import { LiveReply } from "./LiveReply.tsx";
import { MessageItem } from "./MessageItem.tsx";
import { PlayerBubble } from "./MessageFrame.tsx";
import type { Chat } from "./useChat.ts";

/** Within this many pixels of the bottom counts as "at the bottom": new text keeps it pinned there. */
const STICK_PX = 96;

/**
 * The ledger, top to bottom, then the optimistic player message and the live reply. A regenerate's live reply
 * goes in the slot of the message it rewrites instead. It follows the stream while you are at the bottom,
 * and leaves you alone once you scroll up (a "Latest" button brings you back).
 */
export function Scrollback({
  conv,
  chat,
  onRetry,
  onPreviewRegenerate,
  empty,
}: {
  conv: Conversation;
  chat: Chat;
  onRetry(): void;
  onPreviewRegenerate(messageId: string, steer: string): void;
  empty: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [away, setAway] = useState(false);
  const brains = new Map(conv.brains.map((b) => [b.id, b]));
  const { live, pendingPlayer } = chat;

  const toBottom = useCallback((smooth = false) => {
    const el = box.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "instant" });
    stuck.current = true;
    setAway(false);
  }, []);

  // Sending always brings you to the bottom.
  useLayoutEffect(() => {
    if (pendingPlayer !== null || live?.origin === "turn") toBottom();
  }, [pendingPlayer, live?.origin, toBottom]);

  // New text while pinned: stay pinned. Runs after every render that changes what is shown.
  useLayoutEffect(() => {
    if (stuck.current) box.current?.scrollTo({ top: box.current.scrollHeight });
  });

  // Content can also grow without a render of ours (a code block's font loading, the window narrowing).
  useEffect(() => {
    const el = box.current;
    const inner = el?.firstElementChild;
    if (!el || !inner) return;
    const ro = new ResizeObserver(() => stuck.current && el.scrollTo({ top: el.scrollHeight }));
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    stuck.current = atBottom;
    setAway(!atBottom);
  };

  const nothing = conv.messages.length === 0 && pendingPlayer === null && !live;
  const last = conv.messages.at(-1);
  // A regenerate streams in its message's slot (also when re-attached by generation.follow, once `start` says
  // which message). Anything else, or a regenerate of a message we don't have, goes at the bottom.
  const inSlot = live?.kind === "regenerate" && live.messageId && conv.messages.some((m) => m.id === live.messageId) ? live.messageId : null;
  const atBottom = live && !inSlot ? live : null;
  const canRegenerate = !!last && last.author.type === "brain" && last.kind === "text" && !atBottom && pendingPlayer === null;

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={box} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 sm:px-6">
          {nothing ? (
            empty
          ) : (
            <ol className="space-y-7">
              {conv.messages.map((m) => (
                <li key={m.id} id={m.id}>
                  <MessageItem
                    message={m}
                    brain={m.author.type === "brain" ? brains.get(m.author.brainId) : undefined}
                    isLast={m === last && !atBottom && pendingPlayer === null}
                    canRegenerate={m === last && canRegenerate}
                    live={m.id === inSlot ? live! : undefined}
                    busy={chat.busy}
                    actions={chat.actions}
                    onPreviewRegenerate={onPreviewRegenerate}
                    onDismissLive={chat.dismissLive}
                  />
                </li>
              ))}
              {pendingPlayer !== null && (
                <li>
                  <PlayerBubble pending>
                    <Markdown text={pendingPlayer} />
                  </PlayerBubble>
                </li>
              )}
              {atBottom && (
                <li>
                  <LiveReply
                    live={atBottom}
                    brain={atBottom.brainId ? brains.get(atBottom.brainId) : undefined}
                    onRetry={onRetry}
                    onDismiss={chat.dismissLive}
                  />
                </li>
              )}
            </ol>
          )}
        </div>
      </div>
      {away && (
        <button
          type="button"
          onClick={() => toBottom(true)}
          className="absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line-strong bg-raised/95 px-3 py-1.5 text-[12.5px] text-muted shadow-lg shadow-black/40 backdrop-blur transition-colors hover:text-fg"
        >
          <ArrowDown aria-hidden className="size-3.5" /> Latest
        </button>
      )}
    </div>
  );
}
