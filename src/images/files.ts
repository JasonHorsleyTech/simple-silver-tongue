import { listFiles, readBytes, removeFile, renameFile, writeBytes, type Vault } from "../storage/vault.ts";
import { kindOfExt, sniffImage, type ImageKind } from "./sniff.ts";

/**
 * Image files: images/<imageId>.<ext> in the user's folder, through the vault, so they are ciphertext for an
 * encrypted user exactly like conversations. One file per image id.
 *
 * The extension is the sniffed type for a plaintext user (so the files open in a viewer, for debugging). For an
 * encrypted user it is always .bin (T06, T05 QA-6): a typed extension gave away the format Venice returned,
 * which hints at the model. Nothing needs it: the record has the mime, and reading a file sniffs the bytes.
 * Files written before T06 (img_….webp in an encrypted folder) are still found, and are renamed at login.
 */

export const IMAGE_ID_RE = /^img_[a-z0-9]{4,32}$/;

const DIR = "images";
export const NEUTRAL_EXT = "bin";

const extOf = (name: string) => name.slice(name.indexOf(".") + 1);

export async function saveImageFile(vault: Vault, id: string, kind: ImageKind, bytes: Uint8Array): Promise<void> {
  await writeBytes(vault, `${DIR}/${id}.${vault.key ? NEUTRAL_EXT : kind.ext}`, bytes);
}

/** The stored file's name, or null when there is none (still pending, failed, or deleted). */
export async function findImageFile(vault: Vault, id: string): Promise<{ name: string } | null> {
  if (!IMAGE_ID_RE.test(id)) return null;
  for (const name of await listFiles(vault, DIR)) {
    if (!name.startsWith(`${id}.`)) continue;
    const ext = extOf(name);
    if (ext === NEUTRAL_EXT || kindOfExt(ext)) return { name };
  }
  return null;
}

/** The bytes (decrypted) and what they really are, sniffed; null when there is no file. */
export async function readImageFile(vault: Vault, id: string): Promise<{ bytes: Buffer; kind: ImageKind | null; name: string } | null> {
  const file = await findImageFile(vault, id);
  if (!file) return null;
  const bytes = await readBytes(vault, `${DIR}/${file.name}`);
  return bytes ? { bytes, kind: sniffImage(bytes) ?? kindOfExt(extOf(file.name)), name: file.name } : null;
}

/** Remove these images' files. Best effort: a file that is already gone is fine. */
export async function removeImageFiles(vault: Vault, ids: Iterable<string>): Promise<void> {
  const want = new Set([...ids].filter((id) => IMAGE_ID_RE.test(id)));
  if (!want.size) return;
  for (const name of await listFiles(vault, DIR)) {
    const id = name.slice(0, name.indexOf("."));
    if (want.has(id)) await removeFile(vault, `${DIR}/${name}`);
  }
}

/**
 * An encrypted user's image files from before T06 carry their type in the name (img_….webp). Rename them to
 * the neutral .bin. Names only: nothing is read or decrypted. Returns how many were renamed.
 */
export async function neutralizeImageNames(vault: Vault): Promise<number> {
  if (!vault.key) return 0;
  let n = 0;
  for (const name of await listFiles(vault, DIR)) {
    const id = name.slice(0, name.indexOf("."));
    if (!IMAGE_ID_RE.test(id) || !kindOfExt(extOf(name))) continue;
    await renameFile(vault, `${DIR}/${name}`, `${DIR}/${id}.${NEUTRAL_EXT}`);
    n++;
  }
  return n;
}
