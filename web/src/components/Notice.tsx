import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx.ts";

type Tone = "error" | "warn" | "info";

const TONES: Record<Tone, { box: string; icon: string; Icon: typeof Info }> = {
  error: { box: "border-red-400/25 bg-red-400/[0.07] text-red-100", icon: "text-red-300", Icon: CircleAlert },
  warn: { box: "border-amber-300/20 bg-amber-300/[0.06] text-amber-50", icon: "text-amber-300", Icon: TriangleAlert },
  info: { box: "border-line-strong bg-raised text-muted", icon: "text-muted", Icon: Info },
};

/** An inline message box. Errors are announced to screen readers. */
export function Notice({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  const t = TONES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-5", t.box, className)}
    >
      <t.Icon aria-hidden className={cx("mt-0.5 size-4 shrink-0", t.icon)} />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}
