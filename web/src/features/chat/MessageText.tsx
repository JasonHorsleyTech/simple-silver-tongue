import { useMemo, type CSSProperties, type ReactNode } from "react";
import { HiddenNote } from "../../components/HiddenNote.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { containersOf, messageParts } from "../../lib/hiddenParts.ts";

/**
 * A text message's body, saved or streaming, the player's or a brain's: its visible text as Markdown and each
 * hidden note as a fold (T08, design.md "Hidden notes"). The split is the shared rule, re-run on every frame of
 * a streaming reply, so a note's words never reach the page before you open it, mid-stream included.
 *
 * `writing`: the reply is still streaming. Its notes can't be opened yet, and its unfinished last line waits
 * while it could still become a note's opening fence (`messageParts`). `empty` is shown while nothing is.
 *
 * `color`: the brain's color. Quoted dialogue in the visible text shows in it (lib/quotes.ts); notes stay as they are.
 * The player's messages have none.
 *
 * Image prompts don't come here: they are plain captions, never folded (ImageCard).
 */
export function MessageText({
  text,
  writing = false,
  empty = null,
  color,
}: {
  text: string;
  writing?: boolean;
  empty?: ReactNode;
  color?: string;
}) {
  const parts = useMemo(() => messageParts(text, { writing }), [text, writing]);
  if (parts.length === 0) return <>{empty}</>;
  return (
    <div className="md-flow flex flex-col gap-3" style={color ? ({ "--quote": color } as CSSProperties) : undefined}>
      {parts.map((p, i) =>
        p.type === "text" ? (
          <Markdown key={i} text={p.text} quotes={!color ? undefined : writing && i === parts.length - 1 ? "writing" : "done"} />
        ) : (
          <InPlace key={i} prefix={p.block.prefix}>
            <HiddenNote lines={p.block.lines} label={p.block.label} writing={writing && p.block.open} locked={writing}>
              <Markdown text={p.block.body} />
            </HiddenNote>
          </InPlace>
        ),
      )}
    </div>
  );
}

/**
 * A note written inside a quote or a list item folds there: the split ends that quote or list around the fold,
 * so the fold gets the quote's bar and the item's marker back, as the terminal keeps its prefix.
 */
function InPlace({ prefix, children }: { prefix: string; children: ReactNode }) {
  return containersOf(prefix).reduceRight<ReactNode>(
    (inner, c) =>
      c.kind === "quote" ? (
        <div className="border-l-[3px] border-line-strong pl-[1em]">{inner}</div>
      ) : (
        <div className="flex">
          <span aria-hidden className="w-[1.5em] shrink-0 pr-[0.45em] text-right text-[15px] leading-9 text-faint tabular-nums">
            {c.marker}
          </span>
          <div className="min-w-0 flex-1">{inner}</div>
        </div>
      ),
    children,
  );
}
