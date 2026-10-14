import { Braces, ChevronDown, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import type { Brain, Conversation, ModelInfo } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Notice } from "../../components/Notice.tsx";
import { Segmented } from "../../components/Segmented.tsx";
import { TextArea } from "../../components/TextArea.tsx";
import { TextField } from "../../components/TextField.tsx";
import { cx } from "../../lib/cx.ts";
import { BrainBadge } from "../chat/BrainBadge.tsx";
import { BrainEditor } from "./BrainEditor.tsx";

/**
 * The brains: one quiet card each (badge, what is on, how much it has said, its prompt's first line), opened
 * one at a time into the full editor. Each card's braces show that brain's exact payload. A conversation with
 * a single brain opens it straight away, as T02 did.
 */
export function BrainsTab({
  conv,
  model,
  writingBrainId,
  addNonce,
  onBrain,
  onPatch,
  onPayload,
}: {
  conv: Conversation;
  model: ModelInfo | null | undefined;
  /** The brain writing a reply right now, if any. */
  writingBrainId: string | null;
  /** Changes when something outside asks for the add form ("Add a brain" in an empty conversation). */
  addNonce: number;
  onBrain(b: Brain): void;
  onPatch(fn: (c: Conversation) => Conversation): void;
  onPayload(brainId: string): void;
}) {
  const [openId, setOpenId] = useState<string | null>(() => (conv.brains.length === 1 ? conv.brains[0]!.id : null));
  const [adding, setAdding] = useState(false);
  const counts = useMemo(() => {
    const n = new Map<string, number>();
    for (const m of conv.messages) if (m.author.type === "brain") n.set(m.author.brainId, (n.get(m.author.brainId) ?? 0) + 1);
    return n;
  }, [conv.messages]);

  useEffect(() => {
    if (addNonce) setAdding(true);
  }, [addNonce]);

  return (
    <div className="px-5 pt-4 pb-8">
      <p className="mb-4 text-[12.5px] leading-5 text-faint">
        Each brain is a persona with its own system prompt. All of them share the ledger: a brain sees its own lines as its replies, and everyone else's framed
        with their name.
      </p>
      <div className="space-y-2.5">
        {conv.brains.map((b) => (
          <BrainCard
            key={b.id}
            brain={b}
            open={openId === b.id}
            onToggle={() => setOpenId((o) => (o === b.id ? null : b.id))}
            isDefault={b.id === conv.defaultBrainId}
            messageCount={counts.get(b.id) ?? 0}
            writing={writingBrainId === b.id}
            onPayload={() => onPayload(b.id)}
          >
            <BrainEditor
              conversationId={conv.id}
              brain={b}
              isDefault={b.id === conv.defaultBrainId}
              messageCount={counts.get(b.id) ?? 0}
              writing={writingBrainId === b.id}
              model={model}
              onSaved={onBrain}
              onDefault={(id) => onPatch((c) => ({ ...c, defaultBrainId: id }))}
              onDeleted={(id) => onPatch((c) => ({ ...c, brains: c.brains.filter((x) => x.id !== id) }))}
              onPayload={() => onPayload(b.id)}
            />
          </BrainCard>
        ))}
      </div>
      <div className="mt-3">
        {adding ? (
          <AddBrainForm
            conversationId={conv.id}
            onCancel={() => setAdding(false)}
            onAdded={(b) => {
              onBrain(b);
              setAdding(false);
              setOpenId(b.id);
            }}
          />
        ) : (
          <Button size="sm" variant="ghost" className="-ml-1" onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-4" /> Add a brain
          </Button>
        )}
      </div>
    </div>
  );
}

function BrainCard({
  brain,
  open,
  onToggle,
  isDefault,
  messageCount,
  writing,
  onPayload,
  children,
}: {
  brain: Brain;
  open: boolean;
  onToggle(): void;
  isDefault: boolean;
  messageCount: number;
  writing: boolean;
  onPayload(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);
  const tags = [
    isDefault && "default",
    brain.kind === "image" && "image",
    brain.reasoning.enabled && `reasoning ${brain.reasoning.effort}`,
    brain.finalReminder.enabled && brain.finalReminder.content.trim() && "reminder",
  ].filter((t): t is string => !!t);
  const firstLine = brain.systemPrompt.trim().split("\n")[0];
  return (
    <div
      ref={ref}
      className={cx("scroll-mt-3 rounded-xl border transition-colors", open ? "border-line-strong bg-raised/50" : "border-line bg-raised/25 hover:border-line-strong")}
    >
      <div className="flex items-start gap-1 pr-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${brain.name}${tags.length ? `, ${tags.join(", ")}` : ""}, ${plural(messageCount, "message")}`}
          onClick={onToggle}
          className={cx("min-w-0 flex-1 rounded-xl px-3.5 text-left", open ? "py-3" : "pt-3 pb-2.5")}
        >
          <span className="flex min-w-0 items-center gap-2">
            <BrainBadge name={brain.name} color={brain.color} className="min-w-0" />
            {tags.map((t) => (
              <span key={t} className={cx("shrink-0 text-[11.5px]", t === "default" ? "text-muted" : "text-faint")}>
                {t}
              </span>
            ))}
            {writing && <span className="shimmer shrink-0 text-[11.5px] font-medium">writing…</span>}
            {open && <span className="ml-auto shrink-0 text-[11.5px] text-faint/80 tabular-nums">{plural(messageCount, "message")}</span>}
          </span>
          {!open && (
            <span className="mt-1.5 flex items-baseline gap-2 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate text-faint">{firstLine}</span>
              <span className="shrink-0 text-[11.5px] text-faint/80 tabular-nums">{plural(messageCount, "message")}</span>
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onPayload}
          title={`Exact payload: what ${brain.name} would be sent next`}
          aria-label={`Exact payload for ${brain.name}`}
          className="mt-2 grid size-8 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-fg"
        >
          <Braces aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? `Collapse ${brain.name}` : `Edit ${brain.name}`}
          className="mt-2 grid size-8 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-fg"
        >
          <ChevronDown aria-hidden className={cx("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {/* Kept mounted when closed, so a half-typed prompt survives opening another card (it is never sent unsaved). */}
      <div hidden={!open} className="border-t border-line px-3.5 pt-4 pb-3.5">
        {children}
      </div>
    </div>
  );
}

/** A new brain: name, kind and system prompt. Its reminder starts on, pre-filled with an example to edit. */
function AddBrainForm({ conversationId, onAdded, onCancel }: { conversationId: string; onAdded(b: Brain): void; onCancel(): void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Brain["kind"]>("text");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (pending) return;
    if (!name.trim()) return setError("Give it a name: the other brains see its lines under it.");
    if (!systemPrompt.trim()) return setError("Write its system prompt: it is the first message of every request to this brain.");
    setPending(true);
    setError(null);
    try {
      onAdded(await api.call("brain.add", { conversation: conversationId, name: name.trim(), systemPrompt, ...(kind === "image" ? { kind } : {}) }));
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <form
      ref={ref}
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
      className="scroll-mt-3 space-y-4 rounded-xl border border-focus/30 bg-raised/50 p-3.5"
    >
      <div className="flex items-center gap-3">
        <h4 className="flex-1 text-[13px] font-semibold text-fg">New brain</h4>
        <Segmented<Brain["kind"]>
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: "text", label: "Text" },
            { value: "image", label: "Image" },
          ]}
        />
      </div>
      <TextField id="nb-name" label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dice Master" maxLength={60} autoFocus autoComplete="off" />
      <TextArea
        id="nb-sp"
        label="System prompt"
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        placeholder="You are the Dice Master. When the player tries something risky, call for a check and roll it…"
        maxPx={300}
      />
      <p className="text-[12.5px] leading-5 text-faint">
        It joins mid-campaign too: from its first request it sees everything said so far. Its final reminder starts on, with an example you can edit.
        {kind === "image" && " Image brains get editable tool text and safe mode; their replies arrive in T05."}
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" loading={pending} title="Add brain (⌘ Enter)">
          Add brain
        </Button>
      </div>
    </form>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
