import { ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../api/client.ts";
import { ApiError, errorMessage } from "../../api/errors.ts";
import { BRAIN_COLORS, type BrainImport, type Conversation, type LibraryBrain } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Notice } from "../../components/Notice.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { cx } from "../../lib/cx.ts";
import { BrainBadge } from "../chat/BrainBadge.tsx";
import { BrainTags } from "../conversations/Cast.tsx";
import { useExamples, usePresets } from "../conversations/library.ts";

type Lib = "preset" | "example";
type Group = { lib: Lib; file: string; title: string; brains: LibraryBrain[]; error?: string };
type Pick = { lib: Lib; file: string; brain: LibraryBrain };

/** The brain here that already has this name (names are unique, ignoring case), if any. */
const holder = (conv: Conversation, name: string) => conv.brains.find((b) => b.name.toLowerCase() === name.trim().toLowerCase());
const taken = (conv: Conversation, name: string) => !!holder(conv, name);

/** The file's name for the brain if it is free here, else the first free "Name 2", "Name 3", ... */
function freeName(conv: Conversation, name: string): string {
  if (!taken(conv, name)) return name;
  for (let n = 2; ; n++) if (!taken(conv, `${name} ${n}`)) return `${name} ${n}`;
}

/**
 * T10: "Add a brain" → "From a preset": every preset's brains, then every example campaign's (brain.import takes
 * both), each with its one line on its job. Pick one, keep or change its name, add it: the whole brain comes over
 * (prompt, reminder, kind, reasoning, stop, tool text, safe mode), and nothing else.
 */
export function ImportBrainPicker({ conv, onImported }: { conv: Conversation; onImported(r: BrainImport): void }) {
  const presets = usePresets();
  const examples = useExamples();
  const groups: Group[] = [
    ...(presets.items ?? []).map((p) => ({ lib: "preset" as const, file: p.name, title: p.title, brains: p.brains, error: p.error })),
    ...(examples.items ?? []).map((e) => ({ lib: "example" as const, file: e.name, title: e.title, brains: e.brains, error: e.error })),
  ];
  const loading = (!presets.items && !presets.error) || (!examples.items && !examples.error);
  // The first usable preset starts open; the rest are one click away.
  const [open, setOpen] = useState<Set<string> | null>(null);
  const openSet = open ?? new Set(groups.filter((g) => !g.error).slice(0, 1).map((g) => `${g.lib}:${g.file}`));
  const [pick, setPick] = useState<Pick | null>(null);

  const toggle = (key: string) =>
    setOpen(() => {
      const next = new Set(openSet);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] leading-5 text-faint">
        A ready-made brain, brought over whole: system prompt, reminder, reasoning, stop sequence (and an image brain's tool text and safe mode). This
        conversation keeps its own World Bible and templates.
      </p>
      {presets.error && <Notice tone="error">Couldn't list the presets. {presets.error}</Notice>}
      {examples.error && <Notice tone="error">Couldn't list the example campaigns. {examples.error}</Notice>}
      {loading && (
        <p className="flex items-center gap-2 text-[12.5px] text-faint">
          <Spinner className="size-3.5" /> Loading the presets…
        </p>
      )}
      {!loading && !groups.length && !presets.error && !examples.error && <p className="text-[12.5px] text-faint">No presets or example campaigns in the repo.</p>}
      {groups.map((g) => {
        const key = `${g.lib}:${g.file}`;
        const isOpen = !g.error && openSet.has(key);
        return (
          <section key={key} aria-label={`${g.title} (${g.lib === "preset" ? "preset" : "example campaign"})`} className="rounded-lg border border-line bg-panel/40">
            <button
              type="button"
              aria-expanded={g.error ? undefined : isOpen}
              disabled={!!g.error}
              onClick={() => toggle(key)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left enabled:hover:bg-hover/60 disabled:cursor-default"
            >
              <ChevronRight aria-hidden className={cx("size-3.5 shrink-0 text-faint transition-transform", isOpen && "rotate-90", g.error && "opacity-0")} />
              <span className="min-w-0 truncate text-[13px] font-medium text-fg">{g.title}</span>
              <span className="ml-auto shrink-0 text-[11.5px] text-faint">
                {g.lib === "preset" ? "preset" : "example"}
                {!g.error && ` · ${g.brains.length} brain${g.brains.length === 1 ? "" : "s"}`}
              </span>
            </button>
            {g.error && (
              <Notice tone="error" className="mx-3 mb-3">
                Can't be used: {g.error}
              </Notice>
            )}
            {isOpen && (
              <div className="px-1.5 pb-1.5">
                {g.lib === "example" && (
                  <p className="px-1.5 pb-2 text-[12px] leading-[1.45] text-faint">Written for this campaign: their prompts may name its world and people.</p>
                )}
                <ul className="space-y-0.5">
                  {g.brains.map((b, i) => {
                    const selected = pick?.lib === g.lib && pick.file === g.file && pick.brain.name === b.name;
                    return (
                      <li key={b.name} className={cx("rounded-md border", selected ? "border-line-strong bg-raised" : "border-transparent")}>
                        <button
                          type="button"
                          aria-expanded={selected}
                          onClick={() => setPick(selected ? null : { lib: g.lib, file: g.file, brain: b })}
                          className={cx("w-full rounded-md px-2 py-2 text-left", !selected && "hover:bg-hover/60")}
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <BrainBadge name={b.name} color={b.color ?? BRAIN_COLORS[i % BRAIN_COLORS.length]!} className="max-w-[70%]" />
                            <BrainTags kind={b.kind} reasoning={b.reasoning} makes={b.makes} />
                            {taken(conv, b.name) && <span className="shrink-0 text-[11.5px] text-faint">· one here already</span>}
                          </span>
                          {b.about && <span className="mt-1 block text-[12.5px] leading-[1.45] text-muted">{b.about}</span>}
                        </button>
                        {selected && <AddAs key={`${key}:${b.name}`} conv={conv} pick={pick} onImported={onImported} />}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** The picked brain's name (editable: a clash here is a 409 until it is renamed), and Add. */
function AddAs({ conv, pick, onImported }: { conv: Conversation; pick: Pick; onImported(r: BrainImport): void }) {
  const original = pick.brain.name;
  const [name, setName] = useState(() => freeName(conv, original));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const renamed = name.trim() !== original;
  const clash = holder(conv, name);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
    // Bring the name and Add into view when the picked brain is low in the panel. The panel scrolls, never the
    // page: scrollIntoView would move the page too (T05 frontend lesson).
    const form = formRef.current;
    const box = form?.closest("#settings-body");
    if (!form || !box) return;
    const below = form.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom + 12;
    if (below > 0) box.scrollBy({ top: below, behavior: "smooth" });
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!name.trim()) {
      setError("Give it a name: the other brains see its lines under it.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      onImported(
        await api.call("brain.import", {
          conversation: conv.id,
          ...(pick.lib === "preset" ? { preset: pick.file } : { example: pick.file }),
          brain: original,
          ...(renamed ? { name: name.trim() } : {}),
        }),
      );
    } catch (err) {
      // A 409 is the name clash (brain.import's own wording names the CLI flag). The hint under the name says so
      // already when this tab knows the other brain; otherwise (added elsewhere a moment ago) the error does.
      setError(err instanceof ApiError && err.code === "conflict" ? (holder(conv, name) ? null : `Another brain here is already called “${name.trim()}”: give this one another name.`) : errorMessage(err));
      setPending(false);
      ref.current?.focus();
      ref.current?.select();
    }
  }

  return (
    <form ref={formRef} onSubmit={add} noValidate className="space-y-2 px-2 pt-1 pb-2.5">
      <label htmlFor="ib-name" className="block text-[12.5px] font-medium text-muted">
        Name it here
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id="ib-name"
          ref={ref}
          value={name}
          maxLength={60}
          autoComplete="off"
          aria-invalid={!!clash || undefined}
          aria-describedby="ib-name-hint"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          className="block h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-canvas/40 px-2.5 text-[13.5px] text-fg outline-none placeholder:text-faint focus:border-focus/60 focus:ring-3 focus:ring-focus/15 aria-[invalid=true]:border-red-400/60"
        />
        <Button size="sm" variant="primary" type="submit" loading={pending}>
          Add brain
        </Button>
      </div>
      <p id="ib-name-hint" className={cx("text-[12px] leading-[1.45]", clash ? "text-red-200/90" : "text-faint")}>
        {clash
          ? `A brain here is already called “${clash.name}”: pick another name.`
          : taken(conv, original)
            ? `“${original}” is already at this table, so this one gets another name. Any name you like.`
            : "The other brains see its lines under this name."}
      </p>
      {error && <Notice tone="error">{error}</Notice>}
    </form>
  );
}

/**
 * What brain.import said it left behind, after the brain is in (its card is open): sentences for the user, shown
 * as they come, never swallowed. Dismissable; it is gone on the next add too.
 */
export function ImportedNotes({ imported, onDismiss }: { imported: BrainImport; onDismiss(): void }) {
  const from = imported.from.preset !== undefined ? "the preset" : "the example campaign";
  return (
    <Notice tone="info" className="mb-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-fg">
            Added from {from} “{imported.from.title}”, whole: everything below came with it.
          </p>
          {imported.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-m-0.5 rounded p-0.5 opacity-70 hover:opacity-100">
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
    </Notice>
  );
}
