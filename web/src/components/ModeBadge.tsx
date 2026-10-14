import type { Health } from "../api/types.ts";
import { cx } from "../lib/cx.ts";

/** Which Venice the server talks to: the free local mock, or the live API that spends real money. */
export function ModeBadge({ mode, className }: { mode: Health["mode"]; className?: string }) {
  const mock = mode === "mock";
  return (
    <span
      title={mock ? "The server is using the local mock Venice: free and deterministic." : "The server is using the live Venice API."}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        mock ? "border-amber-300/20 bg-amber-300/[0.07] text-amber-200" : "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-200",
        className,
      )}
    >
      <span aria-hidden className={cx("size-1.5 rounded-full", mock ? "bg-amber-300" : "bg-emerald-300")} />
      {mock ? "Mock Venice" : "Live Venice"}
    </span>
  );
}
