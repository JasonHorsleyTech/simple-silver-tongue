import { CornerDownRight, PenLine, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../../lib/cx.ts";
import { clockTime, fullTime } from "../../lib/format.ts";
import { BrainBadge } from "./BrainBadge.tsx";

/** The player's message: a quiet bubble on the right. Its footer floats in the gap below, shown on hover. */
export function PlayerBubble({ children, footer, pending }: { children: ReactNode; footer?: ReactNode; pending?: boolean }) {
  return (
    <div className="group relative flex flex-col items-end">
      <div
        className={cx(
          "max-w-[min(85%,40rem)] rounded-2xl rounded-br-md border border-line bg-raised px-4 py-2.5 [&_.md]:text-[15px]",
          pending && "opacity-60",
        )}
      >
        {children}
      </div>
      {footer && <div className="absolute top-full right-0">{footer}</div>}
    </div>
  );
}

/**
 * A brain's message: badge on top (with the time, or what is being written, and the steer behind the version
 * shown), then the body beside a thin rail in the brain's color, so who is speaking stays clear deep inside a
 * long reply and at a glance down a long campaign. Live replies use the same frame, so nothing jumps when one
 * is saved.
 */
export function BrainMessageFrame({
  name,
  color,
  time,
  authored,
  status,
  origin,
  reasoning,
  children,
  footer,
}: {
  name: string;
  color: string;
  time?: string;
  /** Words you put in this brain's mouth (message.add), not generated. */
  authored?: boolean;
  /** In place of the time: "writing version 4…". */
  status?: ReactNode;
  /** Where the version shown came from (SteerNote). */
  origin?: ReactNode;
  reasoning?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="group">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <BrainBadge name={name} color={color} className="shrink-0" />
        {status ??
          (time && (
            <time dateTime={time} title={fullTime(time)} className="shrink-0 text-[11.5px] text-faint tabular-nums">
              {clockTime(time)}
            </time>
          ))}
        {authored && (
          <span
            title={`You wrote this in ${name}'s mouth. ${name} sees it as its own reply; the other brains see it framed with its name.`}
            className="flex shrink-0 cursor-help items-center gap-1 text-[11.5px] text-faint"
          >
            <span aria-hidden className="text-line-strong">
              ·
            </span>
            <PenLine aria-hidden className="size-3" /> written by you
          </span>
        )}
        {origin}
      </div>
      <div className="ml-[10px] border-l-2 pl-[17px]" style={{ borderColor: `color-mix(in oklab, ${color} 32%, transparent)` }}>
        {reasoning}
        {children}
      </div>
      {footer && <div className="ml-[10px] pl-[13px]">{footer}</div>}
    </div>
  );
}

/**
 * Where a version came from: the steer that produced it (and which version it revised), a fresh take (T15), or a
 * plain re-roll. Display only: the steer was sent once, with the request that wrote this version, and never again.
 * A fresh take's thought isn't repeated here (it is usually a hidden note): a text version starts with it, and an
 * image version shows it above the picture.
 */
export function SteerNote({
  steer,
  fromVersion,
  reroll,
  repaintOf,
  freshTake,
  image,
}: {
  steer?: string | null;
  fromVersion?: number | null;
  reroll?: boolean;
  /** An image version painted again from version N's prompt (image.retry of a finished image), 1-based. */
  repaintOf?: number | null;
  /** T15: written after a thought planted as the brain's own words. */
  freshTake?: boolean;
  image?: boolean;
}) {
  if (!steer && !reroll && !repaintOf && !freshTake) return null;
  const title = freshTake
    ? image
      ? "A fresh take: written after a thought you planted as the brain's own words (shown above the picture; it was sent with that request only). It never saw the version before."
      : "A fresh take: written after a thought you planted as the brain's own words. The version starts with that thought, and every later request carries it. It never saw the version before."
    : steer
    ? `The steer behind this version${fromVersion ? `, which revised version ${fromVersion}` : ""}. It was sent once, with that request only.`
    : repaintOf
      ? `Painted again from version ${repaintOf}'s prompt, word for word: another image of the same prompt. Both images are kept.`
      : "A plain re-roll: written again from the messages before it, without a steer.";
  return (
    <span title={title} className="flex min-w-0 items-center gap-1 text-[12px] text-faint">
      <span aria-hidden className="text-line-strong">
        ·
      </span>
      {freshTake ? <Sparkles aria-hidden className="size-3.5 shrink-0" /> : <CornerDownRight aria-hidden className="size-3.5 shrink-0" />}
      {freshTake ? (
        <span>fresh take</span>
      ) : steer ? (
        <>
          <span className="shrink-0">steered</span>
          <span className="min-w-0 truncate text-muted">“{steer}”</span>
          {fromVersion ? <span className="shrink-0">on v{fromVersion}</span> : null}
        </>
      ) : repaintOf ? (
        <span>same prompt as v{repaintOf}</span>
      ) : (
        <span>re-roll</span>
      )}
    </span>
  );
}
