import { CircleAlert, Info, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cx } from "../lib/cx.ts";

/**
 * App-wide messages for errors that have no natural inline home (a failed logout, a lost connection).
 * Errors stay until dismissed, so nothing is swallowed; info toasts fade after a few seconds.
 * A `key` replaces an earlier toast with the same key instead of stacking duplicates.
 */

type Tone = "error" | "info";
type Toast = { id: number; tone: Tone; message: string; key?: string };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

function push(tone: Tone, message: string, key?: string): number {
  const id = nextId++;
  toasts = [...toasts.filter((t) => key === undefined || t.key !== key), { id, tone, message, key }];
  emit();
  if (tone === "info") setTimeout(() => dismiss(id), 4000);
  return id;
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  error: (message: string, opts: { key?: string } = {}) => push("error", message, opts.key),
  info: (message: string, opts: { key?: string } = {}) => push("info", message, opts.key),
  dismiss,
  /** Remove the toast with this key, if any (e.g. once a lost connection comes back). */
  clear: (key: string) => {
    toasts = toasts.filter((t) => t.key !== key);
    emit();
  },
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts);
  if (list.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={cx(
            "pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-5 shadow-xl shadow-black/40",
            t.tone === "error" ? "border-red-400/30 bg-[#1d1316] text-red-100" : "border-line-strong bg-raised text-fg",
          )}
        >
          {t.tone === "error" ? (
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-red-300" />
          ) : (
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
          )}
          <p className="min-w-0 flex-1 break-words">{t.message}</p>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="-m-1 rounded p-1 text-faint transition-colors hover:text-fg"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
