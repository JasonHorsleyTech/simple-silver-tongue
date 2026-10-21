import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { z } from "zod";
import { commands as allCommands } from "../src/commands/index.ts";
import { idleMinutes } from "../src/config.ts";
import { streamCommand } from "../src/registry.ts";
import { createUser, unlockUser } from "../src/storage/users.ts";
import { readJson, writeJson, type Vault } from "../src/storage/vault.ts";
import { createClient, type SessionLoss } from "../web/src/api/client.ts";
import { startTestServer } from "./helpers.ts";

const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 };
const MIN = 60_000;

describe("T06 triage: an idle session ends and its key is wiped (QA-1)", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  let clock = Date.parse("2026-10-14T12:00:00Z");
  let open: () => void = () => {};
  let gate: Promise<void> = Promise.resolve();
  // Like a turn: holds the request's own key copy across a pause, then saves.
  const slowSave = streamCommand({
    name: "test.slow-save",
    description: "Starts, waits for the test, then saves through the vault",
    args: z.object({ file: z.string() }),
    async *handler(args, ctx) {
      const { vault } = ctx.requireSession();
      yield { type: "start" };
      await gate;
      await writeJson(vault, `conversations/${args.file}`, { title: "SAVED-AFTER-EXPIRY" });
      yield { type: "done", message: null };
    },
  });
  before(async () => {
    t = await startTestServer({ commands: [...allCommands, slowSave], sessions: { idleMinutes: 60, now: () => clock } });
    await createUser(t.config.dataDir, "dev-idle", "idle-pw", FAST_KDF);
  });
  after(() => t.close());

  const later = (minutes: number) => void (clock += minutes * MIN);
  const sessionFile = () => join(t.config.runDir, "cli-session.json");
  const login = async () => {
    const r = await t.cli(["auth.login", "--username", "dev-idle", "--password", "-"], { stdin: "idle-pw\n" });
    assert.equal(r.code, 0, r.stderr);
    return r;
  };
  const savedToken = () => (JSON.parse(readFileSync(sessionFile(), "utf8")) as { token: string }).token;
  const master = (): Vault => t.sessions.get(savedToken())!.vault;

  test("activity keeps it alive; 60 idle minutes end it, wipe its key, and the CLI says why", async () => {
    const r = await login();
    assert.match(r.stdout, /The session ends after 60 minutes without activity, and the server wipes its key\./);
    const vault = master();
    later(50);
    assert.equal((await t.cli(["conversation.list"])).code, 0, "50 minutes in: still logged in");
    later(50);
    assert.equal((await t.cli(["conversation.list"])).code, 0, "100 minutes after login, 50 after the last use");

    // Asking who you are isn't activity: it can't keep a session alive.
    later(59);
    assert.match((await t.cli(["auth.whoami"])).stdout, /dev-idle \(encrypted\)\nThe session ends after 60 minutes without activity \(1 minute left\)/);
    later(1);
    const gone = await t.cli(["conversation.list"]);
    assert.equal(gone.code, 1);
    assert.match(gone.stderr, /error: Your session expired: nothing used it for 60 minutes, so the server logged it out and wiped its key from memory\.\nLog in again: \.\/sst auth\.login --username dev-idle/);
    assert.ok(vault.closed && vault.key!.every((b) => b === 0), "the key is zeroed");
    assert.ok(!existsSync(sessionFile()), "the CLI dropped its dead token");
  });

  test("with no request at all, the sweep wipes the key; the next request hears 'expired', not 'restarted'", async () => {
    await login();
    const vault = master();
    later(61);
    assert.equal(t.sessions.sweep(), 1);
    assert.ok(vault.closed && vault.key!.every((b) => b === 0));
    const r = await t.cli(["auth.whoami"]);
    assert.match(r.stderr, /\(Saved CLI session for dev-idle expired: nothing used it for the idle limit, so the server logged it out and wiped its key from memory\.\)/);
    assert.equal(r.stdout.trim(), "Not logged in.");
  });

  test("work already running when the session expires finishes and saves under the real key", async () => {
    await login();
    const token = savedToken();
    gate = new Promise((r) => (open = r));
    const res = await t.app.fetch(
      new Request("http://localhost/api/test.slow-save", {
        method: "POST",
        headers: { host: "localhost", "content-type": "application/json", cookie: `sst_session=${token}` },
        body: JSON.stringify({ file: "c_expiry01.json" }),
      }),
    );
    later(61);
    t.sessions.sweep();
    open();
    assert.deepEqual((await res.text()).trim().split("\n").map((l) => JSON.parse(l).type), ["start", "done"]);
    const { vault } = await unlockUser(t.config.dataDir, "dev-idle", "idle-pw");
    assert.deepEqual(await readJson(vault, "conversations/c_expiry01.json"), { title: "SAVED-AFTER-EXPIRY" });
  });

  test("the browser's client hears 'expired' (header and 401), and whoami tells it when to look again", async () => {
    let cookie: string | null = null;
    const jarFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (cookie) headers.set("cookie", cookie);
      const res = await fetch(input, { ...init, headers });
      const set = res.headers.getSetCookie().find((c) => c.startsWith("sst_session="));
      if (set) cookie = set.split(";")[0]!;
      return res;
    }) as typeof fetch;
    const api = createClient({ baseUrl: t.url, fetch: jarFetch });
    const lost: SessionLoss[] = [];
    api.onSessionLost((why) => lost.push(why));

    const me = await api.call("auth.login", { username: "dev-idle", password: "idle-pw" });
    assert.deepEqual(me.idle, { minutes: 60, secondsLeft: 3600 });
    later(20);
    await api.call("conversation.list");
    later(10);
    const who = await api.call("auth.whoami");
    assert.equal(who.username !== null && who.idle?.secondsLeft, 50 * 60, "counted from the last use, not from login");
    later(50);
    await assert.rejects(api.call("conversation.list"), { code: "session_expired" });
    assert.deepEqual(lost, ["expired"], "one signal per response: the header's reason (the 401 says the same)");
    assert.deepEqual(await api.call("auth.whoami"), { username: null });
  });

  test("auth.logout --all ends this user's other sessions too (another terminal, a browser tab)", async () => {
    await login();
    const other = { SST_SESSION_FILE: join(t.tmp, "terminal-2.json") };
    assert.equal((await t.cli(["auth.login", "--username", "dev-idle", "--password", "-"], { stdin: "idle-pw\n", env: other })).code, 0);
    const r = await t.cli(["auth.logout", "--all"]);
    assert.equal(r.stdout.trim(), "Logged out dev-idle everywhere (2 sessions).");
    assert.equal((await t.cli(["conversation.list"], { env: other })).code, 1, "the other terminal is out too");
  });

  test("T06 frontend: a tab or terminal left logged in hears why it was ended: everywhere, password, deleted", async () => {
    const browser = () => {
      let cookie: string | null = null;
      const jarFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
        const headers = new Headers(init.headers);
        if (cookie) headers.set("cookie", cookie);
        const res = await fetch(input, { ...init, headers });
        const set = res.headers.getSetCookie().find((c) => c.startsWith("sst_session="));
        if (set) cookie = set.split(";")[0]!;
        return res;
      }) as typeof fetch;
      const api = createClient({ baseUrl: t.url, fetch: jarFetch });
      const lost: SessionLoss[] = [];
      api.onSessionLost((why) => lost.push(why));
      return { api, lost };
    };
    const termB = { SST_SESSION_FILE: join(t.tmp, "terminal-b.json") };
    const termC = { SST_SESSION_FILE: join(t.tmp, "terminal-c.json") };
    const loginAs = (env: Record<string, string>, user = "dev-idle", pw = "idle-pw") => t.cli(["auth.login", "--username", user, "--password", "-"], { stdin: `${pw}\n`, env });

    // Log out everywhere, from the terminal: the tab's next look and the other terminals say so.
    const tab = browser();
    await tab.api.call("auth.login", { username: "dev-idle", password: "idle-pw" });
    await loginAs(termB);
    await loginAs(termC);
    await login();
    assert.equal((await t.cli(["auth.logout", "--all"])).stdout.trim(), "Logged out dev-idle everywhere (4 sessions).");
    assert.deepEqual(await tab.api.call("auth.whoami"), { username: null });
    assert.deepEqual(tab.lost, ["logged-out"]);
    const listB = await t.cli(["conversation.list"], { env: termB });
    assert.equal(listB.code, 1);
    assert.match(listB.stderr, /error: dev-idle was logged out everywhere \(Log out everywhere in the browser, or auth\.logout --all\)\.\nLog in again: \.\/sst auth\.login --username dev-idle/);
    const whoC = await t.cli(["auth.whoami"], { env: termC });
    assert.match(whoC.stderr, /\(Saved CLI session for dev-idle ended: this user was logged out everywhere/);
    assert.equal(existsSync(termC.SST_SESSION_FILE), false, "the stale token is dropped");

    // A password change (from the browser this time) ends the other sessions with its own reason.
    await tab.api.call("auth.login", { username: "dev-idle", password: "idle-pw" });
    await loginAs(termB);
    const other = browser();
    await other.api.call("auth.login", { username: "dev-idle", password: "idle-pw" });
    assert.deepEqual(await tab.api.call("user.change-password", { username: "dev-idle", password: "idle-pw", newPassword: "idle-pw-2" }), { username: "dev-idle", loggedOut: 3 });
    assert.deepEqual(await tab.api.call("auth.whoami"), { username: null }, "the tab that changed it is logged out too, its cookie cleared");
    assert.deepEqual(tab.lost, ["logged-out"], "...without a stale-cookie signal: it knows why");
    await assert.rejects(other.api.call("conversation.list"), { code: "session_ended", message: /The password for dev-idle was changed, which logs it out everywhere/ });
    assert.deepEqual(other.lost, ["password-changed"]);
    assert.match((await t.cli(["conversation.list"], { env: termB })).stderr, /The password for dev-idle was changed/);
    await t.cli(["user.change-password", "--username", "dev-idle", "--password", "-", "--new-password", "idle-pw"], { stdin: "idle-pw-2\n" });

    // Deleted: no "log in again".
    await createUser(t.config.dataDir, "dev-gone", "gone-pw", FAST_KDF);
    const gone = browser();
    await gone.api.call("auth.login", { username: "dev-gone", password: "gone-pw" });
    await loginAs(termB, "dev-gone", "gone-pw");
    assert.equal((await t.cli(["user.delete", "--username", "dev-gone", "--confirm", "dev-gone"])).code, 0);
    await assert.rejects(gone.api.call("conversation.list"), { code: "session_ended", message: /This user was deleted/ });
    assert.deepEqual(gone.lost, ["deleted"]);
    const listGone = await t.cli(["conversation.list"], { env: termB });
    assert.match(listGone.stderr, /error: This user was deleted/);
    assert.doesNotMatch(listGone.stderr, /Log in again/);
  });
});

describe("T06 triage: SST_SESSION_IDLE_MINUTES", () => {
  test("parses minutes; 0 means never; anything else is the 60-minute default", () => {
    assert.equal(idleMinutes(undefined), 60);
    assert.equal(idleMinutes(""), 60);
    assert.equal(idleMinutes("90"), 90);
    assert.equal(idleMinutes("0.5"), 0.5);
    assert.equal(idleMinutes("0"), 0);
    assert.equal(idleMinutes("-5"), 60);
    assert.equal(idleMinutes("an hour"), 60);
  });

  test("0: a session never times out, and whoami says so", async () => {
    let clock = 0;
    const t = await startTestServer({ sessions: { idleMinutes: 0, now: () => clock } });
    try {
      await createUser(t.config.dataDir, "dev-never", "", FAST_KDF);
      assert.equal((await t.cli(["auth.login", "--username", "dev-never", "--password", ""])).code, 0);
      clock += 30 * 24 * 60 * MIN;
      assert.equal(t.sessions.sweep(), 0);
      const who = JSON.parse((await t.cli(["auth.whoami", "--json"])).stdout);
      assert.deepEqual(who, { username: "dev-never", encrypted: false, idle: null });
      assert.equal((await t.cli(["conversation.list"])).code, 0);
    } finally {
      await t.close();
    }
  });
});
