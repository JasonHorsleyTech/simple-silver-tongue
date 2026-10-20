import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { z } from "zod";
import { commands as allCommands } from "../src/commands/index.ts";
import { conflict } from "../src/lib/errors.ts";
import { command, streamCommand } from "../src/registry.ts";
import { createClient } from "../web/src/api/client.ts";
import { ApiError, diagnosticsOf, errorMessage, retryOf } from "../web/src/api/errors.ts";
import { readNdjson } from "../web/src/api/ndjson.ts";
import { forBrowser } from "../web/src/lib/format.ts";
import { brainActivity, fitRow, madeFromIndex, makerOf, pinsByMessage } from "../web/src/lib/cast.ts";
import { brainInitials } from "../web/src/lib/initials.ts";
import { freshTakeTarget, mergedThought, prefillThought, thoughtBesideImage } from "../web/src/lib/thought.ts";
import { newBrain, newConversation, newMuse } from "../src/conversations/defaults.ts";
import { newMessage, planMuseNote } from "../src/conversations/turn.ts";
import { rollLineIndex, rollView } from "../web/src/lib/rolls.ts";
import { STOP_BILL_NOTE as SERVER_STOP_NOTE } from "../src/commands/chat.ts";
import { BRAIN_COLORS as SERVER_COLORS, DEFAULT_TEMPLATES } from "../src/conversations/defaults.ts";
import { REASONING_NOTE as SERVER_REASONING_NOTE } from "../src/conversations/prompt.ts";
import { IMAGE_STOP_NOTE as SERVER_IMAGE_STOP_NOTE } from "../src/conversations/wording.ts";
import type { Brain, Conversation, LedgerMessage } from "../src/conversations/types.ts";
import {
  BRAIN_COLORS,
  formatDiagnostics,
  freeMadeName,
  IMAGE_STOP_NOTE,
  isPatternName,
  REASONING_NOTE,
  ROLL_PREVIEW_NOTE,
  STOP_BILL_NOTE,
  type Commands,
  type NoArgs,
  type StreamCommands,
  type StreamYield,
} from "../web/src/api/types.ts";
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

/** A login or whoami answer with secondsLeft rounded to the minute, so a slow run can't flake on a second. */
const roughly = <T,>(w: T): T => {
  const idle = (w as { idle?: { secondsLeft: number | null } | null }).idle;
  return idle?.secondsLeft ? { ...w, idle: { ...idle, secondsLeft: Math.round(idle.secondsLeft / 60) * 60 } } : w;
};

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
    assert.deepEqual(roughly(await api.call("auth.login", { username: "web-plain", password: "" })), { username: "web-plain", encrypted: false, idle: { minutes: 60, secondsLeft: 3600 } });
    assert.deepEqual(roughly(await api.call("auth.whoami")), { username: "web-plain", encrypted: false, idle: { minutes: 60, secondsLeft: 3600 } });
    assert.deepEqual(roughly(await api.call("auth.login", { username: "web-enc", password: "pw-1" })), { username: "web-enc", encrypted: true, idle: { minutes: 60, secondsLeft: 3600 } });
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
    assert.deepEqual(roughly(await api.call("auth.whoami")), { username: "web-plain", encrypted: false, idle: { minutes: 60, secondsLeft: 3600 } });

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

  test("T04: the web client's brain, setup, message.add, per-brain turn and retry shapes are what the server accepts", async () => {
    const api = client();
    await api.call("auth.login", { username: "web-plain", password: "" });
    const conv = await api.call("conversation.create", { title: "T04 web", systemPrompt: "You are the GM." });
    const gm = await api.call("brain.update", { conversation: conv.id, brain: conv.defaultBrainId, name: "Game Master" });

    // Setup messages: every command answers with the whole ordered list.
    const added = await api.call("setup.add", { conversation: conv.id });
    assert.equal(added.setup[0]!.content, "<!-- This is the World Bible. -->");
    const rules = await api.call("setup.add", { conversation: conv.id, label: "House rules" });
    const moved = await api.call("setup.move", { conversation: conv.id, setup: rules.changed!, position: 1 });
    assert.deepEqual(moved.setup.map((x) => x.label), ["House rules", "World Bible"]);
    const updated = await api.call("setup.update", { conversation: conv.id, setup: added.changed!, content: "The Gilded Goat." });
    assert.equal(updated.setup[1]!.content, "The Gilded Goat.");
    assert.deepEqual((await api.call("setup.delete", { conversation: conv.id, setup: rules.changed! })).setup.map((x) => x.label), ["World Bible"]);

    // Brains: a new one gets an unused palette color and its reminder on; an image brain takes tool text and safe mode.
    const dice = await api.call("brain.add", { conversation: conv.id, name: "Dice Master", systemPrompt: "You roll dice." });
    assert.equal(dice.color, BRAIN_COLORS[1]);
    assert.equal(dice.finalReminder.enabled, true);
    const painter = await api.call("brain.add", { conversation: conv.id, name: "Scene Painter", systemPrompt: "You paint.", kind: "image" });
    const painted = await api.call("brain.update", { conversation: conv.id, brain: painter.id, safeMode: false, tool: { description: "Paint it." } });
    assert.equal(painted.safeMode, false);
    assert.equal(painted.tool!.description, "Paint it.");

    // Words in the GM's mouth, then an empty turn to another brain: it just responds.
    const opener = await api.call("message.add", { conversation: conv.id, as: gm.id, content: "Rain hammers the shutters." });
    assert.deepEqual(opener.message.author, { type: "brain", brainId: gm.id });
    assert.equal(opener.message.versions[0]!.source, "authored");
    const events = await collectStream(api.stream("turn", { conversation: conv.id, brain: dice.id }));
    const start = events.find((e) => e.type === "start");
    assert.ok(start?.type === "start" && start.brainId === dice.id && start.brainName === "Dice Master");
    const preview = await api.call("prompt.preview", { conversation: conv.id, brain: dice.id });
    assert.equal(preview.body.messages[2]!.content, "<!-- from: Game Master -->\nRain hammers the shutters.");

    // Default and delete: the Dice Master has spoken, so it stays; the unused painter can go once it isn't the default.
    assert.equal((await api.call("brain.set-default", { conversation: conv.id, brain: painter.id })).id, painter.id);
    await api.call("brain.set-default", { conversation: conv.id, brain: gm.id });
    await assert.rejects(api.call("brain.delete", { conversation: conv.id, brain: dice.id }), (e: unknown) => e instanceof ApiError && e.code === "brain_in_use");
    assert.deepEqual((await api.call("brain.delete", { conversation: conv.id, brain: painter.id })).brains, ["Game Master", "Dice Master"]);

    // A broken reply names its own retry: the same brain, never the default one by accident (T04 QA-1).
    await api.call("brain.update", { conversation: conv.id, brain: dice.id, finalReminder: { enabled: false } });
    const broken = await collectStream(api.stream("turn", { conversation: conv.id, brain: dice.id, content: "MOCK_MIDSTREAM_ERROR roll" })).catch((e: unknown) => e);
    assert.deepEqual(retryOf(broken), { command: "turn", args: { conversation: conv.id, brain: dice.id } });
    assert.equal(retryOf(new ApiError(409, "conflict", "busy")), null);
    // 2026-10-20: and its diagnostics, for the failed reply's Details: the same block the CLI prints.
    const diag = diagnosticsOf(broken);
    assert.equal(diag?.stage, "stream");
    assert.equal(diag?.brain, "Dice Master");
    assert.match(formatDiagnostics(diag!), /Received before it broke: \d+ chunks/);
    assert.equal(diagnosticsOf(new ApiError(409, "conflict", "busy")), null);
    // Refused up front (no stream yet): an HTTP error whose details carry them too.
    const refused = await collectStream(api.stream("turn", { conversation: conv.id, brain: dice.id, content: "MOCK_ERROR roll" })).catch((e: unknown) => e);
    assert.ok(refused instanceof ApiError && refused.status === 502);
    assert.equal(diagnosticsOf(refused)?.venice.status, 500);

    assert.equal(REASONING_NOTE, SERVER_REASONING_NOTE, "the brain editor shows the server's own sentence");
    assert.deepEqual(BRAIN_COLORS, SERVER_COLORS, "the color picker offers the server's palette");
  });

  test("T09: the web client's roll-and-send, message.roll, roll preview and roll template are what the server accepts", async () => {
    const api = client();
    await api.call("auth.login", { username: "web-plain", password: "" });
    const conv = await api.call("conversation.create", { title: "T09 web", systemPrompt: "You are the GM." });

    // Roll-and-send: your text's message, then the roll's, both before start (the browser shows the roll at once).
    const events = await collectStream(api.stream("turn", { conversation: conv.id, content: "I haggle.", roll: true }));
    assert.deepEqual(events.slice(0, 3).map((e) => e.type), ["message", "message", "start"]);
    const rolled = (events[1] as Extract<StreamYield, { type: "message" }>).message;
    const v = rolled.versions[0]!;
    assert.ok(v.roll && v.roll.die === "d20" && v.roll.result >= 1 && v.roll.result <= 20);
    assert.equal(v.content, `🎲 I rolled a d20: **${v.roll.result}**`);
    assert.deepEqual(rollView(v), { roll: v.roll, face: v.roll.result, label: `🎲 d20: ${v.roll.result}`, history: null });
    assert.equal(rollView((events[0] as Extract<StreamYield, { type: "message" }>).message.versions[0]!), null, "typed text is no roll");

    // The honor system: once edited, the line is the roll; the die's number is only history, never the face (T09 QA-1).
    // (Another number than the die's: an edit that changes nothing isn't marked edited.)
    const fudged = v.roll.result === 3 ? 4 : 3;
    const edited = await api.call("message.edit", { conversation: conv.id, message: rolled.id, content: `🎲 I rolled a d20: **${fudged}**` });
    const shown = rollView(edited.message.versions[0]!)!;
    assert.equal(shown.face, null);
    assert.equal(shown.history, `🎲 d20 said ${v.roll.result}`);

    // Just roll: a roll in the ledger, no brain asked (the mock keeps its newest 20 requests, newest first).
    const newest = t.mock.state.requests[0];
    const just = await api.call("message.roll", { conversation: conv.id });
    assert.ok(just.message.versions[0]!.roll);
    assert.equal(t.mock.state.requests[0], newest);

    // The preview: the note first, and the browser marks {{roll}} in the roll's own line only, not in typed text.
    const preview = await api.call("prompt.preview", { conversation: conv.id, content: 'I carve "{{roll}}".', roll: true });
    assert.equal(preview.notes[0], ROLL_PREVIEW_NOTE);
    const messages = preview.body.messages;
    const at = rollLineIndex(messages, conv.brains[0]!.finalReminder);
    assert.equal(at, messages.length - 1);
    assert.match(messages[at - 1]!.content, /I carve "\{\{roll\}\}"/);
    const reminder = { enabled: true, content: "Stay in character." };
    assert.equal(rollLineIndex([...messages, { role: "user", content: reminder.content }], reminder), at, "a final reminder comes after the roll's line");
    assert.equal(rollLineIndex([...messages.slice(0, -1), { role: "user", content: "I haggle." }], null), -1, "no {{roll}} last, nothing marked");

    // The template, as the templates editor saves it; one without {{roll}} is refused.
    assert.equal((await api.call("conversation.update", { id: conv.id, templates: { roll: "Fate says {{roll}}." } })).templates.roll, "Fate says {{roll}}.");
    await assert.rejects(api.call("conversation.update", { id: conv.id, templates: { roll: "Fate says." } }), (e: unknown) => e instanceof ApiError && e.status === 400);

    // A broken roll-and-send keeps the roll. Its retry never rolls, and the browser's words drop the terminal command.
    await api.call("conversation.update", { id: conv.id, templates: { roll: "MOCK_MIDSTREAM_ERROR {{roll}}" } });
    const broken = await collectStream(api.stream("turn", { conversation: conv.id, roll: true })).catch((e: unknown) => e);
    assert.match(errorMessage(broken), /no new roll: turn --brain b_\w+ without --content or --roll, or Retry in the browser\.$/);
    assert.match(forBrowser(errorMessage(broken)), /send again to Assistant with no new message and no new roll, or Retry in the browser\.$/);
    assert.deepEqual(retryOf(broken), { command: "turn", args: { conversation: conv.id, brain: conv.defaultBrainId } });
  });

  test("an unreachable server is a network ApiError", async () => {
    const api = createClient({ baseUrl: "http://127.0.0.1:9" });
    await assert.rejects(api.call("health"), (e: unknown) => e instanceof ApiError && e.code === "network" && e.status === 0);
  });
});

describe("web API client and image brains (T05 frontend)", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    t = await startTestServer({ mock: { imageSlowMs: 300 } });
    assert.equal((await t.cli(["user.create", "--username", "web-img", "--password", "pw-img"])).code, 0);
  });
  after(() => t.close());

  test("an image turn's reply ends at image_pending; image.follow, edit, retry, stop and image_busy are what the browser relies on", async () => {
    const jar = cookieJar();
    const api = createClient({ baseUrl: t.url, fetch: jar.fetch });
    await api.call("auth.login", { username: "web-img", password: "pw-img" }); // encrypted: image.get decrypts
    const conv = await api.call("conversation.create", { title: "T05 web", systemPrompt: "You are the GM." });
    const painter = await api.call("brain.add", { conversation: conv.id, name: "Scene Painter", systemPrompt: "You paint.", kind: "image", finalReminder: { enabled: false } });
    const states: LedgerMessage[] = []; // every copy of the image message the browser would receive, in order

    // The turn: start (kind image), the prompt as words, then image_pending with the saved message. useChat stops reading there.
    const seen: StreamYield[] = [];
    for await (const ev of api.stream("turn", { conversation: conv.id, brain: painter.id, content: "MOCK_IMAGE_SLOW the hearth" })) {
      seen.push(ev);
      if (ev.type === "image_pending") break;
    }
    const start = seen.find((e) => e.type === "start");
    assert.ok(start?.type === "start" && start.kind === "image" && start.brainId === painter.id);
    const prompt = seen.flatMap((e) => (e.type === "prompt" ? [e.delta] : [])).join("");
    const pending = seen.at(-1)!;
    assert.ok(pending.type === "image_pending");
    const m = pending.message;
    states.push(m);
    assert.deepEqual([m.versions[0]!.content, m.versions[0]!.image?.status, m.versions[0]!.image?.id], [prompt, "pending", pending.imageId]);

    // The table is free meanwhile: the GM answers while the image is being made.
    const gm = await collectStream(api.stream("turn", { conversation: conv.id, content: "What do I see?" }));
    assert.equal(gm.at(-1)!.type, "done");
    // What would replace or remove it waits, with its own code (not "conflict", which means a reply is being written).
    await assert.rejects(api.call("message.delete", { conversation: conv.id, message: m.id }), (e: unknown) => e instanceof ApiError && e.status === 409 && e.code === "image_busy");
    await assert.rejects(api.call("message.edit", { conversation: conv.id, message: m.id, content: "another" }), (e: unknown) => e instanceof ApiError && e.code === "image_busy");
    // A stop has nothing to stop: it names the image being made, and the browser shows the server's note.
    const stop = await api.call("generation.stop", { conversation: conv.id });
    assert.deepEqual([stop.stopped, stop.painting], [false, [{ messageId: m.id, imageId: pending.imageId }]]);
    assert.equal(IMAGE_STOP_NOTE, SERVER_IMAGE_STOP_NOTE);

    // The browser's watcher: image.follow ends with the message as saved, and the bytes are there for <img src>.
    const followed = await collectStream(api.stream("image.follow", { conversation: conv.id, message: m.id }));
    assert.deepEqual(followed.map((e) => e.type), ["image_pending", "image_done", "done"]);
    const done = followed.at(-1)!;
    assert.ok(done.type === "done" && done.message);
    states.push(done.message);
    assert.equal(done.message.versions[0]!.image!.status, "done");
    assert.ok(done.spentUsd! >= 0.01, "the total includes the image");
    const res = await jar.fetch(api.binaryUrl("image.get", { id: pending.imageId }));
    assert.deepEqual([res.status, res.headers.get("content-type")], [200, "image/png"]);
    // Nothing being made: it answers at once with the message as it is.
    assert.deepEqual((await collectStream(api.stream("image.follow", { conversation: conv.id, message: m.id }))).map((e) => e.type), ["done"]);

    // An edit answers at once: the new prompt, its image pending, the old one kept as `previous` until it lands.
    const edited = await api.call("message.edit", { conversation: conv.id, message: m.id, content: "MOCK_IMAGE_SLOW A brand new prompt." });
    states.push(edited.message);
    assert.deepEqual([edited.painting?.imageId, edited.message.versions[0]!.image?.status, edited.message.versions[0]!.image?.previous?.id], [edited.message.versions[0]!.image?.id, "pending", pending.imageId]);
    const afterEdit = (await collectStream(api.stream("image.follow", { conversation: conv.id, message: m.id }))).at(-1)!;
    assert.ok(afterEdit.type === "done" && afterEdit.message);
    states.push(afterEdit.message);

    // Paint again (image.retry of a finished image): a new version with the same prompt, which the pager labels.
    let again: LedgerMessage | null = null;
    for await (const ev of api.stream("image.retry", { conversation: conv.id, message: m.id })) {
      if (ev.type === "image_pending") {
        again = ev.message;
        break;
      }
    }
    assert.ok(again);
    states.push(again);
    assert.deepEqual([again.versions.length, again.activeVersion, again.versions[1]!.repaintOf, again.versions[1]!.content], [2, 1, 0, "MOCK_IMAGE_SLOW A brand new prompt."]);
    const last = (await collectStream(api.stream("image.follow", { conversation: conv.id, message: m.id }))).at(-1)!;
    assert.ok(last.type === "done" && last.message);
    states.push(last.message);

    // Each later copy of the message has a later (or equal) updatedAt: the browser keeps the newer of two copies by it.
    for (let i = 1; i < states.length; i++) assert.ok(states[i]!.updatedAt >= states[i - 1]!.updatedAt, `copy ${i} is not older than copy ${i - 1}`);
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

test("brain initials for the composer's buttons are short and never clash (T12)", () => {
  assert.deepEqual(brainInitials(["Co-GM", "Show Me the Odds", "Character Creator", "Scene Painter", "Character Actor", "Character Portraitist"]), [
    "CG",
    "SMTO",
    "CC",
    "SP",
    "CA",
    "CP",
  ]);
  assert.deepEqual(brainInitials(["Character Actor", "Character Artist", "GM", "Narrator", "DiceMaster"]), ["CAc", "CAr", "GM", "Na", "DM"]);
  const same = brainInitials(["Bob", "bob", "Dice Master", "Dice Mister"]);
  assert.equal(new Set(same.map((l) => l.toLowerCase())).size, same.length);
});

test("a brain per character: initials keep numbers whole, and clashes still part (T16)", () => {
  assert.deepEqual(brainInitials(["Character 1", "Character 2", "Character 10", "Character 12", "Cargo 12", "Hooded Figure"]), ["C1", "C2", "C10", "Ch12", "Ca12", "HF"]);
});

test("the composer's row keeps the most recently active brains in their places, and '+N' the rest (T16)", () => {
  const brain = (id: string, madeFrom?: string) => ({ id, name: id, pins: [], ...(madeFrom ? { madeFrom } : {}) }) as unknown as Brain;
  const msg = (id: string, author: string | null) => ({ id, author: author ? { type: "brain", brainId: author } : { type: "player" } }) as unknown as LedgerMessage;
  const conv = {
    brains: [brain("gm"), brain("odds"), brain("creator"), brain("c1", "m2"), brain("c2", "m4")],
    messages: [msg("m1", "gm"), msg("m2", "creator"), msg("m3", "c1"), msg("m4", "creator"), msg("m5", null)],
  } as unknown as Conversation;
  const act = brainActivity(conv);
  assert.deepEqual(Object.fromEntries(act), { gm: 0, odds: -1, creator: 3, c1: 2, c2: 3 }, "spoke last, or was made (its message's place)");
  // All fit: everyone, in order.
  assert.deepEqual(fitRow([30, 30, 30], [0, 1, 2], 100, 4, 30), [0, 1, 2]);
  // Room for two beside "+N": the two most recent, in their own order (ties by order).
  assert.deepEqual(fitRow([30, 30, 30, 30], [5, -1, 9, 9], 100, 4, 30), [2, 3]);
  assert.deepEqual(fitRow([30, 30, 30, 30], [1, 1, 1, 1], 100, 4, 30), [0, 1]);
  assert.deepEqual(fitRow([30, 30], [1, 1], 20, 4, 30), [], "nothing fits: only '+N'");
  assert.equal(madeFromIndex(conv.brains).get("m4")?.id, "c2");
  assert.equal(makerOf(conv, conv.brains[3]!)?.id, "creator");
  assert.equal(makerOf(conv, conv.brains[0]!), null);
  const pinned = { ...conv.brains[0]!, pins: [{ messageId: "m2", as: "system" }] } as Brain;
  assert.deepEqual(
    pinsByMessage([pinned]).get("m2")?.map((p) => [p.brain.id, p.as]),
    [["gm", "system"]],
  );
});

test("the browser names a maker's next brain by the server's own rule (T16)", () => {
  const maker = { name: "Character {{n}}", next: 3 };
  assert.deepEqual(freeMadeName([], maker), { name: "Character 3", n: 3 });
  assert.deepEqual(freeMadeName([{ name: "character 3" }, { name: "Character 4" }], maker), { name: "Character 5", n: 5 }, "a taken name is skipped");
  assert.equal(isPatternName("Character {{n}}", "Character 12"), true);
  assert.equal(isPatternName("Character {{n}}", "Hooded Figure"), false);
  assert.equal(isPatternName("Place ({{n}})", "Place (2)"), true, "regex characters in a pattern are literal");
  assert.equal(isPatternName("Place ({{n}})", "Place 2"), false);
});

test("the Fresh take box starts with the thought template, the marker gone, the caret where it was and the brain named (T15, T17)", () => {
  const { text, caret } = prefillThought(DEFAULT_TEMPLATES.thought, "Game Master");
  const head = "```hidden\nAn idea for Game Master's next reply, which the player won't see:\n\n";
  assert.equal(text, `${head}\n\`\`\``);
  assert.equal(caret, head.length);
  assert.deepEqual(prefillThought("{{brain}}: {{thought}}", "{{thought}}"), { text: "{{thought}}: ", caret: 13 }, "a name is never taken for the marker");
  assert.deepEqual(prefillThought("a {{thought}} b {{thought}}"), { text: "a  b ", caret: 2 }, "no marker is left to be sent");
  assert.deepEqual(prefillThought("no marker"), { text: "no marker", caret: 9 });
});

test("the Fresh take box says what the server will do with the Muse's note (T17 frontend: freshTakeTarget agrees with planMuseNote)", () => {
  const at = "2026-10-15T12:00:00.000Z";
  const text = (content: string, source: "authored" | "generated" = "generated") => ({ content, source, createdAt: at });
  const scene = (muse: "none" | "text" | "image") => {
    const conv = newConversation({ title: "t", systemPrompt: "You help." });
    const gm = conv.brains[0]!;
    if (muse === "text") conv.brains.push(newMuse(conv));
    if (muse === "image") conv.brains.push(newBrain({ name: "Muse", systemPrompt: "paint", isDefault: false, kind: "image" }));
    return { conv, gm, muse: conv.brains[1] };
  };
  const server = (conv: Conversation, messageId: string) => {
    const m = conv.messages.find((x) => x.id === messageId)!;
    const brain = conv.brains.find((b) => m.author.type === "brain" && b.id === m.author.brainId)!;
    try {
      const { note } = planMuseNote(conv, m, brain, "An idea.");
      return note.isNew ? (note.museCreated ? "new, adds a Muse" : "new") : note.same ? "same" : `version ${note.version + 1}`;
    } catch (err) {
      return `refused: ${(err as { code: string }).code}`;
    }
  };
  const browser = (conv: Conversation, messageId: string, typed = "An idea.") => {
    const t = freshTakeTarget(conv, messageId);
    if (t.kind === "new") return t.muse ? "new" : "new, adds a Muse";
    if (t.kind === "after") return "new";
    if (t.kind === "version") return t.text === typed ? "same" : `version ${t.version}`;
    return t.kind === "own" ? "refused: bad_request" : "refused: bad_brain";
  };
  const check = (label: string, conv: Conversation, messageId: string, want: string) => {
    assert.equal(server(conv, messageId), want, `${label}: the server`);
    assert.equal(browser(conv, messageId), want, `${label}: the browser`);
  };

  { // No Muse yet: the first fresh take adds one.
    const { conv, gm } = scene("none");
    const reply = newMessage({ type: "brain", brainId: gm.id }, "text", text("Hello."));
    conv.messages.push(newMessage({ type: "player" }, "text", text("hi", "authored")), reply);
    check("no Muse", conv, reply.id, "new, adds a Muse");
  }
  { // A note you wrote, right before: a new version (or the same note, for the same words).
    const { conv, gm, muse } = scene("text");
    const note = newMessage({ type: "brain", brainId: muse!.id }, "text", text("Old idea.", "authored"));
    const reply = newMessage({ type: "brain", brainId: gm.id }, "text", text("Hello."));
    conv.messages.push(newMessage({ type: "player" }, "text", text("hi", "authored")), note, reply);
    check("a note you wrote", conv, reply.id, "version 2");
    note.versions[0]!.content = "An idea.";
    check("the same words", conv, reply.id, "same");
  }
  { // The Muse's own idea, right before: it stays, and the note goes in after it (T17 QA-1).
    const { conv, gm, muse } = scene("text");
    const own = newMessage({ type: "brain", brainId: muse!.id }, "text", text("Its own idea."));
    const reply = newMessage({ type: "brain", brainId: gm.id }, "text", text("Hello."));
    conv.messages.push(own, reply);
    check("the Muse's own idea", conv, reply.id, "new");
    check("the Muse's own message", conv, own.id, "refused: bad_request");
  }
  { // An image brain called Muse: refused (rename it).
    const { conv, gm } = scene("image");
    const reply = newMessage({ type: "brain", brainId: gm.id }, "text", text("Hello."));
    conv.messages.push(newMessage({ type: "player" }, "text", text("hi", "authored")), reply);
    check("an image Muse", conv, reply.id, "refused: bad_brain");
  }
});

test("an image fresh take's idea shows above its picture only when no note above has it, and T15 text versions are told apart (T17 frontend)", () => {
  const at = "2026-10-15T12:00:00.000Z";
  const conv = newConversation({ title: "t", systemPrompt: "You help." });
  const muse = newMuse(conv);
  const idea = "```hidden\nSix small boots.\n```";
  const note = newMessage({ type: "brain", brainId: muse.id }, "text", { content: idea, source: "authored", createdAt: at });
  const player = newMessage({ type: "player" }, "text", { content: "hi", source: "authored", createdAt: at });
  assert.equal(thoughtBesideImage({ thought: idea }, note, [...conv.brains, muse]), false, "the note right above has it");
  note.versions[0]!.content = "edited since";
  assert.equal(thoughtBesideImage({ thought: idea }, note, [...conv.brains, muse]), false, "still the Muse's note, edited");
  assert.equal(thoughtBesideImage({ thought: idea }, player, [...conv.brains, muse]), true, "a T15 version, or its note deleted");
  assert.equal(thoughtBesideImage({}, player, conv.brains), false, "no fresh take");
  assert.equal(mergedThought({ thought: idea, content: `${idea}\n\nThe reply.` }), true, "T15: saved merged");
  assert.equal(mergedThought({ thought: idea, content: "The reply." }), false, "T17: the reply alone");
});
