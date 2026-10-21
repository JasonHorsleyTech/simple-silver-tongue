import { cx } from "../lib/cx.ts";

/*
 * A d20 seen face-on: a hexagon, the face toward you as a triangle in the middle, and the edges to the faces
 * around it. Drawn here because the icon set has only six-sided dice.
 */
const HEX = "M12 1.75 21 6.9v10.2l-9 5.15-9-5.15V6.9Z";
const FACE = "M12 5.6 5.4 16.6h13.2Z";
const EDGES = "M12 1.75v3.85M3 6.9l9-1.3M21 6.9l-9-1.3M3 6.9l2.4 9.7M21 6.9l-2.4 9.7M3 17.1l2.4-.5M21 17.1l-2.4-.5M12 22.25l-6.6-5.65M12 22.25l6.6-5.65";
/** The big die's face is wider, so a two-digit number sits inside it. */
const BIG_FACE = "M12 4.2 4 17.5h16Z";
const BIG_EDGES = "M12 1.75v2.45M3 6.9l9-2.7M21 6.9l-9-2.7M3 6.9l1 10.6M21 6.9l-1 10.6M3 17.1l1 .4M21 17.1l-1 .4M12 22.25l-8-4.75M12 22.25l8-4.75";

/** The die as an icon, in the current text color (the composer's roll toggle, its send buttons). */
export function D20Icon({ className, strokeWidth = 1.6 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" className={className}>
      <path d={HEX} />
      <path d={FACE} />
      <path d={EDGES} strokeWidth={strokeWidth * 0.62} opacity={0.75} />
    </svg>
  );
}

/**
 * The die in the scrollback, showing what it rolled. `value` null: no number on it (an edited roll, whose line is
 * the roll now, or one still rolling). `rolling`: it tumbles while the server's roll is on its way. `land`: a roll
 * that just arrived settles in, once.
 */
export function D20Face({ value, rolling, land, dim, className }: { value: number | null; rolling?: boolean; land?: boolean; dim?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "relative grid size-12 shrink-0 place-items-center",
        rolling && "motion-safe:animate-[sst-tumble_0.9s_cubic-bezier(.45,.05,.55,.95)_infinite]",
        land && "motion-safe:animate-[sst-land_0.5s_cubic-bezier(.2,.9,.3,1.25)_both]",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="absolute inset-0 size-full overflow-visible" strokeLinejoin="round" strokeLinecap="round" fill="none">
        <path d={HEX} className={dim ? "fill-white/[0.015] stroke-line-strong" : "fill-silver/[0.07] stroke-silver/55"} strokeWidth={1.1} />
        <path d={BIG_FACE} className={dim ? "fill-transparent stroke-line-strong" : "fill-silver/[0.09] stroke-silver/45"} strokeWidth={0.9} />
        <path d={BIG_EDGES} className={dim ? "stroke-line" : "stroke-silver/25"} strokeWidth={0.7} />
      </svg>
      {value !== null && (
        // The face's center sits a little below the hexagon's (the triangle's centroid).
        <span className="relative mt-[9%] text-[16px] leading-none font-semibold tracking-[-0.03em] text-silver-hi tabular-nums [text-shadow:0_0_3px_var(--color-raised),0_0_1px_var(--color-raised)]">
          {value}
        </span>
      )}
    </span>
  );
}
