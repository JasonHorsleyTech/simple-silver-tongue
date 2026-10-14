import { LoaderCircle } from "lucide-react";
import { cx } from "../lib/cx.ts";

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden className={cx("animate-spin", className ?? "size-4")} />;
}
