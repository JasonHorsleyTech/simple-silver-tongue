import { useState, type ReactNode } from "react";
import type { MessageVersion } from "../../api/types.ts";
import { D20Face } from "../../components/D20.tsx";
import { cx } from "../../lib/cx.ts";
import { rollView } from "../../lib/rolls.ts";
import { MessageText } from "./MessageText.tsx";

/** A roll made this recently when it is first shown has just arrived (sent here, or followed): its die settles in. */
const FRESH_MS = 8000;

/**
 * T09: a roll, on the player's side of the scrollback but plainly not a typed line: the die showing what it
 * rolled, beside the roll's line (the template's words, which every brain reads, framed as yours).
 *
 * An edited roll (the honor system) shows no number on the die: its line is the roll now, since it is what every
 * brain was told, so the line is the face. The die's own number is only history, in the footer beside "edited"
 * (MessageItem; design.md, "Dice rolls", T09 QA-1).
 */
export function RollBubble({ version: v, footer }: { version: MessageVersion; footer?: ReactNode }) {
  const view = rollView(v)!;
  const [land] = useState(() => Date.now() - Date.parse(v.createdAt) < FRESH_MS);
  const edited = view.face === null;
  return (
    <div className="group relative flex flex-col items-end">
      <div
        role="group"
        aria-label={view.label}
        className={cx(
          "flex max-w-[min(85%,40rem)] items-center gap-3 rounded-2xl rounded-br-md border py-2 pr-4 pl-2",
          edited ? "border-line bg-raised" : "border-silver/[0.16] bg-linear-to-br from-silver/[0.07] to-raised to-60%",
        )}
      >
        <span
          title={
            edited
              ? `The line beside it was edited, so it is the roll: every brain reads it. The server's die said ${view.roll.result}.`
              : `${view.label}, rolled by the server (never a model). The line beside it is what every brain reads, framed as yours.`
          }
          className="cursor-help"
        >
          <D20Face value={view.face} land={land && !edited} dim={edited} />
        </span>
        <div className={cx("min-w-0 py-0.5", edited ? "[&_.md]:text-[15px]" : "[&_.md]:text-[14px] [&_.md]:text-muted")}>
          <MessageText text={v.content} />
        </div>
      </div>
      {footer && <div className="absolute top-full right-0">{footer}</div>}
    </div>
  );
}

/** A roll on its way: the server rolls when Venice takes the request (or at once, for "Just roll"). No number shows until it's real. */
export function PendingRoll() {
  return (
    <div className="flex justify-end" aria-live="polite">
      <div className="flex items-center gap-3 rounded-2xl rounded-br-md border border-line bg-raised/70 py-2 pr-4 pl-2">
        <D20Face value={null} rolling />
        <span className="shimmer text-[13.5px] font-medium">Rolling a d20…</span>
      </div>
    </div>
  );
}
