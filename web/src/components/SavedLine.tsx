import { Check } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { errorMessage } from "../api/errors.ts";
import { cx } from "../lib/cx.ts";
import { Button } from "./Button.tsx";
import { Notice } from "./Notice.tsx";

/**
 * One line that is saved on purpose, like SavedText: type, then Enter (or Save) saves and Escape reverts.
 * For short values that still matter: a brain's name (it is framed into every other brain's prompt), a setup
 * label, a tool name, max tokens. Follows outside changes while there is nothing unsaved here.
 */
export function SavedLine({
  id,
  label,
  description,
  saved,
  onSave,
  mono,
  validate,
  placeholder,
  inputProps,
  className,
}: {
  id: string;
  label?: ReactNode;
  description?: ReactNode;
  saved: string;
  onSave(value: string): Promise<void>;
  mono?: boolean;
  /** A reason the value can't be saved, or null. */
  validate?(value: string): string | null;
  placeholder?: string;
  inputProps?: Omit<ComponentProps<"input">, "id" | "value" | "onChange" | "onKeyDown" | "placeholder">;
  className?: string;
}) {
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const base = useRef(saved);
  const dirty = draft !== saved;

  useEffect(() => {
    setDraft((d) => (d === base.current ? saved : d));
    base.current = saved;
  }, [saved]);

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1600);
    return () => clearTimeout(t);
  }, [justSaved]);

  async function save() {
    if (!dirty || saving) return;
    const problem = validate?.(draft) ?? null;
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

  const revert = () => {
    setDraft(saved);
    setError(null);
  };

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1 flex items-center gap-2 text-[13px] font-medium text-fg">
          {label}
          {justSaved && !dirty && (
            <span className="inline-flex items-center gap-1 text-[12px] font-normal text-emerald-300/90">
              <Check aria-hidden className="size-3.5" /> Saved
            </span>
          )}
        </label>
      )}
      {description && (
        <p id={`${id}-desc`} className="mb-2 text-[12.5px] leading-5 text-faint">
          {description}
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          value={draft}
          placeholder={placeholder}
          aria-describedby={description ? `${id}-desc` : undefined}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          spellCheck={!mono}
          {...inputProps}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape" && dirty) {
              e.stopPropagation(); // the first Escape reverts; it doesn't close the panel
              revert();
            }
          }}
          className={cx(
            "block h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 text-fg",
            "placeholder:text-faint outline-none transition-[border-color,box-shadow]",
            "focus:border-focus/60 focus:ring-3 focus:ring-focus/15",
            mono ? "font-mono text-[12.5px]" : "text-[14px]",
            dirty && "border-amber-300/35",
          )}
        />
        {dirty && (
          <>
            <Button size="sm" variant="ghost" className="px-2" disabled={saving} onClick={revert} title="Revert (Esc)">
              Revert
            </Button>
            <Button size="sm" variant="primary" loading={saving} onClick={() => void save()} title="Save (Enter)">
              Save
            </Button>
          </>
        )}
        {!label && justSaved && !dirty && <Check aria-label="Saved" className="size-4 shrink-0 text-emerald-300/90" />}
      </div>
      {error && (
        <Notice tone="error" className="mt-2">
          {error}
        </Notice>
      )}
    </div>
  );
}
