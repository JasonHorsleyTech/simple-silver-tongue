import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { STOP_BILL_NOTE, type MessageVersion } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { copyText } from "../../lib/clipboard.ts";
import { cx } from "../../lib/cx.ts";
import { formatUsd } from "../../lib/format.ts";

/**
 * Under a message: the version pager (always shown when there is more than one version: it is state, not an
 * action), then the actions and the meta, which appear on hover or keyboard focus. `pinned` keeps them shown:
 * on the last message, and while a delete confirmation is open.
 */
export function MessageFooter({
  align = "start",
  pinned,
  pager,
  children,
}: {
  align?: "start" | "end";
  pinned?: boolean;
  pager?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cx("flex items-center gap-1 text-[11.5px] text-faint", align === "end" ? "mt-0.5 h-6 justify-end" : "mt-1.5 h-7")}>
      {pager}
      <div
        className={cx(
          "flex min-w-0 items-center gap-0.5 transition-opacity",
          pinned ? "opacity-100" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** A quiet icon button for the footer. `blocked` looks dimmed but still answers a click (with a reason why not). */
export function IconAction({
  label,
  onClick,
  children,
  blocked,
  active,
}: {
  label: string;
  onClick(): void;
  children: ReactNode;
  blocked?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-disabled={blocked || undefined}
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "grid size-7 place-items-center rounded-md transition-colors",
        active ? "bg-hover text-fg" : "text-faint hover:bg-hover hover:text-fg",
        blocked && "opacity-45 hover:bg-transparent hover:text-faint",
      )}
    >
      {children}
    </button>
  );
}

export function CopyAction({ text, label = "Copy the Markdown" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconAction
      label={copied ? "Copied" : label}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
    </IconAction>
  );
}

/** ‹ 2/3 ›: numbered from 1, as the commands number them. `onGo` gets the 1-based version. */
export function VersionPager({ index, count, onGo, pending, blocked }: { index: number; count: number; onGo(version: number): void; pending?: boolean; blocked?: boolean }) {
  const n = index + 1;
  const arrow = "grid h-7 w-6 place-items-center rounded-md text-faint transition-colors enabled:hover:bg-hover enabled:hover:text-fg disabled:opacity-35";
  return (
    <div role="group" aria-label={`Version ${n} of ${count}`} className={cx("-ml-1 flex items-center", (pending || blocked) && "opacity-60")}>
      <button type="button" aria-label="Previous version" title="Previous version" disabled={n <= 1 || pending} onClick={() => onGo(n - 1)} className={arrow}>
        <ChevronLeft aria-hidden className="size-4" />
      </button>
      <span className="min-w-[2.6em] text-center text-[12px] text-muted tabular-nums" aria-live="polite">
        {n}/{count}
      </span>
      <button type="button" aria-label="Next version" title="Next version" disabled={n >= count || pending} onClick={() => onGo(n + 1)} className={arrow}>
        <ChevronRight aria-hidden className="size-4" />
      </button>
    </div>
  );
}

/** Inline "are you sure", in the footer row itself. It promises nothing about cost: the total keeps it. */
export function DeleteConfirm({
  versions,
  images,
  onConfirm,
  onCancel,
  pending,
}: {
  versions: number;
  /** An image message: its images go with it. */
  images?: boolean;
  onConfirm(): void;
  onCancel(): void;
  pending: boolean;
}) {
  const what = images
    ? versions > 1
      ? `Delete this message, all ${versions} versions and their images?`
      : "Delete this message and its image?"
    : versions > 1
      ? `Delete this message and all ${versions} versions?`
      : "Delete this message?";
  return (
    <div role="alertdialog" aria-label="Delete this message?" className="flex items-center gap-1.5">
      <span className="px-1 text-[12.5px] text-red-100/90">{what}</span>
      <Button
        size="sm"
        variant="danger"
        className="h-7 px-2 text-[12.5px]"
        loading={pending}
        autoFocus
        onClick={onConfirm}
        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}
      >
        Delete
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-[12.5px]" disabled={pending} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/**
 * edited · stopped · 89 in · 33 out · $0.000066 (model and finish reason on hover). An image message adds its
 * image's price ("image $0.01"), with the image model and safe mode on hover.
 */
export function VersionMeta({ version: v }: { version: MessageVersion }) {
  const bits: string[] = [];
  if (v.usage) bits.push(`${v.usage.promptTokens} in`, `${v.usage.completionTokens} out`);
  if (v.costUsd !== undefined) bits.push(formatUsd(v.costUsd));
  const img = v.image;
  if (img?.costUsd !== undefined) bits.push(`image ${formatUsd(img.costUsd)}`);
  const title = [
    v.model,
    v.finishReason && `finish: ${v.finishReason}`,
    v.usage?.reasoningTokens && `${v.usage.reasoningTokens} reasoning tokens`,
    img && `image: ${img.model}${img.mime ? `, ${img.mime.replace("image/", "")}` : ""}, safe mode ${img.safeMode ? "on" : "off"}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      {v.edited && <span className="px-1">edited</span>}
      {v.stopped && (
        <span title={STOP_BILL_NOTE} className="cursor-help px-1 text-amber-200/70">
          {v.costUsd === undefined ? "stopped · cost pending" : "stopped"}
        </span>
      )}
      {bits.length > 0 && (
        <span className="min-w-0 truncate px-1 tabular-nums" title={title || undefined}>
          {bits.join(" · ")}
        </span>
      )}
    </>
  );
}
