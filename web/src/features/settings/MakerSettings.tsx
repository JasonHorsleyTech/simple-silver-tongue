import { BrainCircuit } from "lucide-react";
import { useState, type FormEvent } from "react";
import { errorMessage } from "../../api/errors.ts";
import { freeMadeName, MAKES_NUMBER, PIN_AS_WORDS, PIN_ROLES, type Brain, type MakesUpdate, type ModelInfo, type PinRole } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Notice } from "../../components/Notice.tsx";
import { SavedLine } from "../../components/SavedLine.tsx";
import { Segmented } from "../../components/Segmented.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { Switch } from "../../components/Switch.tsx";
import { TextArea } from "../../components/TextArea.tsx";
import { BrainBadge } from "../chat/BrainBadge.tsx";
import { PromptFields, type PromptPatch } from "./PromptFields.tsx";

/** How a made brain gets its message, in the picker; PIN_AS_WORDS (the server's) is its tooltip. */
const PIN_LABEL: Record<PinRole, string> = {
  ledger: "As it appears in the story",
  system: "As a system message",
  assistant: "As the new brain's own words",
};

const patternProblem = (v: string) =>
  !v.trim()
    ? "A name pattern can't be empty."
    : !v.includes(MAKES_NUMBER)
      ? `Put ${MAKES_NUMBER} where the number goes ("Character ${MAKES_NUMBER}"), or every brain it made would have the same name.`
      : /[\n\r\t]/.test(v)
        ? "A name pattern is one line."
        : null;

/**
 * T16: "Each new message makes a new brain", in the maker's card: on or off, the name pattern and its counter, how
 * the message is pinned, and the blueprint (every word each new brain starts with, edited like a brain's own). Each
 * made brain gets a copy, so the blueprint shapes only brains still to come: the brains made so far are listed, one
 * click to their cards. A brain without the setting offers to start one (a pattern and the new brains' prompt).
 */
export function MakerSettings({
  brain,
  brains,
  made,
  model,
  imagePlan,
  onImageSettings,
  update,
  busy,
  onOpenBrain,
}: {
  brain: Brain;
  brains: Brain[];
  /** The brains made from this brain's messages that are still here. */
  made: Brain[];
  model: ModelInfo | null | undefined;
  imagePlan: string;
  onImageSettings(): void;
  /** brain.update with `makes` (null removes it). With `what`, the editor shows the spinner and the error. */
  update(makes: MakesUpdate | null, what?: string): Promise<void>;
  busy: string | null;
  onOpenBrain(brainId: string): void;
}) {
  const m = brain.makes;
  const [starting, setStarting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const id = (k: string) => `${k}-mk-${brain.id}`;

  if (!m) {
    return (
      <div className="rounded-lg border border-line bg-canvas/40 p-3.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
              <BrainCircuit aria-hidden className="size-3.5 text-faint" /> Makes brains: off
            </h4>
            <p className="mt-0.5 text-[12.5px] leading-5 text-faint">
              A brain can make a new brain from each new message it gets, with that message pinned to it: a character's sheet becomes that character's own
              brain, a place's note that place's.
            </p>
          </div>
          {!starting && (
            <Button size="sm" variant="ghost" className="-mr-1.5" onClick={() => setStarting(true)}>
              Set up…
            </Button>
          )}
        </div>
        {starting && <StartMaker brain={brain} onStart={(makes) => update(makes)} onCancel={() => setStarting(false)} />}
      </div>
    );
  }

  const next = freeMadeName(brains, m)?.name;
  const save = (patch: PromptPatch, what?: string) => update({ blueprint: patch }, what && `bp-${what}`);
  const bpBusy = busy?.startsWith("bp-") ? busy.slice(3) : null;

  return (
    <div className="space-y-5 rounded-lg border border-line bg-canvas/40 p-3.5">
      <Switch
        id={id("on")}
        label={
          <span className="inline-flex items-center gap-1.5">
            <BrainCircuit aria-hidden className="size-3.5 text-faint" /> Each new message makes a new brain
          </span>
        }
        description={
          m.enabled
            ? `On: every new message ${brain.name} gets (a reply, a stopped one too, or words you write in its mouth) makes a brain from the blueprint below, with that message pinned to it. A regenerate makes none: the pin follows the version you pick.`
            : `Off: new messages make nothing. The setting is kept, and "Make a brain" on any of ${brain.name}'s messages still uses it.`
        }
        checked={m.enabled}
        busy={busy === "mk-on"}
        onChange={(enabled) => void update({ enabled }, "mk-on")}
      />

      <SavedLine
        id={id("name")}
        label="Name pattern"
        description={
          <>
            <code className="font-mono text-[11.5px] text-muted">{MAKES_NUMBER}</code> is where the number goes; the number only counts up, so renaming a brain
            never frees its name for the next one. {next ? <>Next: <span className="text-muted">{next}</span>.</> : "No name it makes is free: change it."}
          </>
        }
        saved={m.name}
        validate={patternProblem}
        inputProps={{ maxLength: 50 }}
        onSave={(name) => update({ name: name.trim() })}
      />

      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <SavedLine
          id={id("next")}
          label="Next number"
          className="w-36"
          saved={String(m.next)}
          validate={(v) => (/^\d{1,7}$/.test(v.trim()) && Number(v) >= 1 ? null : "A whole number, 1 or more.")}
          inputProps={{ inputMode: "numeric" }}
          onSave={(v) => update({ next: Number(v.trim()) })}
        />
        <div>
          <label htmlFor={id("pin")} className="mb-1 flex items-center gap-2 text-[13px] font-medium text-fg">
            The message is pinned {busy === "mk-pin" && <Spinner className="size-3.5 text-faint" />}
          </label>
          <select
            id={id("pin")}
            value={m.pinAs}
            disabled={busy === "mk-pin"}
            title={PIN_AS_WORDS[m.pinAs]}
            onChange={(e) => void update({ pinAs: e.target.value as PinRole }, "mk-pin")}
            className="h-8 rounded-md border border-line-strong bg-raised px-2 text-[13px] text-fg outline-none focus:border-focus/60"
          >
            {PIN_ROLES.map((r) => (
              <option key={r} value={r} title={PIN_AS_WORDS[r]}>
                {PIN_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <h4 className="text-[13px] font-medium text-fg">Made so far</h4>
        {made.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {made.map((b) => (
              <button key={b.id} type="button" onClick={() => onOpenBrain(b.id)} title={`Open ${b.name}'s card`} className="max-w-full rounded-full">
                <BrainBadge name={b.name} color={b.color} />
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-0.5 text-[12.5px] leading-5 text-faint">None yet{m.enabled ? `: ${brain.name}'s next message makes ${next ?? "one"}.` : "."}</p>
        )}
      </div>

      <div className="space-y-5 border-t border-line pt-4">
        <div>
          <h4 className="text-[13px] font-medium text-fg">Blueprint</h4>
          <p className="mt-0.5 text-[12.5px] leading-5 text-faint">
            What each new brain starts with, word for word, but its name and color. Each one gets its own copy, so a change here shapes only the brains still to
            come{made.length ? "; the ones made so far keep theirs (edit each in its own card)" : ""}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex-1 text-[13px] font-medium text-fg">Their kind</span>
          {busy === "bp-kind" && <Spinner className="size-3.5 text-faint" />}
          <Segmented<Brain["kind"]>
            label="Their kind"
            value={m.blueprint.kind}
            disabled={busy === "bp-kind"}
            options={[
              { value: "text", label: "Text" },
              { value: "image", label: "Image" },
            ]}
            onChange={(kind) => void update({ blueprint: { kind } }, "bp-kind")}
          />
        </div>
        <PromptFields
          idBase={`bp-${brain.id}`}
          value={m.blueprint}
          name="each new brain"
          blueprint
          busy={bpBusy}
          model={model}
          imagePlan={imagePlan}
          onImageSettings={onImageSettings}
          save={save}
        />
      </div>

      <div className="flex items-center justify-end gap-1.5 border-t border-line pt-3">
        {confirmRemove ? (
          <div role="alertdialog" aria-label="Stop making brains?" className="flex flex-wrap items-center justify-end gap-1.5">
            <span className="text-[12.5px] text-red-100/90">Remove the setting and its blueprint? The brains made so far stay.</span>
            <Button
              size="sm"
              variant="danger"
              className="h-7 px-2"
              loading={busy === "mk-remove"}
              autoFocus
              onClick={() => void update(null, "mk-remove").then(() => setConfirmRemove(false))}
              onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setConfirmRemove(false))}
            >
              Remove
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="-mr-2 text-faint" onClick={() => setConfirmRemove(true)} title="Remove the setting and its blueprint (brains made so far stay)">
            Stop making brains
          </Button>
        )}
      </div>
    </div>
  );
}

/** Starting the setting: the pattern and the new brains' system prompt (the rest starts as a new brain's would). */
function StartMaker({ brain, onStart, onCancel }: { brain: Brain; onStart(makes: MakesUpdate): Promise<void>; onCancel(): void }) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const p = patternProblem(name) ?? (prompt.trim() ? null : "Write the new brains' system prompt: it is the first message of every request to each of them.");
    if (p) return setProblem(p);
    setPending(true);
    setProblem(null);
    try {
      await onStart({ name: name.trim(), blueprint: { systemPrompt: prompt } });
    } catch (err) {
      setProblem(errorMessage(err));
      setPending(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void submit();
        } else if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      noValidate
      className="mt-4 space-y-4"
    >
      <div>
        <label htmlFor={`mk-new-name-${brain.id}`} className="mb-1 block text-[13px] font-medium text-fg">
          Name pattern
        </label>
        <input
          id={`mk-new-name-${brain.id}`}
          value={name}
          maxLength={50}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          placeholder={`Character ${MAKES_NUMBER}`}
          autoFocus
          className="block h-9 w-full rounded-md border border-line-strong bg-raised px-2.5 text-[13.5px] text-fg outline-none placeholder:text-faint focus:border-focus/60"
        />
        <p className="mt-1 text-[12.5px] leading-5 text-faint">
          <code className="font-mono text-[11.5px] text-muted">{MAKES_NUMBER}</code> is where the number goes: “Character {MAKES_NUMBER}” makes Character 1,
          Character 2, …
        </p>
      </div>
      <TextArea
        id={`mk-new-sp-${brain.id}`}
        label="The new brains' system prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="You play the one person whose sheet comes right after the World Bible…"
        maxPx={260}
      />
      <p className="text-[12.5px] leading-5 text-faint">
        The message that makes each one is pinned to it (sent right after the setup). Their reminder starts on with the example, reasoning off; all of it is
        editable once it is set up. Every new message {brain.name} gets from then on makes a brain.
      </p>
      {problem && <Notice tone="error">{problem}</Notice>}
      <div className="flex items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" loading={pending} title="Start making brains (⌘ Enter)">
          Start making brains
        </Button>
      </div>
    </form>
  );
}
