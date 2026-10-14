import { useLayoutEffect, type RefObject } from "react";

/**
 * Grow a textarea with its content, up to maxPx (then it scrolls). Re-measures whenever `value` changes and
 * whenever the textarea's own width changes (line wrapping depends on it). Watching the element rather than
 * the window matters: a panel opening or closing beside it changes its width with no window resize.
 *
 * It measures an off-screen twin, never the textarea itself (T14). The usual trick, `height: auto` and then reading
 * `scrollHeight`, collapses the real box for a forced reflow, and Firefox clamps every scroll box around it to the
 * shorter content right then: typing in a long message's editor at the bottom of the scrollback threw the
 * scrollback up by the editor's height on every keystroke, and the caret reveal then parked your line at the
 * bottom edge. Chrome defers that clamp, so it never showed there.
 */
export function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxPx?: number) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const full = measure(el);
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

/** What decides how tall the text lays out. Width with box-sizing, paddings and borders give the same line width. */
const SIZING = [
  "box-sizing",
  "width",
  "min-height",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "font-stretch",
  "font-variant",
  "font-feature-settings",
  "font-variation-settings",
  "font-kerning",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-indent",
  "text-transform",
  "text-rendering",
  "tab-size",
  "white-space",
  "word-break",
  "overflow-wrap",
  "hyphens",
  "direction",
];

let twin: HTMLTextAreaElement | null = null;

/** The border-box height `el` needs to show all its text (at least its `rows`), measured on the twin. */
function measure(el: HTMLTextAreaElement): number {
  if (!twin) {
    twin = document.createElement("textarea");
    twin.setAttribute("aria-hidden", "true");
    twin.tabIndex = -1;
    twin.readOnly = true;
    twin.spellcheck = false;
  }
  const cs = getComputedStyle(el);
  const s = twin.style;
  for (const p of SIZING) s.setProperty(p, cs.getPropertyValue(p));
  // Fixed, so it can't stretch any scroll area (the T12 trap); hidden, so nobody sees or reaches it.
  s.position = "fixed";
  s.top = "0";
  s.left = "0";
  s.height = "auto";
  s.maxHeight = "none";
  s.overflow = "hidden";
  s.visibility = "hidden";
  s.pointerEvents = "none";
  twin.rows = el.rows;
  twin.placeholder = el.placeholder;
  twin.value = el.value;
  if (!twin.isConnected) document.body.append(twin);
  const borders = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth); // border-box sizing
  return twin.scrollHeight + borders;
}
