import { useLayoutEffect, type RefObject } from "react";

/**
 * Grow a textarea with its content, up to maxPx (then it scrolls). Re-measures whenever `value` changes and
 * whenever the textarea's own width changes (line wrapping depends on it). Watching the element rather than
 * the window matters: a panel opening or closing beside it changes its width with no window resize.
 */
export function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxPx?: number) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      const cs = getComputedStyle(el);
      const borders = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth); // border-box sizing
      const full = el.scrollHeight + borders;
      const max = maxPx ?? Infinity;
      el.style.height = `${Math.min(full, max)}px`;
      el.style.overflowY = full > max ? "auto" : "hidden";
    };
    fit();
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return; // our own height change; nothing to re-measure
      width = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, value, maxPx]);
}
