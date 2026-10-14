import { ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { cx } from "../../lib/cx.ts";
import { compactNumber } from "../../lib/format.ts";

/**
 * A brain's reasoning, collapsed by default (design.md: shown collapsed, never sent back). While the brain is
 * still reasoning the label says so; it can be opened to watch it live.
 */
export function Reasoning({ text, tokens, live }: { text: string; tokens?: number; live?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const size = tokens ? `${compactNumber(tokens)} tokens` : `${compactNumber(text.length)} characters`;
  return (
    <div className="mb-2.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[12.5px] text-faint transition-colors hover:text-muted"
      >
        <ChevronRight aria-hidden className={cx("size-3.5 transition-transform", open && "rotate-90")} />
        {live ? <span className="shimmer font-medium">Thinking…</span> : <span className="font-medium">Reasoning</span>}
        {!live && <span className="text-faint/80">· {size}</span>}
      </button>
      {open && (
        <div
          id={id}
          className="mt-1.5 max-h-80 overflow-y-auto border-l-2 border-line-strong py-0.5 pr-2 pl-3.5 text-[13px] leading-6 whitespace-pre-wrap text-muted"
        >
          {text}
        </div>
      )}
    </div>
  );
}
