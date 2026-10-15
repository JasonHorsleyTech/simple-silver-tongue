import type { Brain, BrainMaker } from "./types.ts";
import { MAKES_NUMBER } from "./wording.ts";

/**
 * T16: how a brain that makes brains names them. Dependency-free, so the browser runs the same rule (the name a
 * "Make a brain" would give, and whether a made brain still has the name its pattern gave it). makers.ts uses it.
 */

/** The word message.add --as uses for you (commands/brains.ts PLAYER), so no brain may be called that. */
const RESERVED = "player";

/** A name a new brain can't take: another brain's (ignoring case), "player", or one that looks like an id. */
export function nameTaken(brains: ReadonlyArray<Pick<Brain, "name">>, name: string): boolean {
  const low = name.toLowerCase();
  return low === RESERVED || /^b_[a-z0-9]+$/.test(name) || brains.some((b) => b.name.toLowerCase() === low);
}

/** The pattern with a number in it: "Character {{n}}" → "Character 4". */
export const madeName = (pattern: string, n: number) => pattern.split(MAKES_NUMBER).join(String(n)).trim();

/**
 * The name the maker's next brain gets, and its number: the counter, moved past any name already taken (a brain
 * someone called "Character 4" by hand), so two brains never share a name. Null when no name it makes is free.
 */
export function freeMadeName(brains: ReadonlyArray<Pick<Brain, "name">>, maker: Pick<BrainMaker, "name" | "next">): { name: string; n: number } | null {
  const start = Math.max(1, Math.floor(maker.next) || 1);
  for (let n = start; n < start + 10_000; n++) {
    const name = madeName(maker.name, n);
    if (!nameTaken(brains, name)) return { name, n };
  }
  return null;
}

/** True when `name` is one the pattern makes ("Character 3" for "Character {{n}}"): a made brain nobody has renamed yet. */
export function isPatternName(pattern: string, name: string): boolean {
  const parts = pattern.split(MAKES_NUMBER).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${parts.join("\\d+")}$`).test(name.trim()) || false;
}
