import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, ImageIcon, ScrollText, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { isCompaction, isMuse, type Brain, type Conversation, type PinRole } from "../../api/types.ts";
import { madeFromIndex, pinsByMessage } from "../../lib/cast.ts";
import { cutView, storyCount } from "../../lib/compaction.ts";
import { cx } from "../../lib/cx.ts";
import { freshTakeTarget, thoughtBesideImage } from "../../lib/thought.ts";
import { GalleryContext, type GalleryItem } from "./ImageCard.tsx";
import { LiveReply } from "./LiveReply.tsx";
import type { CloneSource } from "./CloneMenu.tsx";
import { MessageItem } from "./MessageItem.tsx";
import { PlayerBubble } from "./MessageFrame.tsx";
import { MessageText } from "./MessageText.tsx";
import { PendingRoll } from "./RollCard.tsx";
import type { Chat, RegenerateAsk } from "./useChat.ts";

/** More than this many pixels below the view (the column's own bottom padding is 40) brings up "Latest". */
const AWAY_PX = 64;
/** How long after opening a conversation it is kept at its end while things settle, unless you act first. */
const SETTLE_MS = 1500;

/** T20: unfold the messages above the newest compaction if `messageId` is one of them (a pin's "Jump to it"), so it can be scrolled to. */
export function revealMessage(messageId: string) {
  window.dispatchEvent(new CustomEvent<string>(REVEAL_EVENT, { detail: messageId }));
}
const REVEAL_EVENT = "sst:reveal-message";

/**
 * The ledger, top to bottom, then the optimistic player message, a roll on its way (T09) and the live reply. A regenerate's live reply
 * goes in the slot of the message it rewrites instead. It opens at the end, and from then on scrolls the browser's
 * way: new text comes in below without moving the view ("Latest" appears when there is more below), and only you,
 * "Latest" and the picture-is-ready pill scroll it.
 *
 * T20, compaction: the messages above the newest compaction are left out of every request, so they fold under one band
 * ("12 earlier messages, left out of every request"), still there to open, read and edit; the compaction has a look of
 * its own (MessageFrame's `compaction`). A compaction being written streams right after the message it compacts
 * through. When the fold changes under you (a compaction lands, or is deleted), the message you were looking at keeps
 * its place on screen, as the browser's scroll anchoring does when it can (it can't when that message folds away).
 */
export function Scrollback({
  conv,
  chat,
  onRetry,
  onPreviewRegenerate,
  onPreviewCompact,
  onOpenBrain,
  empty,
}: {
  conv: Conversation;
  chat: Chat;
  onRetry(): void;
  onPreviewRegenerate(messageId: string, ask: RegenerateAsk): void;
  /** T20: the payload view of "Compact through here" on a message, with a compaction brain. */
  onPreviewCompact(messageId: string, brainId: string): void;
  /** T16: open a brain's card in Settings → Brains (a message's made brain, or a brain it is pinned to). */
  onOpenBrain(brainId: string): void;
  empty: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  /** T20: the newest compaction (where every request starts), and whether you opened the fold above it (per cut). */
  const cut = useMemo(() => cutView(conv), [conv]);
  const cutId = cut.at >= 0 ? conv.messages[cut.at]!.id : null;
  const [openCut, setOpenCut] = useState<string | null>(null);
  const folded = cut.at > 0 && openCut !== cutId;
  /** A stable way for a message's Compact menu to read the conversation as it is when it opens (keeps MessageItem's memo). */
  const convRef = useRef(conv);
  convRef.current = conv;
  const getConv = useCallback(() => convRef.current, []);
  const brains = new Map(conv.brains.map((b) => [b.id, b]));
  const { live, pendingPlayer, pendingRoll } = chat;
  const gallery = useMemo(() => galleryOf(conv), [conv]);
  // T16: which brain each message made, and the brains each is pinned to (stable while the brains don't change).
  const made = useMemo(() => madeFromIndex(conv.brains), [conv.brains]);
  const pins = useMemo(() => pinsByMessage(conv.brains), [conv.brains]);
  /** "Clone from here" on each message: what it needs of the conversation, stable between saves. */
  // T18: the brains with a text model of their own (they keep it in the copy), as a string so the memo holds.
  const ownKey = JSON.stringify(conv.brains.flatMap((b) => (b.textModel ? [[b.name, b.textModel]] : [])));
  const cloneSource = useMemo<CloneSource>(
    () => ({
      id: conv.id,
      title: conv.title,
      textModel: conv.settings.textModel,
      count: conv.messages.length,
      ownText: (JSON.parse(ownKey) as [string, string][]).map(([name, model]) => ({ name, model })),
    }),
    [conv.id, conv.title, conv.settings.textModel, conv.messages.length, ownKey],
  );
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
    // The box itself scrolls, not the page (scrollIntoView would move both).
    const b = el.getBoundingClientRect();
    const r = card.getBoundingClientRect();
    el.scrollTo({ top: el.scrollTop + r.top - b.top - Math.max(16, (el.clientHeight - r.height) / 2), behavior: "smooth" });
  }, [landed]);

  const toBottom = () => box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });

  /**
   * T20: the message at the top of the view, and where it is, so a fold that changes under it (a compaction lands, or
   * is deleted) can put it back where it was. The browser's scroll anchoring does this by itself, except when the
   * message it anchored to is the one that folds away.
   */
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const noteAnchor = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    // A compaction being written, in view: once saved (with this id) it is the one to keep in place.
    const lc = el.querySelector<HTMLElement>("li[data-live-compaction]");
    const lt = lc?.dataset.liveCompaction ? lc.getBoundingClientRect().top - b.top : null;
    if (lc && lt !== null && lt > -40 && lt < el.clientHeight - 40) {
      anchor.current = { id: lc.dataset.liveCompaction!, top: lt };
      return;
    }
    for (const y of [24, 64, 120, 200]) {
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + y)?.closest<HTMLElement>("li[id]");
      if (hit && el.contains(hit)) {
        anchor.current = { id: hit.id, top: hit.getBoundingClientRect().top - b.top };
        return;
      }
    }
  }, []);

  /** "Latest" shows while there is more below the view. It only shows: nothing here moves the box. */
  const measure = useCallback(() => {
    const el = box.current;
    if (el) setAway(el.scrollHeight - el.scrollTop - el.clientHeight > AWAY_PX);
    noteAnchor();
  }, [noteAnchor]);

  // T20: the fold changed (a new cut, or the fold opened or closed). Put the message that was at the top of the view
  // back where it was; if it folded away, the compaction takes its place. Before paint, so nothing visibly jumps.
  const lastFold = useRef({ cutId, folded });
  useLayoutEffect(() => {
    const was = lastFold.current;
    lastFold.current = { cutId, folded };
    if (was.cutId === cutId && was.folded === folded) return;
    const el = box.current;
    const a = anchor.current;
    if (!el || !a) return;
    const target = document.getElementById(a.id) ?? (cutId ? document.getElementById(cutId) : null);
    if (!target) return;
    el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - a.top;
    noteAnchor();
  }, [cutId, folded, noteAnchor]);

  // T20: "Jump to it" on a message in the fold opens the fold first (synchronously, so the caller can scroll to it).
  useEffect(() => {
    const onReveal = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const c = convRef.current;
      const at = c.messages.findIndex((m) => m.id === id);
      const { at: cutAt } = cutView(c);
      if (at < 0 || at >= cutAt) return;
      const cid = c.messages[cutAt]!.id;
      flushSync(() => setOpenCut(cid));
    };
    window.addEventListener(REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_EVENT, onReveal);
  }, []);

  // A conversation opens at its end: the one scroll the scrollback makes by itself (ChatView is keyed by the
  // conversation, so a mount is a new one). Whatever settles in the next moment (a picture taking its own shape, a
  // reply re-attached after a reload) keeps it at the end, until you scroll, click, type or touch, or SETTLE_MS pass.
  // From then on only you and the two buttons move it: new text, an editor, a note opening all grow in place, and the
  // browser's own scroll anchoring keeps what you are looking at still.
  useLayoutEffect(() => {
    const el = box.current;
    const inner = el?.firstElementChild;
    if (!el || !inner || conv.messages.length === 0) return;
    const end = () => {
      el.scrollTop = el.scrollHeight;
    };
    end();
    const ro = new ResizeObserver(end);
    ro.observe(inner);
    const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    const settled = () => {
      ro.disconnect();
      clearTimeout(timer);
      for (const t of inputs) window.removeEventListener(t, settled, true);
    };
    for (const t of inputs) window.addEventListener(t, settled, { capture: true, passive: true });
    const timer = setTimeout(settled, SETTLE_MS);
    return settled;
  }, []); // once, on open

  // Content grows and shrinks under a still box (a reply streaming in off the bottom, the window narrowing).
  useEffect(() => {
    const el = box.current;
    const inner = el?.firstElementChild;
    if (!el || !inner) return;
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    measure();
    if (landed) {
      const at = whereIs(el, landed.messageId);
      if (at === "in view") setLanded(null);
      else if (landed.above !== (at === "above")) setLanded({ ...landed, above: at === "above" });
    }
  };

  const nothing = conv.messages.length === 0 && pendingPlayer === null && !pendingRoll && !live;
  const last = conv.messages.at(-1);
  // A regenerate streams in its message's slot (also when re-attached by generation.follow, once `start` says
  // which message). Anything else, or a regenerate of a message we don't have, goes at the bottom.
  const inSlot = live?.kind === "regenerate" && live.messageId && conv.messages.some((m) => m.id === live.messageId) ? live.messageId : null;
  // T20: a new compaction streams right after the message it compacts through (at the bottom when that is the last).
  const afterId = live?.kind === "turn" && live.compact && conv.messages.some((m) => m.id === live.compact!.through) ? live.compact.through : null;
  const atBottom = live && !inSlot && !afterId ? live : null;
  const waiting = pendingPlayer !== null || pendingRoll;
  const canRegenerate = !!last && last.author.type === "brain" && !atBottom && !afterId && !waiting;
  /** T17: what a fresh take on the last message does with the Muse's note (its Regenerate box says so). */
  const freshTarget = useMemo(() => (last ? freshTakeTarget(conv, last.id) : undefined), [conv, last]);
  const authorOf = (i: number) => {
    const a = conv.messages[i]?.author;
    return a?.type === "brain" ? brains.get(a.brainId) : undefined;
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={box} data-scrollback onScroll={onScroll} className="relative h-full overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 sm:px-6">
          {nothing ? (
            empty
          ) : (
            <GalleryContext value={gallery}>
                <ol className="space-y-7">
                  {cut.at > 0 && (
                    <li data-fold>
                      <FoldBand
                        count={cut.at}
                        pinned={cut.pinnedAbove}
                        compactor={authorOf(cut.at)}
                        open={!folded}
                        onToggle={() => setOpenCut(folded ? cutId : null)}
                      />
                    </li>
                  )}
                  {conv.messages.map((m, i) => {
                    if (folded && i < cut.at) return null;
                    const brain = authorOf(i);
                    // T17: a Muse's note sits close above the reply it is for (the next message, a brain's).
                    const muse = !!brain && isMuse(brain);
                    const next = muse ? authorOf(i + 1) : undefined;
                    const v = m.versions[m.activeVersion];
                    const compaction = isCompaction(conv, m) ? (i === cut.at ? "newest" : "older") : undefined;
                    const item = (
                    <li
                      id={m.id}
                      data-compacted={i < cut.at ? "" : undefined}
                      className={cx(muse && next && !isMuse(next) && "!mb-1", i < cut.at && "opacity-70 transition-opacity focus-within:opacity-100 hover:opacity-100")}
                    >
                      <MessageItem
                        message={m}
                        brain={brain}
                        isLast={m === last && !atBottom && !afterId && !waiting}
                        canRegenerate={m === last && canRegenerate}
                        live={m.id === inSlot ? live! : undefined}
                        busy={chat.busy}
                        actions={chat.actions}
                        onPreviewRegenerate={onPreviewRegenerate}
                        onDismissLive={chat.dismissLive}
                        thoughtTemplate={m === last ? conv.templates.thought : undefined}
                        freshTarget={m === last ? freshTarget : undefined}
                        noteFor={muse ? (next && !isMuse(next) ? next : null) : undefined}
                        thoughtBeside={m.kind === "image" && v?.thought !== undefined && thoughtBesideImage(v, conv.messages[i - 1], conv.brains)}
                        brains={conv.brains}
                        made={made.get(m.id) ?? null}
                        pins={pins.get(m.id) ?? NO_PINS}
                        freshMade={chat.fresh.has(made.get(m.id)?.id ?? "")}
                        onOpenBrain={onOpenBrain}
                        cloneSource={cloneSource}
                        position={i + 1}
                        compaction={compaction}
                        storyCount={compaction ? storyCount(conv, i) : 0}
                        prevId={conv.messages[i - 1]?.id}
                        getConv={getConv}
                        onPreviewCompact={onPreviewCompact}
                      />
                    </li>
                    );
                    // The fold is open: a line says where requests start, right above the compaction.
                    const startsHere = i === cut.at && cut.at > 0 && !folded && (
                      <li className="flex items-center gap-3 text-[11.5px] text-faint">
                        <span className="h-px flex-1 bg-line-strong" />
                        Every request starts here
                        <button type="button" onClick={() => setOpenCut(null)} className="rounded px-1 text-faint underline decoration-line-strong underline-offset-4 hover:text-muted">
                          Fold the {cut.at} above
                        </button>
                        <span className="h-px flex-1 bg-line-strong" />
                      </li>
                    );
                    const liveAfter = m.id === afterId && (
                      <li data-live-compaction={live!.messageId ?? ""}>
                        <LiveReply live={live!} brain={live!.brainId ? brains.get(live!.brainId) : undefined} onRetry={onRetry} onDismiss={chat.dismissLive} />
                      </li>
                    );
                    // One keyed fragment per message, its parts always in the same places, so nothing remounts as they come and go.
                    return (
                      <Fragment key={m.id}>
                        {startsHere}
                        {item}
                        {liveAfter}
                      </Fragment>
                    );
                  })}
                  {pendingPlayer !== null && (
                    <li>
                      <PlayerBubble pending>
                        <MessageText text={pendingPlayer} />
                      </PlayerBubble>
                    </li>
                  )}
                  {pendingRoll && (
                    <li>
                      <PendingRoll />
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
            onClick={toBottom}
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

const NO_PINS: Array<{ brain: Brain; as: PinRole }> = [];

/**
 * T20: the messages above the newest compaction, folded: they are left out of every request (the compaction stands
 * for them), but still here, to open, read and edit. A message among them that is pinned to a brain still reaches it.
 */
function FoldBand({ count, pinned, compactor, open, onToggle }: { count: number; pinned: number; compactor?: Brain; open: boolean; onToggle(): void }) {
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      title={`Left out of every request since ${compactor ? `${compactor.name}'s` : "the"} compaction, which stands for them. Nothing is deleted: open them to read or edit them, or delete the compaction to bring them back into every request.`}
      className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-2.5 text-left text-[13px] text-muted transition-colors hover:border-faint hover:bg-hover/40 hover:text-fg"
    >
      <ScrollText aria-hidden className="size-4 shrink-0" style={compactor ? { color: compactor.color } : undefined} />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-fg">
          {count} earlier message{count === 1 ? "" : "s"}
        </span>
        <span className="text-faint">
          {" "}
          · left out of every request since the compaction below
          {pinned > 0 && (pinned === 1 ? " (one is pinned to a brain, which still gets it)" : ` (${pinned} are pinned to brains, which still get them)`)}
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] text-faint">
        {open ? "Fold" : "Show"} <Chevron aria-hidden className="size-3.5" />
      </span>
    </button>
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
