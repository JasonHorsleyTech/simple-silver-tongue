import { rm } from "node:fs/promises";
import { decrypt, DecryptError, encrypt, isEncryptedBlob } from "./crypto.ts";
import { listDir, readFileOrNull, safeJoin, writeFileAtomic } from "./files.ts";

/**
 * A user's storage root plus their data key. Every file under the root goes through here, so an
 * encrypted user's data is ciphertext on disk (temp files included) and a plaintext user's is readable JSON.
 * user.json is the one exception and is handled by users.ts, never by the vault.
 */
export type Vault = { dir: string; key: Buffer | null };

function pathFor(vault: Vault, rel: string): string {
  if (rel === "user.json") throw new Error("user.json is not vault data");
  return safeJoin(vault.dir, rel);
}

export async function readBytes(vault: Vault, rel: string): Promise<Buffer | null> {
  const raw = await readFileOrNull(pathFor(vault, rel));
  if (raw === null) return null;
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
  await writeFileAtomic(pathFor(vault, rel), vault.key ? encrypt(vault.key, data) : data);
}

export async function readJson<T>(vault: Vault, rel: string): Promise<T | null> {
  const bytes = await readBytes(vault, rel);
  return bytes === null ? null : (JSON.parse(bytes.toString("utf8")) as T);
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
  return listDir(pathFor(vault, relDir));
}
