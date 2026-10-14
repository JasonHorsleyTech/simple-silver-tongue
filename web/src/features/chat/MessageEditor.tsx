import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Notice } from "../../components/Notice.tsx";
import { cx } from "../../lib/cx.ts";
import { useAutosize } from "../../lib/useAutosize.ts";
import { BUSY_LEDGER } from "./useChat.ts";

/**
 * A message's raw Markdown, edited in place (message.edit). Saving makes it what the history "always was":
 * every brain sees the new text from the next request on, and the scrollback renders it again.
 * Cmd/Ctrl+Enter saves, Escape cancels. While a reply is being written the text stays editable, but it
 * can't be saved until the reply is done (the server would refuse it with a 409).
 *
 * An image message's text is its prompt (`kind: "image"`): plain text, sent to the image model word for word.
 * Saving a new one paints a new image; the one on show stays until the new one swaps in.
 */
export function MessageEditor({
  initial,
  onSave,
  onCancel,
  busy,
  versionNote,
  compact,
  kind = "text",
}: {
  initial: string;
  /** Resolves to null when saved, or to the reason it wasn't. */
  onSave(content: string): Promise<string | null>;
  onCancel(): void;
  busy: boolean;
  /** "Editing version 2 of 3", when there are others. */
  versionNote?: string;
  /** In the player's bubble column: a little tighter. */
  compact?: boolean;
  kind?: "text" | "image";
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutosize(ref, draft, typeof window === "undefined" ? 480 : Math.max(200, Math.round(window.innerHeight * (kind === "image" ? 0.35 : 0.6))));
  const image = kind === "image";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // A reply that has finished clears the "wait for it" reason.
  useEffect(() => {
    if (!busy) setError((e) => (e === BUSY_LEDGER ? null : e));
  }, [busy]);

  const blank = draft.trim() === "";
  const changed = draft !== initial;

  async function save() {
    if (saving || blank) return;
    if (!changed) return onCancel();
    if (busy) return setError(BUSY_LEDGER);
    setSaving(true);
    setError(null);
    const problem = await onSave(draft);
    setSaving(false);
    if (problem) setError(problem); // stays open, with the text as typed
  }

  return (
    <div className={cx("w-full rounded-xl border border-focus/40 bg-raised ring-3 ring-focus/10", compact ? "max-w-[40rem]" : "", image && "mt-2.5")}>
      <textarea
        ref={ref}
        name="message"
        autoComplete="off"
        aria-label={image ? "Image prompt" : "Message (Markdown)"}
        value={draft}
        disabled={saving}
        spellCheck
        onChange={(e) => {
          setDraft(e.target.value);
          if (error && error !== BUSY_LEDGER) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation(); // not the settings drawer
            onCancel();
          }
        }}
        className={cx(
          "block w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-fg outline-none",
          image ? "text-[14px] leading-[1.6]" : "font-mono text-[13px] leading-[1.65]",
        )}
      />
      {(error || (busy && changed)) && (
        <div className="px-3 pb-2">
          <Notice tone={error && error !== BUSY_LEDGER ? "error" : "warn"}>{error ?? BUSY_LEDGER}</Notice>
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-line px-2.5 py-2">
        <p className="min-w-0 flex-1 truncate pl-1 text-[11.5px] text-faint">
          {blank ? (
            <span className="text-amber-200/80">It can't be empty. To remove the message, delete it instead.</span>
          ) : image ? (
            <span title="The image model gets this text word for word, and every other brain sees it framed. The image on show stays until the new one is ready.">
              {versionNote ? `${versionNote} · ` : ""}Saving paints a new image from it · <Kbd>⌘ Enter</Kbd> saves · <Kbd>Esc</Kbd> cancels
            </span>
          ) : (
            <>
              {versionNote ? `${versionNote} · ` : ""}Markdown · <Kbd>⌘ Enter</Kbd> saves · <Kbd>Esc</Kbd> cancels
            </>
          )}
        </p>
        <Button size="sm" variant="ghost" className="h-7 px-2.5 text-[12.5px]" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          className="h-7 px-3 text-[12.5px]"
          loading={saving}
          disabled={blank || (busy && changed)}
          title={busy && changed ? BUSY_LEDGER : image ? "Save the prompt and paint it (⌘ Enter)" : "Save (⌘ Enter)"}
          onClick={() => void save()}
        >
          {image ? "Save and paint" : "Save"}
        </Button>
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border border-line-strong bg-panel px-1 py-px font-sans text-[10.5px] text-muted">{children}</kbd>;
}
