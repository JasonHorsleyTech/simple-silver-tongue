import { CornerDownRight } from "lucide-react";
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
 * shown), then the body at full column width. Live replies use the same frame, so nothing jumps when one is saved.
 */
export function BrainMessageFrame({
  name,
  color,
  time,
  status,
  origin,
  reasoning,
  children,
  footer,
}: {
  name: string;
  color: string;
  time?: string;
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
        {origin}
      </div>
      {reasoning}
      {children}
      {footer}
    </div>
  );
}

/**
 * Where a version came from: the steer that produced it (and which version it revised), or a plain re-roll.
 * Display only: the steer was sent once, with the request that wrote this version, and never again.
 */
export function SteerNote({ steer, fromVersion, reroll }: { steer?: string | null; fromVersion?: number | null; reroll?: boolean }) {
  if (!steer && !reroll) return null;
  const title = steer
    ? `The steer behind this version${fromVersion ? `, which revised version ${fromVersion}` : ""}. It was sent once, with that request only.`
    : "A plain re-roll: written again from the messages before it, without a steer.";
  return (
    <span title={title} className="flex min-w-0 items-center gap-1 text-[12px] text-faint">
      <span aria-hidden className="text-line-strong">
        ·
      </span>
      <CornerDownRight aria-hidden className="size-3.5 shrink-0" />
      {steer ? (
        <>
          <span className="shrink-0">steered</span>
          <span className="min-w-0 truncate text-muted">“{steer}”</span>
          {fromVersion ? <span className="shrink-0">on v{fromVersion}</span> : null}
        </>
      ) : (
        <span>re-roll</span>
      )}
    </span>
  );
}
