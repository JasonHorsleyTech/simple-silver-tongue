import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { REASONING_NOTE } from "../src/conversations/prompt.ts";
import type { Conversation } from "../src/conversations/types.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 };

describe("streaming chat end to end: CLI → server → mock Venice", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    t = await startTestServer();
  });
  after(() => t.close());

  const json = async (argv: string[], stdin?: string) => {
    const r = await t.cli([...argv, "--json"], { stdin });
    assert.equal(r.code, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const login = async (username: string, password = "") => {
    if (!(await t.cli(["user.list", "--json"])).stdout.includes(`"${username}"`)) await createUser(t.config.dataDir, username, password, FAST_KDF);
    const r = await t.cli(["auth.login", "--username", username, "--password", password]);
    assert.equal(r.code, 0, r.stderr);
  };
  const create = async (systemPrompt = "You answer only in haiku.") =>
    (await json(["conversation.create", "--title", "Haiku bot", "--system-prompt", systemPrompt])) as Conversation;
  const get = async (id: string) => (await json(["conversation.get", "--id", id])) as Conversation;
  /** The CLI's saved session as a cookie, for raw concurrent requests through app.fetch. */
  const cookieOf = () => `ss_session=${JSON.parse(readFileSync(join(t.config.runDir, "cli-session.json"), "utf8")).token}`;
  const lastSent = () => t.mock.state.requests.find((r) => r.path === "/chat/completions")?.body as Record<string, any>;

  test("three turns stream, persist, and the preview is exactly what was sent", async () => {
    await login("dev-chat");
    const conv = await create();
    for (const [i, msg] of ["Tell me of the sea.", "Now mountains.", "Finally, the moon."].entries()) {
      // Reasoning is off by default (T02 QA-1); turning it on is an opt-in that the preview labels.
      if (i === 1) assert.match((await t.cli(["brain.update", "--conversation", conv.id, "--reasoning.enabled"])).stdout, /provider adds a small hidden instruction/);
      // What turn --content X will send, asked for first, then compared with what the mock really got.
      const preview = await json(["prompt.preview", "--conversation", conv.id, "--content", msg]);
      assert.deepEqual(preview.notes, i === 0 ? [] : [REASONING_NOTE]);
      assert.equal(preview.body.reasoning_effort, i === 0 ? "none" : "low");
      const r = await t.cli(["turn", "--conversation", conv.id, "--content", msg]);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout, `MOCK reply to brain "You answer only in haiku."; saw ${2 * i + 2} messages; last: "<!-- from: the user --> ${msg}"\n`);
      assert.match(r.stderr, /\[Assistant\]/);
      assert.equal(/MOCK reasoning \(effort: low\)/.test(r.stderr), i > 0, r.stderr);
      assert.match(r.stderr, /\[Assistant · \d+ in \/ \d+ out · \$/);
      assert.deepEqual(lastSent(), preview.body);
    }
    assert.match((await t.cli(["prompt.preview", "--conversation", conv.id])).stdout, /^Exact request .*\nNote: Reasoning on: the provider adds/);
    const saved = await get(conv.id);
    assert.deepEqual(
      saved.messages.map((m) => (m.author.type === "player" ? "player" : "brain")),
      ["player", "brain", "player", "brain", "player", "brain"],
    );
    const reply = saved.messages[5]!.versions[0]!;
    assert.equal(reply.source, "generated");
    assert.equal(reply.model, "deepseek-v4-1-flash");
    assert.equal(reply.finishReason, "stop");
    assert.ok(reply.costUsd! > 0 && reply.usage!.promptTokens > 0);
    assert.match(reply.reasoning!, /^MOCK reasoning/);
    assert.ok(!JSON.stringify(lastSent()).includes("MOCK reasoning"), "reasoning is never sent back");

    const list = (await json(["conversation.list"])).conversations;
    assert.equal(list[0].id, conv.id);
    assert.equal(list[0].messageCount, 6);

    // Nothing new to answer: turn refuses (live, the model just repeated itself), and preview says why.
    const newestBefore = t.mock.state.requests[0];
    const r = await t.cli(["turn", "--conversation", conv.id]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /the last message is Assistant's own reply/i);
    assert.equal(t.mock.state.requests[0], newestBefore, "nothing went upstream");
    assert.match((await t.cli(["prompt.preview", "--conversation", conv.id])).stdout, /Note: turn would not send this/);

    // The text view prints the whole ledger.
    const text = (await t.cli(["conversation.get", "--id", conv.id])).stdout;
    assert.match(text, /── you · m_\w+ ──\nFinally, the moon\./);
  });

  test("one reply at a time: a second turn is a 409 and delete is refused; a rename mid-stream survives the save", async () => {
    await login("dev-chat");
    const conv = await create();
    const post = (cmd: string, body: unknown) =>
      t.app.fetch(new Request(`http://localhost/api/${cmd}`, { method: "POST", headers: { host: "localhost", "content-type": "application/json", cookie: cookieOf() }, body: JSON.stringify(body) }));
    const slow = await post("turn", { conversation: conv.id, content: "MOCK_SLOW story" });
    assert.equal(slow.status, 200);
    const busy = await post("turn", { conversation: conv.id, content: "me too" });
    assert.equal(busy.status, 409);
    assert.equal(((await busy.json()) as any).error.code, "conflict");
    assert.equal((await post("conversation.delete", { id: conv.id })).status, 409);
    assert.equal((await post("conversation.update", { id: conv.id, title: "Renamed mid-stream" })).status, 200);
    const events = (await slow.text()).trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual([...new Set(events.map((e) => e.type))], ["message", "start", "delta", "done"]);
    const saved = await get(conv.id);
    assert.equal(saved.title, "Renamed mid-stream");
    assert.equal(saved.messages.length, 2);
    // The lock is released: the next turn works.
    assert.equal((await t.cli(["turn", "--conversation", conv.id, "--content", "again"])).code, 0);
  });

  test("failures: refused up front saves nothing; broken mid-stream keeps only the player message", async () => {
    await login("dev-chat");
    const conv = await create();
    let r = await t.cli(["turn", "--conversation", conv.id, "--content", "MOCK_ERROR please"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Venice 500 .*MOCK_ERROR/);
    assert.equal((await get(conv.id)).messages.length, 0);

    r = await t.cli(["turn", "--conversation", conv.id, "--content", "MOCK_MIDSTREAM_ERROR please"]);
    assert.equal(r.code, 1);
    // The error says what was kept and how to retry (T02 QA-8).
    assert.match(r.stderr, /stream broke off .*Your message is saved; the reply isn't\. To retry, run turn again without --content\./);
    const saved = await get(conv.id);
    assert.deepEqual(saved.messages.map((m) => m.author.type), ["player"]);
  });

  test("nothing to answer: a fresh conversation with no message is refused, not sent as a bare system prompt (T02 QA-3)", async () => {
    await login("dev-chat");
    const conv = await create();
    const newestBefore = t.mock.state.requests[0];
    const r = await t.cli(["turn", "--conversation", conv.id]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /nothing for Assistant to answer yet: the request would hold only its system prompt/);
    assert.equal(t.mock.state.requests[0], newestBefore, "nothing went upstream");
    assert.match((await t.cli(["prompt.preview", "--conversation", conv.id])).stdout, /Note: turn would not send this .*only its system prompt/);
  });

  test("max_tokens spent on reasoning: the empty reply is saved as is, and the note says why (T02 QA-6)", async () => {
    await login("dev-chat");
    const conv = await create();
    await json(["conversation.update", "--id", conv.id, "--settings.max-tokens", "3"]);
    await json(["brain.update", "--conversation", conv.id, "--reasoning.enabled"]);
    const r = await t.cli(["turn", "--conversation", conv.id, "--content", "hi"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "\n");
    assert.match(r.stderr, /cut off by max_tokens while reasoning: no reply text/);
    const v = (await get(conv.id)).messages[1]!.versions[0]!;
    assert.deepEqual([v.content, v.finishReason, v.reasoning], ["", "length", "MOCK reasoning (effort: "]);
  });

  test("conversation.list: unreadable files are listed with why, and can't hide the rest (T02 QA-4)", async () => {
    await login("dev-chat-list");
    const conv = await create();
    const dir = join(t.config.dataDir, "users", "dev-chat-list", "conversations");
    await writeFile(join(dir, "c_corrupt01.json"), '{"oops": truncated');
    await writeFile(join(dir, "c_partial01.json"), JSON.stringify({ id: "c_partial01", title: "half" }));
    const list = await json(["conversation.list"]);
    assert.deepEqual(list.conversations.map((c: { id: string }) => c.id), [conv.id]);
    assert.deepEqual(list.unreadable, [
      { id: "c_corrupt01", error: "not valid JSON" },
      { id: "c_partial01", error: "not a conversation document (fields are missing)" },
    ]);
    const text = (await t.cli(["conversation.list"])).stdout;
    assert.match(text, new RegExp(`${conv.id}  Haiku bot[\\s\\S]*Unreadable conversation files \\(2\\):\\n  c_corrupt01: not valid JSON`));
  });

  test("hard rule 1: an empty system prompt never reaches Venice, even if it got onto disk", async () => {
    await login("dev-chat");
    let r = await t.cli(["conversation.create", "--system-prompt", " \n"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /system prompt can't be empty/);

    const conv = await create();
    const file = join(t.config.dataDir, "users", "dev-chat", "conversations", `${conv.id}.json`);
    const doc = JSON.parse(await readFile(file, "utf8")) as Conversation;
    doc.brains[0]!.systemPrompt = "";
    await writeFile(file, JSON.stringify(doc));
    const newestBefore = t.mock.state.requests[0];
    for (const cmd of ["turn", "prompt.preview"]) {
      r = await t.cli([cmd, "--conversation", conv.id, "--content", "hi"]);
      assert.equal(r.code, 1, cmd);
      assert.match(r.stderr, /empty system prompt, so nothing was sent/, cmd);
    }
    assert.equal(t.mock.state.requests[0], newestBefore, "no request went upstream");
    assert.equal((await get(conv.id)).messages.length, 0);
  });

  test("settings, templates and brain edits flow into the very next request", async () => {
    await login("dev-chat");
    const conv = await create();
    let r = await t.cli(["conversation.update", "--id", conv.id, "--settings.text-model", "no-such-model"]);
    assert.match(r.stderr, /Venice has no text model "no-such-model"/);
    await json(["conversation.update", "--id", conv.id, "--settings.max-tokens", "4", "--templates.player", "{{content}}"]);
    await json(["brain.update", "--conversation", conv.id, "--brain", "assistant", "--system-prompt", "-", "--no-reasoning.enabled"], "New prompt\n");
    r = await t.cli(["turn", "--conversation", conv.id, "--content", "hello"]);
    assert.equal(r.stdout, "MOCK reply to brain \n", r.stderr); // 4 words
    assert.match(r.stderr, /cut off by max_tokens/);
    const sent = lastSent();
    assert.deepEqual(sent.messages, [{ role: "system", content: "New prompt" }, { role: "user", content: "hello" }]);
    assert.equal(sent.reasoning_effort, "none");
    assert.equal(sent.max_tokens, 4);
    assert.equal((await get(conv.id)).messages[1]!.versions[0]!.finishReason, "length");
    await json(["conversation.update", "--id", conv.id, "--settings", '{"maxTokens": null}']);
    assert.equal((await get(conv.id)).settings.maxTokens, undefined);
  });

  test("an encrypted user's conversation is ciphertext on disk", async () => {
    await login("dev-chat-enc", "pw");
    const conv = (await json(["conversation.create", "--title", "GILDED-GOAT-TITLE", "--system-prompt", "You are the SECRET-GM."])) as Conversation;
    assert.equal((await t.cli(["turn", "--conversation", conv.id, "--content", "I order PLUM-WINE."])).code, 0);
    const raw = await readFile(join(t.config.dataDir, "users", "dev-chat-enc", "conversations", `${conv.id}.json`));
    assert.equal(raw.subarray(0, 6).toString(), "SSENC1");
    for (const phrase of ["GILDED-GOAT", "SECRET-GM", "PLUM-WINE", "MOCK reply"]) assert.ok(!raw.includes(phrase), phrase);
    assert.equal((await get(conv.id)).messages.length, 2);
    assert.equal((await json(["conversation.delete", "--id", conv.id])).deleted, conv.id);
    assert.equal((await t.cli(["conversation.get", "--id", conv.id])).code, 1);
  });
});
