import { randomBytes } from "node:crypto";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { badRequest, conflict, isUnreadable, notFound, unreadableFile, wrongPassword } from "../lib/errors.ts";
import { nowIso } from "../lib/ids.ts";
import { checkKdf, createKeyEnvelope, DecryptError, KDF_DEFAULTS, KdfError, openKeyEnvelope, wrapKey, type KdfParams } from "./crypto.ts";
import { listDir, readFileOrNull, writeFileAtomic } from "./files.ts";
import { closeVault, openVault, type Vault } from "./vault.ts";

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

/** A deleted user's folder is renamed to this first (atomic), then removed. Dot-names are never listed as users. */
const GRAVE_PREFIX = ".deleted-";

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

/**
 * Null when there is no user.json. A damaged one (cut short, edited by hand, another user's copied in) is a clear
 * `unreadable_file` error rather than a 500 with a stack, and its key-derivation settings are checked before anything
 * runs them (T06 QA-5). user.json holds no secret, but V8's JSON errors quote their input, so they never reach the log.
 */
export async function loadUser(dataDir: string, username: string): Promise<UserRecord | null> {
  const raw = await readFileOrNull(join(userDir(dataDir, username), "user.json"));
  if (!raw) return null;
  let u: UserRecord;
  try {
    u = JSON.parse(raw.toString("utf8")) as UserRecord;
  } catch {
    throw damagedUser(username, "it is not valid JSON");
  }
  if (typeof u !== "object" || u === null || typeof u.encrypted !== "boolean" || typeof u.createdAt !== "string") {
    throw damagedUser(username, "fields are missing");
  }
  if (u.username !== username) throw damagedUser(username, `it is ${typeof u.username === "string" ? `${u.username}'s` : "no user's"} (copied or renamed by hand?)`);
  if (u.encrypted) {
    if (typeof u.wrappedKey !== "string") throw damagedUser(username, "its wrapped key is missing");
    try {
      checkKdf(u.kdf);
    } catch (err) {
      if (err instanceof KdfError) throw damagedUser(username, err.message);
      throw err;
    }
  }
  return u;
}

function damagedUser(username: string, why: string) {
  return unreadableFile(
    `users/${username}/user.json`,
    `damaged: ${why}. So ${username} can't log in. Put back a good copy if you have one (an encrypted user's data can't be read without it), or remove the user with ./sst user.delete --username ${username}.`,
  );
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
    await writeFileAtomic(join(dir, "user.json"), `${JSON.stringify(record, null, 2)}\n`, { makeDirs: false });
    return record;
  } catch (err) {
    await rm(dir, { recursive: true, force: true }); // don't leave a half-made user behind
    throw err;
  }
}

export type UnreadableUser = { username: string; error: string };

/** Every user, plus those whose user.json is damaged: listed, not silently left out (T06 QA-5). */
export async function listUsers(dataDir: string): Promise<{ users: UserSummary[]; unreadable: UnreadableUser[] }> {
  const users: UserSummary[] = [];
  const unreadable: UnreadableUser[] = [];
  for (const name of await listDir(usersDir(dataDir))) {
    if (!USERNAME_RE.test(name)) continue;
    try {
      const u = await loadUser(dataDir, name);
      if (u) users.push(summarize(u));
    } catch (err) {
      if (!isUnreadable(err)) throw err;
      unreadable.push({ username: name, error: (err as Error).message.replace(`users/${name}/user.json: `, "") });
    }
  }
  return { users, unreadable };
}

const sameUser = (a: UserRecord | null, b: UserRecord) => a !== null && a.createdAt === b.createdAt && a.username === b.username;

/** Check the password and return the user's vault (key is null for plaintext users). */
export async function unlockUser(dataDir: string, username: string, password: string): Promise<{ user: UserRecord; vault: Vault }> {
  const user = await loadUser(dataDir, username);
  if (!user) throw notFound(`No user named ${username}. Create one with ./sst user.create --username ${username}.`);
  const dir = userDir(dataDir, username);
  let vault: Vault;
  if (!user.encrypted) {
    if (password !== "") throw wrongPassword(`${username} has no password (unencrypted user). Log in with an empty password.`);
    vault = openVault(dir, null);
  } else {
    try {
      vault = openVault(dir, await openKeyEnvelope(password, user.kdf!, user.wrappedKey!));
    } catch (err) {
      if (err instanceof DecryptError) throw wrongPassword(`Wrong password for ${username}.`);
      throw err;
    }
  }
  // scrypt takes ~200 ms. If user.delete (or a password change) landed meanwhile, don't hand out a key for a
  // user that is gone: its session's first write would bring back a folder with no user.json (T06).
  const now = await loadUser(dataDir, username).catch((err) => {
    closeVault(vault);
    throw err;
  });
  if (!sameUser(now, user)) {
    closeVault(vault);
    throw notFound(`No user named ${username}: it was deleted while you were logging in.`);
  }
  if (now!.wrappedKey !== user.wrappedKey) {
    closeVault(vault);
    throw wrongPassword(`The password for ${username} was changed while you were logging in. Log in with the new one.`);
  }
  return { user, vault };
}

/**
 * Change an encrypted user's password (T06). The envelope design makes it cheap: the data key that encrypts
 * the files stays the same, and only user.json's wrappedKey is rewrapped, with a fresh salt. No file is touched.
 * A plaintext user has no password to change, and an encrypted one can't drop its password here (that would
 * mean decrypting every file).
 */
export async function changePassword(dataDir: string, username: string, current: string, next: string, kdfParams = KDF_DEFAULTS): Promise<UserRecord> {
  const user = await loadUser(dataDir, username);
  if (!user) throw notFound(`No user named ${username}.`);
  if (!user.encrypted) {
    throw badRequest(`${username} is unencrypted, so it has no password to change. Its files are plain JSON on purpose (for debugging); for encrypted data, create a new user with a password.`);
  }
  if (next === "") {
    throw badRequest(`The new password can't be empty: ${username} is encrypted and stays encrypted (no password would mean decrypting every file). Choose a new password.`);
  }
  let dataKey: Buffer;
  try {
    dataKey = await openKeyEnvelope(current, user.kdf!, user.wrappedKey!);
  } catch (err) {
    if (err instanceof DecryptError) throw wrongPassword(`Wrong password for ${username}. Nothing was changed.`);
    throw err;
  }
  try {
    const env = await wrapKey(dataKey, next, kdfParams);
    const now = await loadUser(dataDir, username);
    if (!sameUser(now, user)) throw notFound(`No user named ${username}: it was deleted meanwhile.`);
    if (now!.wrappedKey !== user.wrappedKey) throw conflict(`The password for ${username} was changed by someone else just now. Nothing was changed; try again.`);
    const record: UserRecord = { ...user, kdf: env.kdf, wrappedKey: env.wrappedKey };
    try {
      await writeFileAtomic(join(userDir(dataDir, username), "user.json"), `${JSON.stringify(record, null, 2)}\n`, { makeDirs: false });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw notFound(`No user named ${username}: it was deleted meanwhile.`);
      throw err;
    }
    return record;
  } finally {
    dataKey.fill(0);
  }
}

/** What a user's folder holds, by name only (nothing is read or decrypted). */
export async function countUserFiles(dataDir: string, username: string): Promise<{ conversations: number; images: number }> {
  const dir = userDir(dataDir, username);
  const conversations = (await listDir(join(dir, "conversations"))).filter((n) => n.endsWith(".json")).length;
  const images = (await listDir(join(dir, "images"))).length;
  return { conversations, images };
}

/**
 * Remove a user's folder for good (user.delete). It is renamed away first, which is atomic: from that moment
 * the name is free and nothing can log in to it or read it. Then the renamed folder is removed. A removal cut
 * short (a crash) leaves a dot-named folder that no listing shows; the next delete sweeps it.
 */
export async function removeUserFolder(dataDir: string, username: string): Promise<void> {
  const grave = join(usersDir(dataDir), `${GRAVE_PREFIX}${username}-${randomBytes(4).toString("hex")}`);
  try {
    await rename(userDir(dataDir, username), grave);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw notFound(`No user named ${username}.`);
    throw err;
  }
  await rm(grave, { recursive: true, force: true });
  await sweepRemovedUsers(dataDir);
}

/** Finish any earlier removal that was cut short. Best effort. */
export async function sweepRemovedUsers(dataDir: string): Promise<void> {
  const names = await readdir(usersDir(dataDir)).catch(() => [] as string[]);
  for (const n of names) if (n.startsWith(GRAVE_PREFIX)) await rm(join(usersDir(dataDir), n), { recursive: true, force: true }).catch(() => {});
}
