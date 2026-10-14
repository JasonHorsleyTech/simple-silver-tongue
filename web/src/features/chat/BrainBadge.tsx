import { cx } from "../../lib/cx.ts";

/**
 * A brain's name in its own color: the author label on its messages, and (T04) on per-brain send buttons and
 * in the brains editor. Colors come from the brain (`brain.color`, #rrggbb).
 */
export function BrainBadge({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      className={cx("inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-[1px] text-[12.5px] font-medium", className)}
      style={{
        color: `color-mix(in oklab, ${color} 62%, white)`,
        backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
        borderColor: `color-mix(in oklab, ${color} 28%, transparent)`,
      }}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="truncate">{name}</span>
    </span>
  );
}
