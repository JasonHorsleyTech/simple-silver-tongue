import { listFiles, readBytes, removeFile, writeBytes, type Vault } from "../storage/vault.ts";
import { kindOfExt, type ImageKind } from "./sniff.ts";

/**
 * Image files: images/<imageId>.<ext> in the user's folder, through the vault, so they are ciphertext for an
 * encrypted user exactly like conversations. The extension is the sniffed type. One file per image id.
 */

export const IMAGE_ID_RE = /^img_[a-z0-9]{4,32}$/;

const DIR = "images";

export async function saveImageFile(vault: Vault, id: string, kind: ImageKind, bytes: Uint8Array): Promise<void> {
  await writeBytes(vault, `${DIR}/${id}.${kind.ext}`, bytes);
}

/** The stored file's name and kind, or null when there is none (still pending, failed, or deleted). */
export async function findImageFile(vault: Vault, id: string): Promise<{ name: string; kind: ImageKind } | null> {
  if (!IMAGE_ID_RE.test(id)) return null;
  for (const name of await listFiles(vault, DIR)) {
    if (!name.startsWith(`${id}.`)) continue;
    const kind = kindOfExt(name.slice(id.length + 1));
    if (kind) return { name, kind };
  }
  return null;
}

export async function readImageFile(vault: Vault, id: string): Promise<{ bytes: Buffer; kind: ImageKind; name: string } | null> {
  const file = await findImageFile(vault, id);
  if (!file) return null;
  const bytes = await readBytes(vault, `${DIR}/${file.name}`);
  return bytes ? { bytes, kind: file.kind, name: file.name } : null;
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
