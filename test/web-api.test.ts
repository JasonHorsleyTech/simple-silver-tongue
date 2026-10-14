import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { z } from "zod";
import { commands as allCommands } from "../src/commands/index.ts";
import { conflict } from "../src/lib/errors.ts";
import { command, streamCommand } from "../src/registry.ts";
import { createClient } from "../web/src/api/client.ts";
import { ApiError, errorMessage } from "../web/src/api/errors.ts";
import { readNdjson } from "../web/src/api/ndjson.ts";
import { STOP_BILL_NOTE as SERVER_STOP_NOTE } from "../src/commands/chat.ts";
import { STOP_BILL_NOTE, type Commands, type NoArgs, type StreamCommands, type StreamYield } from "../web/src/api/types.ts";
import { startTestServer } from "./helpers.ts";

// The web app's API client is plain TS with no DOM dependency, so it runs here against the real server.

function bodyOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(typeof ch === "string" ? enc.encode(ch) : ch);
      c.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const v of readNdjson(body)) out.push(v);
  return out;
}

describe("web NDJSON reader", () => {
  test("lines split anywhere, even inside a multi-byte character; blank lines skipped; no final newline", async () => {
    const bytes = new TextEncoder().encode('{"type":"delta","delta":"café ☕"}\n');
    const cut = bytes.indexOf(0xc3) + 1; // between the two bytes of "é"
    const events = await collect(
      bodyOf(['{"type":"st', 'art"}\n\n', bytes.slice(0, cut), bytes.slice(cut), '{"type":"done","message":{"id":"m_1"}}']),
    );
    assert.deepEqual(events, [
      { type: "start" },
      { type: "delta", delta: "café ☕" },
      { type: "done", message: { id: "m_1" } },
    ]);
  });

  test("a line that isn't JSON is a bad_stream ApiError", async () => {
    await assert.rejects(collect(bodyOf(['{"type":"start"}\n', "oops\n"])), (e: unknown) => e instanceof ApiError && e.code === "bad_stream");
  });
});

/** A fetch that keeps the session cookie the way a browser would. */
function cookieJar() {
  let cookie: string | null = null;
  const jarFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set("cookie", cookie);
    const res = await fetch(input, { ...init, headers });
    const set = res.headers.getSetCookie().find((c) => c.startsWith("ss_session="));
    if (set) {
      const pair = set.split(";")[0]!;
      cookie = pair === "ss_session=" ? null : pair;
    }
    return res;
  }) as typeof fetch;
  return { fetch: jarFetch, cookie: () => cookie };
}

type TestCommands = Commands & { "test.private": { args: NoArgs; result: { ok: boolean } } };
type TestStreams = StreamCommands & { "test.stream": { args: { mode: "ok" | "busy" | "mid_error" | "no_done" } } };

describe("web API client against the real server", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    t = await startTestServer({
      commands: [
        ...allCommands,
        command({ name: "test.private", description: "Needs a login", args: z.object({}), handler: () => ({ ok: true }) }),
        streamCommand({
          name: "test.stream",
          description: "Streams a few events",
          auth: false,
          args: z.object({ mode: z.enum(["ok", "busy", "mid_error", "no_done"]) }),
          async *handler(args) {
            if (args.mode === "busy") throw conflict("This conversation is busy.");
            yield { type: "start", brainName: "Tester" };
            yield { type: "delta", delta: "hello " };
            if (args.mode === "mid_error") throw conflict("Venice went away.");
            yield { type: "delta", delta: "world" };
            if (args.mode === "ok") yield { type: "done", message: { id: "m_1" } };
          },
        }),
      ],
    });
    assert.equal((await t.cli(["user.create", "--username", "web-plain", "--password", ""])).code, 0);
    assert.equal((await t.cli(["user.create", "--username", "web-enc", "--password", "pw-1"])).code, 0);
  });
  after(() => t.close());

  const client = (jar = cookieJar()) => createClient<TestCommands, TestStreams>({ baseUrl: t.url, fetch: jar.fetch });

  test("login, whoami and logout ride the cookie; empty password works for an unencrypted user", async () => {
    const api = client();
    assert.deepEqual(await api.call("auth.whoami"), { username: null });
    assert.deepEqual(await api.call("auth.login", { username: "web-plain", password: "" }), { username: "web-plain", encrypted: false });
    assert.deepEqual(await api.call("auth.whoami"), { username: "web-plain", encrypted: false });
    assert.deepEqual(await api.call("auth.login", { username: "web-enc", password: "pw-1" }), { username: "web-enc", encrypted: true });
    assert.deepEqual(await api.call("test.private"), { ok: true });
    assert.deepEqual(await api.call("auth.logout"), { loggedOut: "web-enc" });
    assert.deepEqual(await api.call("auth.whoami"), { username: null });
  });

  test("errors arrive as ApiError with the server's status, code and message", async () => {
    const api = client();
    await assert.rejects(api.call("auth.login", { username: "web-enc", password: "nope" }), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.status, 401);
      assert.equal(e.code, "wrong_password");
      assert.equal(e.message, "Wrong password for web-enc.");
      return true;
    });
    // bad_args: errorMessage shows the field rule, not the CLI-style line
    const bad = await api.call("auth.login", { username: "Not Valid", password: "" }).catch((e: unknown) => e);
    assert.ok(bad instanceof ApiError && bad.code === "bad_args");
    assert.match(errorMessage(bad), /^Username must be 1-32 characters/);
  });

  test("the session-lost signal fires for a dead cookie and for unauthenticated, but not for a failed login", async () => {
    const jar = cookieJar();
    const api = client(jar);
    let lost = 0;
    api.onSessionLost(() => lost++);
    await api.call("auth.login", { username: "web-plain", password: "" });
    await assert.rejects(api.call("auth.login", { username: "web-enc", password: "nope" }));
    assert.equal(lost, 0, "a wrong password is not a lost session");
    assert.deepEqual(await api.call("auth.whoami"), { username: "web-plain", encrypted: false });

    // Kill the session behind the client's back, as a server restart does: its cookie is now unknown.
    await fetch(`${t.url}/api/auth.logout`, { method: "POST", headers: { "content-type": "application/json", cookie: jar.cookie()! } });
    assert.deepEqual(await api.call("auth.whoami"), { username: null });
    assert.equal(lost, 1, "x-ss-session: invalid");

    const anon = client();
    let lostAnon = 0;
    anon.onSessionLost(() => lostAnon++);
    await assert.rejects(anon.call("test.private"), (e: unknown) => e instanceof ApiError && e.status === 401 && e.code === "unauthenticated");
    assert.equal(lostAnon, 1, "401 unauthenticated");
  });

  test("stream: events arrive in order and end with done", async () => {
    const types: string[] = [];
    let text = "";
    for await (const ev of client().stream("test.stream", { mode: "ok" })) {
      types.push(ev.type);
      if (ev.type === "delta") text += ev.delta;
    }
    assert.deepEqual(types, ["start", "delta", "delta", "done"]);
    assert.equal(text, "hello world");
  });

  test("stream: an early failure is an HTTP error; a mid-stream error event or a missing done throws", async () => {
    const api = client();
    await assert.rejects(drain(api.stream("test.stream", { mode: "busy" })), (e: unknown) => e instanceof ApiError && e.status === 409 && e.code === "conflict");

    const seen: string[] = [];
    await assert.rejects(drain(api.stream("test.stream", { mode: "mid_error" }), seen), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, "conflict");
      assert.equal(e.message, "Venice went away.");
      return true;
    });
    assert.deepEqual(seen, ["start", "delta"], "events before the error still reach the caller");

    await assert.rejects(drain(api.stream("test.stream", { mode: "no_done" })), (e: unknown) => e instanceof ApiError && e.code === "stream_broken");
  });

  test("T03: the web client's regenerate, version, edit, delete and stop shapes are what the server accepts", async () => {
    const api = client();
    await api.call("auth.login", { username: "web-plain", password: "" });
    const conv = await api.call("conversation.create", { title: "T03 web", systemPrompt: "You answer in one word." });
    const turn = await collectStream(api.stream("turn", { conversation: conv.id, content: "What color is a lime?" }));
    const reply = turn.at(-1)!;
    assert.ok(reply.type === "done" && reply.message);
    const id = reply.message.id;

    // The steered request, previewed exactly as the steer box's Payload button asks for it.
    const preview = await api.call("prompt.preview", { conversation: conv.id, regenerate: true, message: id, steer: "Say it's blue." });
    assert.deepEqual(preview.regenerate, { messageId: id, newVersion: 2, steer: "Say it's blue.", steeredFrom: 0 });

    // A regenerate's start event says so, with its steer, and done carries the whole message.
    const regen = await collectStream(api.stream("message.regenerate", { conversation: conv.id, message: id, steer: "Say it's blue." }));
    const start = regen.find((e) => e.type === "start");
    assert.ok(start?.type === "start" && start.regenerate === true && start.steer === "Say it's blue." && start.messageId === id);
    const done = regen.at(-1)!;
    assert.ok(done.type === "done" && done.message);
    assert.equal(done.message.versions.length, 2);
    assert.equal(done.message.activeVersion, 1);
    assert.equal(done.message.versions[1]!.steer, "Say it's blue.");
    // done carries the running total, so the header needn't re-read the conversation.
    assert.ok(done.spentUsd! > 0);
    assert.equal(done.spentUsd, (await api.call("conversation.get", { id: conv.id })).spentUsd);

    // The pager's 1-based version; edit and delete.
    const back = await api.call("message.select-version", { conversation: conv.id, message: id, version: 1 });
    assert.equal(back.message.activeVersion, 0);
    const edited = await api.call("message.edit", { conversation: conv.id, message: id, content: "**Green.**" });
    assert.equal(edited.message.versions[0]!.content, "**Green.**");
    assert.equal(edited.message.versions[0]!.edited, true);
    assert.deepEqual(await api.call("generation.stop", { conversation: conv.id }), { stopped: false, message: null });
    const gone = await api.call("message.delete", { conversation: conv.id, message: id });
    assert.equal(gone.messageCount, 1);
    assert.equal(STOP_BILL_NOTE, SERVER_STOP_NOTE, "the browser shows the server's own sentence");
  });

  test("an unreachable server is a network ApiError", async () => {
    const api = createClient({ baseUrl: "http://127.0.0.1:9" });
    await assert.rejects(api.call("health"), (e: unknown) => e instanceof ApiError && e.code === "network" && e.status === 0);
  });
});

async function collectStream(it: AsyncIterable<StreamYield>): Promise<StreamYield[]> {
  const out: StreamYield[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

async function drain(it: AsyncIterable<{ type: string }>, seen: string[] = []) {
  for await (const ev of it) seen.push(ev.type);
}
