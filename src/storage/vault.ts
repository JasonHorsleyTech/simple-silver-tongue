import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { sessionEnded, USER_DELETED } from "../lib/errors.ts";
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
export type Vault = { dir: string; key: Buffer | null; closed?: boolean; deleted?: boolean };

/**
 * Every open vault of this server, by user folder: each session's master copy and each request's or job's fork
 * (T06). An open fork is work using that user's data right now, which is what user.delete must not cut short,
 * and once a user is deleted every copy of its key still open is closed (closeVaultsOf).
 */
const open = new Map<string, Map<Vault, "master" | "fork">>();

function track(vault: Vault, role: "master" | "fork"): Vault {
  let m = open.get(vault.dir);
  if (!m) open.set(vault.dir, (m = new Map()));
  m.set(vault, role);
  return vault;
}

/** A session's master vault (auth.login). Close it on logout. */
export function openVault(dir: string, key: Buffer | null): Vault {
  return track({ dir, key }, "master");
}

/** An independent copy (own key buffer) for one job. Whoever forks it must closeVault it when done. */
export function forkVault(vault: Vault): Vault {
  if (vault.closed) throw ended(vault);
  return track({ dir: vault.dir, key: vault.key ? Buffer.from(vault.key) : null }, "fork");
}

/** Zero the key and refuse all further use. Idempotent. */
export function closeVault(vault: Vault): void {
  vault.key?.fill(0);
  vault.closed = true;
  const m = open.get(vault.dir);
  if (m?.delete(vault) && m.size === 0) open.delete(vault.dir);
}

/** How many forks of this user's folder are open (work running on its data), not counting `except`. */
export function forksOpen(dir: string, except?: Vault | null): number {
  let n = 0;
  for (const [v, role] of open.get(dir) ?? []) if (role === "fork" && v !== except) n++;
  return n;
}

/** Close every open copy of this user's key, masters and forks (user.delete). Returns how many there were. */
export function closeVaultsOf(dir: string): number {
  const all = [...(open.get(dir)?.keys() ?? [])];
  for (const v of all) {
    v.deleted = true;
    closeVault(v);
  }
  return all.length;
}

const ended = (vault: Vault) => sessionEnded(vault.deleted ? USER_DELETED : undefined);

/**
 * Vault files always live in a subfolder (conversations/, images/). The top level, where user.json lives,
 * is out of reach whatever the spelling: macOS volumes are usually case-insensitive, so a name check alone
 * would let USER.json through. Dot segments are refused by safeJoin.
 */
function pathFor(vault: Vault, rel: string, kind: "file" | "dir" = "file"): string {
  if (vault.closed) throw ended(vault);
  const path = safeJoin(vault.dir, rel);
  const depth = relative(vault.dir, path).split(sep).filter(Boolean).length;
  if (depth < (kind === "file" ? 2 : 1)) throw new Error(`${rel}: vault files live in a subfolder; the top level (user.json) is not vault data`);
  return path;
}

/**
 * Make the subfolders between the user's folder and a file, but never the user's folder itself: a write that
 * comes after user.delete must fail, not bring back a folder with no user.json (T01 QA-2, T06).
 */
async function makeParents(vault: Vault, path: string): Promise<void> {
  let dir = vault.dir;
  for (const part of relative(vault.dir, dirname(path)).split(sep).filter(Boolean)) {
    dir = join(dir, part);
    try {
      await mkdir(dir, { mode: 0o700 });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") continue;
      if (code === "ENOENT") throw sessionEnded(USER_DELETED);
      throw err;
    }
  }
}

export async function readBytes(vault: Vault, rel: string): Promise<Buffer | null> {
  const raw = await readFileOrNull(pathFor(vault, rel));
  if (raw === null) return null;
  if (vault.closed) throw ended(vault); // closed while we were reading
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
  await makeParents(vault, path);
  await writeFileAtomic(path, vault.key ? encrypt(vault.key, data) : data, { makeDirs: false });
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

/** Rename a file within the user's folder (both names go through the same checks). */
export async function renameFile(vault: Vault, from: string, to: string): Promise<void> {
  await rename(pathFor(vault, from), pathFor(vault, to));
}

export async function listFiles(vault: Vault, relDir: string): Promise<string[]> {
  return listDir(pathFor(vault, relDir, "dir"));
}
