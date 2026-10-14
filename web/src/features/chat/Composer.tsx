import { ArrowUp } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { Brain } from "../../api/types.ts";
import { Spinner } from "../../components/Spinner.tsx";
import { cx } from "../../lib/cx.ts";
import { useAutosize } from "../../lib/useAutosize.ts";

/**
 * Where the player writes. Enter sends, Shift+Enter adds a newline, and Enter while an IME is composing is
 * left alone. Sending with nothing typed asks the brain to respond to the ledger as it stands (that is how a
 * failed reply is retried); the server explains when there is nothing to answer.
 *
 * Send targets: the default brain gets the big button (and Enter). T04 adds one small button per other
 * brain to `brains`; with one brain there is only the big one.
 */
export function Composer({
  value,
  onChange,
  onSend,
  brains,
  defaultBrainId,
  busy,
  autoFocus,
}: {
  value: string;
  onChange(v: string): void;
  onSend(brainId?: string): void;
  brains: Brain[];
  defaultBrainId: string;
  busy: boolean;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutosize(ref, value, typeof window === "undefined" ? 320 : Math.max(160, Math.round(window.innerHeight * 0.4)));
  const main = brains.find((b) => b.id === defaultBrainId) ?? brains[0];
  const others = brains.filter((b) => b !== main);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // Focus returns here once a reply finishes, so you can type straight on.
  useEffect(() => {
    if (!busy && document.activeElement === document.body) ref.current?.focus();
  }, [busy]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault(); // Enter (or Cmd/Ctrl+Enter) never inserts a newline; Shift+Enter does
    if (!busy) onSend();
  };

  return (
    <div className="relative shrink-0 px-4 pb-4 sm:px-6">
      {/* The scrollback fades out under the composer instead of stopping at a hard edge. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-linear-to-b from-transparent to-canvas" />
      <div
        className={cx(
          "mx-auto w-full max-w-3xl rounded-2xl border border-line-strong bg-raised shadow-xl shadow-black/30 transition-[border-color,box-shadow]",
          "focus-within:border-focus/45 focus-within:ring-3 focus-within:ring-focus/10",
        )}
      >
        <label htmlFor="composer" className="sr-only">
          Message {main?.name}
        </label>
        <textarea
          id="composer"
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Message ${main?.name ?? "the brain"}…`}
          className="block max-h-[40vh] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-[1.6] text-fg outline-none placeholder:text-faint"
        />
        <div className="flex items-center gap-2 px-2.5 pt-1 pb-2.5">
          <p className="hidden min-w-0 flex-1 truncate pl-1.5 text-[11.5px] text-faint sm:block">
            {busy ? (
              `${main?.name ?? "The brain"} is replying…`
            ) : (
              <>
                <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd> <Kbd>Enter</Kbd> for a new line · Markdown works
              </>
            )}
          </p>
          <div className="ml-auto flex items-center gap-1.5">
            {others.map((b) => (
              <button
                key={b.id}
                type="button"
                disabled={busy}
                onClick={() => onSend(b.id)}
                className="h-8 rounded-lg border border-line-strong px-2.5 text-[12.5px] text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                {b.name}
              </button>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => onSend()}
              title={`Send to ${main?.name ?? "the brain"} (Enter)`}
              aria-label={`Send to ${main?.name ?? "the brain"}`}
              className={cx(
                "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors",
                busy
                  ? "cursor-wait bg-hover text-faint"
                  : "bg-silver text-canvas shadow-[inset_0_1px_0_rgb(255_255_255/0.55)] hover:bg-silver-hi",
              )}
            >
              {busy ? <Spinner className="size-3.5" /> : <ArrowUp aria-hidden className="size-4" strokeWidth={2.25} />}
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border border-line-strong bg-panel px-1 py-px font-sans text-[10.5px] text-muted">{children}</kbd>;
}
