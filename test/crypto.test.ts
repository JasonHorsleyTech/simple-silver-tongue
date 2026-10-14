import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createKeyEnvelope, decrypt, DecryptError, encrypt, MAGIC, openKeyEnvelope } from "../src/storage/crypto.ts";
import { createUser, unlockUser } from "../src/storage/users.ts";
import { closeVault, forkVault, listFiles, readJson, writeJson } from "../src/storage/vault.ts";
import { randomBytes } from "node:crypto";

const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 }; // tests only; real users get KDF_DEFAULTS
const tmp = await mkdtemp(join(tmpdir(), "ss-crypto-"));
after(() => rm(tmp, { recursive: true, force: true }));

test("encrypt/decrypt round trip, with a fresh IV every time", () => {
  const key = randomBytes(32);
  const msg = Buffer.from("The hooded figure slides a coin across the table.");
  const a = encrypt(key, msg);
  const b = encrypt(key, msg);
  assert.ok(a.subarray(0, MAGIC.length).equals(MAGIC));
  assert.notDeepEqual(a, b, "same plaintext must not give the same ciphertext");
  assert.deepEqual(decrypt(key, a), msg);
  assert.deepEqual(decrypt(key, b), msg);
});

test("a wrong key or a flipped bit fails to decrypt", () => {
  const key = randomBytes(32);
  const blob = encrypt(key, Buffer.from("secret"));
  assert.throws(() => decrypt(randomBytes(32), blob), DecryptError);
  const tampered = Buffer.from(blob);
  tampered[tampered.length - 1]! ^= 1;
  assert.throws(() => decrypt(key, tampered), DecryptError);
});

test("key envelope: the right password opens it, a wrong one fails", async () => {
  const env = await createKeyEnvelope("correct horse", FAST_KDF);
  assert.deepEqual(await openKeyEnvelope("correct horse", env.kdf, env.wrappedKey), env.dataKey);
  await assert.rejects(openKeyEnvelope("wrong horse", env.kdf, env.wrappedKey), DecryptError);
  await assert.rejects(openKeyEnvelope("", env.kdf, env.wrappedKey), DecryptError);
});

test("encrypted user: files on disk are ciphertext and read back intact; wrong password is rejected", async () => {
  const dataDir = join(tmp, "data");
  await createUser(dataDir, "dev-enc", "pw", FAST_KDF);
  await assert.rejects(unlockUser(dataDir, "dev-enc", "nope"), { code: "wrong_password" });
  const { vault } = await unlockUser(dataDir, "dev-enc", "pw");
  assert.ok(vault.key);

  const phrase = "The barkeep polishes a tankard";
  await writeJson(vault, "conversations/c_test.json", { title: phrase });
  const raw = await readFile(join(vault.dir, "conversations", "c_test.json"));
  assert.ok(raw.subarray(0, MAGIC.length).equals(MAGIC));
  assert.ok(!raw.includes(Buffer.from(phrase)), "plaintext leaked to disk");
  assert.ok(!(await readdir(join(vault.dir, "conversations"))).some((f) => f.endsWith(".tmp")), "temp file left behind");
  assert.deepEqual(await readJson(vault, "conversations/c_test.json"), { title: phrase });

  // A plaintext file planted in an encrypted user's folder is refused, not silently trusted.
  await writeFile(join(vault.dir, "conversations", "c_plain.json"), "{}");
  await assert.rejects(readJson(vault, "conversations/c_plain.json"), { code: "unreadable_file", message: /not encrypted, but every file of an encrypted user is/ });
  // user.json never goes through the vault, and paths can't escape the user's folder.
  await assert.rejects(writeJson(vault, "user.json", {}), /not vault data/);
  await assert.rejects(writeJson(vault, "../dev-other/x.json", {}), /unsafe path/);
  // T01 QA-3: no spelling reaches user.json (macOS volumes are case-insensitive), and login still works.
  for (const p of ["conversations/../user.json", "./user.json", "USER.json", "User.JSON"]) {
    await assert.rejects(writeJson(vault, p, { oops: 1 }), /unsafe path|not vault data/, p);
  }
  assert.ok((await unlockUser(dataDir, "dev-enc", "pw")).vault.key);
  assert.deepEqual(await listFiles(vault, "conversations"), ["c_plain.json", "c_test.json"]);
});

test("a forked vault outlives a closed master; a closed vault refuses everything; a wiped key can't encrypt", async () => {
  const dataDir = join(tmp, "data");
  const { vault: master } = await unlockUser(dataDir, "dev-enc", "pw");
  const lease = forkVault(master);
  closeVault(master); // what logout does to the session's copy
  assert.ok(master.key!.every((b) => b === 0));
  assert.throws(() => forkVault(master), { code: "session_ended" });
  await writeJson(lease, "conversations/c_lease.json", { ok: 1 }); // running work is unaffected
  assert.deepEqual(await readJson((await unlockUser(dataDir, "dev-enc", "pw")).vault, "conversations/c_lease.json"), { ok: 1 });
  closeVault(lease);
  await assert.rejects(writeJson(lease, "conversations/c_lease.json", { ok: 2 }), { code: "session_ended" });
  await assert.rejects(readJson(lease, "conversations/c_lease.json"), { code: "session_ended" });
  assert.throws(() => encrypt(Buffer.alloc(32), Buffer.from("x")), /wiped/);
});

test("plaintext user: files are readable JSON", async () => {
  const dataDir = join(tmp, "data");
  await createUser(dataDir, "dev-plain", "");
  await assert.rejects(unlockUser(dataDir, "dev-plain", "something"), { code: "wrong_password" });
  const { vault } = await unlockUser(dataDir, "dev-plain", "");
  assert.equal(vault.key, null);
  await writeJson(vault, "conversations/c_x.json", { title: "hello" });
  const raw = await readFile(join(vault.dir, "conversations", "c_x.json"), "utf8");
  assert.deepEqual(JSON.parse(raw), { title: "hello" });
});
