import { Check, Copy, Pin, RotateCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import { isAllHidden, PIN_AS_WORDS, ROLL_PREVIEW_NOTE, stopNote, type Brain, type ChatMessage, type PinRole, type Preview } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { D20Icon } from "../../components/D20.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { Notice } from "../../components/Notice.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { copyText } from "../../lib/clipboard.ts";
import { cx } from "../../lib/cx.ts";
import { rollLineIndex } from "../../lib/rolls.ts";
import { BrainBadge } from "../chat/BrainBadge.tsx";

/**
 * Which request to show: the next Send (with the unsent composer text, and a roll when the die is armed), or a
 * Regenerate with its steer, or (T15) a fresh take with its thought (T17: the Muse's note), exactly as the box holds it.
 */
export type PayloadRequest = { kind: "turn"; draft: string; roll?: boolean } | { kind: "regenerate"; messageId: string; steer: string; thought?: string };

/**
 * "Exact payload": prompt.preview for one brain, which is built by the same code path that turn and
 * message.regenerate send with. For Send it includes the unsent composer text; for Regenerate, the steer as
 * typed so far. Two views: each message verbatim, or the raw JSON body.
 *
 * For Send, a row of brain badges switches whose point of view it is, so "what does the Dice Master see of
 * the GM's last line?" is one click: its own lines are `assistant`, everyone else's are framed `user` messages.
 *
 * An image brain's request (T05) is followed by the second one its answer leads to: POST /image/generate with
 * the prompt from its tool call, word for word, and the parameters shown (`preview.image`), with any notes on
 * settings this image model doesn't take.
 *
 * A roll-and-send (T09) is previewed with prompt.preview --roll: the die isn't rolled until you send, so the roll's
 * line has {{roll}} where the number will go (marked here), and ROLL_PREVIEW_NOTE says so. "With a roll" in the
 * footer switches it, starting from the composer's die.
 */
export function PayloadDialog({
  conversationId,
  brains,
  brainId: initialBrainId,
  request,
  onClose,
}: {
  conversationId: string;
  brains: Brain[];
  brainId: string;
  request: PayloadRequest;
  onClose(): void;
}) {
  const [brainId, setBrainId] = useState(initialBrainId);
  const brain = brains.find((b) => b.id === brainId) ?? brains[0]!;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"messages" | "json">("messages");
  const [copied, setCopied] = useState(false);
  const [withRoll, setWithRoll] = useState(request.kind === "turn" && request.roll === true);
  const regen = request.kind === "regenerate" ? request : null;
  const draft = request.kind === "turn" ? request.draft : "";
  const withDraft = draft.trim() !== "";
  const thought = regen?.thought;
  const steer = thought === undefined ? (regen?.steer.trim() ?? "") : "";
  const regenId = regen?.messageId;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const args = regenId
        ? { conversation: conversationId, regenerate: true, message: regenId, ...(steer ? { steer } : {}), ...(thought !== undefined ? { thought } : {}) }
        : { conversation: conversationId, brain: brain.id, ...(withDraft ? { content: draft } : {}), ...(withRoll ? { roll: true } : {}) };
      setPreview(await api.call("prompt.preview", args));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [conversationId, brain.id, draft, withDraft, withRoll, regenId, steer, thought]);

  useEffect(() => {
    void load();
  }, [load]);

  const body = preview?.body;
  const { messages = [], ...params } = body ?? {};
  const rollAt = preview?.notes.includes(ROLL_PREVIEW_NOTE) ? rollLineIndex(messages, brain.finalReminder) : -1;
  /** T17: a fresh take's request: where the Muse's note is in it (the last message that carries its text). */
  const note = preview?.regenerate?.note;
  const noteText = preview?.regenerate?.thought;
  const noteAt = note && noteText !== undefined ? messages.findLastIndex((m) => typeof m.content === "string" && m.content.includes(noteText)) : -1;

  return (
    <Dialog
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          {regen ? "Regenerate payload" : "Exact payload"} {(regen || brains.length === 1) && <BrainBadge name={brain.name} color={brain.color} />}
        </span>
      }
      subtitle={
        regen ? (
          <>
            <code className="font-mono text-[11.5px] text-muted">POST /chat/completions</code>, exactly as Regenerate would make it
            {preview?.regenerate ? ` (version ${preview.regenerate.newVersion})` : ""}, minus the API key.{" "}
            {thought !== undefined
              ? `A fresh take: the messages before this one, without it, ending on the Muse's note (framed like any helper's)${noteAt !== -1 && noteAt < messages.length - 1 ? ", then the final reminder" : ""}. ${brain.name} answers the note, which is saved when you send.`
              : steer
                ? "The version on screen stays in, and your steer goes last. Only this one request carries the steer."
                : "A plain re-roll: the messages before this one, without it."}
          </>
        ) : (
          <>
            <code className="font-mono text-[11.5px] text-muted">POST /chat/completions</code>, exactly as the next Send to {brain.name} would make it, minus
            the API key.{" "}
            {withDraft && withRoll
              ? "Your unsent message is included, framed, then your roll, with {{roll}} where the number will go."
              : withDraft
                ? "Your unsent message is included, framed, as the last ledger message."
                : withRoll
                  ? "Your roll is the last ledger message, with {{roll}} where the number will go."
                  : `With the composer empty, ${brain.name} just answers the ledger as it stands.`}
            {!regen && brains.length > 1 && <BrainSwitcher brains={brains} value={brain.id} onChange={setBrainId} />}
          </>
        )
      }
      footer={
        <>
          <div role="tablist" aria-label="View" className="inline-flex rounded-lg border border-line-strong p-0.5">
            {(["messages", "json"] as const).map((v) => (
              <button
                key={v}
                role="tab"
                type="button"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cx(
                  "h-7 rounded-md px-2.5 text-[12.5px] transition-colors",
                  view === v ? "bg-hover text-fg" : "text-faint hover:text-muted",
                )}
              >
                {v === "messages" ? "Messages" : "Raw JSON"}
              </button>
            ))}
          </div>
          {!regen && (
            <button
              type="button"
              aria-pressed={withRoll}
              onClick={() => setWithRoll((r) => !r)}
              title={withRoll ? "Show the next send without a roll" : "Show the next send with a d20 roll after your message (what the die in the composer does)"}
              className={cx(
                "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] transition-colors",
                withRoll ? "border-silver/30 bg-silver/[0.1] text-fg" : "border-line-strong text-faint hover:text-muted",
              )}
            >
              <D20Icon className="size-3.5" /> With a roll
            </button>
          )}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void load()} disabled={loading}>
            <RotateCw aria-hidden className="size-3.5" /> Refresh
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!body}
            onClick={async () => {
              if (body && (await copyText(JSON.stringify(body)))) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            }}
          >
            {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
            {copied ? "Copied" : "Copy JSON"}
          </Button>
        </>
      }
    >
      {loading && !preview ? (
        <div className="flex items-center gap-2 py-10 text-[13px] text-faint">
          <Spinner className="size-4" /> Building the request…
        </div>
      ) : error ? (
        <Notice tone="error">{error}</Notice>
      ) : preview && body ? (
        <div className={cx("space-y-4 transition-opacity", loading && "opacity-60")} aria-busy={loading || undefined}>
          {preview.notes.map((n) => (
            // The stop note says what a visible setting does; the rest warn of something we can't see or that will fail.
            // T16: the pin and maker notes say what a visible setting does, too.
            // T17: a fresh take's note (the first) says what it does, unless the note isn't hidden: the player would read it.
            <Notice
              key={n}
              tone={
                (body.stop?.length && n === stopNote(body.stop)) ||
                n === ROLL_PREVIEW_NOTE ||
                isT16Note(n, preview.brainName) ||
                (note && n === preview.notes[0] && noteText !== undefined && isAllHidden(noteText)) ||
                (note && n.startsWith(`${note.muse} makes a brain`))
                  ? "info"
                  : "warn"
              }
            >
              {n}
            </Notice>
          ))}
          {preview.refusal && (
            <Notice tone="info">
              <strong className="font-medium text-fg">{regen ? "Regenerate" : "Send"} would refuse this as it stands.</strong> {preview.refusal}
            </Notice>
          )}
          {view === "json" ? (
            <>
              <pre className="overflow-x-auto rounded-lg border border-line bg-canvas p-4 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap text-muted">
                {JSON.stringify(body, null, 2)}
              </pre>
              {preview.image && <ImageRequest image={preview.image} brain={brain} />}
            </>
          ) : (
            <>
              <section>
                <h3 className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">Parameters</h3>
                <pre className="overflow-x-auto rounded-lg border border-line bg-canvas px-4 py-3 font-mono text-[12px] leading-[1.6] break-all whitespace-pre-wrap text-muted">
                  {compactParams(params)}
                </pre>
              </section>
              <section>
                <h3 className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
                  {messages.length} message{messages.length === 1 ? "" : "s"}, in order, verbatim
                </h3>
                <ol className="space-y-2">
                  {messages.map((m, i) => (
                    <PayloadMessage
                      key={i}
                      index={i}
                      message={m}
                      rollLine={i === rollAt}
                      pinned={preview.pinned?.find((p) => p.index === i)}
                      museNote={i === noteAt && note ? { muse: note.muse, isNew: note.isNew, version: note.version, same: note.same } : undefined}
                    />
                  ))}
                </ol>
              </section>
              {preview.image && <ImageRequest image={preview.image} brain={brain} />}
            </>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}

/**
 * The image request an image brain's answer leads to: every field but the prompt, which is the one its tool
 * call writes and goes in word for word. Notes say what this model doesn't take of the conversation's settings.
 */
function ImageRequest({ image, brain }: { image: NonNullable<Preview["image"]>; brain: Brain }) {
  const tool = brain.tool?.name ?? "generate_image";
  const entries = Object.entries(image.params);
  return (
    <section>
      <h3 className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
        Then <span className="font-mono tracking-normal normal-case">POST {image.path}</span>
      </h3>
      <p className="mb-2 text-[12.5px] leading-5 text-faint">
        Once {brain.name} has called <code className="font-mono text-[11.5px] text-muted">{tool}</code>, its prompt goes to the image model word for word, with
        these parameters and nothing else. Every other brain sees that prompt, framed.
      </p>
      {image.notes.map((n) => (
        <Notice key={n} tone="warn" className="mb-2">
          {n}
        </Notice>
      ))}
      <pre className="overflow-x-auto rounded-lg border border-line bg-canvas px-4 py-3 font-mono text-[12px] leading-[1.6] break-all whitespace-pre-wrap text-muted">
        {"{\n"}
        {entries.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},\n`).join("")}
        {"  "}
        <span className="text-fg">"prompt"</span>: <span className="text-sky-200/80">‹the prompt from its {tool} call, word for word›</span>
        {"\n}"}
      </pre>
    </section>
  );
}

/** Whose request to show. Arrow keys move between brains, as in any tab list. */
function BrainSwitcher({ brains, value, onChange }: { brains: Brain[]; value: string; onChange(id: string): void }) {
  return (
    <div
      role="tablist"
      aria-label="Whose request"
      className="mt-3 flex flex-wrap gap-1.5"
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const i = brains.findIndex((b) => b.id === value);
        const next = brains[(i + (e.key === "ArrowRight" ? 1 : brains.length - 1)) % brains.length]!;
        onChange(next.id);
        (e.currentTarget.querySelector(`[data-brain="${next.id}"]`) as HTMLElement | null)?.focus();
      }}
    >
      {brains.map((b) => {
        const on = b.id === value;
        return (
          <button
            key={b.id}
            type="button"
            role="tab"
            data-brain={b.id}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(b.id)}
            className={cx("rounded-full transition-opacity", on ? "opacity-100" : "opacity-50 hover:opacity-85")}
          >
            <BrainBadge name={b.name} color={b.color} className={on ? "ring-1 ring-white/25" : undefined} />
          </button>
        );
      })}
    </div>
  );
}

/** One line per top-level field, nested values inline: the whole set fits above the messages. Raw JSON has the exact body. */
function compactParams(params: Record<string, unknown>): string {
  return Object.entries(params)
    .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(",\n");
}

const ROLE_TONE: Record<ChatMessage["role"], string> = {
  system: "text-amber-200/90 bg-amber-300/[0.08] border-amber-300/20",
  user: "text-sky-200/90 bg-sky-300/[0.07] border-sky-300/20",
  assistant: "text-emerald-200/90 bg-emerald-300/[0.07] border-emerald-300/20",
  tool: "text-violet-200/90 bg-violet-300/[0.08] border-violet-300/20",
};

/** T16: the payload notes on pinned messages (pinnedNote) and on a maker's side effect (makesNote): information, not warnings. */
function isT16Note(n: string, brainName: string): boolean {
  return n.startsWith(`Pinned to ${brainName}: `) || n.startsWith(`${brainName} makes a brain from each new message: `);
}

/**
 * `rollLine`: the roll's own line in a roll preview (T09): its {{roll}} is where the server puts the number.
 * `pinned` (T16): a message pinned to this brain, sent here, right after the setup, rather than at its place.
 */
function PayloadMessage({
  index,
  message: m,
  rollLine,
  pinned,
  museNote,
}: {
  index: number;
  message: ChatMessage;
  rollLine?: boolean;
  /** T17: the Muse's note a fresh take saves when you send (a new message, or a new version of the note there). */
  museNote?: { muse: string; isNew: boolean; version: number; same: boolean } | undefined;
  pinned?: { messageId: string; as: PinRole } | undefined;
}) {
  return (
    <li className="overflow-hidden rounded-lg border border-line bg-canvas">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-1.5">
        <span className="font-mono text-[11px] text-faint tabular-nums">[{index}]</span>
        <span className={cx("rounded border px-1.5 py-px font-mono text-[11px]", ROLE_TONE[m.role])}>{m.role}</span>
        {m.role === "tool" && <span className="font-mono text-[11px] text-faint">tool_call_id {m.tool_call_id}</span>}
        {pinned && (
          <span title={`Pinned: sent here, right after the setup, ${PIN_AS_WORDS[pinned.as]}, and not at its place in the story`} className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted">
            <Pin aria-hidden className="size-3 shrink-0" /> <span className="truncate">pinned {pinned.messageId}</span>
          </span>
        )}
        {museNote && (
          <span
            title="Your idea: a message of its own in the ledger from now on, which every brain reads at this place. Edit or delete it like any message."
            className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted"
          >
            <Sparkles aria-hidden className="size-3 shrink-0" />
            <span className="truncate">
              {museNote.muse}'s note, {museNote.isNew ? "saved when you send" : museNote.same ? `as it is (v${museNote.version})` : `its version ${museNote.version}, saved when you send`}
            </span>
          </span>
        )}
        {rollLine && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted">
            <D20Icon className="size-3" /> your roll, rolled when you send
          </span>
        )}
        <span className="ml-auto text-[11px] text-faint tabular-nums">{m.content.length} chars</span>
      </div>
      {m.content !== "" && (
        <pre className="px-3.5 py-2.5 font-mono text-[12.5px] leading-[1.65] break-words whitespace-pre-wrap text-fg">
          {rollLine
            ? m.content.split("{{roll}}").map((part, i) => (
                <span key={i}>
                  {i > 0 && (
                    <mark title="The server puts the number it rolls (1 to 20) here, when you send" className="rounded-sm bg-sky-300/15 px-0.5 text-sky-100">
                      {"{{roll}}"}
                    </mark>
                  )}
                  {part}
                </span>
              ))
            : m.content}
        </pre>
      )}
      {m.role === "assistant" && m.tool_calls && (
        <pre className="border-t border-line px-3.5 py-2.5 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap text-muted">
          tool_calls: {JSON.stringify(m.tool_calls, null, 2)}
        </pre>
      )}
    </li>
  );
}
