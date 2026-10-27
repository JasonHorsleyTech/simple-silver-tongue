import { Gauge, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import { ESTIMATE_NOTE, lastCount, type Conversation, type PromptSizes } from "../../api/types.ts";
import { Spinner } from "../../components/Spinner.tsx";
import { cx } from "../../lib/cx.ts";
import { compactNumber } from "../../lib/format.ts";
import { BrainBadge } from "./BrainBadge.tsx";

const n = (x: number) => x.toLocaleString("en-US");

/**
 * T20, the token counter, in the chat header: how big each brain's prompt is, which is what tells you when to compact.
 * The button shows the default brain's last real count (Venice's prompt tokens for its newest reply, read from the
 * ledger: no call); it opens prompt.size, every brain's last real count (cached tokens included) beside an estimate of
 * its request now, which says it is one. Each brain's view differs (its own prompt, reminder and pins).
 */
export function TokenCounter({ conv }: { conv: Conversation }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const brain = conv.brains.find((b) => b.id === conv.defaultBrainId);
  const last = brain ? lastCount(conv, brain.id) : null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    // Not `relative`: the panel hangs from the header's right edge (ChatHeader is relative), so it fits on a phone.
    <div ref={box}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        title={
          last && brain
            ? `${brain.name}'s last prompt: ${n(last.promptTokens)} tokens, as Venice counted it${last.cachedTokens ? ` (${n(last.cachedTokens)} cached)` : ""}${last.beforeCut ? ", before the newest compaction" : ""}. Every brain's prompt size`
            : "Every brain's prompt size: how big each request is"
        }
        className={cx(
          "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] tabular-nums transition-colors",
          open ? "bg-hover text-fg" : "text-faint hover:bg-hover hover:text-fg",
        )}
      >
        <Gauge aria-hidden className="size-4" />
        {/* Counted before the newest compaction: no longer the size of its next request, so the number waits for the next reply. */}
        {last && !last.beforeCut ? <span>{compactNumber(last.promptTokens)}</span> : <span className="sr-only">Prompt sizes</span>}
      </button>
      {open && <SizesPanel conv={conv} onClose={() => setOpen(false)} />}
    </div>
  );
}

function SizesPanel({ conv, onClose }: { conv: Conversation; onClose(): void }) {
  const [sizes, setSizes] = useState<PromptSizes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSizes(await api.call("prompt.size", { conversation: conv.id }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [conv.id]);
  // Again whenever the ledger or the brains change while it is open (a reply landed, a compaction moved the cut).
  useEffect(() => {
    void load();
  }, [load, conv.updatedAt, conv.messages.length, conv.brains]);

  const brains = new Map(conv.brains.map((b) => [b.id, b]));
  const cutAuthor = sizes?.cut && conv.messages.find((m) => m.id === sizes.cut!.messageId)?.author;
  const compactor = cutAuthor?.type === "brain" ? brains.get(cutAuthor.brainId) : undefined;

  return (
    <div
      role="dialog"
      aria-label="Prompt sizes"
      className="absolute top-full right-3 z-40 mt-1 flex max-h-[min(34rem,calc(100vh-6rem))] w-[min(30rem,calc(100vw-2rem))] flex-col rounded-xl border border-line-strong bg-panel text-[12.5px] shadow-2xl shadow-black/60"
    >
      <div className="flex items-start gap-2 border-b border-line px-4 pt-3 pb-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13.5px] font-semibold text-fg">Prompt sizes</h2>
          <p className="mt-0.5 leading-5 text-faint">
            What each brain is sent, in tokens: Venice's count for its last reply, and an estimate of its request now. Every request carries the whole story
            {sizes?.cut ? " since the newest compaction" : ""}, so this grows with every turn.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} aria-label="Count again" title="Count again" className="grid size-7 shrink-0 place-items-center rounded-md text-faint hover:bg-hover hover:text-fg disabled:opacity-40">
          {loading ? <Spinner className="size-3.5" /> : <RotateCw aria-hidden className="size-3.5" />}
        </button>
        <button type="button" onClick={onClose} aria-label="Close" className="-mr-1.5 grid size-7 shrink-0 place-items-center rounded-md text-faint hover:bg-hover hover:text-fg">
          <X aria-hidden className="size-4" />
        </button>
      </div>
      {error ? (
        <p className="px-4 py-3 text-red-200">{error}</p>
      ) : !sizes ? (
        <p className="flex items-center gap-2 px-4 py-4 text-faint">
          <Spinner className="size-3.5" /> Counting…
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-4 px-4 pt-2.5 pb-1 text-[11px] font-semibold tracking-[0.06em] text-faint uppercase">
            <span>Brain</span>
            <span className="text-right" title="Venice's own count of the prompt tokens for the brain's newest reply, cached tokens included">
              Last reply
            </span>
            <span className="w-20 text-right" title={ESTIMATE_NOTE}>
              Now ≈
            </span>
          </div>
          <ul className={cx("min-h-0 overflow-y-auto px-2 pb-2 transition-opacity", loading && "opacity-60")}>
            {sizes.brains.map((row) => {
              const b = brains.get(row.brainId);
              const l = row.last;
              return (
                <li key={row.brainId} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-4 rounded-md px-2 py-1.5 hover:bg-hover/50">
                  <span className="min-w-0">
                    <BrainBadge name={row.name} color={b?.color ?? "#9aa3b0"} className="max-w-full" />
                  </span>
                  <span className="text-right tabular-nums">
                    {l ? (
                      <span
                        title={`${n(l.promptTokens)} prompt tokens${l.cachedTokens ? `, ${n(l.cachedTokens)} of them cached` : ""}, and ${n(l.completionTokens)} written, for its reply ${l.messagesAgo === 0 ? "that is the newest message" : `${l.messagesAgo} message${l.messagesAgo === 1 ? "" : "s"} ago`}${l.model ? ` (${l.model})` : ""}.${l.beforeCut ? " Counted before the newest compaction was written, so its next request is smaller." : ""}`}
                        className={cx("cursor-help", l.beforeCut ? "text-faint" : "text-fg")}
                      >
                        {l.beforeCut && <span className="text-[11px]">before the cut · </span>}
                        {n(l.promptTokens)}
                        {l.cachedTokens ? <span className="text-[11.5px] text-faint"> · {n(l.cachedTokens)} cached</span> : null}
                      </span>
                    ) : (
                      <span className="text-faint">not yet</span>
                    )}
                  </span>
                  <span className="w-20 text-right text-muted tabular-nums" title={row.error ?? (row.contextLength ? `of the model's ${n(row.contextLength)}` : undefined)}>
                    {row.error ? <span className="text-amber-200/80">can't tell</span> : row.now ? n(row.now.tokens) : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="space-y-1.5 border-t border-line px-4 py-2.5 leading-5 text-faint">
            <p>
              {sizes.cut ? (
                <>
                  Compacted: every request starts at {compactor ? `${compactor.name}'s` : "the"} compaction, and the {sizes.cut.before} message
                  {sizes.cut.before === 1 ? "" : "s"} before it {sizes.cut.before === 1 ? "is" : "are"} left out. To shrink requests again, compact a later message.
                </>
              ) : (
                <>No compaction yet: every request holds all {sizes.messageCount} messages. To make them smaller, use Compact through here on any message.</>
              )}
            </p>
            <p className="text-[11.5px]">Now ≈ is the request each brain would be sent next with nothing new typed. {ESTIMATE_NOTE}</p>
          </div>
        </>
      )}
    </div>
  );
}
