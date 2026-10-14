import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { after, before, describe, test } from "node:test";
import { z } from "zod";
import { authLogin } from "../src/commands/auth.ts";
import { help } from "../src/commands/system.ts";
import { ROOT } from "../src/config.ts";
import { conflict } from "../src/lib/errors.ts";
import { binaryCommand, streamCommand } from "../src/registry.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

describe("CLI end to end against an in-process server and mock Venice", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    t = await startTestServer();
  });
  after(() => t.close());

  test("plaintext user: create, log in, whoami, log out", async () => {
    let r = await t.cli(["user.create", "--username", "dev-a", "--password", ""]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Created dev-a \(unencrypted\)/);

    r = await t.cli(["auth.login", "--username", "dev-a", "--password", ""]);
    assert.equal(r.code, 0, r.stderr);
    const saved = JSON.parse(await readFile(join(t.config.runDir, "cli-session.json"), "utf8"));
    assert.equal(saved.username, "dev-a");
    assert.equal((await stat(join(t.config.runDir, "cli-session.json"))).mode & 0o777, 0o600);

    r = await t.cli(["auth.whoami", "--json"]);
    assert.deepEqual(JSON.parse(r.stdout), { username: "dev-a", encrypted: false });

    r = await t.cli(["auth.logout"]);
    assert.match(r.stdout, /Logged out dev-a/);
    await assert.rejects(stat(join(t.config.runDir, "cli-session.json")), { code: "ENOENT" });
    r = await t.cli(["auth.whoami"]);
    assert.match(r.stdout, /Not logged in/);
  });

  test("encrypted user: hidden prompt with confirmation, wrong password rejected", async () => {
    let r = await t.cli(["user.create", "--username", "dev-b"], { secrets: ["s3cret", "s3cret"] });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Created dev-b \(encrypted\)/);
    const userJson = await readFile(join(t.config.dataDir, "users", "dev-b", "user.json"), "utf8");
    assert.ok(!userJson.includes("s3cret"), "password must never be stored");

    r = await t.cli(["user.create", "--username", "dev-c"], { secrets: ["one", "two"] });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /did not match/);

    r = await t.cli(["auth.login", "--username", "dev-b", "--password", "nope"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Wrong password for dev-b/);

    r = await t.cli(["auth.login", "--username", "dev-b", "--password", "-"], { stdin: "s3cret\n" });
    assert.equal(r.code, 0, r.stderr);
    r = await t.cli(["auth.whoami"]);
    assert.equal(r.stdout.trim(), "dev-b (encrypted)");

    r = await t.cli(["user.list", "--json"]);
    assert.deepEqual(
      JSON.parse(r.stdout).users.map((u: { username: string; encrypted: boolean }) => [u.username, u.encrypted]),
      [["dev-a", false], ["dev-b", true]],
    );
  });

  test("Venice basics through the mock: models.list and venice.balance", async () => {
    let r = await t.cli(["models.list", "--type", "image", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const models = JSON.parse(r.stdout).models;
    assert.ok(models.every((m: { type: string }) => m.type === "image"));
    const z = models.find((m: { id: string }) => m.id === "z-image-turbo");
    assert.equal(z.price, "$0.01/image");
    assert.equal(z.privacy, "private");

    r = await t.cli(["models.list", "--type", "text"]);
    assert.match(r.stdout, /\*deepseek-v4-1-flash .* \$0\.30\/M in, \$1\.20\/M out +none\/low\/high\/max/);

    r = await t.cli(["venice.balance", "--json"]);
    assert.equal(JSON.parse(r.stdout).usd, 10);
  });

  test("bad input gives clear errors and exit codes", async () => {
    let r = await t.cli(["user.create", "--username", "Bad Name", "--password", ""]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Username must be/);
    r = await t.cli(["user.creat"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Did you mean: user\.create/);
    r = await t.cli(["auth.login", "--username", "ghost", "--password", ""]);
    assert.match(r.stderr, /No user named ghost/);
  });

  test("help is generated from the schemas", async () => {
    const r = await t.cli(["help", "user.create"]);
    assert.match(r.stdout, /--password <text> .*prompted \(hidden\) when omitted/);
    const res = await fetch(`${t.url}/api/help`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const names = ((await res.json()) as { commands: { name: string }[] }).commands.map((c) => c.name);
    for (const n of ["help", "health", "user.create", "user.list", "auth.login", "auth.logout", "auth.whoami", "models.list", "venice.balance"]) {
      assert.ok(names.includes(n), n);
    }
  });

  test("the ./ss executable works as a subprocess", async () => {
    const { stdout } = await promisify(execFile)(join(ROOT, "ss"), ["health"], {
      env: { ...process.env, SS_URL: t.url, SS_RUN_DIR: t.config.runDir },
    });
    assert.match(stdout, /^ok · MOCK Venice/);
  });
});

describe("HTTP adapter: streams, binary, sessions and the local-only guard", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  const testCommands = [
    help,
    authLogin,
    streamCommand({
      name: "test.stream",
      description: "Streams words",
      auth: false,
      args: z.object({ text: z.string(), busy: z.boolean().optional() }),
      async *handler(args) {
        if (args.busy) throw conflict("busy");
        yield { type: "start", brainName: "Tester" };
        yield { type: "reasoning", delta: "thinking" };
        for (const w of args.text.split(" ")) yield { type: "delta", delta: `${w} ` };
        yield { type: "done", message: { id: "m_1" } };
      },
    }),
    binaryCommand({
      name: "test.bytes",
      description: "Returns bytes",
      args: z.object({ n: z.string() }),
      handler: async (args) => ({ contentType: "image/png", bytes: new Uint8Array(Number(args.n)).fill(7) }),
    }),
  ];
  before(async () => {
    t = await startTestServer({ commands: testCommands });
  });
  after(() => t.close());

  test("stream: CLI prints deltas live; --json passes NDJSON through", async () => {
    let r = await t.cli(["test.stream", "--text", "hello there world"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "hello there world \n");
    assert.match(r.stderr, /\[Tester\]/);
    assert.match(r.stderr, /thinking/);
    r = await t.cli(["test.stream", "--text", "a b", "--json"]);
    const events = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(events.map((e) => e.type), ["start", "reasoning", "delta", "delta", "done"]);
  });

  test("stream: an error before the first event is a real HTTP status (409)", async () => {
    const res = await fetch(`${t.url}/api/test.stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "x", busy: true }),
    });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: { code: "conflict", message: "busy" } });
  });

  test("binary: login required, browser-style cookie session, GET for <img src>, no-store", async () => {
    let res = await fetch(`${t.url}/api/test.bytes?n=3`);
    assert.equal(res.status, 401);
    await createUser(t.config.dataDir, "dev-web", "");
    res = await fetch(`${t.url}/api/auth.login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "dev-web", password: "" }),
    });
    assert.equal(res.status, 200);
    const cookie = res.headers.getSetCookie()[0] ?? "";
    assert.match(cookie, /^ss_session=[\w-]+;/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.ok(!JSON.stringify(await res.json()).includes(cookie.split(";")[0]!.split("=")[1]!), "token must not be in the body");

    res = await fetch(`${t.url}/api/test.bytes?n=3`, { headers: { cookie: cookie.split(";")[0]! } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), new Uint8Array([7, 7, 7]));

    // GET is only for binary commands (and health): a state-changing command can't be triggered by a link.
    res = await fetch(`${t.url}/api/auth.login?username=dev-web&password=`);
    assert.equal(res.status, 405);
  });

  test("local-only guard: foreign Host and cross-site Origin are refused", async () => {
    const { request } = await import("node:http");
    const status = (headers: Record<string, string>) =>
      new Promise<number>((resolve, reject) => {
        const u = new URL(`${t.url}/api/help`);
        const req = request({ host: u.hostname, port: u.port, path: u.pathname, method: "POST", headers }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", reject);
        req.end("{}");
      });
    assert.equal(await status({ host: "evil.example:4747", "content-type": "application/json" }), 403);
    assert.equal(await status({ host: "localhost:4747", origin: "https://evil.example", "content-type": "application/json" }), 403);
    assert.equal(await status({ host: "localhost:4747", origin: "http://localhost:5173", "content-type": "application/json" }), 200);
  });
});
