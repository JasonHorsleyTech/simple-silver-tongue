import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { Conversation } from "../src/conversations/types.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 };

describe("T06 triage: damaged files say what is wrong, never 'Internal server error' (QA-2, QA-4, QA-5)", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  const log: string[] = [];
  before(async () => {
    t = await startTestServer({ log: (l) => void log.push(l) });
    await createUser(t.config.dataDir, "dev-dmg", "dmg-pw", FAST_KDF);
    await createUser(t.config.dataDir, "dev-dmg-plain", "", FAST_KDF);
    await createUser(t.config.dataDir, "dev-dmg-user", "user-pw", FAST_KDF);
  });
  after(() => t.close());

  const ok = async (argv: string[], io?: Parameters<typeof t.cli>[1]) => {
    const r = await t.cli(argv, io);
    assert.equal(r.code, 0, `${argv.join(" ")}\n${r.stderr}`);
    return r;
  };
  const fails = async (argv: string[], message: RegExp, io?: Parameters<typeof t.cli>[1]) => {
    const r = await t.cli(argv, io);
    assert.equal(r.code, 1, `${argv.join(" ")} should fail\n${r.stdout}`);
    assert.match(r.stderr, message);
    assert.doesNotMatch(r.stderr, /Internal server error/);
  };
  const dir = (u: string, sub: string) => join(t.config.dataDir, "users", u, sub);
  const flip = async (file: string, at?: number) => {
    const b = await readFile(file);
    b[at ?? Math.floor(b.length / 2)]! ^= 1;
    await writeFile(file, b);
  };

  test("an encrypted user's damaged, cut-short, empty or plaintext conversation file", async () => {
    await ok(["auth.login", "--username", "dev-dmg", "--password", "-"], { stdin: "dmg-pw\n" });
    const c = (JSON.parse((await ok(["conversation.create", "--title", "Ok", "--system-prompt", "x", "--json"])).stdout) as Conversation).id;
    const file = join(dir("dev-dmg", "conversations"), `${c}.json`);
    const good = await readFile(file);
    const name = `conversations/${c}.json`;

    await flip(file);
    await fails(["conversation.get", "--id", c], new RegExp(`error: ${name}: can't be decrypted with this user's key: it is damaged, or it is another user's file`));
    await writeFile(file, good.subarray(0, 20)); // starts with SSENC1: ours, cut short (QA called this "plaintext")
    await fails(["conversation.get", "--id", c], /cut short, too small to be an encrypted file/);
    assert.match((await ok(["conversation.list"])).stdout, new RegExp(`Unreadable conversation files \\(1\\):\\n  ${c}: damaged: cut short`));
    await writeFile(file, "");
    await fails(["conversation.get", "--id", c], /empty, so it is damaged/);
    await writeFile(file, '{"id":"planted"}');
    await fails(["conversation.get", "--id", c], /not encrypted, but every file of an encrypted user is/);
    await fails(["conversation.update", "--id", c, "--title", "Over"], /not encrypted/);
    assert.equal(await readFile(file, "utf8"), '{"id":"planted"}', "nothing is written over an unreadable file");
    await writeFile(file, good);
    await ok(["conversation.get", "--id", c]);
  });

  test("a damaged image, and an encrypted file in a plaintext user's folder", async () => {
    // An image in the encrypted user's folder: any ciphertext the vault made will do.
    const conv = (await readdir(dir("dev-dmg", "conversations")))[0]!;
    await mkdir(dir("dev-dmg", "images"), { recursive: true });
    await copyFile(join(dir("dev-dmg", "conversations"), conv), join(dir("dev-dmg", "images"), "img_dmg0000001.bin"));
    await flip(join(dir("dev-dmg", "images"), "img_dmg0000001.bin"), 40);
    await fails(["image.get", "--id", "img_dmg0000001", "--out", join(t.tmp, "x.png")], /images\/img_dmg0000001\.bin: can't be decrypted with this user's key/);

    await ok(["auth.login", "--username", "dev-dmg-plain", "--password", ""]);
    const c = (JSON.parse((await ok(["conversation.create", "--title", "Plain", "--system-prompt", "x", "--json"])).stdout) as Conversation).id;
    await copyFile(join(dir("dev-dmg", "conversations"), conv), join(dir("dev-dmg-plain", "conversations"), `${c}.json`));
    await fails(["conversation.get", "--id", c], /encrypted, but this user is unencrypted \(copied in from an encrypted user\?\)/);
  });

  test("a copy of one conversation under another's name is refused, not listed twice or written into (QA-4)", async () => {
    await ok(["auth.login", "--username", "dev-dmg-plain", "--password", ""]);
    const a = (JSON.parse((await ok(["conversation.create", "--title", "A", "--system-prompt", "x", "--json"])).stdout) as Conversation).id;
    const b = (JSON.parse((await ok(["conversation.create", "--title", "B", "--system-prompt", "x", "--json"])).stdout) as Conversation).id;
    await copyFile(join(dir("dev-dmg-plain", "conversations"), `${a}.json`), join(dir("dev-dmg-plain", "conversations"), `${b}.json`));
    const list = JSON.parse((await ok(["conversation.list", "--json"])).stdout) as { conversations: { id: string }[]; unreadable: { id: string; error: string }[] };
    assert.equal(list.conversations.filter((x) => x.id === a).length, 1, "listed once");
    assert.ok(list.unreadable.some((u) => u.id === b && u.error.startsWith(`holds conversation ${a}, not ${b}`)));
    await fails(["conversation.update", "--id", b, "--title", "Renamed"], new RegExp(`holds conversation ${a}, not ${b}`));
    assert.equal(JSON.parse(await readFile(join(dir("dev-dmg-plain", "conversations"), `${a}.json`), "utf8")).title, "A");
  });

  test("a damaged user.json is listed as damaged, refuses login clearly, can still be deleted; inflated KDF settings never run (QA-5)", async () => {
    const userJson = join(t.config.dataDir, "users", "dev-dmg-user", "user.json");
    const good = await readFile(userJson, "utf8");
    const login = ["auth.login", "--username", "dev-dmg-user", "--password", "-"];

    await writeFile(userJson, good.slice(0, 120));
    const listed = JSON.parse((await ok(["user.list", "--json"])).stdout) as { users: { username: string }[]; unreadable: { username: string; error: string }[] };
    assert.ok(!listed.users.some((u) => u.username === "dev-dmg-user"));
    assert.match(listed.unreadable.find((u) => u.username === "dev-dmg-user")!.error, /^damaged: it is not valid JSON\. So dev-dmg-user can't log in/);
    assert.match((await ok(["user.list"])).stdout, /Users whose user\.json is damaged \(1\):\n  dev-dmg-user: damaged: it is not valid JSON/);
    await fails(login, /users\/dev-dmg-user\/user\.json: damaged: it is not valid JSON/, { stdin: "user-pw\n" });

    // QA set N to 2^24: scrypt then asked for 16 GiB and swapped the Mac for minutes. Now it is refused before it runs.
    const inflated = JSON.parse(good);
    inflated.kdf.N = 2 ** 24;
    await writeFile(userJson, JSON.stringify(inflated));
    const t0 = performance.now();
    await fails(login, /key-derivation settings \(N=16777216, r=8, p=1\) are far above this app's/, { stdin: "user-pw\n" });
    assert.ok(performance.now() - t0 < 2000, "refused at once, not after a giant scrypt");
    for (const kdf of [{ ...inflated.kdf, N: 1000 }, { ...inflated.kdf, N: 2 ** 10, r: 0 }, { ...inflated.kdf, N: 2 ** 10, p: 2 ** 20 }, null]) {
      await writeFile(userJson, JSON.stringify({ ...inflated, kdf }));
      await fails(login, /users\/dev-dmg-user\/user\.json: damaged/, { stdin: "user-pw\n" });
    }

    await writeFile(userJson, good);
    await ok(login, { stdin: "user-pw\n" });
    await writeFile(userJson, "{");
    const r = await ok(["user.delete", "--username", "dev-dmg-user", "--confirm", "dev-dmg-user"]);
    assert.match(r.stdout, /Deleted dev-dmg-user \(damaged user\.json\) with 0 conversations and 0 images, for good\. Logged out 1 session\./);
  });

  test("none of it reached the log as an internal error with a stack", () => {
    assert.ok(log.some((l) => /failed: 500 unreadable_file/.test(l)));
    assert.deepEqual(log.filter((l) => l.startsWith("ERROR")), []);
  });
});
