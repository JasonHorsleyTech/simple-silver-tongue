import { BrainCircuit, Check, Pencil, Pin, Search, UserRoundPen, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { freeMadeName, isPatternName, PIN_AS_WORDS, type Brain, type LedgerMessage, type PinRole } from "../../api/types.ts";
import { Spinner } from "../../components/Spinner.tsx";
import { cx } from "../../lib/cx.ts";
import { BrainBadge } from "./BrainBadge.tsx";
import { IconAction } from "./MessageFooter.tsx";

/**
 * T16, on a message: which brain it made and which brains it is pinned to (a pinned message is sent to that brain
 * right after the setup, instead of at its place), with Rename for the made brain and Unpin for each pin. Under the
 * message's body, so a character sheet (usually a folded hidden note) says whose sheet it is.
 *
 * A brain made while you watch (`fresh`) opens its name field at once: it is "Character 3" until the story says who
 * she is, and renaming is the one thing left to do. Nothing here knows what a character is: a "Place {{n}}" brain
 * made from a place's note looks the same.
 */
export function LinksBand({
  made,
  maker,
  pins,
  fresh,
  making,
  brains,
  onOpenBrain,
  onRename,
  onUnpin,
  onMake,
  onCancelMake,
}: {
  /** The brain made from this message, if it is still here. */
  made: Brain | null;
  /** The message's author, when it makes brains (its pattern says whether `made` was renamed yet, and names the next one). */
  maker: Brain | null;
  /** Every brain this message is pinned to (the made brain's own pin included). */
  pins: Array<{ brain: Brain; as: PinRole }>;
  fresh: boolean;
  /** "Make a brain from this" is open (the footer's button). */
  making: boolean;
  brains: Brain[];
  onOpenBrain(brainId: string): void;
  onRename(brainId: string, name: string): Promise<string | null>;
  onUnpin(brainId: string): Promise<string | null>;
  onMake(name?: string): Promise<string | null>;
  onCancelMake(): void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [unpinning, setUnpinning] = useState<string | null>(null);
  const others = pins.filter((p) => p.brain.id !== made?.id);
  const madePin = made ? pins.find((p) => p.brain.id === made.id) : undefined;
  if (!made && others.length === 0 && !making) return null;

  const unpin = async (brainId: string) => {
    setUnpinning(brainId);
    setProblem(null);
    const p = await onUnpin(brainId);
    setUnpinning(null);
    setProblem(p);
  };

  return (
    <div data-links className="mt-3 space-y-1.5 text-[12.5px] text-faint">
      {made && (
        <MadeLine
          brain={made}
          pinAs={madePin?.as ?? null}
          unnamed={!!maker?.makes && isPatternName(maker.makes.name, made.name)}
          fresh={fresh}
          onOpen={() => onOpenBrain(made.id)}
          onRename={(name) => onRename(made.id, name)}
        />
      )}
      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <Pin aria-hidden className="size-3.5 shrink-0" />
          <span className="shrink-0">{made ? "Also pinned to" : "Pinned to"}</span>
          {others.map(({ brain, as }) => (
            <span key={brain.id} className="inline-flex max-w-full items-center">
              <button
                type="button"
                onClick={() => onOpenBrain(brain.id)}
                title={`${brain.name} gets this message right after the setup, ${PIN_AS_WORDS[as]}, and not at its place. Open its card.`}
                className="min-w-0 rounded-full"
              >
                <BrainBadge name={brain.name} color={brain.color} />
              </button>
              {as !== "ledger" && <span className="ml-1 shrink-0 text-[11.5px]">as {as === "system" ? "a system message" : "its own words"}</span>}
              <button
                type="button"
                onClick={() => void unpin(brain.id)}
                disabled={unpinning !== null}
                aria-label={`Unpin from ${brain.name}`}
                title={`Unpin from ${brain.name}: it sees this message at its place in the story again`}
                className="ml-0.5 grid size-5 shrink-0 place-items-center rounded text-faint transition-colors hover:bg-hover hover:text-fg"
              >
                {unpinning === brain.id ? <Spinner className="size-3" /> : <X aria-hidden className="size-3" />}
              </button>
            </span>
          ))}
        </div>
      )}
      {making && maker?.makes && <MakeForm maker={maker} brains={brains} onMake={onMake} onCancel={onCancelMake} />}
      {problem && <p className="text-amber-200/85">{problem}</p>}
    </div>
  );
}

/** "Made Character 3 from this message · Rename": the name field opens by itself for a brain just made. */
function MadeLine({
  brain,
  pinAs,
  unnamed,
  fresh,
  onOpen,
  onRename,
}: {
  brain: Brain;
  /** How it has this message pinned; null: it was unpinned since. */
  pinAs: PinRole | null;
  /** It still has the name its maker's pattern gave it. */
  unnamed: boolean;
  fresh: boolean;
  onOpen(): void;
  onRename(name: string): Promise<string | null>;
}) {
  const [renaming, setRenaming] = useState(fresh && unnamed);
  const how = pinAs ? `pinned to it ${PIN_AS_WORDS[pinAs]}` : "no longer pinned to it";
  if (renaming) {
    return (
      <RenameForm brain={brain} fresh={fresh} onRename={onRename} onDone={() => setRenaming(false)} />
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <BrainCircuit aria-hidden className="size-3.5 shrink-0" />
      <span className="shrink-0">Made</span>
      <button type="button" onClick={onOpen} title={`${brain.name} was made from this message, ${how}. Open its card.`} className="min-w-0 rounded-full">
        <BrainBadge name={brain.name} color={brain.color} />
      </button>
      <span className="hidden min-w-0 sm:inline">{pinAs ? "from this message, pinned at the top of what it reads" : "from this message (no longer pinned to it)"}</span>
      <button
        type="button"
        onClick={() => setRenaming(true)}
        title={`Rename ${brain.name}: every brain sees the new name from then on`}
        className={cx(
          "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 transition-colors",
          unnamed ? "border border-line-strong text-muted hover:bg-hover hover:text-fg" : "text-faint hover:bg-hover hover:text-fg",
        )}
      >
        <Pencil aria-hidden className="size-3" /> Rename
      </button>
    </div>
  );
}

/** A brain's new name, saved with Enter (brain.update). Escape or Cancel keeps the old one. */
function RenameForm({ brain, fresh, onRename, onDone }: { brain: Brain; fresh: boolean; onRename(name: string): Promise<string | null>; onDone(): void }) {
  const [name, setName] = useState(brain.name);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const fieldId = `rename-${brain.id}`;
  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const next = name.trim();
    if (!next) return setProblem("A brain needs a name.");
    if (next === brain.name) return onDone();
    setPending(true);
    setProblem(null);
    const p = await onRename(next);
    setPending(false);
    if (p) setProblem(p);
    else onDone();
  }
  return (
    <form
      onSubmit={submit}
      className="rounded-lg border px-3 py-2.5"
      style={{ borderColor: `color-mix(in oklab, ${brain.color} 35%, transparent)`, backgroundColor: `color-mix(in oklab, ${brain.color} 5%, transparent)` }}
    >
      <label htmlFor={fieldId} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-muted">
        <BrainCircuit aria-hidden className="size-3.5 shrink-0" />
        <span className="font-medium text-fg">{fresh ? "Made a new brain," : "Rename"}</span>
        <BrainBadge name={brain.name} color={brain.color} />
        <span className="font-medium text-fg">{fresh ? "from this message." : ""}</span>
        <span>
          {fresh ? "Rename it once you know who or what it is: " : ""}every brain sees the new name from then on{fresh ? ", and this message stays pinned at the top of what it reads." : "."}
        </span>
      </label>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          id={fieldId}
          ref={input}
          value={name}
          maxLength={60}
          autoComplete="off"
          onChange={(e) => {
            setName(e.target.value);
            setProblem(null);
          }}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onDone();
            }
          }}
          aria-invalid={problem ? true : undefined}
          className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2.5 text-[13.5px] text-fg outline-none focus:border-focus/60 aria-[invalid=true]:border-red-400/60"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-silver px-2.5 text-[12.5px] font-medium text-canvas transition-colors hover:bg-silver-hi disabled:cursor-wait"
        >
          {pending ? <Spinner className="size-3.5" /> : <Check aria-hidden className="size-3.5" />} Rename
        </button>
        <button type="button" onClick={onDone} className="h-8 shrink-0 rounded-md px-2 text-[12.5px] text-faint transition-colors hover:bg-hover hover:text-fg">
          {fresh ? "Later" : "Cancel"}
        </button>
      </div>
      {problem && <p className="mt-1.5 text-[12.5px] text-red-200">{problem}</p>}
    </form>
  );
}

/**
 * "Make a brain from this" (brain.make): the author's blueprint, the message pinned to it, and the next name from its
 * pattern, or one you type (how an older campaign's sheets get their brains: you often know the name already).
 */
function MakeForm({ maker, brains, onMake, onCancel }: { maker: Brain; brains: Brain[]; onMake(name?: string): Promise<string | null>; onCancel(): void }) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const next = freeMadeName(brains, maker.makes!)?.name ?? "";
  const fieldId = `make-${maker.id}`;
  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setPending(true);
    setProblem(null);
    const p = await onMake(name.trim() || undefined);
    setPending(false);
    if (p) setProblem(p);
  }
  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      className="rounded-lg border border-focus/30 bg-focus/[0.05] px-3 py-2.5"
    >
      <label htmlFor={fieldId} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-muted">
        <BrainCircuit aria-hidden className="size-3.5 shrink-0" />
        <span className="font-medium text-fg">Make a brain from this message.</span>
        <span>
          A copy of {maker.name}'s blueprint, with this message pinned at the top of what it reads. Leave the name blank for {next ? `“${next}”` : "the next one"}.
        </span>
      </label>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          id={fieldId}
          value={name}
          maxLength={60}
          autoComplete="off"
          autoFocus
          placeholder={next}
          onChange={(e) => {
            setName(e.target.value);
            setProblem(null);
          }}
          className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2.5 text-[13.5px] text-fg outline-none placeholder:text-faint focus:border-focus/60"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-silver px-2.5 text-[12.5px] font-medium text-canvas transition-colors hover:bg-silver-hi disabled:cursor-wait"
        >
          {pending && <Spinner className="size-3.5" />} Make brain
        </button>
        <button type="button" onClick={onCancel} className="h-8 shrink-0 rounded-md px-2 text-[12.5px] text-faint transition-colors hover:bg-hover hover:text-fg">
          Cancel
        </button>
      </div>
      {problem && <p className="mt-1.5 text-[12.5px] text-red-200">{problem}</p>}
    </form>
  );
}

/**
 * A footer icon that opens a small menu over the scrollback, above or below the button, whichever has more room in
 * the scroll box. Closes on Escape, a click outside, or `close()` from its content. `role="dialog"` is for a small
 * form instead of a list (Clone from here): the arrow keys are then the fields' own.
 */
export function FooterMenu({
  label,
  icon,
  active,
  role = "menu",
  onOpenChange,
  children,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  role?: "menu" | "dialog";
  onOpenChange?(open: boolean): void;
  children(close: () => void): ReactNode;
}) {
  const [open, setOpenState] = useState(false);
  const [up, setUp] = useState(true);
  /** The menu's left edge, from the button's: centered on it, but kept inside the scroll box (a phone is narrow). */
  const [left, setLeft] = useState(0);
  const box = useRef<HTMLSpanElement>(null);
  const setOpen = (o: boolean) => {
    setOpenState(o);
    onOpenChange?.(o);
  };
  const close = () => setOpen(false);
  useLayoutEffect(() => {
    if (!open || !box.current) return;
    const scroller = box.current.closest<HTMLElement>("[data-scrollback]") ?? document.documentElement;
    const r = box.current.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    setUp(r.top - s.top > s.bottom - r.bottom);
    const width = Math.min(MENU_W, s.width - 16);
    const want = r.left + r.width / 2 - width / 2;
    setLeft(Math.round(Math.max(s.left + 8, Math.min(want, s.right - 8 - width)) - r.left));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    // The filter takes the keys at once, except on a touch screen, where focusing it would pop up the keyboard.
    const keys = window.matchMedia("(hover: hover)").matches ? "[data-menu] input, " : "";
    box.current?.querySelector<HTMLElement>(`${keys}[data-menu] [role=menuitemcheckbox]:not(:disabled), [data-menu] [role=menuitemradio]:not(:disabled)`)?.focus();
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  return (
    <span ref={box} className="relative">
      <IconAction label={label} active={open || active} onClick={() => setOpen(!open)}>
        {icon}
      </IconAction>
      {open && (
        <div
          data-menu
          role={role}
          aria-label={label}
          onKeyDown={(e) => {
            if (role !== "menu" || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
            e.preventDefault();
            const items = [...(box.current?.querySelectorAll<HTMLElement>("[data-menu] [role^=menuitem]:not(:disabled)") ?? [])];
            const i = items.indexOf(document.activeElement as HTMLElement);
            items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
          }}
          style={{ left, width: `min(${MENU_W}px, calc(100vw - 32px))` }}
          className={cx(
            "absolute z-30 flex max-h-[min(24rem,50vh)] flex-col rounded-xl border border-line-strong bg-panel p-1.5 text-left text-[13px] shadow-2xl shadow-black/60",
            up ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
        >
          {children(close)}
        </div>
      )}
    </span>
  );
}

const MENU_W = 288;

/** A brain list in a footer menu, with a filter once there are many (a dozen characters). */
function BrainList({ brains, children }: { brains: Brain[]; children(list: Brain[]): ReactNode }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const list = q ? brains.filter((b) => b.name.toLowerCase().includes(q)) : brains;
  return (
    <>
      {brains.length > 8 && (
        <label className="mx-1 mb-1 flex shrink-0 items-center gap-2 rounded-md border border-line-strong bg-raised px-2">
          <Search aria-hidden className="size-3.5 shrink-0 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a brain"
            aria-label="Find a brain"
            className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint"
          />
        </label>
      )}
      <div className="min-h-0 overflow-y-auto">
        {children(list)}
        {list.length === 0 && <p className="px-2 py-1.5 text-[12.5px] text-faint">No brain by that name.</p>}
      </div>
    </>
  );
}

const ITEM =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors enabled:hover:bg-hover focus:bg-hover focus:outline-none disabled:cursor-not-allowed disabled:opacity-45";

/**
 * Pin to a brain: every brain, the ones it is pinned to checked; a click pins (as it appears in the ledger) or unpins.
 * Not a ledger edit, so it works while a reply is being written. How a pin is sent is changed in the brain's card.
 */
export function PinMenu({
  brains,
  pinnedTo,
  onPin,
  onUnpin,
  onOpenChange,
}: {
  brains: Brain[];
  pinnedTo: Map<string, PinRole>;
  onPin(brainId: string): Promise<string | null>;
  onUnpin(brainId: string): Promise<string | null>;
  onOpenChange?(open: boolean): void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const toggle = async (b: Brain) => {
    setPending(b.id);
    setProblem(null);
    const p = pinnedTo.has(b.id) ? await onUnpin(b.id) : await onPin(b.id);
    setPending(null);
    setProblem(p);
  };
  return (
    <FooterMenu label="Pin to a brain" icon={<Pin aria-hidden className="size-3.5" />} active={pinnedTo.size > 0} onOpenChange={onOpenChange}>
      {() => (
        <>
          <p className="shrink-0 px-2 pt-1 pb-1.5 text-[11.5px] leading-4 text-faint">
            Pin to a brain: it gets this message right after the setup, as it stands now (edits and versions included), instead of at its place.
          </p>
          <BrainList brains={brains}>
            {(list) =>
              list.map((b) => {
                const as = pinnedTo.get(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={as !== undefined}
                    disabled={pending !== null}
                    onClick={() => void toggle(b)}
                    title={as ? `Pinned ${PIN_AS_WORDS[as]}. Click to unpin.` : `Pin to ${b.name}, ${PIN_AS_WORDS.ledger}`}
                    className={ITEM}
                  >
                    <span className={cx("grid size-4 shrink-0 place-items-center rounded border", as ? "border-silver/60 bg-silver text-canvas" : "border-line-strong")}>
                      {pending === b.id ? <Spinner className="size-3" /> : as && <Check aria-hidden className="size-3" strokeWidth={3} />}
                    </span>
                    <BrainBadge name={b.name} color={b.color} className="min-w-0" />
                    {as && as !== "ledger" && <span className="ml-auto shrink-0 text-[11px] text-faint">{as}</span>}
                  </button>
                );
              })
            }
          </BrainList>
          {problem && <p className="shrink-0 px-2 pt-1.5 text-[12.5px] text-red-200">{problem}</p>}
        </>
      )}
    </FooterMenu>
  );
}

/**
 * "Said by" (message.set-author): move the message to another brain of its kind, or to or from you, as if it had
 * always been so. The new author reads it as its own words, everyone else framed with the new name. The server's
 * rules show as disabled rows with the reason: an image prompt goes only to an image brain, a message with versions
 * can't be yours, a roll stays yours.
 */
export function AuthorMenu({
  message,
  brains,
  busy,
  busyHint,
  onSet,
  onOpenChange,
}: {
  message: LedgerMessage;
  brains: Brain[];
  busy: boolean;
  busyHint: string;
  onSet(as: string): Promise<string | null>;
  onOpenChange?(open: boolean): void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const author = message.author.type === "brain" ? message.author.brainId : "player";
  const image = message.kind === "image";
  const fit = brains.filter((b) => b.kind === message.kind);
  const toPlayer = image
    ? "An image prompt is said by an image brain."
    : message.versions.length > 1
      ? `It has ${message.versions.length} versions, and a message of yours has one. Delete the others first, or move it to another brain.`
      : null;
  const pick = async (as: string, close: () => void) => {
    if (as === author) return close();
    setPending(as);
    setProblem(null);
    const p = await onSet(as);
    setPending(null);
    if (p) setProblem(p);
    else close();
  };
  return (
    <FooterMenu label="Said by…" icon={<UserRoundPen aria-hidden className="size-3.5" />} onOpenChange={onOpenChange}>
      {(close) => (
        <>
          <p className="shrink-0 px-2 pt-1 pb-1.5 text-[11.5px] leading-4 text-faint">
            Said by… as if it always had been: the new author reads it as its own words, every other brain sees it framed with that name.
          </p>
          {busy && <p className="shrink-0 px-2 pb-1.5 text-[12px] leading-4 text-amber-200/85">{busyHint}</p>}
          <BrainList brains={fit}>
            {(list) =>
              list.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={author === b.id}
                  disabled={busy || pending !== null}
                  onClick={() => void pick(b.id, close)}
                  className={ITEM}
                >
                  <BrainBadge name={b.name} color={b.color} className="min-w-0" />
                  <span className="ml-auto shrink-0">
                    {pending === b.id ? <Spinner className="size-3.5" /> : author === b.id && <Check aria-hidden className="size-3.5 text-muted" />}
                  </span>
                </button>
              ))
            }
          </BrainList>
          <div className="my-1 shrink-0 border-t border-line" />
          <button
            type="button"
            role="menuitemradio"
            aria-checked={author === "player"}
            disabled={busy || pending !== null || (author !== "player" && toPlayer !== null)}
            title={author !== "player" ? (toPlayer ?? "Make it your own message") : undefined}
            onClick={() => void pick("player", close)}
            className={cx(ITEM, "shrink-0")}
          >
            <span className="text-fg">You</span>
            {author !== "player" && toPlayer && <span className="min-w-0 truncate text-[11.5px] text-faint">{image ? "image prompts stay with a brain" : "has versions"}</span>}
            <span className="ml-auto shrink-0">
              {pending === "player" ? <Spinner className="size-3.5" /> : author === "player" && <Check aria-hidden className="size-3.5 text-muted" />}
            </span>
          </button>
          {problem && <p className="shrink-0 px-2 pt-1.5 text-[12.5px] text-red-200">{problem}</p>}
        </>
      )}
    </FooterMenu>
  );
}
