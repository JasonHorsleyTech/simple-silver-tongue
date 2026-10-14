import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "../lib/cx.ts";

/**
 * A modal on the native <dialog> (focus trap, Escape and the top layer for free). Mount it to open it;
 * `onClose` runs on Escape, the close button or a click on the backdrop.
 */
export function Dialog({
  title,
  subtitle,
  children,
  footer,
  onClose,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose(): void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    body.current?.focus(); // not the close button: arrow keys then scroll the content
    return () => d?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "m-auto flex max-h-[min(88vh,56rem)] w-[min(56rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel p-0 text-fg shadow-2xl shadow-black/60",
        "backdrop:bg-black/65 backdrop:backdrop-blur-[2px]",
        className,
      )}
    >
      <div className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-tight text-silver-hi">{title}</h2>
          {subtitle && <div className="mt-1 text-[12.5px] leading-5 text-faint">{subtitle}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mt-0.5 -mr-1.5 grid size-8 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-fg"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <div ref={body} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-5 py-4 outline-none">
        {children}
      </div>
      {footer && <div className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3">{footer}</div>}
    </dialog>
  );
}
