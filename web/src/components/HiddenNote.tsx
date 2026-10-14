import { ChevronDown, EyeOff } from "lucide-react";
import { useContext, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { hiddenSummary } from "../api/types.ts";
import { cx } from "../lib/cx.ts";
import { ScrollPin } from "../lib/scrollPin.ts";

/**
 * T08: a hidden note, folded. The bar says that it is hidden and how much ("Hidden · 14 lines", the same words
 * as the terminal's marker), never a word of it, its label included. A click (or Enter or Space) opens it: the
 * label as a small caption, then the note (`children`, rendered only while it is open, so a folded note's words
 * are never in the page). Another click folds it, and so does its header, which stays at the top of the
 * scrollback while you read a long note. Every mount starts folded: nothing remembers an open note.
 *
 * While a reply is still being written (`locked`), its notes can't be opened, and the one being written
 * (`writing`) counts up: "Hidden · 3 lines so far".
 */
export function HiddenNote({
  lines,
  label,
  writing,
  locked,
  children,
}: {
  lines: number;
  /** The rest of the note's opening line: shown only once it is open. */
  label?: string;
  writing?: boolean;
  locked?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const pin = useContext(ScrollPin);
  const root = useRef<HTMLDivElement>(null);
  const folding = useRef(false);
  const shown = open && !locked;

  // Folded from its header deep inside a long note: bring the bar back into view, before paint.
  useLayoutEffect(() => {
    if (shown || !folding.current) return;
    folding.current = false;
    if (root.current) pin?.folded(root.current);
  }, [shown, pin]);

  const toggle = () => {
    if (shown) {
      folding.current = true;
      setOpen(false);
    } else {
      if (root.current) pin?.opening(root.current);
      setOpen(true);
    }
  };

  return (
    <div
      ref={root}
      data-hidden-note={shown ? "open" : "folded"}
      className={cx("rounded-lg border", shown ? "border-line bg-panel" : "ss-hatch border-dashed border-line-strong")}
    >
      <button
        type="button"
        aria-expanded={shown}
        aria-controls={shown ? id : undefined}
        disabled={locked}
        onClick={toggle}
        title={
          locked
            ? writing
              ? "A hidden note, being written. You can open it once the reply is finished."
              : "A hidden note. You can open it once the reply is finished."
            : shown
              ? "Fold this note again"
              : "A hidden note: every brain reads it, and it's folded here so you don't read it by accident. Open it to read it."
        }
        className={cx(
          "flex min-h-9 w-full items-center gap-2 rounded-[7px] px-3 py-1.5 text-left text-[13px] text-muted transition-colors",
          shown && "sticky top-0 z-10 rounded-b-none border-b border-line bg-panel",
          locked ? "cursor-default" : "hover:bg-hover/70 hover:text-fg",
        )}
      >
        <EyeOff aria-hidden className="size-3.5 shrink-0 text-faint" />
        <span className={cx("font-medium tabular-nums", writing && "shimmer")}>{hiddenSummary({ lines }, { writing })}</span>
        {!locked && (
          <span aria-hidden className="ml-auto flex shrink-0 items-center gap-1 text-[12px] text-faint">
            {shown ? "Hide" : "Show"}
            <ChevronDown className={cx("size-3.5 transition-transform", shown && "rotate-180")} />
          </span>
        )}
      </button>
      {shown && (
        <div id={id} role="region" aria-label="Hidden note" className="px-3.5 pt-2.5 pb-3">
          {label && <p className="mb-1.5 text-[12px] font-medium tracking-wide text-faint">{label}</p>}
          {lines > 0 ? children : <p className="text-[13px] text-faint">Nothing in it.</p>}
        </div>
      )}
    </div>
  );
}
