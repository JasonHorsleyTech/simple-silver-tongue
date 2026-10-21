import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { Conversation, LedgerMessage } from "../src/conversations/types.ts";
import { USER_DELETED } from "../src/lib/errors.ts";
import { createUser, removeUserFolder, unlockUser } from "../src/storage/users.ts";
import { writeJson } from "../src/storage/vault.ts";
import { startTestServer } from "./helpers.ts";

const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 };

describe("T06: user.delete, user.change-password, and the CLI around them", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    // MOCK_SLOW replies take ~1.5 s and MOCK_IMAGE_SLOW images 600 ms: long enough to try a delete mid-way.
    t = await startTestServer({ mock: { slowDelayMs: 100, imageSlowMs: 600 } });
  });
  after(() => t.close());

  const ok = async (argv: string[], io?: Parameters<typeof t.cli>[1]) => {
    const r = await t.cli(argv, io);
    assert.equal(r.code, 0, `${argv.join(" ")}\n${r.stderr}`);
    return r;
  };
  const json = async <T,>(argv: string[]) => JSON.parse((await ok([...argv, "--json"])).stdout) as T;
  const dirOf = (u: string) => join(t.config.dataDir, "users", u);
  const sessionFile = () => join(t.config.runDir, "cli-session.json");

  test("user.delete asks for the username again; a wrong one deletes nothing", async () => {
    await createUser(t.config.dataDir, "dev-del", "", FAST_KDF);
    let r = await t.cli(["user.delete", "--username", "dev-nobody", "--confirm", "dev-nobody"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /No user named dev-nobody/);
    r = await t.cli(["user.delete", "--username", "dev-del", "--confirm", "dev-de"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Not deleted: the confirmation must be the username, dev-del/);
    r = await t.cli(["user.delete", "--username", "dev-del"], { secrets: ["dev-dle"] }); // the prompt, mistyped
    assert.equal(r.code, 1);
    r = await t.cli(["user.delete", "--username", "dev-del"], { stdin: "" }); // no terminal, no answer: not a yes
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--confirm is required/);
    assert.ok(existsSync(join(dirOf("dev-del"), "user.json")), "still there");
    assert.match((await ok(["help", "user.delete"])).stdout, /--confirm <text> .*asked when omitted/);

    r = await ok(["user.delete", "--username", "dev-del"], { secrets: ["dev-del"] });
    assert.match(r.stdout, /Deleted dev-del \(unencrypted\) with 0 conversations and 0 images, for good/);
    assert.ok(!existsSync(dirOf("dev-del")));
    assert.ok(!(await json<{ users: Array<{ username: string }> }>(["user.list"])).users.some((u) => u.username === "dev-del"));
  });

  test("user.delete waits for running work (409, nothing deleted), then deletes everything; the name is free again", async () => {
    await createUser(t.config.dataDir, "dev-busy", "busy-pw", FAST_KDF);
    await ok(["auth.login", "--username", "dev-busy", "--password", "-"], { stdin: "busy-pw\n" });
    const c = (await json<Conversation>(["conversation.create", "--title", "Busy", "--system-prompt", "You are terse."])).id;
    await ok(["brain.add", "--conversation", c, "--name", "Painter", "--kind", "image", "--system-prompt", "You paint.", "--no-final-reminder.enabled"]);

    // A reply being written, as the browser streams it (T01 QA-2: its last save used to bring the folder back).
    const token = (JSON.parse(readFileSync(sessionFile(), "utf8")) as { token: string }).token;
    const res = await t.app.fetch(
      new Request("http://localhost/api/turn", {
        method: "POST",
        headers: { host: "localhost", "content-type": "application/json", cookie: `sst_session=${token}` },
        body: JSON.stringify({ conversation: c, content: "MOCK_SLOW tell me a long story" }),
      }),
    );
    assert.equal(res.status, 200);
    const reader = res.body!.getReader();
    await reader.read(); // the reply has started
    let r = await t.cli(["user.delete", "--username", "dev-busy", "--confirm", "dev-busy", "--json"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, new RegExp(`Can't delete dev-busy yet: a reply is being written \\(${c}\\).*Nothing was deleted`));
    while (!(await reader.read()).done); // the reply finishes and saves
    assert.equal((await json<Conversation>(["conversation.get", "--id", c])).messages.length, 2, "the reply was saved, under the user");

    // An image being made: a job of its own, with no request left open.
    const added = await json<{ message: LedgerMessage }>(["message.add", "--conversation", c, "--as", "Painter", "--content", "MOCK_IMAGE_SLOW a lighthouse"]);
    r = await t.cli(["user.delete", "--username", "dev-busy", "--confirm", "dev-busy"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, new RegExp(`an image is being made \\(${c}\\), which Venice is already billing`));
    await ok(["image.follow", "--conversation", c, "--message", added.message.id]);

    // Nothing running now. Deleting yourself works too, and logs you out (the CLI drops its saved session).
    r = await ok(["user.delete", "--username", "dev-busy", "--confirm", "dev-busy"]);
    assert.match(r.stdout, /Deleted dev-busy \(encrypted\) with 1 conversation and 1 image, for good\. Logged out 1 session\./);
    assert.ok(!existsSync(dirOf("dev-busy")));
    assert.ok(!existsSync(sessionFile()), "the CLI's session for the deleted user is gone");
    assert.deepEqual((await t.cli(["user.list", "--json"])).stdout.match(/dev-busy|\.deleted-/g), null, "no leftovers, nothing listed");

    // The name is free: a new user with it starts empty, whatever the old one had.
    await ok(["user.create", "--username", "dev-busy", "--password", ""]);
    await ok(["auth.login", "--username", "dev-busy", "--password", ""]);
    assert.deepEqual((await json<{ conversations: unknown[]; unreadable: unknown[] }>(["conversation.list"])), { conversations: [], unreadable: [] });
    await ok(["user.delete", "--username", "dev-busy", "--confirm", "dev-busy"]);
  });

  test("a key still held after its user is deleted can't bring the folder back; a login racing the delete fails", async () => {
    await createUser(t.config.dataDir, "dev-ghost", "pw", FAST_KDF);
    const { vault } = await unlockUser(t.config.dataDir, "dev-ghost", "pw");
    await removeUserFolder(t.config.dataDir, "dev-ghost");
    await assert.rejects(writeJson(vault, "conversations/c_ghost.json", { title: "late save" }), { code: "session_ended", message: USER_DELETED });
    assert.ok(!existsSync(dirOf("dev-ghost")), "no folder without a user.json");

    // scrypt at N = 2^15 takes tens of ms: the folder goes while the key is being derived.
    await createUser(t.config.dataDir, "dev-race", "pw", { N: 2 ** 15, r: 8, p: 1 });
    const login = unlockUser(t.config.dataDir, "dev-race", "pw");
    await new Promise((r) => setTimeout(r, 10));
    await removeUserFolder(t.config.dataDir, "dev-race");
    await assert.rejects(login, { code: "not_found", message: /deleted while you were logging in/ });
  });

  test("user.change-password rewraps the key: files untouched, old password out, logged out everywhere", async () => {
    await createUser(t.config.dataDir, "dev-pw", "old-pw", FAST_KDF);
    await createUser(t.config.dataDir, "dev-pw-plain", "", FAST_KDF);
    await ok(["auth.login", "--username", "dev-pw", "--password", "-"], { stdin: "old-pw\n" });
    const c = (await json<Conversation>(["conversation.create", "--title", "Kept", "--system-prompt", "You are terse."])).id;
    const file = join(dirOf("dev-pw"), "conversations", `${c}.json`);
    const before = readFileSync(file);
    const envelope = JSON.parse(readFileSync(join(dirOf("dev-pw"), "user.json"), "utf8"));

    let r = await t.cli(["user.change-password", "--username", "dev-pw"], { stdin: "wrong\nnew-pw\n" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Wrong password for dev-pw\. Nothing was changed/);
    r = await t.cli(["user.change-password", "--username", "dev-pw", "--password", "-", "--new-password", ""], { stdin: "old-pw\n" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /can't be empty: dev-pw is encrypted and stays encrypted/);
    r = await t.cli(["user.change-password", "--username", "dev-pw", "--password", "-"], { stdin: "old-pw\n" });
    assert.equal(r.code, 2, "stdin went to --password: it can't answer --new-password too");
    assert.match(r.stderr, /--new-password is required, and stdin went to another flag/);
    r = await t.cli(["user.change-password", "--username", "dev-pw-plain"], { stdin: "\nx\n" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /dev-pw-plain is unencrypted, so it has no password to change/);
    assert.equal((await ok(["auth.whoami"])).stdout.split("\n")[0], "dev-pw (encrypted)", "nothing changed so far");

    // Prompted: current (hidden), new (hidden, twice). No warning: nothing was typed on the command line.
    r = await ok(["user.change-password", "--username", "dev-pw"], { secrets: ["old-pw", "new-pw", "new-pw"] });
    assert.match(r.stdout, /Changed the password for dev-pw\. Logged out 1 session\./);
    assert.doesNotMatch(r.stderr, /warning/);
    assert.match((await ok(["auth.whoami"])).stdout, /Not logged in/);
    const after = JSON.parse(readFileSync(join(dirOf("dev-pw"), "user.json"), "utf8"));
    assert.notEqual(after.wrappedKey, envelope.wrappedKey);
    assert.notEqual(after.kdf.salt, envelope.kdf.salt, "a fresh salt");
    assert.equal(after.kdf.N, 2 ** 17, "the new envelope uses today's KDF strength");
    assert.equal(after.createdAt, envelope.createdAt);
    assert.ok(readFileSync(file).equals(before), "no file was re-encrypted");

    r = await t.cli(["auth.login", "--username", "dev-pw", "--password", "-"], { stdin: "old-pw\n" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Wrong password/);
    await ok(["auth.login", "--username", "dev-pw", "--password", "-"], { stdin: "new-pw\n" });
    assert.equal((await json<Conversation>(["conversation.get", "--id", c])).title, "Kept");
    // Scripted: one stdin line per answer.
    await ok(["user.change-password", "--username", "dev-pw"], { stdin: "new-pw\nthird-pw\n" });
    await ok(["auth.login", "--username", "dev-pw", "--password", "-"], { stdin: "third-pw\n" });
  });

  test("a password typed on the command line gets a warning; encrypted logins mention shell history; two terminals, two users", async () => {
    await createUser(t.config.dataDir, "dev-warn", "warn-pw", FAST_KDF);
    let r = await ok(["auth.login", "--username", "dev-warn", "--password", "warn-pw"]);
    assert.match(r.stderr, /warning: --password on the command line is saved in your shell history \(and shows in ps while \.\/sst runs\)/);
    assert.match(r.stdout, /Logged in as dev-warn \(encrypted\)\.\nThe session ends after 60 minutes without activity, and the server wipes its key\.\nNote: text you type on the \.\/sst command line .* shell history as plain text\. For private text, use --content -/);
    r = await ok(["auth.login", "--username", "dev-warn", "--password", "-"], { stdin: "warn-pw\n" });
    assert.doesNotMatch(r.stderr, /warning/);
    await createUser(t.config.dataDir, "dev-warn-plain", "", FAST_KDF);
    const other = { SST_SESSION_FILE: join(t.tmp, "terminal-2.json") };
    r = await ok(["auth.login", "--username", "dev-warn-plain", "--password", ""], { env: other });
    assert.doesNotMatch(r.stderr, /warning/, "an empty password is no secret");
    assert.doesNotMatch(r.stdout, /Note:/, "a plaintext user's data is plain anyway");
    assert.equal((await ok(["auth.whoami"], { env: other })).stdout.split("\n")[0], "dev-warn-plain (unencrypted)");
    assert.equal((await ok(["auth.whoami"])).stdout.split("\n")[0], "dev-warn (encrypted)", "this terminal is still the other user");
  });
});
