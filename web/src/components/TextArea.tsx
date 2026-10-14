import { useCallback, useRef, type ComponentProps, type ReactNode, type Ref } from "react";
import { cx } from "../lib/cx.ts";
import { useAutosize } from "../lib/useAutosize.ts";

type Props = Omit<ComponentProps<"textarea">, "value" | "ref"> & {
  id: string;
  label?: ReactNode;
  /** Shown under the label, before the box. */
  description?: ReactNode;
  value: string;
  /** Monospace, for text whose exact characters matter (templates). */
  mono?: boolean;
  /** Grow up to this height, then scroll. */
  maxPx?: number;
  ref?: Ref<HTMLTextAreaElement>;
};

/** A labelled textarea that grows with its content. Whitespace is kept exactly as typed. */
export function TextArea({ id, label, description, value, mono, maxPx = 480, className, ref, ...rest }: Props) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useAutosize(inner, value, maxPx);
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      inner.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-fg">
          {label}
        </label>
      )}
      {description && (
        <p id={`${id}-desc`} className="mb-2 text-[12.5px] leading-5 text-faint">
          {description}
        </p>
      )}
      <textarea
        id={id}
        ref={setRef}
        value={value}
        rows={3}
        spellCheck={!mono}
        aria-describedby={description ? `${id}-desc` : undefined}
        className={cx(
          "block w-full resize-none rounded-lg border border-line-strong bg-raised px-3 py-2.5 text-fg",
          "placeholder:text-faint outline-none transition-[border-color,box-shadow]",
          "focus:border-focus/60 focus:ring-3 focus:ring-focus/15",
          mono ? "font-mono text-[12.5px] leading-[1.6]" : "text-[14px] leading-[1.6]",
        )}
        {...rest}
      />
    </div>
  );
}
