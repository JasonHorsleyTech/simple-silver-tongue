import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Short random id with a type prefix, e.g. newId("c") → "c_k3j9x0q2ma". */
export function newId(prefix: string, length = 10): string {
  let s = "";
  for (const b of randomBytes(length)) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${s}`;
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function nowIso(): string {
  return new Date().toISOString();
}
