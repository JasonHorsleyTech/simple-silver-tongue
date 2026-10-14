import { ArrowUp, Check, ImageIcon, PenLine, Plus, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { STOP_BILL_NOTE, type Brain } from "../../api/types.ts";
import { D20Icon } from "../../components/D20.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { cx } from "../../lib/cx.ts";
import { useAutosize } from "../../lib/useAutosize.ts";
import { BrainBadge } from "./BrainBadge.tsx";

/** `writeAs`: the composer adds your words to the ledger instead of sending: in a brain's mouth, or as yours. */
export const AS_PLAYER = "player";

/**
 * Where the player writes. Enter sends, Shift+Enter adds a newline, and Enter while an IME is composing is
 * left alone.
 *
 * Send targets: the default brain gets the big button (and Enter); every other brain gets a chip in its own
 * color (and ⌥1…⌥9, in chip order). With nothing typed, a chip asks that brain to just respond to the table
 * as it stands (also how a failed reply is retried); the server explains when there is nothing to answer.
 * An image brain's chip (with a small picture icon) asks it for a picture: your text, if any, is its note.
 * Once its prompt is saved the composer is free again, while the image is painted in the scrollback.
 *
 * "Write as…" (the pen) switches to adding words without generating anything: in a brain's mouth (the GM's
 * opening scene) or as your own message. The brain sees them as its own past reply; everyone else, framed
 * with its name. Written as an image brain, the words are its prompt and are painted as written. Enter adds;
 * Escape or × goes back to playing.
 *
 * While a reply is being written (sent here, regenerated, or followed from the CLI) the chips give way to who
 * is writing, and the big button is Stop. Its caption and tooltip are the server's own sentence: a stop saves
 * waiting, not money.
 *
 * The die (T09, ⌥R) arms a d20 roll for the next send, whichever button sends it: the server rolls, the roll goes
 * in as your message (after your words, if any), then that brain answers. Send and the chips wear the die while it
 * is armed, and the send switches it off. Its band offers "Just roll" (message.roll: no brain is asked). Esc or ×
 * disarms it. Writing as someone else has no roll: the die steps aside.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onAdd,
  writeAs,
  onWriteAs,
  brains,
  defaultBrainId,
  busy,
  status,
  onStop,
  stopping,
  roll,
  onRoll,
  onJustRoll,
  autoFocus,
}: {
  value: string;
  onChange(v: string): void;
  onSend(brainId?: string): void;
  /** Add the text as `writeAs` (message.add). Resolves to null when added, or to the reason it wasn't. */
  onAdd(): Promise<string | null>;
  /** A brain id, AS_PLAYER, or null (sending, the normal mode). */
  writeAs: string | null;
  onWriteAs(as: string | null): void;
  brains: Brain[];
  defaultBrainId: string;
  busy: boolean;
  /** What is being written, while busy ("Assistant is writing version 3"). */
  status?: string;
  onStop(): void;
  stopping: boolean;
  /** T09: the die is armed: the next send rolls a d20 after your words, then the brain answers. */
  roll: boolean;
  onRoll(armed: boolean): void;
  /** Roll now with no brain asked (message.roll). Resolves to null when rolled, or to the reason it wasn't. */
  onJustRoll(): Promise<string | null>;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [justRolling, setJustRolling] = useState(false);
  const [rollError, setRollError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  useAutosize(ref, value, typeof window === "undefined" ? 320 : Math.max(160, Math.round(window.innerHeight * 0.4)));
  const main = brains.find((b) => b.id === defaultBrainId) ?? brains[0];
  const others = brains.filter((b) => b !== main);
  const author = writeAs === AS_PLAYER ? null : (brains.find((b) => b.id === writeAs) ?? null);
  const writing = writeAs !== null && (writeAs === AS_PLAYER || author !== null);
  /** Writing as an image brain: the words are a prompt, and they are painted. */
  const paints = author?.kind === "image";
  const empty = value.trim() === "";
  const several = brains.length > 1;
  /** The die is armed and this is a send (writing as someone adds words, with no roll). */
  const rolling = roll && !writing;

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // Focus returns here once a reply finishes, so you can type straight on.
  useEffect(() => {
    if (!busy && document.activeElement === document.body) ref.current?.focus();
  }, [busy]);

  // Choosing who to write as puts you in the box.
  useEffect(() => {
    setAddError(null);
    if (writeAs) ref.current?.focus();
  }, [writeAs]);

  // A changed mind (disarmed, or rolled) clears an old "couldn't roll".
  useEffect(() => {
    setRollError(null);
  }, [roll]);

  // A brain that is gone (deleted elsewhere) can't be written as.
  useEffect(() => {
    if (writeAs && writeAs !== AS_PLAYER && !author) onWriteAs(null);
  }, [writeAs, author, onWriteAs]);

  async function add() {
    if (adding || busy || empty) return;
    setAdding(true);
    setAddError(null);
    const problem = await onAdd();
    setAdding(false);
    if (problem) setAddError(problem);
  }

  const sendTo = (b: Brain) => {
    if (busy) return;
    onSend(b.id);
  };

  async function justRoll() {
    if (justRolling || busy) return;
    setJustRolling(true);
    setRollError(null);
    const problem = await onJustRoll();
    setJustRolling(false);
    if (problem) setRollError(problem);
    ref.current?.focus();
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.altKey && !e.metaKey && !e.ctrlKey && /^Digit[1-9]$/.test(e.code) && !writing) {
      const b = others[Number(e.code.slice(5)) - 1];
      if (b) {
        e.preventDefault(); // Option+digit would otherwise type ¡™£…
        sendTo(b);
      }
      return;
    }
    if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === "KeyR" && !writing) {
      e.preventDefault(); // Option+R would otherwise type ®
      onRoll(!roll);
      return;
    }
    if (e.key === "Escape" && writing && !menu) {
      e.preventDefault();
      e.stopPropagation(); // not the settings drawer
      onWriteAs(null);
      return;
    }
    if (e.key === "Escape" && rolling) {
      e.preventDefault();
      e.stopPropagation();
      onRoll(false);
      return;
    }
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault(); // Enter (or Cmd/Ctrl+Enter) never inserts a newline; Shift+Enter does
    if (writing) void add();
    else if (!busy) onSend();
  };

  const authorName = writeAs === AS_PLAYER ? "you" : (author?.name ?? "");
  const tint = author?.color;

  return (
    <div className="relative shrink-0 px-4 pb-4 sm:px-6">
      {/* The scrollback fades out under the composer instead of stopping at a hard edge. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-linear-to-b from-transparent to-canvas" />
      <div
        className={cx(
          "@container mx-auto w-full max-w-3xl rounded-2xl border bg-raised shadow-xl shadow-black/30 transition-[border-color,box-shadow]",
          writing
            ? "border-line-strong"
            : rolling
              ? "border-silver/35 focus-within:ring-3 focus-within:ring-silver/10"
              : "border-line-strong focus-within:border-focus/45 focus-within:ring-3 focus-within:ring-focus/10",
        )}
        style={writing ? { borderColor: tint ? `color-mix(in oklab, ${tint} 45%, transparent)` : "var(--color-focus)" } : undefined}
      >
        {writing && (
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-2 text-[12.5px] text-faint">
            <PenLine aria-hidden className="size-3.5 shrink-0" />
            <span className="shrink-0">Writing as</span>
            {author ? <BrainBadge name={author.name} color={author.color} className="max-w-[12rem] shrink-0" /> : <span className="font-medium text-fg">you</span>}
            <span
              className="hidden min-w-0 truncate sm:inline"
              title={
                paints && author
                  ? `Your words become ${author.name}'s image prompt, word for word: the image model paints them, and every other brain sees them framed as ${author.name}'s prompt. No brain is asked to write anything.`
                  : author
                    ? `${author.name} sees these words as its own past reply; every other brain sees them framed with its name. Nothing is generated.`
                    : "Added as your own message. No brain is asked to reply."
              }
            >
              {paints ? "· your words are its prompt, painted as written" : "· nothing is generated"}
            </span>
            <button
              type="button"
              onClick={() => onWriteAs(null)}
              aria-label="Back to sending"
              title="Back to sending (Esc)"
              className="ml-auto grid size-6 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-fg"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </div>
        )}
        {rolling && (
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-1.5 text-[12.5px] text-faint">
            <D20Icon className="size-4 shrink-0 text-silver" />
            <span className="shrink-0 font-medium text-fg">Rolling a d20</span>
            <span
              className="hidden min-w-0 truncate sm:inline"
              title="The server rolls it (never a model) when you send. The roll goes in as your message, which every brain reads, then the brain you sent to answers. Edit or delete it like any message."
            >
              {empty ? "· with your next send, then that brain answers" : "· after your words, then that brain answers"}
            </span>
            <button
              type="button"
              onClick={() => void justRoll()}
              disabled={busy || justRolling}
              title={
                busy
                  ? "A reply is being written. Roll once it's done, or stop it."
                  : `Roll a d20 now and add it as your message, without asking any brain.${empty ? "" : " Your words stay here."}`
              }
              className="ml-auto inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted transition-colors enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
            >
              {justRolling && <Spinner className="size-3" />}
              Just roll
            </button>
            <button
              type="button"
              onClick={() => onRoll(false)}
              aria-label="Don't roll"
              title="Don't roll (Esc)"
              className="grid size-6 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-fg"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </div>
        )}
        <label htmlFor="composer" className="sr-only">
          {writing ? `Words for ${authorName}` : `Message ${main?.name}`}
        </label>
        <textarea
          id="composer"
          ref={ref}
          autoComplete="off"
          rows={1}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (addError) setAddError(null);
          }}
          onKeyDown={onKeyDown}
          placeholder={
            writing
              ? paints
                ? `${author!.name}'s image prompt… (what the picture shows, in detail)`
                : author
                  ? `${author.name}'s words… (the opening scene, a line you'd rather write yourself)`
                  : "Your message, added without asking anyone to reply…"
              : rolling
                ? "What you try, if anything; the roll goes after it…"
                : `Message ${main?.name ?? "the brain"}…`
          }
          className="block max-h-[40vh] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-[1.6] text-fg outline-none placeholder:text-faint"
        />
        {addError && <p className="px-4 pt-1 text-[12.5px] leading-5 text-red-200">{addError}</p>}
        {rollError && rolling && <p className="px-4 pt-1 text-[12.5px] leading-5 text-red-200">{rollError}</p>}
        <div className="flex items-end gap-2 px-2.5 pt-1 pb-2.5">
          <WriteAsMenu
            open={menu}
            onOpen={setMenu}
            brains={brains}
            current={writeAs}
            onPick={(as) => {
              onWriteAs(as);
              setMenu(false);
            }}
          />
          {!writing && (
            <button
              type="button"
              aria-pressed={roll}
              onClick={() => {
                onRoll(!roll);
                ref.current?.focus();
              }}
              aria-label="Roll a d20 with the next send"
              title={
                roll
                  ? "Don't roll (⌥R)"
                  : "Roll a d20 with your next send (⌥R): the server rolls it, the roll goes in as your message, then the brain you send to answers"
              }
              className={cx(
                "grid size-8 shrink-0 place-items-center rounded-lg transition-colors",
                roll ? "bg-silver/[0.13] text-silver-hi ring-1 ring-silver/30 ring-inset" : "text-faint hover:bg-hover hover:text-fg",
              )}
            >
              <D20Icon className="size-[18px]" />
            </button>
          )}
          {/* Who else can answer, in their colors; while a reply runs, who is writing (the chips would be off anyway). */}
          <div className="flex min-h-8 min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {busy ? (
              <p className="min-w-0 truncate text-[11.5px] text-faint" title={STOP_BILL_NOTE}>
                {status ?? `${main?.name ?? "The brain"} is replying`} · <span className="text-muted">{STOP_CAPTION}</span>
              </p>
            ) : writing ? (
              <p className="hidden min-w-0 truncate text-[11.5px] text-faint sm:block">
                <Kbd>Enter</Kbd> {paints ? "paints it" : "adds it"} · <Kbd>Esc</Kbd> back to sending
              </p>
            ) : several ? (
              others.map((b, i) => <BrainChip key={b.id} brain={b} index={i} empty={empty} roll={rolling} onClick={() => sendTo(b)} />)
            ) : rolling ? (
              <p className="hidden min-w-0 truncate text-[11.5px] text-faint sm:block">
                <Kbd>Enter</Kbd> rolls and sends · <Kbd>Esc</Kbd> no roll
              </p>
            ) : (
              <p className="hidden min-w-0 truncate text-[11.5px] text-faint sm:block">
                <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd> <Kbd>Enter</Kbd> for a new line · Markdown works
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center">
            {busy ? (
              <button
                type="button"
                onClick={onStop}
                disabled={stopping}
                title={STOP_BILL_NOTE}
                aria-label="Stop the reply"
                aria-describedby="stop-note"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-hover px-3 text-[13px] font-medium text-fg transition-colors hover:border-[#3a4250] hover:bg-[#232934] disabled:cursor-wait disabled:text-muted"
              >
                {stopping ? <Spinner className="size-3.5" /> : <Square aria-hidden className="size-3 fill-current" />}
                {stopping ? "Stopping…" : "Stop"}
              </button>
            ) : writing ? (
              <button
                type="button"
                onClick={() => void add()}
                disabled={adding || empty}
                title={
                  paints
                    ? `Add it as ${authorName}'s prompt and paint it (Enter). No brain is asked to write anything.`
                    : `Add it as ${authorName === "you" ? "your message" : `${authorName}'s line`} (Enter). Nothing is generated.`
                }
                className="inline-flex h-8 max-w-[16rem] items-center gap-1.5 rounded-lg bg-silver px-3 text-[13px] font-medium text-canvas shadow-[inset_0_1px_0_rgb(255_255_255/0.55)] transition-colors hover:bg-silver-hi disabled:cursor-not-allowed disabled:bg-hover disabled:text-faint disabled:shadow-none"
              >
                {adding ? <Spinner className="size-3.5" /> : <Plus aria-hidden className="size-4 shrink-0" strokeWidth={2.25} />}
                <span className="truncate">{author ? `${paints ? "Paint" : "Add"} as ${author.name}` : "Add"}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSend()}
                title={
                  rolling
                    ? `${empty ? "Roll a d20 and send it" : "Send your words and a d20 roll"} to ${main?.name ?? "the brain"} (Enter)`
                    : `${empty && several ? `Ask ${main?.name} to respond` : `Send to ${main?.name ?? "the brain"}`} (Enter)`
                }
                aria-label={rolling ? `Roll a d20 and send to ${main?.name ?? "the brain"}` : `Send to ${main?.name ?? "the brain"}`}
                className="inline-flex h-8 max-w-[16rem] items-center gap-1.5 rounded-lg bg-silver px-3 text-[13px] font-medium text-canvas shadow-[inset_0_1px_0_rgb(255_255_255/0.55)] transition-colors hover:bg-silver-hi"
              >
                {rolling ? <D20Icon className="size-4 shrink-0" strokeWidth={2} /> : <ArrowUp aria-hidden className="size-4 shrink-0" strokeWidth={2.25} />}
                <span className="truncate">
                  {rolling ? "Roll & send" : "Send"}
                  {several && <span className="hidden @2xl:inline"> to {main?.name}</span>}
                </span>
              </button>
            )}
            {busy && (
              <span id="stop-note" className="sr-only">
                {STOP_BILL_NOTE}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A small send button in a brain's own color. An image brain's has a picture icon: it answers with an image.
 * With the die armed (`roll`), it wears the die too: it rolls, then that brain answers (or paints).
 */
function BrainChip({ brain: b, index, empty, roll, onClick }: { brain: Brain; index: number; empty: boolean; roll: boolean; onClick(): void }) {
  const image = b.kind === "image";
  const key = index < 9 ? ` (⌥${index + 1})` : "";
  const title = roll
    ? `${empty ? "Roll a d20 and send it" : "Send your words and a d20 roll"} to ${b.name}${image ? ": it paints a picture, with the roll as its note" : ""}${key}`
    : image
      ? empty
        ? `Ask ${b.name} for a picture of the scene as it stands${key}`
        : `Send to ${b.name}: it paints a picture, with your message as its note${key}`
      : empty
        ? `Ask ${b.name} to respond, with no new message${key}`
        : `Send to ${b.name}${key}`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={
        roll
          ? `Roll a d20 and send to ${b.name}${image ? " for a picture" : ""}`
          : image
            ? empty
              ? `Ask ${b.name} for a picture`
              : `Send to ${b.name} for a picture`
            : empty
              ? `Ask ${b.name} to respond`
              : `Send to ${b.name}`
      }
      className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12.5px] font-medium transition-colors enabled:hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-40",
        roll ? "max-w-[13rem]" : "max-w-[11rem]", // room for the die beside the name
      )}
      style={{
        color: `color-mix(in oklab, ${b.color} 55%, white)`,
        borderColor: `color-mix(in oklab, ${b.color} 30%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${b.color} 9%, transparent)`,
      }}
    >
      {roll && <D20Icon className="size-3.5 shrink-0" strokeWidth={1.9} />}
      {image ? (
        <ImageIcon aria-hidden className="size-3.5 shrink-0" style={{ color: b.color }} />
      ) : roll ? null : (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
      )}
      <span className="truncate">{b.name}</span>
    </button>
  );
}

/** The pen: pick who the next words are from: a brain (an image brain's words are its prompt, painted), or you. */
function WriteAsMenu({
  open,
  onOpen,
  brains,
  current,
  onPick,
}: {
  open: boolean;
  onOpen(open: boolean): void;
  brains: Brain[];
  current: string | null;
  onPick(as: string | null): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && onOpen(false);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    box.current?.querySelector<HTMLButtonElement>("[role=menuitemradio]")?.focus();
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onOpen]);

  const item = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors enabled:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-45";
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpen(!open)}
        title="Write as… words in a brain's mouth (the opening scene), or yours with no reply"
        aria-label="Write as…"
        className={cx(
          "grid size-8 place-items-center rounded-lg transition-colors",
          open || current ? "bg-hover text-fg" : "text-faint hover:bg-hover hover:text-fg",
        )}
      >
        <PenLine aria-hidden className="size-4" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Write as"
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const items = [...(box.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]:not(:disabled)") ?? [])];
            const i = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
          }}
          className="absolute bottom-full left-0 z-30 mb-2 w-72 rounded-xl border border-line-strong bg-panel p-1.5 shadow-2xl shadow-black/60"
        >
          <p className="px-2 pt-1 pb-1.5 text-[11.5px] leading-4 text-faint">Write as… Added to the ledger as written. No brain writes anything; an image prompt is painted.</p>
          {brains.map((b) => (
            <button
              key={b.id}
              type="button"
              role="menuitemradio"
              aria-checked={current === b.id}
              title={b.kind === "image" ? `Your words become ${b.name}'s image prompt, and are painted as written` : `${b.name} sees it as its own past reply`}
              onClick={() => onPick(b.id)}
              className={item}
            >
              <BrainBadge name={b.name} color={b.color} className="min-w-0" />
              {b.kind === "image" && <span className="shrink-0 text-[11.5px] text-faint">image prompt</span>}
              {current === b.id && <Check aria-hidden className="ml-auto size-3.5 text-muted" />}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <button type="button" role="menuitemradio" aria-checked={current === AS_PLAYER} onClick={() => onPick(AS_PLAYER)} className={item}>
            <span className="text-fg">You</span>
            <span className="text-[12px] text-faint">· no reply</span>
            {current === AS_PLAYER && <Check aria-hidden className="ml-auto size-3.5 text-muted" />}
          </button>
          {current && (
            <button type="button" role="menuitemradio" aria-checked={false} onClick={() => onPick(null)} className={cx(item, "text-muted")}>
              Back to sending
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The first clause of the server's sentence, for the caption; the whole sentence is the tooltip. */
const STOP_CAPTION = STOP_BILL_NOTE.split(":")[0];

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border border-line-strong bg-panel px-1 py-px font-sans text-[10.5px] text-muted">{children}</kbd>;
}
