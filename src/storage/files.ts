import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

/**
 * Write to a temp file in the same directory, fsync, then rename over the target. `makeDirs: false` when the
 * folder must already exist: a user's files never re-create a deleted user's folder (T06, user.delete).
 */
export async function writeFileAtomic(path: string, data: Uint8Array | string, opts: { makeDirs?: boolean } = {}): Promise<void> {
  if (opts.makeDirs !== false) await mkdir(dirname(path), { recursive: true, mode: 0o700 });
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

/**
 * Join a relative path under root. Any "." or ".." segment is refused outright rather than normalized
 * away, so "conversations/../user.json" can't sneak past a check on the result.
 */
export function safeJoin(root: string, rel: string): string {
  if (!rel || rel.includes("\0") || isAbsolute(rel) || rel.split(/[\\/]/).some((p) => p === "." || p === "..")) {
    throw new Error(`unsafe path: ${JSON.stringify(rel)}`);
  }
  return join(root, rel);
}
