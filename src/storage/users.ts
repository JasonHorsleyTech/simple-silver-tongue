import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { badRequest, conflict, notFound, wrongPassword } from "../lib/errors.ts";
import { nowIso } from "../lib/ids.ts";
import { createKeyEnvelope, DecryptError, KDF_DEFAULTS, openKeyEnvelope, type KdfParams } from "./crypto.ts";
import { listDir, readFileOrNull, writeFileAtomic } from "./files.ts";
import type { Vault } from "./vault.ts";

/** Plaintext metadata only. Never the password or any key in the clear. */
export type UserRecord = {
  version: 1;
  username: string;
  encrypted: boolean;
  createdAt: string;
  kdf?: KdfParams;
  /** The user's random data key, encrypted with the scrypt key (crypto.ts file format, base64). */
  wrappedKey?: string;
};

export type UserSummary = { username: string; encrypted: boolean; createdAt: string };

export const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const USERNAME_RULE = "1-32 characters: lowercase letters, digits, '-' or '_', starting with a letter or digit";

export function usersDir(dataDir: string): string {
  return join(dataDir, "users");
}

export function userDir(dataDir: string, username: string): string {
  if (!USERNAME_RE.test(username)) throw badRequest(`Invalid username. Use ${USERNAME_RULE}.`);
  return join(usersDir(dataDir), username);
}

export function summarize(u: UserRecord): UserSummary {
  return { username: u.username, encrypted: u.encrypted, createdAt: u.createdAt };
}

export async function loadUser(dataDir: string, username: string): Promise<UserRecord | null> {
  const raw = await readFileOrNull(join(userDir(dataDir, username), "user.json"));
  return raw ? (JSON.parse(raw.toString("utf8")) as UserRecord) : null;
}

export async function createUser(
  dataDir: string,
  username: string,
  password: string,
  kdfParams = KDF_DEFAULTS,
): Promise<UserRecord> {
  const dir = userDir(dataDir, username);
  await mkdir(usersDir(dataDir), { recursive: true, mode: 0o700 });
  try {
    await mkdir(dir, { mode: 0o700 }); // not recursive: EEXIST is our "already taken" signal, race-free
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw conflict(`User ${username} already exists.`);
    throw err;
  }
  try {
    const record: UserRecord = { version: 1, username, encrypted: password !== "", createdAt: nowIso() };
    if (record.encrypted) {
      const env = await createKeyEnvelope(password, kdfParams);
      env.dataKey.fill(0); // nothing to write yet; login will unwrap it again
      record.kdf = env.kdf;
      record.wrappedKey = env.wrappedKey;
    }
    await writeFileAtomic(join(dir, "user.json"), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  } catch (err) {
    await rm(dir, { recursive: true, force: true }); // don't leave a half-made user behind
    throw err;
  }
}

export async function listUsers(dataDir: string): Promise<UserSummary[]> {
  const out: UserSummary[] = [];
  for (const name of await listDir(usersDir(dataDir))) {
    if (!USERNAME_RE.test(name)) continue;
    const u = await loadUser(dataDir, name).catch(() => null);
    if (u) out.push(summarize(u));
  }
  return out;
}

/** Check the password and return the user's vault (key is null for plaintext users). */
export async function unlockUser(dataDir: string, username: string, password: string): Promise<{ user: UserRecord; vault: Vault }> {
  const user = await loadUser(dataDir, username);
  if (!user) throw notFound(`No user named ${username}. Create one with ./ss user.create --username ${username}.`);
  const dir = userDir(dataDir, username);
  if (!user.encrypted) {
    if (password !== "") throw wrongPassword(`${username} has no password (unencrypted user). Log in with an empty password.`);
    return { user, vault: { dir, key: null } };
  }
  if (!user.kdf || !user.wrappedKey) throw new Error(`${username}/user.json is missing its key envelope`);
  try {
    const key = await openKeyEnvelope(password, user.kdf, user.wrappedKey);
    return { user, vault: { dir, key } };
  } catch (err) {
    if (err instanceof DecryptError) throw wrongPassword(`Wrong password for ${username}.`);
    throw err;
  }
}
