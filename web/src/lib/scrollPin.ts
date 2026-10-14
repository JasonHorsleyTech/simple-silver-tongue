import { createContext } from "react";

/**
 * The scrollback's pin to the bottom, for content that opens in place (T08's hidden notes). Opening a note on the
 * last message while pinned would re-pin to the new bottom and scroll the note's own top out of view, so an
 * opening note calls `opening(el)` first: the pin lets go, and once the note is open the box scrolls just enough
 * to show as much of it as fits, never past its top. Folding a note you had scrolled deep into calls `folded(el)`,
 * which brings its bar back if it ended up above the view. The scroll box itself moves, never the page. Null
 * outside a scrollback: nothing to keep.
 */
export type ScrollPinApi = {
  opening(el: HTMLElement): void;
  folded(el: HTMLElement): void;
};

export const ScrollPin = createContext<ScrollPinApi | null>(null);
