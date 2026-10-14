import type { ReactNode } from "react";
import { cx } from "../lib/cx.ts";
import { Spinner } from "./Spinner.tsx";

/** An on/off switch with a label to its left. `busy` shows a spinner while the change is being saved. */
export function Switch({
  id,
  checked,
  onChange,
  label,
  description,
  disabled,
  busy,
}: {
  id: string;
  checked: boolean;
  onChange(next: boolean): void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className={cx("block text-[13px] font-medium", disabled ? "text-faint" : "text-fg")}>
          {label}
        </label>
        {description && <p className="mt-0.5 text-[12.5px] leading-5 text-faint">{description}</p>}
      </div>
      {busy && <Spinner className="mt-0.5 size-3.5 text-faint" />}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled || busy}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
          checked ? "border-silver/60 bg-silver" : "border-line-strong bg-hover",
          (disabled || busy) && "cursor-not-allowed opacity-50",
        )}
      >
        <span
          aria-hidden
          className={cx(
            "inline-block size-3.5 rounded-full shadow transition-transform",
            checked ? "translate-x-[18px] bg-canvas" : "translate-x-[2px] bg-muted",
          )}
        />
      </button>
    </div>
  );
}
