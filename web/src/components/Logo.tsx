import { useId } from "react";
import { cx } from "../lib/cx.ts";

/** A silver crescent on a dark tile. Same artwork as public/favicon.svg. */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={cx("shrink-0", className)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4f6f9" />
          <stop offset=".55" stopColor="#b9c1cc" />
          <stop offset="1" stopColor="#6f7988" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="#161a21" />
      <rect x=".5" y=".5" width="31" height="31" rx="7.5" fill="none" stroke="#ffffff" strokeOpacity=".07" />
      <circle cx="16" cy="16" r="9" fill={`url(#${id})`} />
      <circle cx="19.5" cy="12.5" r="7" fill="#161a21" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "bg-linear-to-br from-silver-hi via-silver to-[#8a94a3] bg-clip-text font-semibold tracking-tight text-transparent",
        className,
      )}
    >
      simple silver
    </span>
  );
}
