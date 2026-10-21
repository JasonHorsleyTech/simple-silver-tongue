import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";
import { after, before, describe, test } from "node:test";
import { z } from "zod";
import { authLogin, authLogout } from "../src/commands/auth.ts";
import { help } from "../src/commands/system.ts";
import { ROOT } from "../src/config.ts";
import { conflict } from "../src/lib/errors.ts";
import { binaryCommand, streamCommand } from "../src/registry.ts";
import { createUser, unlockUser } from "../src/storage/users.ts";
import { readJson, writeJson } from "../src/storage/vault.ts";
import { pickModels } from "../src/venice/model-list.ts";
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
    const who = JSON.parse(r.stdout);
    assert.ok(who.idle.secondsLeft > 3540 && who.idle.secondsLeft <= 3600, "a fresh login has the whole idle limit");
    assert.deepEqual(who, { username: "dev-a", encrypted: false, idle: { minutes: 60, secondsLeft: who.idle.secondsLeft } });

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

    // T01 QA-6: no terminal and no input is not a choice; it must not quietly create an unencrypted user.
    r = await t.cli(["user.create", "--username", "dev-c"], { stdin: "" });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--password is required and there is no terminal/);
    r = await t.cli(["user.list", "--json"]);
    assert.ok(!JSON.parse(r.stdout).users.some((u: { username: string }) => u.username === "dev-c"));

    r = await t.cli(["auth.login", "--username", "dev-b", "--password", "-"], { stdin: "s3cret\n" });
    assert.equal(r.code, 0, r.stderr);
    r = await t.cli(["auth.whoami"]);
    assert.equal(r.stdout.trim(), "dev-b (encrypted)\nThe session ends after 60 minutes without activity (60 minutes left), and the server wipes its key.");

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

    // T19: the pickers' list is the model list's (the tests read models.example.ini), in its order; --all is
    // everything Venice lists.
    const ids = async (...extra: string[]) => JSON.parse((await t.cli(["models.list", "--json", ...extra])).stdout).models.map((m: { id: string }) => m.id);
    assert.deepEqual(await ids(), ["deepseek-v4-1-flash", "google-gemma-4-31b-it", "z-image-turbo", "hunyuan-image-v3"]);
    assert.equal((await ids("--all")).length, 9);
    assert.match((await t.cli(["models.list", "--type", "image"])).stdout, /hunyuan-image-v3 .* aspect ratio\n/, "sized by aspect ratio, not width × height");
    assert.match((await t.cli(["models.list", "--type", "image", "--all"])).stdout, /krea-2-turbo +Krea 2 Turbo +private, uncensored /, "Venice's uncensored label shows");
    const venice = [
      { id: "wai-Illustrious", type: "image" },
      { id: "openai-gpt-55", type: "text" },
      { id: "e2ee-kimi-k3-p", type: "text" },
      { id: "kimi-k3", type: "text" },
      { id: "grok-4-7", type: "text" },
      { id: "z-image-turbo", type: "image" },
      { id: "deepseek-v4-1-flash", type: "text" },
    ];
    const list = { text: ["deepseek-v4-1-flash", "kimi-k3", "not-at-venice"], image: ["z-image-turbo", "wai-Illustrious"] };
    assert.deepEqual(pickModels(venice, list).map((m) => m.id), ["deepseek-v4-1-flash", "kimi-k3", "z-image-turbo", "wai-Illustrious"], "text first, the list's order, the rest left out");

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

  test("the ./sst executable works as a subprocess", async () => {
    const { stdout } = await promisify(execFile)(join(ROOT, "sst"), ["health"], {
      env: { ...process.env, SST_URL: t.url, SST_RUN_DIR: t.config.runDir },
    });
    assert.match(stdout, /^ok · MOCK Venice/);
  });
});

describe("HTTP adapter: streams, binary, sessions and the local-only guard", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  // test.slow-start waits on the test before its first event, like turn waiting on Venice's headers.
  const slowStart = { started: Promise.withResolvers<void>(), gate: Promise.withResolvers<void>(), finished: Promise.withResolvers<number>() };
  const testCommands = [
    help,
    authLogin,
    streamCommand({
      name: "test.slow-start",
      description: "Waits on the test, then streams",
      auth: false,
      args: z.object({}),
      async *handler() {
        slowStart.started.resolve();
        await slowStart.gate.promise;
        let n = 0;
        try {
          for (; n < 20; n++) yield { type: "delta", delta: "x".repeat(100) };
          yield { type: "done", message: null };
        } finally {
          slowStart.finished.resolve(n);
        }
      },
    }),
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
    // Reasoning folds to one line unless --reveal (T08 QA-3).
    assert.doesNotMatch(r.stderr, /thinking/);
    assert.match(r.stderr, /\[Reasoning, folded: --reveal streams it/);
    r = await t.cli(["test.stream", "--text", "hello there world", "--reveal"]);
    assert.equal(r.stdout, "hello there world \n");
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

  test("stream: a client that leaves before the first event doesn't park the work (T02 QA-2)", async () => {
    // Real HTTP, so @hono/node-server's own handling of an already-closed socket is what's under test.
    const req = request(`${t.url}/api/test.slow-start`, { method: "POST", agent: false, headers: { "content-type": "application/json" } });
    req.on("error", () => {});
    req.end("{}");
    await slowStart.started.promise;
    req.destroy(); // Ctrl-C, or a browser reload, while Venice hasn't answered yet
    await new Promise((r) => setTimeout(r, 50)); // let the server see the close
    slowStart.gate.resolve();
    const done = await Promise.race([slowStart.finished.promise, new Promise((r) => setTimeout(() => r("parked"), 2000))]);
    assert.equal(done, 20, "the generator ran to the end, so its finally (lock release, vault close) ran");
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
    assert.match(cookie, /^sst_session=[\w-]+;/);
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

  test("CSRF: POSTs that a page could send without a preflight are refused with 415 (T01 QA-4)", async () => {
    const post = (headers: Record<string, string>) => fetch(`${t.url}/api/help`, { method: "POST", headers, body: "{}" });
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const res = await post({ origin: "http://localhost:3000", "content-type": type });
      assert.equal(res.status, 415, type);
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, "unsupported_media_type");
    }
    assert.equal((await fetch(`${t.url}/api/help`, { method: "POST" })).status, 415); // no content type at all
    assert.equal((await post({ "content-type": "application/json; charset=utf-8" })).status, 200);
  });
});

describe("sessions: logging out or in mid-request never pulls the key out from under running work (T01 QA-2)", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  let open: () => void = () => {};
  let gate: Promise<void> = Promise.resolve();
  const slowSave = streamCommand({
    name: "test.slow-save",
    description: "Starts, waits for the test to let it go, then saves through the vault (like T02's turn)",
    args: z.object({ file: z.string() }),
    async *handler(args, ctx) {
      const { vault } = ctx.requireSession();
      yield { type: "start" };
      await gate;
      await writeJson(vault, `conversations/${args.file}`, { title: "SECRET-TAVERN" });
      yield { type: "done", message: null };
    },
  });
  before(async () => {
    t = await startTestServer({ commands: [authLogin, authLogout, slowSave] });
    await createUser(t.config.dataDir, "dev-lease", "pw", { N: 2 ** 10, r: 8, p: 1 });
  });
  after(() => t.close());

  const post = (cmd: string, body: unknown, cookie = "") =>
    t.app.fetch(
      new Request(`http://localhost/api/${cmd}`, {
        method: "POST",
        headers: { host: "localhost", "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
    );
  const login = async () =>
    (await post("auth.login", { username: "dev-lease", password: "pw" })).headers.getSetCookie()[0]!.split(";")[0]!;

  for (const [what, interrupt] of [
    ["logout", (cookie: string) => post("auth.logout", {}, cookie)],
    ["logging in again", (cookie: string) => post("auth.login", { username: "dev-lease", password: "pw" }, cookie)],
  ] as const) {
    test(`${what} mid-stream: the work finishes and saves under the real key`, async () => {
      const cookie = await login();
      gate = new Promise((r) => (open = r));
      const file = `c_${what.replace(/\W/g, "")}.json`;
      const res = await post("test.slow-save", { file }, cookie);
      assert.equal((await interrupt(cookie)).status, 200);
      assert.equal((await post("test.slow-save", { file: "x.json" }, cookie)).status, 401, "the old token is dead");
      open();
      const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
      assert.deepEqual(events.map((e) => e.type), ["start", "done"]);
      const { vault } = await unlockUser(t.config.dataDir, "dev-lease", "pw");
      assert.deepEqual(await readJson(vault, `conversations/${file}`), { title: "SECRET-TAVERN" });
    });
  }
});

describe("T07 frontend: a browser tab's polls stay out of the log", () => {
  test("a successful auth.whoami or health isn't logged; a failed one and every other request are", async () => {
    const log: string[] = [];
    const t = await startTestServer({ log: (l) => void log.push(l) });
    try {
      const post = (name: string, headers: Record<string, string> = { "content-type": "application/json" }) =>
        fetch(`${t.url}/api/${name}`, { method: "POST", headers, body: "{}" }).then((r) => r.status);
      assert.equal(await post("health"), 200);
      assert.equal(await post("auth.whoami"), 200);
      assert.equal(await post("help"), 200);
      assert.equal(await post("auth.whoami", { "content-type": "text/plain" }), 415);
      const lines = log.filter((l) => l.includes("/api/"));
      assert.ok(!lines.some((l) => / \/api\/(health|auth\.whoami) 200 /.test(l)), lines.join("\n"));
      assert.ok(lines.some((l) => / \/api\/help 200 /.test(l)), lines.join("\n"));
      assert.ok(lines.some((l) => / \/api\/auth\.whoami 415 /.test(l)), lines.join("\n"));
    } finally {
      await t.close();
    }
  });
});
