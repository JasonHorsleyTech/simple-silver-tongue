import { rm } from "node:fs/promises";
import { relative, sep } from "node:path";
import { sessionEnded } from "../lib/errors.ts";
import { decrypt, DecryptError, encrypt, isEncryptedBlob } from "./crypto.ts";
import { listDir, readFileOrNull, safeJoin, writeFileAtomic } from "./files.ts";

/**
 * A user's storage root plus their data key. Every file under the root goes through here, so an
 * encrypted user's data is ciphertext on disk (temp files included) and a plaintext user's is readable JSON.
 * user.json is the one exception and is handled by users.ts, never by the vault.
 *
 * A vault can be closed: its key is zeroed and every later read or write throws session_ended, so a wiped
 * key can never encrypt anything. A session holds the master vault. Each request works on its own copy
 * (forkVault), which the HTTP adapter closes when the request's work is done. So logging out wipes the
 * session's key at once, while work already running finishes under the real key.
 */
export type Vault = { dir: string; key: Buffer | null; closed?: boolean };

/** An independent copy (own key buffer) for one job. Whoever forks it must closeVault it when done. */
export function forkVault(vault: Vault): Vault {
  if (vault.closed) throw sessionEnded();
  return { dir: vault.dir, key: vault.key ? Buffer.from(vault.key) : null };
}

/** Zero the key and refuse all further use. Idempotent. */
export function closeVault(vault: Vault): void {
  vault.key?.fill(0);
  vault.closed = true;
}

/**
 * Vault files always live in a subfolder (conversations/, images/). The top level, where user.json lives,
 * is out of reach whatever the spelling: macOS volumes are usually case-insensitive, so a name check alone
 * would let USER.json through. Dot segments are refused by safeJoin.
 */
function pathFor(vault: Vault, rel: string, kind: "file" | "dir" = "file"): string {
  if (vault.closed) throw sessionEnded();
  const path = safeJoin(vault.dir, rel);
  const depth = relative(vault.dir, path).split(sep).filter(Boolean).length;
  if (depth < (kind === "file" ? 2 : 1)) throw new Error(`${rel}: vault files live in a subfolder; the top level (user.json) is not vault data`);
  return path;
}

export async function readBytes(vault: Vault, rel: string): Promise<Buffer | null> {
  const raw = await readFileOrNull(pathFor(vault, rel));
  if (raw === null) return null;
  if (vault.closed) throw sessionEnded(); // closed while we were reading
  if (vault.key) {
    if (!isEncryptedBlob(raw)) throw new Error(`${rel}: expected an encrypted file, found plaintext`);
    try {
      return decrypt(vault.key, raw);
    } catch (err) {
      if (err instanceof DecryptError) throw new Error(`${rel}: ${err.message}`);
      throw err;
    }
  }
  if (isEncryptedBlob(raw)) throw new Error(`${rel}: encrypted file in a plaintext user's folder`);
  return raw;
}

export async function writeBytes(vault: Vault, rel: string, data: Uint8Array): Promise<void> {
  const path = pathFor(vault, rel);
  await writeFileAtomic(path, vault.key ? encrypt(vault.key, data) : data);
}

export async function readJson<T>(vault: Vault, rel: string): Promise<T | null> {
  const bytes = await readBytes(vault, rel);
  if (bytes === null) return null;
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch {
    // V8's message quotes the text it choked on, and internal errors are logged: never let content reach the log.
    throw new Error(`${rel}: not valid JSON`);
  }
}

/** Plaintext users get pretty JSON for easy debugging; encrypted users get compact JSON inside the ciphertext. */
export async function writeJson(vault: Vault, rel: string, value: unknown): Promise<void> {
  const text = vault.key ? JSON.stringify(value) : `${JSON.stringify(value, null, 2)}\n`;
  await writeBytes(vault, rel, Buffer.from(text, "utf8"));
}

export async function removeFile(vault: Vault, rel: string): Promise<void> {
  await rm(pathFor(vault, rel), { force: true });
}

export async function listFiles(vault: Vault, relDir: string): Promise<string[]> {
  return listDir(pathFor(vault, relDir, "dir"));
}
