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
  return blob.length >= HEADER_LEN && Buffer.from(blob.subarray(0, MAGIC.length)).equals(MAGIC);
}

export function encrypt(key: Buffer, plaintext: Uint8Array): Buffer {
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

export function deriveKey(password: string, kdf: KdfParams): Promise<Buffer> {
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
  const kdf: KdfParams = { name: "scrypt", ...params, salt: randomBytes(16).toString("base64") };
  const kek = await deriveKey(password, kdf);
  const dataKey = randomBytes(32);
  const wrappedKey = encrypt(kek, dataKey).toString("base64");
  kek.fill(0);
  return { kdf, wrappedKey, dataKey };
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
