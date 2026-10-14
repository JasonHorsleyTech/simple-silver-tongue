import { Braces, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "../../components/Button.tsx";
import { Notice } from "../../components/Notice.tsx";
import { useAutosize } from "../../lib/useAutosize.ts";
import { Kbd } from "./MessageEditor.tsx";

/**
 * "Regenerate…" on the last brain message: an optional steer, then a new version that streams into the
 * message's own place. With a steer, the brain sees the version on screen and the steer, last, in this one
 * request only. Empty, it is a plain re-roll of the messages before it. Enter regenerates, Shift+Enter adds
 * a line, Escape closes. "Payload" shows the exact request first (prompt.preview with regenerate).
 */
export function SteerBox({
  value,
  onChange,
  onSubmit,
  onCancel,
  onPreview,
  error,
  nextVersion,
  fromVersion,
  pending,
}: {
  value: string;
  onChange(v: string): void;
  onSubmit(): void;
  onCancel(): void;
  onPreview(): void;
  error: string | null;
  /** The version this will add (1-based). */
  nextVersion: number;
  /** The version on screen, which a steer revises (1-based), when the message has more than one. */
  fromVersion: number | null;
  pending: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutosize(ref, value, 180);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const steered = value.trim() !== "";

  return (
    <div className="mt-2 rounded-xl border border-line-strong bg-raised/70 p-3 shadow-lg shadow-black/20">
      <div className="mb-2 flex items-baseline gap-2">
        <h4 className="text-[12.5px] font-medium text-fg">Regenerate as version {nextVersion}</h4>
        {fromVersion !== null && steered && <span className="text-[12px] text-faint">revising version {fromVersion}, the one shown</span>}
      </div>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        name="steer"
        aria-label="Steer (optional)"
        placeholder="Steer it, optionally: “Say it's blue.”"
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation(); // not the settings drawer
            onCancel();
          } else if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            onSubmit();
          }
        }}
        className="block w-full resize-none rounded-lg border border-line-strong bg-canvas/60 px-3 py-2 text-[14px] leading-[1.55] text-fg outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-focus/60 focus:ring-3 focus:ring-focus/15"
      />
      <p className="mt-1.5 text-[12px] leading-5 text-faint">
        {steered
          ? "Sent once, last, with this request only. Later requests see just the version it writes."
          : "Empty: a plain re-roll from the messages before it."}{" "}
        <span className="hidden sm:inline">
          <Kbd>Enter</Kbd> regenerates · <Kbd>Esc</Kbd> closes
        </span>
      </p>
      {error && (
        <Notice tone="error" className="mt-2">
          {error}
        </Notice>
      )}
      <div className="mt-2.5 flex items-center gap-1.5">
        <Button size="sm" variant="ghost" className="-ml-1 h-7 px-2 text-[12.5px]" onClick={onPreview} title="The exact request Regenerate would send">
          <Braces aria-hidden className="size-3.5" /> Payload
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto h-7 px-2.5 text-[12.5px]" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" className="h-7 px-3 text-[12.5px]" loading={pending} onClick={onSubmit}>
          {!pending && <RefreshCw aria-hidden className="size-3.5" />}
          {steered ? "Regenerate" : "Re-roll"}
        </Button>
      </div>
    </div>
  );
}
