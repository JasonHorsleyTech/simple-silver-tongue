import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";

/** Write to a temp file in the same directory, fsync, then rename over the target. */
export async function writeFileAtomic(path: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  const fh = await open(tmp, "wx", 0o600);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export async function readFileOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Directory entries, skipping temp files and dotfiles. Missing directory → []. */
export async function listDir(path: string): Promise<string[]> {
  try {
    const names = await readdir(path);
    return names.filter((n) => !n.startsWith(".") && !n.endsWith(".tmp")).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Join a relative path under root, refusing anything that would escape it. */
export function safeJoin(root: string, rel: string): string {
  if (!rel || rel.includes("\0") || isAbsolute(rel)) throw new Error(`unsafe path: ${JSON.stringify(rel)}`);
  const norm = normalize(rel);
  if (norm === ".." || norm.startsWith(`..${sep}`) || norm.split(sep).includes("..")) {
    throw new Error(`unsafe path: ${JSON.stringify(rel)}`);
  }
  return join(root, norm);
}
