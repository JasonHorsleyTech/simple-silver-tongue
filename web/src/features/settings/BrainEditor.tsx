import { Braces, Plus, Star, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import { BRAIN_COLORS, REASONING_NOTE, type Brain, type BrainFields, type ModelInfo } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Notice } from "../../components/Notice.tsx";
import { SavedLine } from "../../components/SavedLine.tsx";
import { SavedText } from "../../components/SavedText.tsx";
import { Segmented } from "../../components/Segmented.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { Switch } from "../../components/Switch.tsx";
import { cx } from "../../lib/cx.ts";

/**
 * One brain, in full: who it is (name, color, kind, default), then every text that shapes what it is sent
 * (system prompt, reasoning, final reminder, and an image brain's safe mode and tool text), then delete.
 * Long texts save on purpose (Save / ⌘ Enter); switches, colors and kind save on click.
 */
export function BrainEditor({
  conversationId,
  brain,
  isDefault,
  messageCount,
  writing,
  model,
  onSaved,
  onDefault,
  onDeleted,
  onPayload,
}: {
  conversationId: string;
  brain: Brain;
  isDefault: boolean;
  /** Its messages in the ledger: with any, it can't be deleted or change kind. */
  messageCount: number;
  /** It is writing a reply right now. */
  writing: boolean;
  model: ModelInfo | null | undefined;
  onSaved(b: Brain): void;
  onDefault(brainId: string): void;
  onDeleted(brainId: string): void;
  onPayload(): void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  /** brain.update. Text fields (no `what`) show their own error inline; clicks show it at the bottom. */
  async function update(patch: BrainFields, what?: string) {
    if (!what) return onSaved(await api.call("brain.update", { conversation: conversationId, brain: brain.id, ...patch }));
    setBusy(what);
    setError(null);
    try {
      onSaved(await api.call("brain.update", { conversation: conversationId, brain: brain.id, ...patch }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function makeDefault() {
    setBusy("default");
    setError(null);
    try {
      onDefault((await api.call("brain.set-default", { conversation: conversationId, brain: brain.id })).id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setError(null);
    try {
      onDeleted((await api.call("brain.delete", { conversation: conversationId, brain: brain.id })).deleted);
    } catch (err) {
      setError(errorMessage(err));
      setConfirmDelete(false);
      setBusy(null);
    }
  }

  const r = model?.reasoning;
  const canReason = model === undefined ? true : !!r?.supported; // unknown while loading: don't block
  const efforts = (r?.effortOptions ?? []).filter((e) => e !== "none");
  const effortChoices = efforts.includes(brain.reasoning.effort) || efforts.length === 0 ? efforts : [brain.reasoning.effort, ...efforts];
  const kindLocked = messageCount > 0 || writing;
  const id = (k: string) => `${k}-${brain.id}`;

  return (
    <div className="space-y-6">
      <SavedLine
        id={id("name")}
        label="Name"
        description={
          <>
            Other brains see its lines framed with this name, history included: <code className="font-mono text-[11.5px] text-muted">{`<!-- from: ${brain.name} -->`}</code>
          </>
        }
        saved={brain.name}
        validate={(v) => (v.trim() ? null : "A brain needs a name.")}
        inputProps={{ maxLength: 60 }}
        onSave={(name) => update({ name: name.trim() })}
      />

      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[13px] font-medium text-fg">Color</span>
          {busy === "color" && <Spinner className="size-3.5 text-faint" />}
          <span className="text-[12px] text-faint">for its badge only; never sent</span>
        </div>
        <ColorPicker value={brain.color} disabled={busy === "color"} onPick={(color) => void update({ color }, "color")} />
      </div>

      <div>
        <div className="flex items-center gap-3">
          <span id={id("kind-label")} className="flex-1 text-[13px] font-medium text-fg">
            Kind
          </span>
          {busy === "kind" && <Spinner className="size-3.5 text-faint" />}
          <Segmented<Brain["kind"]>
            label="Kind"
            value={brain.kind}
            disabled={kindLocked || busy === "kind"}
            options={[
              { value: "text", label: "Text" },
              { value: "image", label: "Image" },
            ]}
            onChange={(kind) => void update({ kind }, "kind")}
          />
        </div>
        <p className="mt-1 text-[12.5px] leading-5 text-faint">
          {messageCount > 0
            ? `Locked: ${brain.name} has ${messageCount} message${messageCount === 1 ? "" : "s"}. Add a new brain for the other kind.`
            : writing
              ? `Locked while ${brain.name} is writing a reply.`
              : brain.kind === "image"
                ? "Answers with a forced generate_image call. Image replies aren't built yet (T05); set it up now."
                : "Answers in words. Can change until it first speaks."}
        </p>
      </div>

      <SavedText
        id={id("sp")}
        label="System prompt"
        description="Sent verbatim as the first message of every request to this brain. Nothing else is added."
        saved={brain.systemPrompt}
        maxPx={420}
        validate={(v) => (v.trim() ? null : "The system prompt can't be empty: some Venice models inject their own when there is none.")}
        onSave={(systemPrompt) => update({ systemPrompt })}
      />

      <div className="space-y-3">
        <Switch
          id={id("rs")}
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
                <label htmlFor={id("re")} className="text-[13px] text-muted">
                  Effort
                </label>
                <select
                  id={id("re")}
                  value={brain.reasoning.effort}
                  disabled={busy === "effort"}
                  onChange={(e) => void update({ reasoning: { effort: e.target.value } }, "effort")}
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
          id={id("fr")}
          label="Final reminder"
          description="Sent verbatim as the very last message of every request to this brain, after the conversation."
          checked={brain.finalReminder.enabled}
          busy={busy === "reminder"}
          onChange={(enabled) => void update({ finalReminder: { enabled } }, "reminder")}
        />
        {brain.finalReminder.enabled && (
          <SavedText
            id={id("frt")}
            saved={brain.finalReminder.content}
            mono
            maxPx={260}
            placeholder="<!-- System reminder: … -->"
            warn={(v) => (v.trim() ? null : "A blank reminder is skipped: nothing extra is sent.")}
            onSave={(content) => update({ finalReminder: { content } })}
          />
        )}
      </div>

      {brain.kind === "image" && (
        <div className="space-y-5 rounded-lg border border-line bg-canvas/40 p-3.5">
          <Switch
            id={id("safe")}
            label="Safe mode"
            description="Venice blurs adult content in this brain's images. On by default."
            checked={brain.safeMode !== false}
            busy={busy === "safe"}
            onChange={(safeMode) => void update({ safeMode }, "safe")}
          />
          <div>
            <h4 className="text-[13px] font-medium text-fg">Tool text</h4>
            <p className="mt-0.5 text-[12.5px] leading-5 text-faint">
              All of it reaches the model: the tool's name and descriptions in the request, and the result after each of its own images.
            </p>
          </div>
          <SavedLine
            id={id("tn")}
            label="Tool name"
            saved={brain.tool?.name ?? ""}
            mono
            validate={(v) => (/^[A-Za-z0-9_-]{1,64}$/.test(v) ? null : "A tool name is 1-64 letters, digits, _ or -.")}
            onSave={(name) => update({ tool: { name } })}
          />
          <SavedText
            id={id("td")}
            label="Description"
            saved={brain.tool?.description ?? ""}
            mono
            maxPx={200}
            validate={(v) => (v.trim() ? null : "The tool description can't be blank.")}
            onSave={(description) => update({ tool: { description } })}
          />
          <SavedText
            id={id("tp")}
            label="Prompt parameter"
            saved={brain.tool?.promptParamDescription ?? ""}
            mono
            maxPx={200}
            validate={(v) => (v.trim() ? null : "The prompt description can't be blank.")}
            onSave={(promptParamDescription) => update({ tool: { promptParamDescription } })}
          />
          <SavedText
            id={id("tr")}
            label="Tool result"
            description="What the brain sees after each of its own images."
            saved={brain.tool?.resultContent ?? ""}
            mono
            maxPx={200}
            validate={(v) => (v.trim() ? null : "The tool result can't be blank.")}
            onSave={(resultContent) => update({ tool: { resultContent } })}
          />
        </div>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-4">
        <Button size="sm" variant="ghost" className="-ml-2" onClick={onPayload} title={`The exact request the next Send to ${brain.name} would make`}>
          <Braces aria-hidden className="size-3.5" /> Exact payload
        </Button>
        {isDefault ? (
          <span title="To delete it, make another brain the default first." className="inline-flex items-center gap-1.5 px-1 text-[12.5px] text-faint">
            <Star aria-hidden className="size-3.5" /> Default: the big Send talks to it
          </span>
        ) : (
          <Button size="sm" variant="ghost" loading={busy === "default"} onClick={() => void makeDefault()} title="The big Send (and Enter) talks to the default brain">
            {busy !== "default" && <Star aria-hidden className="size-3.5" />} Make default
          </Button>
        )}
        <div className="ml-auto">
          <DeleteBrain
            name={brain.name}
            isDefault={isDefault}
            messageCount={messageCount}
            writing={writing}
            confirming={confirmDelete}
            pending={busy === "delete"}
            onAsk={() => setConfirmDelete(true)}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() => void remove()}
          />
        </div>
      </div>
    </div>
  );
}

/** Delete only when unused: a brain that has spoken stays, because the other brains still see its lines. */
function DeleteBrain({
  name,
  isDefault,
  messageCount,
  writing,
  confirming,
  pending,
  onAsk,
  onCancel,
  onConfirm,
}: {
  name: string;
  isDefault: boolean;
  messageCount: number;
  writing: boolean;
  confirming: boolean;
  pending: boolean;
  onAsk(): void;
  onCancel(): void;
  onConfirm(): void;
}) {
  const why = isDefault
    ? "The default brain can't be deleted. Make another brain the default first."
    : messageCount > 0
      ? `${name} has ${messageCount} message${messageCount === 1 ? "" : "s"}, so it stays: the other brains still see ${messageCount === 1 ? "it" : "them"} under its name. Rename it or change its prompt instead.`
      : writing
        ? `${name} is writing a reply right now.`
        : null;
  if (isDefault) return null; // "Default: the big Send talks to it" beside this says enough; the tooltip on Make default explains
  if (why) {
    return (
      <span title={why} className="inline-flex cursor-help px-1 text-[12px] text-faint/80">
        {messageCount > 0 ? "Has spoken, so it stays" : "Writing a reply"}
      </span>
    );
  }
  if (confirming) {
    return (
      <div role="alertdialog" aria-label={`Delete ${name}?`} className="flex items-center gap-1.5">
        <span className="text-[12.5px] text-red-100/90">Delete {name}?</span>
        <Button size="sm" variant="danger" className="h-7 px-2" loading={pending} autoFocus onClick={onConfirm} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}>
          Delete
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <Button size="sm" variant="ghost" className="-mr-2 text-red-200/80 hover:bg-red-400/10 hover:text-red-100" onClick={onAsk} title="It has never spoken, so nothing in the ledger depends on it">
      <Trash2 aria-hidden className="size-3.5" /> Delete
    </Button>
  );
}

/** The server's badge palette, plus any color you like. A click saves (a color is never sent to a model). */
function ColorPicker({ value, onPick, disabled }: { value: string; onPick(c: string): void; disabled?: boolean }) {
  const current = value.toLowerCase();
  const custom = !BRAIN_COLORS.some((c) => c === current);
  return (
    <div role="radiogroup" aria-label="Badge color" className="flex flex-wrap items-center gap-1.5">
      {BRAIN_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={current === c}
          aria-label={c}
          title={c}
          disabled={disabled}
          onClick={() => current !== c && onPick(c)}
          className={cx(
            "grid size-6 place-items-center rounded-full transition-transform enabled:hover:scale-110",
            current === c ? "ring-2 ring-offset-2 ring-offset-raised" : "",
          )}
          style={{ backgroundColor: c, ["--tw-ring-color" as string]: c }}
        />
      ))}
      <label
        title="Any color"
        className={cx(
          "relative grid size-6 cursor-pointer place-items-center rounded-full border border-dashed border-line-strong text-faint transition-colors hover:text-fg",
          custom && "ring-2 ring-offset-2 ring-offset-raised",
        )}
        style={custom ? { backgroundColor: value, borderStyle: "solid", ["--tw-ring-color" as string]: value } : undefined}
      >
        {!custom && <Plus aria-hidden className="size-3.5" />}
        <NativeColor key={value} value={value} disabled={disabled} onPick={onPick} />
      </label>
    </div>
  );
}

/**
 * The browser's color dialog. React's onChange fires on every drag step; this saves once, on the native
 * `change` event, when the dialog commits a color.
 */
function NativeColor({ value, onPick, disabled }: { value: string; onPick(c: string): void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => pick.current(el.value);
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);
  return (
    <input
      ref={ref}
      type="color"
      aria-label="Any color"
      defaultValue={/^#[0-9a-f]{6}$/i.test(value) ? value : "#9aa3b0"}
      disabled={disabled}
      className="absolute inset-0 cursor-pointer opacity-0"
    />
  );
}
