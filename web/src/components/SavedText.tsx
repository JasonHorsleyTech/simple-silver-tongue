import { Check } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "../api/errors.ts";
import { Button } from "./Button.tsx";
import { Notice } from "./Notice.tsx";
import { TextArea } from "./TextArea.tsx";

/**
 * Text that is saved on purpose, not on every keystroke: edit, then Save (or Cmd/Ctrl+Enter) or Revert.
 * For text that reaches a model (system prompts, templates, reminders), where a half-typed save would be
 * sent. If the saved value changes elsewhere (the CLI, another tab) while you have no edits, it follows.
 */
export function SavedText({
  id,
  label,
  description,
  saved,
  onSave,
  mono,
  maxPx,
  validate,
  warn,
  placeholder,
}: {
  id: string;
  label?: ReactNode;
  description?: ReactNode;
  saved: string;
  onSave(value: string): Promise<void>;
  mono?: boolean;
  maxPx?: number;
  /** A reason the value can't be saved, or null. */
  validate?(value: string): string | null;
  /** A heads-up that doesn't block saving, or null. */
  warn?(value: string): string | null;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const base = useRef(saved);
  const dirty = draft !== saved;

  useEffect(() => {
    // Follow outside changes only while there is nothing unsaved here.
    setDraft((d) => (d === base.current ? saved : d));
    base.current = saved;
  }, [saved]);

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1600);
    return () => clearTimeout(t);
  }, [justSaved]);

  const problem = validate?.(draft) ?? null;
  const heads = warn?.(draft) ?? null;

  async function save() {
    if (!dirty || saving) return;
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      base.current = draft;
      setJustSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <TextArea
        id={id}
        label={label}
        description={description}
        value={draft}
        mono={mono}
        maxPx={maxPx}
        placeholder={placeholder}
        aria-invalid={problem ? true : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape" && dirty) {
            e.stopPropagation(); // the first Escape reverts; it doesn't close the panel
            setDraft(saved);
            setError(null);
          }
        }}
      />
      {heads && !error && (
        <Notice tone="warn" className="mt-2">
          {heads}
        </Notice>
      )}
      {error && (
        <Notice tone="error" className="mt-2">
          {error}
        </Notice>
      )}
      {(dirty || justSaved) && (
        <div className="mt-2 flex h-8 items-center justify-end gap-1.5">
          {justSaved && !dirty && (
            <span className="mr-auto inline-flex items-center gap-1 text-[12px] text-emerald-300/90">
              <Check aria-hidden className="size-3.5" /> Saved
            </span>
          )}
          {dirty && (
            <>
              <span className="mr-auto text-[12px] text-amber-200/80">Unsaved changes</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setDraft(saved);
                  setError(null);
                }}
              >
                Revert
              </Button>
              <Button size="sm" variant="primary" loading={saving} onClick={() => void save()} title="Save (⌘ Enter)">
                Save
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
