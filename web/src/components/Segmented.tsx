import { cx } from "../lib/cx.ts";

/** A small one-of-N picker (a radio group that looks like joined buttons). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  /** For screen readers: what is being picked. */
  label: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange(v: T): void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("inline-flex rounded-lg border border-line-strong p-0.5", disabled && "opacity-55", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          disabled={disabled}
          onClick={() => value !== o.value && onChange(o.value)}
          className={cx(
            "h-7 rounded-md px-2.5 text-[12.5px] transition-colors disabled:cursor-not-allowed",
            value === o.value ? "bg-hover text-fg" : "text-faint enabled:hover:text-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
