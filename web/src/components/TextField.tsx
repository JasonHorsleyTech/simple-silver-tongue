import type { ComponentProps, ReactNode } from "react";
import { cx } from "../lib/cx.ts";

type Props = ComponentProps<"input"> & { id: string; label: string; hint?: ReactNode };

/** A labelled single-line input. `ref` passes through to the <input>. */
export function TextField({ id, label, hint, className, ...input }: Props) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cx(
          "block h-10 w-full rounded-lg border border-line-strong bg-raised px-3 text-[15px] text-fg",
          "placeholder:text-faint outline-none transition-[border-color,box-shadow]",
          "focus:border-focus/60 focus:ring-3 focus:ring-focus/15",
          "aria-[invalid=true]:border-red-400/60 aria-[invalid=true]:ring-3 aria-[invalid=true]:ring-red-400/10",
        )}
        {...input}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-faint">
          {hint}
        </p>
      )}
    </div>
  );
}
