import type { ReactNode } from "react";
import { DEFAULT_SHAPE, REASONING_NOTE, STOP_REASONING_NOTE, type Brain, type BrainFields, type ModelInfo } from "../../api/types.ts";
import { Notice } from "../../components/Notice.tsx";
import { SavedLine } from "../../components/SavedLine.tsx";
import { SavedText } from "../../components/SavedText.tsx";
import { Switch } from "../../components/Switch.tsx";
import { ShapePicker } from "./ShapePicker.tsx";
import { StopSequences } from "./StopSequences.tsx";

/** What a brain is told, and how it is asked: a brain's own fields, or (T16) a maker's blueprint for the brains it makes. */
export type PromptValue = Pick<Brain, "kind" | "systemPrompt" | "reasoning" | "finalReminder" | "stop" | "safeMode" | "shape" | "tool">;
export type PromptPatch = Pick<BrainFields, "systemPrompt" | "reasoning" | "finalReminder" | "stop" | "safeMode" | "shape" | "tool">;

/**
 * Every text that shapes what a brain is sent (system prompt, reasoning, final reminder, stop sequences, and an image
 * brain's safe mode, shape and tool text), for a brain (`blueprint` false) or for the blueprint the brains a maker
 * makes start from (T16): the same fields, the same rules, worded for "each new brain". Long texts save on purpose;
 * switches save on click. `save(patch, what)`: with `what`, the caller shows the spinner and the error; without, the
 * field shows its own error.
 */
export function PromptFields({
  idBase,
  value,
  name,
  blueprint,
  busy,
  model,
  imagePlan,
  onImageSettings,
  save,
  afterSystemPrompt,
}: {
  /** Unique per editor: the fields' ids. */
  idBase: string;
  value: PromptValue;
  /** The brain's name ("Game Master"), or for a blueprint who it is for ("each new brain"). */
  name: string;
  blueprint?: boolean;
  /** The `what` being saved right now, if any. */
  busy: string | null;
  model: ModelInfo | null | undefined;
  imagePlan: string;
  onImageSettings(): void;
  save(patch: PromptPatch, what?: string): Promise<void>;
  /** Right after the system prompt (T16: a brain's pinned messages, sent right after its system prompt and the setup). */
  afterSystemPrompt?: ReactNode;
}) {
  const r = model?.reasoning;
  const canReason = model === undefined ? true : !!r?.supported; // unknown while loading: don't block
  const efforts = (r?.effortOptions ?? []).filter((e) => e !== "none");
  const effortChoices = efforts.includes(value.reasoning.effort) || efforts.length === 0 ? efforts : [value.reasoning.effort, ...efforts];
  const id = (k: string) => `${k}-${idBase}`;
  const each = blueprint ? "each new brain" : "this brain";
  const stopSubject = { id: idBase, name: blueprint ? "a new brain" : name, kind: value.kind, stop: value.stop };

  return (
    <>
      <SavedText
        id={id("sp")}
        label={blueprint ? "Their system prompt" : "System prompt"}
        description={
          blueprint
            ? "Copied into each new brain, then sent verbatim as the first message of every request to it. Nothing else is added."
            : "Sent verbatim as the first message of every request to this brain. Nothing else is added."
        }
        saved={value.systemPrompt}
        maxPx={420}
        validate={(v) => (v.trim() ? null : "The system prompt can't be empty: some Venice models inject their own when there is none.")}
        onSave={(systemPrompt) => save({ systemPrompt })}
      />

      {afterSystemPrompt}

      <div className="space-y-3">
        <Switch
          id={id("rs")}
          label="Reasoning"
          description={
            canReason
              ? blueprint
                ? "For each new brain. Shown collapsed above its replies and never sent back."
                : "Off by default. The reasoning is shown collapsed above the reply and never sent back."
              : `${model?.name ?? "This model"} doesn't reason, so this setting sends nothing.`
          }
          checked={value.reasoning.enabled}
          disabled={!canReason}
          busy={busy === "reasoning"}
          onChange={(enabled) => void save({ reasoning: { enabled } }, "reasoning")}
        />
        {value.reasoning.enabled && canReason && (
          <>
            {effortChoices.length > 0 && (
              <div className="flex items-center gap-3">
                <label htmlFor={id("re")} className="text-[13px] text-muted">
                  Effort
                </label>
                <select
                  id={id("re")}
                  value={value.reasoning.effort}
                  disabled={busy === "effort"}
                  onChange={(e) => void save({ reasoning: { effort: e.target.value } }, "effort")}
                  className="h-8 rounded-md border border-line-strong bg-raised px-2 text-[13px] text-fg outline-none focus:border-focus/60"
                >
                  {effortChoices.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Notice tone="warn">{REASONING_NOTE}</Notice>
            {value.stop.length > 0 && <Notice tone="warn">{STOP_REASONING_NOTE}</Notice>}
          </>
        )}
      </div>

      <div className="space-y-3">
        <Switch
          id={id("fr")}
          label="Final reminder"
          description={`Sent verbatim as the very last message of every request to ${each}, after the conversation.`}
          checked={value.finalReminder.enabled}
          busy={busy === "reminder"}
          onChange={(enabled) => void save({ finalReminder: { enabled } }, "reminder")}
        />
        {value.finalReminder.enabled && (
          <SavedText
            id={id("frt")}
            saved={value.finalReminder.content}
            mono
            maxPx={260}
            placeholder="<!-- System reminder: … -->"
            warn={(v) => (v.trim() ? null : "A blank reminder is skipped: nothing extra is sent.")}
            onSave={(content) => save({ finalReminder: { content } })}
          />
        )}
      </div>

      <StopSequences brain={stopSubject} busy={busy === "stop"} onSave={(stop) => void save({ stop }, "stop")} />

      {value.kind === "image" && (
        <div className="space-y-5 rounded-lg border border-line bg-canvas/40 p-3.5">
          <Switch
            id={id("safe")}
            label="Safe mode"
            description={`On by default: Venice blurs adult content in ${blueprint ? "each new brain's" : "this brain's"} images (sent as safe_mode). A blurred image says so, with a way to paint it again with safe mode off.`}
            checked={value.safeMode !== false}
            busy={busy === "safe"}
            onChange={(safeMode) => void save({ safeMode }, "safe")}
          />
          <ShapePicker value={value.shape ?? DEFAULT_SHAPE} disabled={busy === "shape"} busy={busy === "shape"} onChange={(shape) => void save({ shape }, "shape")} />
          <p className="-mt-2 text-[12.5px] leading-5 text-faint">
            Painted with <span className="text-muted">{imagePlan}</span>, like every image brain here.{" "}
            <button type="button" onClick={onImageSettings} className="text-muted underline decoration-line-strong underline-offset-4 hover:text-fg">
              Image model and price
            </button>
          </p>
          <div>
            <h4 className="text-[13px] font-medium text-fg">Tool text</h4>
            <p className="mt-0.5 text-[12.5px] leading-5 text-faint">
              All of it reaches the model: the tool's name and descriptions in the request, and the result after each of its own images.
            </p>
          </div>
          <SavedLine
            id={id("tn")}
            label="Tool name"
            saved={value.tool?.name ?? ""}
            mono
            validate={(v) => (/^[A-Za-z0-9_-]{1,64}$/.test(v) ? null : "A tool name is 1-64 letters, digits, _ or -.")}
            onSave={(name) => save({ tool: { name } })}
          />
          <SavedText
            id={id("td")}
            label="Description"
            saved={value.tool?.description ?? ""}
            mono
            maxPx={200}
            validate={(v) => (v.trim() ? null : "The tool description can't be blank.")}
            onSave={(description) => save({ tool: { description } })}
          />
          <SavedText
            id={id("tp")}
            label="Prompt parameter"
            saved={value.tool?.promptParamDescription ?? ""}
            mono
            maxPx={200}
            validate={(v) => (v.trim() ? null : "The prompt description can't be blank.")}
            onSave={(promptParamDescription) => save({ tool: { promptParamDescription } })}
          />
          <SavedText
            id={id("tr")}
            label="Tool result"
            description={`What ${blueprint ? "each new brain" : "the brain"} sees after each of its own images.`}
            saved={value.tool?.resultContent ?? ""}
            mono
            maxPx={200}
            validate={(v) => (v.trim() ? null : "The tool result can't be blank.")}
            onSave={(resultContent) => save({ tool: { resultContent } })}
          />
        </div>
      )}
    </>
  );
}
