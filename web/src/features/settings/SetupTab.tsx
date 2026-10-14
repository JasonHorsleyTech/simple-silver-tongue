import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import { DEFAULT_SETUP_LABEL, SETUP_ROLES, type Conversation, type SetupListing, type SetupMessage, type SetupRole } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Notice } from "../../components/Notice.tsx";
import { SavedLine } from "../../components/SavedLine.tsx";
import { SavedText } from "../../components/SavedText.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { cx } from "../../lib/cx.ts";
import { compactNumber } from "../../lib/format.ts";

/**
 * Setup messages (World Bible, module, house rules): sent verbatim, in this order, to every brain right after
 * its system prompt, each with its role (T13). A list of quiet cards, opened one at a time to edit; arrows
 * reorder. Every setup command answers with the whole list, which replaces ours.
 */

/** T13: what each role means for every brain, under the "Sent as" picker. */
const ROLE_HINT: Record<SetupRole, string> = {
  user: "A user message, as the player's messages are. The default.",
  assistant: "Every brain reads it as its own words: the reply half of a staged exchange.",
  system: "A second system message, sent as its own message where it stands (never merged into a brain's system prompt). DeepSeek seems to read every system message together, at the top.",
};
export function SetupTab({
  conv,
  addNonce,
  focusId,
  onFocused,
  onSetup,
}: {
  conv: Conversation;
  /** Changes when something outside asks for the add form ("Add a World Bible" in an empty conversation). */
  addNonce: number;
  /** A setup message added outside (T10: the empty conversation's "Write the World Bible"): open it, cursor in its text. */
  focusId?: string | null;
  onFocused?(): void;
  onSetup(setup: SetupMessage[]): void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null); // just added: focus its text
  const list = conv.setup;

  useEffect(() => {
    if (addNonce) setAdding(true);
  }, [addNonce]);

  useEffect(() => {
    if (!focusId) return;
    setOpenId(focusId);
    setFresh(focusId);
    onFocused?.();
  }, [focusId, onFocused]);

  async function run(p: Promise<SetupListing>): Promise<SetupListing | null> {
    setError(null);
    try {
      const r = await p;
      onSetup(r.setup);
      return r;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    }
  }

  async function move(s: SetupMessage, position: number) {
    setMoving(s.id);
    await run(api.call("setup.move", { conversation: conv.id, setup: s.id, position }));
    setMoving(null);
  }

  return (
    <div className="px-5 pt-4 pb-8">
      <p className="mb-4 text-[12.5px] leading-5 text-faint">
        Sent verbatim, in this order, to every brain right after its system prompt: the world, the module, house rules. Each goes as its own message, with
        the role you pick. The label is for you; only the text is sent.
      </p>
      {error && (
        <Notice tone="error" className="mb-3">
          {error}
        </Notice>
      )}
      {list.length === 0 && !adding && (
        <div className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-center text-[13px] text-faint">No setup messages yet.</div>
      )}
      <ol className="space-y-2.5">
        {list.map((s, i) => (
          <li key={s.id}>
            <SetupCard
              conversationId={conv.id}
              setup={s}
              index={i}
              count={list.length}
              open={openId === s.id}
              focusText={fresh === s.id}
              moving={moving === s.id}
              onToggle={() => setOpenId((o) => (o === s.id ? null : s.id))}
              onMove={(position) => void move(s, position)}
              onRun={run}
              onSetup={onSetup}
              onDeleted={() => setOpenId(null)}
            />
          </li>
        ))}
      </ol>
      <div className="mt-3">
        {adding ? (
          <AddSetupForm
            suggested={list.some((s) => s.label.toLowerCase() === DEFAULT_SETUP_LABEL.toLowerCase()) ? "" : DEFAULT_SETUP_LABEL}
            onCancel={() => setAdding(false)}
            onAdd={async (label) => {
              const r = await run(api.call("setup.add", { conversation: conv.id, ...(label ? { label } : {}) }));
              if (!r) return;
              setAdding(false);
              setOpenId(r.changed ?? null);
              setFresh(r.changed ?? null);
            }}
          />
        ) : (
          <Button size="sm" variant="ghost" className="-ml-1" onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-4" /> Add a setup message
          </Button>
        )}
      </div>
    </div>
  );
}

function SetupCard({
  conversationId,
  setup: s,
  index,
  count,
  open,
  focusText,
  moving,
  onToggle,
  onMove,
  onRun,
  onSetup,
  onDeleted,
}: {
  conversationId: string;
  setup: SetupMessage;
  index: number;
  count: number;
  open: boolean;
  focusText: boolean;
  moving: boolean;
  onToggle(): void;
  /** 1-based, as setup.move takes it. */
  onMove(position: number): void;
  onRun(p: Promise<SetupListing>): Promise<SetupListing | null>;
  /** After an edit, whose errors show inline in its own field. */
  onSetup(setup: SetupMessage[]): void;
  onDeleted(): void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const blank = s.content.trim() === "";
  const firstLine = s.content.trim().split("\n").find((l) => l.trim() && !/^<!--.*-->$/.test(l.trim())) ?? s.content.trim().split("\n")[0];

  useEffect(() => {
    if (!open) {
      setConfirming(false);
      return;
    }
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (focusText) {
      const t = ref.current?.querySelector<HTMLTextAreaElement>("textarea");
      t?.focus();
      t?.setSelectionRange(t.value.length, t.value.length);
    }
  }, [open, focusText]);

  const arrow = "grid size-7 place-items-center rounded-md text-faint transition-colors enabled:hover:bg-hover enabled:hover:text-fg disabled:opacity-30";

  return (
    <div ref={ref} className={cx("scroll-mt-3 rounded-xl border transition-colors", open ? "border-line-strong bg-raised/50" : "border-line bg-raised/25 hover:border-line-strong")}>
      <div className="flex items-start gap-0.5 pr-1.5">
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-w-0 flex-1 gap-3 rounded-xl px-3.5 pt-3 pb-2.5 text-left">
          <span className="mt-px w-4 shrink-0 text-right font-mono text-[12px] text-faint tabular-nums">{index + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="truncate text-[13.5px] font-medium text-fg">{s.label}</span>
              <span className={cx("shrink-0 text-[11.5px]", blank ? "text-amber-200/70" : "text-faint")}>
                {blank ? "blank · not sent" : `${compactNumber(s.content.length)} chars`}
              </span>
              {s.role !== "user" && <span className="shrink-0 rounded border border-line-strong px-1.5 py-px font-mono text-[11px] text-muted">{s.role}</span>}
            </span>
            {!open && !blank && <span className="mt-1 block truncate text-[12.5px] text-faint">{firstLine}</span>}
          </span>
        </button>
        <div className={cx("mt-2 flex items-center", moving && "opacity-50")}>
          <button type="button" className={arrow} disabled={index === 0 || moving} onClick={() => onMove(index)} aria-label={`Move ${s.label} up`} title="Move up">
            <ArrowUp aria-hidden className="size-3.5" />
          </button>
          <button
            type="button"
            className={arrow}
            disabled={index === count - 1 || moving}
            onClick={() => onMove(index + 2)}
            aria-label={`Move ${s.label} down`}
            title="Move down"
          >
            <ArrowDown aria-hidden className="size-3.5" />
          </button>
          <button type="button" className={arrow} onClick={onToggle} aria-label={open ? `Collapse ${s.label}` : `Edit ${s.label}`}>
            <ChevronDown aria-hidden className={cx("size-4 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </div>
      {/* Kept mounted when closed, so unsaved text survives opening another card. */}
      <div hidden={!open} className="space-y-5 border-t border-line px-3.5 pt-4 pb-3.5">
        <SavedLine
          id={`sl-${s.id}`}
          label="Label"
          description="For you only. Never sent."
          saved={s.label}
          inputProps={{ maxLength: 100 }}
          validate={(v) => (v.trim() ? null : "The label can't be empty.")}
          onSave={async (label) => onSetup((await api.call("setup.update", { conversation: conversationId, setup: s.id, label: label.trim() })).setup)}
        />
        <div>
          <div className="flex items-center gap-3">
            <label htmlFor={`sr-${s.id}`} className="flex flex-1 items-center gap-2 text-[13px] font-medium text-fg">
              Sent as
              {roleSaving && <Spinner className="size-3.5 text-faint" />}
            </label>
            <select
              id={`sr-${s.id}`}
              value={s.role}
              disabled={roleSaving}
              onChange={async (e) => {
                const role = e.target.value as SetupRole;
                setRoleSaving(true);
                setRoleError(null);
                try {
                  onSetup((await api.call("setup.update", { conversation: conversationId, setup: s.id, role })).setup);
                } catch (err) {
                  setRoleError(errorMessage(err));
                } finally {
                  setRoleSaving(false);
                }
              }}
              className="h-8 rounded-md border border-line-strong bg-raised px-2 font-mono text-[12.5px] text-fg outline-none focus:border-focus/60 disabled:opacity-60"
            >
              {SETUP_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-1 text-[12.5px] leading-5 text-faint">{ROLE_HINT[s.role]}</p>
          {roleError && (
            <Notice tone="error" className="mt-2">
              {roleError}
            </Notice>
          )}
        </div>
        <SavedText
          id={`sc-${s.id}`}
          label="Text"
          description="Every brain reads this, word for word. Markdown is fine."
          saved={s.content}
          maxPx={520}
          warn={(v) => (v.trim() ? null : "Blank: it is skipped, so no brain sees it.")}
          onSave={async (content) => onSetup((await api.call("setup.update", { conversation: conversationId, setup: s.id, content })).setup)}
        />
        <div className="flex justify-end border-t border-line pt-3">
          {confirming ? (
            <div role="alertdialog" aria-label={`Delete ${s.label}?`} className="flex items-center gap-1.5">
              <span className="text-[12.5px] text-red-100/90">Delete “{s.label}”? No brain sees it from the next request.</span>
              <Button
                size="sm"
                variant="danger"
                className="h-7 px-2"
                loading={deleting}
                autoFocus
                onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setConfirming(false))}
                onClick={async () => {
                  setDeleting(true);
                  const r = await onRun(api.call("setup.delete", { conversation: conversationId, setup: s.id }));
                  setDeleting(false);
                  setConfirming(false);
                  if (r) onDeleted();
                }}
              >
                Delete
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2" disabled={deleting} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="-mr-2 text-red-200/80 hover:bg-red-400/10 hover:text-red-100" onClick={() => setConfirming(true)}>
              <Trash2 aria-hidden className="size-3.5" /> Delete
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A label, then the server pre-fills the text with "<!-- This is the <label>. -->" for you to write on from. */
function AddSetupForm({ suggested, onAdd, onCancel }: { suggested: string; onAdd(label: string): Promise<void>; onCancel(): void }) {
  const [label, setLabel] = useState(suggested);
  const [pending, setPending] = useState(false);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (pending) return;
    setPending(true);
    await onAdd(label.trim());
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-focus/30 bg-raised/50 p-3.5">
      <label htmlFor="ns-label" className="mb-1 block text-[13px] font-medium text-fg">
        New setup message
      </label>
      <p className="mb-2 text-[12.5px] leading-5 text-faint">
        Name it; its text starts as <code className="font-mono text-[11.5px] text-muted">{`<!-- This is the ${label.trim() || DEFAULT_SETUP_LABEL}. -->`}</code> for you to write on from.
      </p>
      <div className="flex items-center gap-1.5">
        <input
          id="ns-label"
          value={label}
          autoFocus
          maxLength={100}
          placeholder={DEFAULT_SETUP_LABEL}
          autoComplete="off"
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              onCancel();
            }
          }}
          className="block h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 text-[14px] text-fg outline-none placeholder:text-faint focus:border-focus/60 focus:ring-3 focus:ring-focus/15"
        />
        <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" loading={pending}>
          Add
        </Button>
      </div>
    </form>
  );
}
