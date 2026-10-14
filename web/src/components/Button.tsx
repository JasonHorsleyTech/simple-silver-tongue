import type { ComponentProps } from "react";
import { cx } from "../lib/cx.ts";
import { Spinner } from "./Spinner.tsx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-silver text-canvas shadow-[inset_0_1px_0_rgb(255_255_255/0.55)] hover:bg-silver-hi",
  secondary: "border border-line-strong bg-raised text-fg hover:border-[#3a4250] hover:bg-hover",
  ghost: "text-muted hover:bg-hover hover:text-fg",
  danger: "border border-red-400/30 bg-red-400/10 text-red-200 hover:bg-red-400/20",
};

/** Disabled (and not just busy): primary goes quiet instead of turning into a grey slab. */
const INACTIVE: Record<Variant, string> = {
  primary: "cursor-not-allowed bg-hover text-faint shadow-none hover:bg-hover",
  secondary: "cursor-not-allowed opacity-50",
  ghost: "cursor-not-allowed opacity-40",
  danger: "cursor-not-allowed opacity-50",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-md px-2.5 text-[13px]",
  md: "h-10 gap-2 rounded-lg px-4 text-sm",
  icon: "size-8 rounded-md",
};

type Props = ComponentProps<"button"> & { variant?: Variant; size?: Size; loading?: boolean };

/** The app's one button. `loading` shows a spinner and disables it, keeping its look. Defaults to type="button". */
export function Button({ variant = "secondary", size = "md", loading = false, className, children, disabled, type, ...rest }: Props) {
  return (
    <button
      type={type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-colors",
        VARIANTS[variant],
        SIZES[size],
        loading ? "cursor-wait" : disabled && INACTIVE[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}
