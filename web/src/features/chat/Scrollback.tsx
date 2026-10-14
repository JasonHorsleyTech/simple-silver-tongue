import { ArrowDown, ArrowUp, ImageIcon, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Conversation } from "../../api/types.ts";
import { ScrollPin, type ScrollPinApi } from "../../lib/scrollPin.ts";
import { expectedAspect, GalleryContext, type GalleryItem } from "./ImageCard.tsx";
import { LiveReply } from "./LiveReply.tsx";
import { MessageItem } from "./MessageItem.tsx";
import { PlayerBubble } from "./MessageFrame.tsx";
import { MessageText } from "./MessageText.tsx";
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
  /** A jump to a landed picture is under way: scroll events don't re-pin to the bottom meanwhile. */
  const jumping = useRef(false);
  const [away, setAway] = useState(false);
  const brains = new Map(conv.brains.map((b) => [b.id, b]));
  const { live, pendingPlayer } = chat;
  // A new object only when the size settings change, so the memo'd messages don't all re-render.
  const { width, height, aspectRatio, resolution } = conv.settings.image;
  const aspect = useMemo(() => expectedAspect({ width, height, aspectRatio, resolution }), [width, height, aspectRatio, resolution]);
  const gallery = useMemo(() => galleryOf(conv), [conv]);
  /** T07: an image that landed while its card was out of view, until you look at it. */
  const [landed, setLanded] = useState<{ messageId: string; brainName: string; failed: boolean; above: boolean } | null>(null);
  const imageStates = useRef<Map<string, string> | null>(null);

  // Notice a picture finishing (or failing) out of sight: painting goes on while you play, so its card is often
  // far up the scrollback by the time it lands.
  useEffect(() => {
    const now = new Map<string, string>();
    for (const m of conv.messages) {
      const img = m.kind === "image" ? m.versions[m.activeVersion]?.image : undefined;
      if (img) now.set(m.id, `${img.id}:${img.status}`);
    }
    const before = imageStates.current;
    imageStates.current = now;
    if (!before) return; // the first load: nothing just landed
    for (const [id, state] of now) {
      const was = before.get(id);
      const at = whereIs(box.current, id);
      if (!was || !was.endsWith(":pending") || state.endsWith(":pending") || at === "in view") continue;
      const m = conv.messages.find((x) => x.id === id)!;
      const b = m.author.type === "brain" ? brains.get(m.author.brainId) : undefined;
      setLanded({ messageId: id, brainName: b?.name ?? "The image brain", failed: !state.endsWith(":done"), above: at === "above" });
    }
  }, [conv.messages]); // brains only names the brain: a rename alone needn't re-run this

  const showLanded = useCallback(() => {
    const el = box.current;
    const card = landed && document.getElementById(landed.messageId);
    setLanded(null);
    if (!el || !card) return;
    // Unpin, and stay unpinned while the smooth scroll runs: its first steps are still "at the bottom", and
    // re-pinning there would snap back. The box itself scrolls, not the page (scrollIntoView would move both).
    stuck.current = false;
    jumping.current = true;
    const done = () => {
      el.removeEventListener("scrollend", done);
      if (!jumping.current) return;
      jumping.current = false;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
      stuck.current = atBottom;
      setAway(!atBottom);
    };
    el.addEventListener("scrollend", done);
    setTimeout(done, 1500); // in case no scrollend comes (already there)
    setAway(true);
    const b = el.getBoundingClientRect();
    const r = card.getBoundingClientRect();
    el.scrollTo({ top: el.scrollTop + r.top - b.top - Math.max(16, (el.clientHeight - r.height) / 2), behavior: "smooth" });
  }, [landed]);

  // T08: a hidden note opening in place keeps its top where it is, instead of the pin scrolling it away, and
  // shows as much of itself as fits.
  const pin = useMemo<ScrollPinApi>(
    () => ({
      opening(target) {
        stuck.current = false;
        requestAnimationFrame(() => {
          const el = box.current;
          if (!el) return;
          const b = el.getBoundingClientRect();
          const r = target.getBoundingClientRect();
          const by = Math.min(r.bottom - b.bottom + 16, r.top - b.top - 16);
          if (by > 0) el.scrollTo({ top: el.scrollTop + by, behavior: "smooth" });
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
          stuck.current = atBottom;
          setAway(!atBottom);
        });
      },
      folded(target) {
        const el = box.current;
        if (!el) return;
        const b = el.getBoundingClientRect();
        const r = target.getBoundingClientRect();
        if (r.top < b.top) el.scrollTo({ top: el.scrollTop + r.top - b.top - 16 });
      },
    }),
    [],
  );

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
    if (jumping.current) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    stuck.current = atBottom;
    setAway(!atBottom);
    if (landed) {
      const at = whereIs(el, landed.messageId);
      if (at === "in view") setLanded(null);
      else if (landed.above !== (at === "above")) setLanded({ ...landed, above: at === "above" });
    }
  };

  const nothing = conv.messages.length === 0 && pendingPlayer === null && !live;
  const last = conv.messages.at(-1);
  // A regenerate streams in its message's slot (also when re-attached by generation.follow, once `start` says
  // which message). Anything else, or a regenerate of a message we don't have, goes at the bottom.
  const inSlot = live?.kind === "regenerate" && live.messageId && conv.messages.some((m) => m.id === live.messageId) ? live.messageId : null;
  const atBottom = live && !inSlot ? live : null;
  const canRegenerate = !!last && last.author.type === "brain" && !atBottom && pendingPlayer === null;

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={box} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 sm:px-6">
          {nothing ? (
            empty
          ) : (
            <GalleryContext value={gallery}>
              <ScrollPin value={pin}>
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
                        aspect={aspect}
                        onPreviewRegenerate={onPreviewRegenerate}
                        onDismissLive={chat.dismissLive}
                      />
                    </li>
                  ))}
                  {pendingPlayer !== null && (
                    <li>
                      <PlayerBubble pending>
                        <MessageText text={pendingPlayer} />
                      </PlayerBubble>
                    </li>
                  )}
                  {atBottom && (
                    <li>
                      <LiveReply
                        live={atBottom}
                        brain={atBottom.brainId ? brains.get(atBottom.brainId) : undefined}
                        aspect={aspect}
                        onRetry={onRetry}
                        onDismiss={chat.dismissLive}
                      />
                    </li>
                  )}
                </ol>
              </ScrollPin>
            </GalleryContext>
          )}
        </div>
      </div>
      {/* Just right of the text column when there is room (centered, it sat on image captions). */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto flex w-full max-w-[54rem] items-end justify-end gap-2 px-4">
        {landed && (
          <div
            role="status"
            className="pointer-events-auto mr-auto ml-auto inline-flex items-center gap-0.5 rounded-full border border-line-strong bg-raised/95 py-0.5 pr-0.5 pl-1 text-[12.5px] shadow-lg shadow-black/40 backdrop-blur"
          >
            <button
              type="button"
              onClick={showLanded}
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-muted transition-colors hover:text-fg"
            >
              <ImageIcon aria-hidden className={landed.failed ? "size-3.5 text-red-300" : "size-3.5"} />
              {landed.failed ? `${landed.brainName}'s picture couldn't be made` : `${landed.brainName}'s picture is ready`}
              {landed.above ? <ArrowUp aria-hidden className="size-3.5" /> : <ArrowDown aria-hidden className="size-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setLanded(null)}
              aria-label="Dismiss"
              className="grid size-6 place-items-center rounded-full text-faint transition-colors hover:bg-hover hover:text-fg"
            >
              <X aria-hidden className="size-3" />
            </button>
          </div>
        )}
        {away && (
          <button
            type="button"
            onClick={() => toBottom(true)}
            aria-label="Latest"
            title="Jump to the latest"
            className="pointer-events-auto grid size-9 shrink-0 place-items-center rounded-full border border-line-strong bg-raised/95 text-muted shadow-lg shadow-black/40 backdrop-blur transition-colors hover:text-fg"
          >
            <ArrowDown aria-hidden className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Where a message is, seen from the scroll box: at least partly on screen, or above or below it. */
function whereIs(box: HTMLElement | null, id: string): "in view" | "above" | "below" {
  const el = document.getElementById(id);
  if (!box || !el) return "in view"; // nothing to point at
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return r.bottom <= b.top + 40 ? "above" : r.top >= b.bottom - 40 ? "below" : "in view";
}

/** Every finished picture in ledger order (each image message's active version), for the large view's ← →. */
function galleryOf(conv: Conversation): GalleryItem[] {
  const brains = new Map(conv.brains.map((b) => [b.id, b]));
  const items: GalleryItem[] = [];
  for (const m of conv.messages) {
    const v = m.kind === "image" ? m.versions[m.activeVersion] : undefined;
    if (!v?.image || v.image.status !== "done") continue;
    items.push({
      image: v.image,
      prompt: v.content,
      brain: m.author.type === "brain" ? brains.get(m.author.brainId) : undefined,
      label: m.versions.length > 1 ? `version ${m.activeVersion + 1} of ${m.versions.length}` : undefined,
    });
  }
  return items;
}
