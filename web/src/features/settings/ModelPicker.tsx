import { useState, type ReactNode } from "react";
import { errorMessage } from "../../api/errors.ts";
import type { ModelInfo } from "../../api/types.ts";
import { Notice } from "../../components/Notice.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { compactNumber } from "../../lib/format.ts";
import type { ModelList } from "./models.ts";

/** A text model in one line: price, privacy, context, and the reasoning it offers. */
export function textModelDetail(m: ModelInfo): string {
  return [
    m.price,
    m.privacy,
    m.contextLength ? `${m.contextLength >= 1e6 ? `${Number((m.contextLength / 1e6).toFixed(1))}M` : compactNumber(m.contextLength)} context` : null,
    m.reasoning?.supported ? (m.reasoning.effortOptions ? `reasoning: ${m.reasoning.effortOptions.join(", ")}` : m.reasoning.always ? "always reasons" : "reasons") : "no reasoning",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A native select over the offered models (models.list: the model list, models.ini), saved on change. The model in
 * use stays listed even when the list hasn't got it (set by id from the terminal, taken out of the list, or dropped
 * by Venice): by its name when Venice still lists it, with a warning when Venice doesn't (every request on it is
 * refused). `optionDetail` follows each option's name (a price).
 *
 * T18, a brain's picker (`inherit`, the conversation's model): the first option is "Conversation default (<model>)",
 * chosen while the brain has no model of its own (`value` null); picking it saves null, and the brain follows the
 * conversation's model from then on. Any other pick is the brain's own, kept when the conversation's changes.
 */
export function ModelPicker({
  id,
  label,
  description,
  value,
  inherit,
  list,
  detail,
  optionDetail,
  onPick,
  showListError = true,
  ownWords = "its own",
}: {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  /** The model picked: a brain's own, or null for the conversation's (`inherit`). */
  value: string | null;
  /** A brain's picker: the conversation's model, which "Conversation default" stands for. */
  inherit?: string;
  list: ModelList;
  detail(m: ModelInfo): string;
  optionDetail?(m: ModelInfo): string;
  onPick(model: string | null): Promise<void>;
  /** Say here when the model list couldn't load (false where the panel already says it). */
  showListError?: boolean;
  /** Whose a picked model is, in the line under the picker: "its own", or a blueprint's "their own". */
  ownWords?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offered = list.models ?? [];
  const inUse = value ?? inherit ?? "";
  const info = list.find(inUse);
  const isOffered = (m: string) => offered.some((x) => x.id === m);
  const nameOf = (m: string) => list.find(m)?.name ?? m;
  const inheritInfo = inherit !== undefined ? list.find(inherit) : undefined;

  async function pick(next: string) {
    setSaving(true);
    setError(null);
    try {
      await onPick(next === "" && inherit !== undefined ? null : next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const extra = value !== null && !isOffered(value) ? value : null;
  const extraInfo = extra ? list.find(extra) : undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-1 flex items-center gap-2 text-[13px] font-medium text-fg">
        {label}
        {saving && <Spinner className="size-3.5 text-faint" />}
      </label>
      {description && <p className="mb-2 text-[12.5px] leading-5 text-faint">{description}</p>}
      <select
        id={id}
        value={value ?? ""}
        disabled={saving || !list.models}
        onChange={(e) => void pick(e.target.value)}
        className="h-9 w-full rounded-lg border border-line-strong bg-raised px-2.5 text-[13.5px] text-fg outline-none focus:border-focus/60 focus:ring-3 focus:ring-focus/15 disabled:opacity-60"
      >
        {inherit !== undefined && (
          <option value="">
            Conversation default ({nameOf(inherit)}
            {inheritInfo && optionDetail ? ` · ${optionDetail(inheritInfo)}` : ""})
          </option>
        )}
        {extra !== null && (
          <option value={extra}>
            {!list.models || extraInfo === undefined ? extra : extraInfo === null ? `${extra} (Venice doesn't list it)` : `${extraInfo.name} (not in the model list)`}
          </option>
        )}
        {offered.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {optionDetail ? ` · ${optionDetail(m)}` : ""}
            {m.privacy !== "private" ? ` · ${m.privacy}` : ""}
            {m.uncensored ? " · uncensored" : ""}
            {m.offline ? " · offline" : ""}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-[12px] leading-5 text-faint">
        <span className="font-mono text-[11.5px] text-muted">{inUse}</span>
        {inherit !== undefined && (value === null ? " · the conversation's" : ` · ${ownWords}`)}
        {info && !isOffered(inUse) && " · not in the model list"}
        {info && ` · ${detail(info)}`}
      </p>
      {info === null && (
        <Notice tone="warn" className="mt-2">
          Venice doesn't list {inUse}, so every request on it is refused. Pick another model{inherit !== undefined && value !== null ? ", or the conversation default" : ""}.
        </Notice>
      )}
      {showListError && list.error && (
        <Notice tone="error" className="mt-2">
          Couldn't load Venice's model list. {list.error}
        </Notice>
      )}
      {error && (
        <Notice tone="error" className="mt-2">
          {error}
        </Notice>
      )}
    </div>
  );
}
