import { Braces, BrainCircuit, LocateFixed, Plus, Star, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import { BRAIN_COLORS, type Brain, type BrainFields, type LedgerMessage, type ModelInfo } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Notice } from "../../components/Notice.tsx";
import { SavedLine } from "../../components/SavedLine.tsx";
import { Segmented } from "../../components/Segmented.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { cx } from "../../lib/cx.ts";
import { BrainBadge } from "../chat/BrainBadge.tsx";
import { MakerSettings } from "./MakerSettings.tsx";
import { messageSnippet, PinnedMessages } from "./PinnedMessages.tsx";
import { PromptFields } from "./PromptFields.tsx";

/**
 * One brain, in full: who it is (name, color, kind, default), then every text that shapes what it is sent
 * (system prompt, its pinned messages, reasoning, final reminder, stop sequences, and an image brain's safe mode and
 * tool text), then (T16) whether it makes brains and their blueprint, then delete. A brain made by another says so at
 * the top: its words are its own copy of that blueprint. Long texts save on purpose (Save / ⌘ Enter); switches,
 * colors and kind save on click.
 */
export function BrainEditor({
  conversationId,
  brain,
  isDefault,
  messageCount,
  writing,
  model,
  imagePlan,
  onSaved,
  onDefault,
  onDeleted,
  onPayload,
  onImageSettings,
  messages,
  brains,
  maker,
  made,
  onJumpTo,
  onOpenBrain,
}: {
  conversationId: string;
  brain: Brain;
  /** T16: the ledger (its pinned messages), every brain (whose they are), the brain that made it, and the ones it made. */
  messages: LedgerMessage[];
  brains: Brain[];
  maker: Brain | null;
  made: Brain[];
  /** T16: show a message in the scrollback; open another brain's card. */
  onJumpTo(messageId: string): void;
  onOpenBrain(brainId: string): void;
  isDefault: boolean;
  /** Its messages in the ledger: with any, it can't be deleted or change kind. */
  messageCount: number;
  /** It is writing a reply right now. */
  writing: boolean;
  model: ModelInfo | null | undefined;
  /** How this conversation paints (image model and size), for an image brain: "z-image-turbo · 1216 × 832". */
  imagePlan: string;
  onSaved(b: Brain): void;
  onDefault(brainId: string): void;
  onDeleted(brainId: string): void;
  onPayload(): void;
  /** Open the conversation's image settings (model, size, format). */
  onImageSettings(): void;
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

  const kindLocked = messageCount > 0 || writing;
  const id = (k: string) => `${k}-${brain.id}`;

  const madeFrom = brain.madeFrom ? messages.find((m) => m.id === brain.madeFrom) : undefined;

  return (
    <div className="space-y-6">
      {madeFrom && (
        <div className="rounded-lg border border-line bg-canvas/40 px-3 py-2.5 text-[12.5px] leading-5 text-faint">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <BrainCircuit aria-hidden className="size-3.5 shrink-0" />
            <span>Made by</span>
            {maker ? (
              <button type="button" onClick={() => onOpenBrain(maker.id)} title={`Open ${maker.name}'s card`} className="rounded-full">
                <BrainBadge name={maker.name} color={maker.color} />
              </button>
            ) : (
              <span>a brain</span>
            )}
            <span>{brain.pins.some((p) => p.messageId === madeFrom.id) ? "from a message, pinned below:" : "from a message (no longer pinned to it):"}</span>
            <button
              type="button"
              onClick={() => onJumpTo(madeFrom.id)}
              className="inline-flex items-center gap-1 rounded px-1 text-muted underline decoration-line-strong underline-offset-4 hover:text-fg"
            >
              <LocateFixed aria-hidden className="size-3" /> Jump to it
            </button>
          </p>
          <p className="mt-1 truncate font-mono text-[12px] text-muted">{messageSnippet(madeFrom)}</p>
          <p className="mt-1">
            Its prompt, reminder, reasoning and stop sequences are its own copy of {maker ? `${maker.name}'s` : "its maker's"} blueprint: change them here for{" "}
            {brain.name} alone. The blueprint{maker ? ` (in ${maker.name}'s card)` : ""} shapes only brains still to come.
          </p>
        </div>
      )}

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
                ? "Answers with a picture: a forced generate_image call writes the prompt, which every other brain sees, and the image model paints it. Can change until it first speaks."
                : "Answers in words. Can change until it first speaks."}
        </p>
      </div>

      {/* T16: its own words and how it is asked; its pinned messages right after the system prompt, as they are sent. */}
      <PromptFields
        idBase={brain.id}
        value={brain}
        name={brain.name}
        busy={busy}
        model={model}
        imagePlan={imagePlan}
        onImageSettings={onImageSettings}
        save={update}
        afterSystemPrompt={
          <PinnedMessages
            brain={brain}
            messages={messages}
            brains={brains}
            onPin={async (message, as) => onSaved((await api.call("brain.pin", { conversation: conversationId, brain: brain.id, message, as })).brain)}
            onUnpin={async (message) => onSaved((await api.call("brain.unpin", { conversation: conversationId, brain: brain.id, message })).brain)}
            onJumpTo={onJumpTo}
          />
        }
      />

      <MakerSettings
        brain={brain}
        brains={brains}
        made={made}
        model={model}
        imagePlan={imagePlan}
        onImageSettings={onImageSettings}
        busy={busy}
        update={(makes, what) => update({ makes }, what)}
        onOpenBrain={onOpenBrain}
      />

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
