import { randomInt } from "node:crypto";
import type { Roll } from "./types.ts";

/**
 * Dice (T09). The server rolls, never a model: crypto.randomInt draws from the OS's random number generator and
 * rejects the samples that would bias a range, so each face is equally likely. d20 only, for now (Jason: "only
 * D20s because that's easy"); Roll.die leaves room for more.
 */
export function rollD20(): Roll {
  return { die: "d20", result: randomInt(1, 21) };
}
