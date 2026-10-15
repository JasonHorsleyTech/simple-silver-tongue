import { Braces, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "../../components/Button.tsx";
import { Notice } from "../../components/Notice.tsx";
import { cx } from "../../lib/cx.ts";
import { prefillThought } from "../../lib/thought.ts";
import { useAutosize } from "../../lib/useAutosize.ts";
import { Kbd } from "./MessageEditor.tsx";

/** The two ways to regenerate (T15): revise the version on screen with a steer, or a fresh take from a planted thought. */
export type RegenerateMode = "revise" | "fresh";

/**
 * "Regenerate…" on the last brain message, in two tabs. A new version then streams into the message's own place.
 *
 * **Revise** (T03): an optional steer. With one, the brain sees the version on screen and the steer, last, in this
 * one request only. Empty, it is a plain re-roll of the messages before it. Enter regenerates, Shift+Enter adds a line.
 *
 * **Fresh take** (T15): the brain never sees the version on screen. What the box holds goes in as the brain's own
 * words, after the messages before it and before its final reminder, sent exactly as written; the new version is
 * that text, a blank line, then the reply. The box starts with the conversation's thought template, the caret
 * where its {{thought}} was. ⌘ Enter sends (Enter is a new line: the text is usually a code fence).
 *
 * Escape closes. "Payload" shows the exact request first (prompt.preview with regenerate), for either tab.
 */
export function SteerBox({
  mode,
  onMode,
  steer,
  onSteer,
  thought,
  onThought,
  thoughtTemplate,
  onSubmit,
  onCancel,
  onPreview,
  error,
  nextVersion,
  fromVersion,
  pending,
  image,
  brainName,
  reminder,
}: {
  mode: RegenerateMode;
  onMode(m: RegenerateMode): void;
  steer: string;
  onSteer(v: string): void;
  thought: string;
  onThought(v: string): void;
  /** The conversation's templates.thought: the Fresh take box starts with it. */
  thoughtTemplate: string;
  onSubmit(): void;
  onCancel(): void;
  onPreview(): void;
  error: string | null;
  /** The version this will add (1-based). */
  nextVersion: number;
  /** The version on screen, which a steer revises (1-based), when the message has more than one. */
  fromVersion: number | null;
  pending: boolean;
  /** An image brain's message: a new prompt, then a new image. */
  image?: boolean;
  brainName: string;
  /** The brain has a final reminder (on, with text): it comes after the thought. Without one, the request ends on it. */
  reminder: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fresh = mode === "fresh";
  const value = fresh ? thought : steer;
  useAutosize(ref, value, fresh ? 320 : 180);
  /**
   * Where the caret goes once the pre-filled thought is in the box. Keyed by that text: on mount both effects
   * run in one commit, before the pre-fill has reached the textarea.
   */
  const caret = useRef<{ text: string; at: number } | null>(null);

  // Opening a tab focuses its box; an empty Fresh take box is filled from the template first.
  useEffect(() => {
    if (fresh && !thought) {
      const p = prefillThought(thoughtTemplate);
      caret.current = { text: p.text, at: p.caret };
      onThought(p.text);
      return;
    }
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // Only on opening a tab (so not on `thought`): typing must never move the caret.
  }, [mode]);
  useEffect(() => {
    const el = ref.current;
    const want = caret.current;
    if (!want || !el || el.value !== want.text) return;
    el.focus();
    el.setSelectionRange(want.at, want.at);
    caret.current = null;
  }, [thought]);

  const steered = steer.trim() !== "";
  const blank = fresh && !thought.trim();
  const tabs: { id: RegenerateMode; label: string; title: string }[] = [
    { id: "revise", label: "Revise", title: "Keep the version on screen and give a direction, or re-roll" },
    { id: "fresh", label: "Fresh take", title: `Plant a thought as ${brainName}'s own words; it never sees the version on screen` },
  ];

  return (
    <div className="mt-2 rounded-xl border border-line-strong bg-raised/70 p-3 shadow-lg shadow-black/20">
      <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <h4 className="text-[12.5px] font-medium text-fg">
          Regenerate as version {nextVersion}
          {image && <span className="font-normal text-faint">: a new prompt and a new image</span>}
        </h4>
        {!fresh && fromVersion !== null && steered && <span className="text-[12px] text-faint">revising version {fromVersion}, the one shown</span>}
        <div role="tablist" aria-label="How to regenerate" className="ml-auto inline-flex rounded-lg border border-line-strong p-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={mode === t.id}
              title={t.title}
              disabled={pending}
              onClick={() => onMode(t.id)}
              className={cx("h-6 rounded-md px-2 text-[12px] transition-colors", mode === t.id ? "bg-hover text-fg" : "text-faint hover:text-muted")}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <textarea
        key={mode}
        ref={ref}
        autoComplete="off"
        rows={1}
        value={value}
        name={fresh ? "thought" : "steer"}
        aria-label={fresh ? `Thought, as ${brainName}'s own words` : "Steer (optional)"}
        placeholder={fresh ? `${brainName}'s own thought, sent word for word` : image ? "Steer it, optionally: “Night now, rain on the windows.”" : "Steer it, optionally: “Say it's blue.”"}
        disabled={pending}
        spellCheck
        onChange={(e) => (fresh ? onThought : onSteer)(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation(); // not the settings drawer
            onCancel();
            return;
          }
          if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
          const send = fresh ? e.metaKey || e.ctrlKey : !e.shiftKey && !e.altKey;
          if (send) {
            e.preventDefault();
            if (!blank) onSubmit();
          }
        }}
        className={cx(
          "block w-full resize-none rounded-lg border border-line-strong bg-canvas/60 px-3 py-2 text-fg outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-focus/60 focus:ring-3 focus:ring-focus/15",
          fresh ? "font-mono text-[13px] leading-[1.65]" : "text-[14px] leading-[1.55]",
        )}
      />
      <p className="mt-1.5 text-[12px] leading-5 text-faint">
        {fresh ? (
          <>
            {brainName} never sees the version on screen: this goes in as its own words, word for word, after the messages before it
            {reminder ? ", then its final reminder" : ", and it carries on from them (it has no final reminder)"}.{" "}
            {image ? "The new prompt is saved alone; this is kept beside it." : "The new version is this, then the reply: edit it like any message."}
          </>
        ) : steered ? (
          "Sent once, last, with this request only. Later requests see just the version it writes."
        ) : image ? (
          "Empty: a fresh prompt from the messages before it. The current version keeps its image."
        ) : (
          "Empty: a plain re-roll from the messages before it."
        )}{" "}
        <span className="hidden sm:inline">
          {fresh ? <Kbd>⌘ Enter</Kbd> : <Kbd>Enter</Kbd>} regenerates · <Kbd>Esc</Kbd> closes
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
        <Button
          size="sm"
          variant="primary"
          className="h-7 px-3 text-[12.5px]"
          loading={pending}
          disabled={blank}
          title={blank ? "Write the thought first: it is sent as the brain's own words" : undefined}
          onClick={onSubmit}
        >
          {!pending && (fresh ? <Sparkles aria-hidden className="size-3.5" /> : <RefreshCw aria-hidden className="size-3.5" />)}
          {fresh ? "Fresh take" : steered ? "Regenerate" : "Re-roll"}
        </Button>
      </div>
    </div>
  );
}
