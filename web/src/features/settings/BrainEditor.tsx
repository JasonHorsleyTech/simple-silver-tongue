import { useState } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import type { Brain, BrainUpdate, ModelInfo } from "../../api/types.ts";
import { Notice } from "../../components/Notice.tsx";
import { SavedText } from "../../components/SavedText.tsx";
import { Switch } from "../../components/Switch.tsx";
import { toast } from "../../components/toasts.tsx";
import { BrainBadge } from "../chat/BrainBadge.tsx";

/** The server's own words for it (REASONING_NOTE in src/conversations/prompt.ts). */
const REASONING_NOTE = "Reasoning on: the provider adds a small hidden instruction we can't see or edit.";

/**
 * One brain's text and switches, all of which shape what is sent: the system prompt, reasoning, and the
 * final reminder. In T02 a conversation has one brain; T04 renders one of these per brain and adds name,
 * color, kind, default and delete.
 */
export function BrainEditor({
  conversationId,
  brain,
  isDefault,
  model,
  onSaved,
}: {
  conversationId: string;
  brain: Brain;
  isDefault: boolean;
  model: ModelInfo | null | undefined;
  onSaved(b: Brain): void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function update(patch: Omit<BrainUpdate, "conversation" | "brain">, what?: string) {
    if (what) setBusy(what);
    try {
      onSaved(await api.call("brain.update", { conversation: conversationId, brain: brain.id, ...patch }));
    } catch (err) {
      if (!what) throw err; // a SavedText shows its own error inline
      toast.error(`Couldn't save that. ${errorMessage(err)}`);
    } finally {
      if (what) setBusy(null);
    }
  }

  const r = model?.reasoning;
  const canReason = model === undefined ? true : !!r?.supported; // unknown while loading: don't block
  const efforts = (r?.effortOptions ?? []).filter((e) => e !== "none");
  const effortChoices = efforts.includes(brain.reasoning.effort) || efforts.length === 0 ? efforts : [brain.reasoning.effort, ...efforts];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <BrainBadge name={brain.name} color={brain.color} />
        {isDefault && <span className="text-[11.5px] text-faint">default brain</span>}
      </div>

      <SavedText
        id={`sp-${brain.id}`}
        label="System prompt"
        description="Sent verbatim as the first message of every request to this brain. Nothing else is added."
        saved={brain.systemPrompt}
        maxPx={420}
        validate={(v) => (v.trim() ? null : "The system prompt can't be empty: some Venice models inject their own when there is none.")}
        onSave={(systemPrompt) => update({ systemPrompt })}
      />

      <div className="space-y-3">
        <Switch
          id={`rs-${brain.id}`}
          label="Reasoning"
          description={
            canReason
              ? "Off by default. The reasoning is shown collapsed above the reply and never sent back."
              : `${model?.name ?? "This model"} doesn't reason, so this setting sends nothing.`
          }
          checked={brain.reasoning.enabled}
          disabled={!canReason}
          busy={busy === "reasoning"}
          onChange={(enabled) => void update({ reasoning: { enabled } }, "reasoning")}
        />
        {brain.reasoning.enabled && canReason && (
          <>
            {effortChoices.length > 0 && (
              <div className="flex items-center gap-3">
                <label htmlFor={`re-${brain.id}`} className="text-[13px] text-muted">
                  Effort
                </label>
                <select
                  id={`re-${brain.id}`}
                  value={brain.reasoning.effort}
                  disabled={busy === "effort"}
                  onChange={(e) => void update({ reasoning: { effort: e.target.value as Brain["reasoning"]["effort"] } }, "effort")}
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
          </>
        )}
      </div>

      <div className="space-y-3">
        <Switch
          id={`fr-${brain.id}`}
          label="Final reminder"
          description="Sent verbatim as the very last message of every request to this brain, after the conversation."
          checked={brain.finalReminder.enabled}
          busy={busy === "reminder"}
          onChange={(enabled) => void update({ finalReminder: { enabled } }, "reminder")}
        />
        {brain.finalReminder.enabled && (
          <SavedText
            id={`frt-${brain.id}`}
            saved={brain.finalReminder.content}
            mono
            placeholder="<!-- System reminder: … -->"
            warn={(v) => (v.trim() ? null : "A blank reminder is skipped: nothing extra is sent.")}
            onSave={(content) => update({ finalReminder: { content } })}
          />
        )}
      </div>
    </div>
  );
}
