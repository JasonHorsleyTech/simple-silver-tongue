import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";

/**
 * File format: "SSENC1" | 12-byte IV | 16-byte GCM tag | AES-256-GCM ciphertext.
 * The magic is also the GCM additional data, so the header is authenticated too.
 */
export const MAGIC = Buffer.from("SSENC1", "ascii");
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + IV_LEN + TAG_LEN;

export type KdfParams = { name: "scrypt"; N: number; r: number; p: number; salt: string };

// OWASP's scrypt recommendation. About 200 ms per login on an M-series Mac.
export const KDF_DEFAULTS = { N: 2 ** 17, r: 8, p: 1 };

export class DecryptError extends Error {}

export function isEncryptedBlob(blob: Uint8Array): boolean {
  return blob.length >= HEADER_LEN && hasMagic(blob);
}

/** Starts with the magic, whatever its length: a file cut short is still ours, just damaged (T06 QA-2). */
export function hasMagic(blob: Uint8Array): boolean {
  return blob.length >= MAGIC.length && Buffer.from(blob.subarray(0, MAGIC.length)).equals(MAGIC);
}

export function encrypt(key: Buffer, plaintext: Uint8Array): Buffer {
  // Last-ditch guard: a key that was wiped (closeVault) must never produce "ciphertext" anyone can read.
  if (key.every((b) => b === 0)) throw new Error("refusing to encrypt with a wiped (all-zero) key");
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MAGIC);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ct]);
}

export function decrypt(key: Buffer, blob: Uint8Array): Buffer {
  if (!isEncryptedBlob(blob)) throw new DecryptError("not an encrypted file");
  const buf = Buffer.from(blob);
  const iv = buf.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const tag = buf.subarray(MAGIC.length + IV_LEN, HEADER_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(buf.subarray(HEADER_LEN)), decipher.final()]);
  } catch {
    throw new DecryptError("decryption failed (wrong key or corrupted file)");
  }
}

/**
 * scrypt needs 128·N·r bytes and N·r·p work. The params come from user.json, which anyone at the computer can edit:
 * inflated ones made one login allocate gigabytes and swap the Mac for minutes (T06 QA-5). So allow at most 8× the
 * defaults' memory (1 GiB) and work (~1.6 s), which leaves room to raise KDF_DEFAULTS later.
 */
const KDF_MAX_NR = 8 * KDF_DEFAULTS.N * KDF_DEFAULTS.r;
const KDF_MAX_WORK = 8 * KDF_DEFAULTS.N * KDF_DEFAULTS.r * KDF_DEFAULTS.p;

export class KdfError extends Error {}

/** Throws KdfError for params scrypt shouldn't run with: not positive integers, N not a power of two, or too costly. */
export function checkKdf(kdf: unknown): asserts kdf is KdfParams {
  const k = kdf as Partial<KdfParams> | null;
  const int = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1;
  if (!k || typeof k !== "object" || k.name !== "scrypt" || typeof k.salt !== "string" || !int(k.N) || !int(k.r) || !int(k.p)) {
    throw new KdfError("its key-derivation settings are missing or malformed");
  }
  if (k.N < 2 || (k.N & (k.N - 1)) !== 0) throw new KdfError(`its key-derivation N (${k.N}) is not a power of two`);
  if (k.N * k.r > KDF_MAX_NR || k.N * k.r * k.p > KDF_MAX_WORK) {
    throw new KdfError(`its key-derivation settings (N=${k.N}, r=${k.r}, p=${k.p}) are far above this app's (N=${KDF_DEFAULTS.N}, r=${KDF_DEFAULTS.r}, p=${KDF_DEFAULTS.p}), so they aren't run`);
  }
}

export function deriveKey(password: string, kdf: KdfParams): Promise<Buffer> {
  checkKdf(kdf);
  const { N, r, p } = kdf;
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFC"), Buffer.from(kdf.salt, "base64"), 32, { N, r, p, maxmem: 256 * N * r }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/**
 * Envelope scheme: a random 32-byte data key encrypts the user's files, and the password-derived key
 * only wraps that data key. A wrong password fails the GCM check on the wrapped key, so no separate
 * verifier is needed, and a future password change only rewraps one small blob.
 */
export async function createKeyEnvelope(
  password: string,
  params = KDF_DEFAULTS,
): Promise<{ kdf: KdfParams; wrappedKey: string; dataKey: Buffer }> {
  const dataKey = randomBytes(32);
  return { ...(await wrapKey(dataKey, password, params)), dataKey };
}

/**
 * Wrap a data key with a password: a fresh salt, so the same password never gives the same envelope. A password
 * change rewraps the user's existing data key this way (T06), and no file needs re-encrypting.
 */
export async function wrapKey(dataKey: Buffer, password: string, params = KDF_DEFAULTS): Promise<{ kdf: KdfParams; wrappedKey: string }> {
  const kdf: KdfParams = { name: "scrypt", ...params, salt: randomBytes(16).toString("base64") };
  const kek = await deriveKey(password, kdf);
  try {
    return { kdf, wrappedKey: encrypt(kek, dataKey).toString("base64") };
  } finally {
    kek.fill(0);
  }
}

/** Returns the data key, or throws DecryptError when the password is wrong. */
export async function openKeyEnvelope(password: string, kdf: KdfParams, wrappedKey: string): Promise<Buffer> {
  const kek = await deriveKey(password, kdf);
  try {
    return decrypt(kek, Buffer.from(wrappedKey, "base64"));
  } finally {
    kek.fill(0);
  }
}
