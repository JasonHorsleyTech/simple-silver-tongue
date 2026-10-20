import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { Conversation } from "../src/conversations/types.ts";
import { describeRequest, formatDiagnostics, forLog, forUser, maskEcho, type ChatDiagnostics } from "../src/venice/diagnose.ts";
import { startTestServer } from "./helpers.ts";

/**
 * 2026-10-20: a failed chat request says everything about itself but its words. The user who hit it gets the
 * diagnostics in the error (CLI block, --json details, the browser's Details); the server log gets a record that
 * names nothing and holds no word of the conversation. Every secret below must reach the user's view where it
 * belongs (the control) and never the log.
 */

const S = {
  system: "Zephyrine system words",
  user: "Quillwater player words",
  assistant: "Brackenford reply words",
  toolArgs: "Marrowgate prompt words",
  toolDesc: "Ostravale tool description",
  toolName: "paint_Velloranth",
  toolResult: "Dunmorrow tool result",
  stop: "Thistledown stop",
  future: "Nightjar future field",
  nested: "Cobblewick nested field",
  key: "Harrowgate odd key",
  callId: "call_Ferncliffe",
};

const body = {
  model: "deepseek-v4-1-flash",
  messages: [
    { role: "system", content: S.system },
    { role: "user", content: `<!-- from: the user -->\n${S.user}` },
    { role: "assistant", content: S.assistant },
    { role: "assistant", content: "", tool_calls: [{ id: S.callId, type: "function", function: { name: S.toolName, arguments: JSON.stringify({ prompt: S.toolArgs }) } }] },
    { role: "tool", tool_call_id: S.callId, content: S.toolResult },
    { role: "system", content: `${S.system} again` },
    { role: "assistant", content: "" },
  ],
  stream: true,
  stream_options: { include_usage: true },
  venice_parameters: { include_venice_system_prompt: false, enable_web_search: "off", enable_web_scraping: false, disable_thinking: true, character_slug: S.nested },
  reasoning_effort: "none",
  max_tokens: 500,
  temperature: 0.7,
  stop: [S.stop],
  tools: [{ type: "function", function: { name: S.toolName, description: S.toolDesc, parameters: { type: "object", properties: { prompt: { type: "string", description: S.toolDesc } }, required: ["prompt"] } } }],
  tool_choice: { type: "function", function: { name: S.toolName } },
  user: S.future, // a field added to the request later: redacted by default
  [S.key]: 1, // a key that isn't a field name
};

const leaks = (text: string, secrets: string[]) => secrets.filter((s) => text.includes(s));

describe("diagnostics of a failed chat request (pure)", () => {
  test("the request's shape keeps structure and sizes, and no word of it", () => {
    const shape = describeRequest(body);
    const d: ChatDiagnostics = { stage: "refused", what: "It answered HTTP 500.", request: shape, timing: { failedMs: 12 }, venice: { status: 500 } };
    assert.deepEqual(leaks(JSON.stringify(shape) + formatDiagnostics(d), Object.values(S)), []);

    assert.deepEqual(shape.messages.map((m) => m.role), ["system", "user", "assistant", "assistant", "tool", "system", "assistant"]);
    assert.deepEqual(shape.messages.map((m) => m.chars), [S.system.length, 24 + S.user.length, S.assistant.length, 0, S.toolResult.length, S.system.length + 6, 0]);
    assert.equal(shape.model, "deepseek-v4-1-flash");
    assert.equal(shape.reasoning, "off (venice_parameters.disable_thinking: true, reasoning_effort: none)");
    // Kept: numbers, booleans and structural strings. Hidden: every other string, as its length, keys included.
    const p = shape.params as Record<string, any>;
    assert.equal(p.max_tokens, 500);
    assert.equal(p.temperature, 0.7);
    assert.equal(p.venice_parameters.include_venice_system_prompt, false);
    assert.equal(p.venice_parameters.enable_web_search, "off");
    assert.equal(p.venice_parameters.character_slug, `<${S.nested.length} chars>`);
    assert.deepEqual(p.stop, [`<${S.stop.length} chars>`]);
    assert.equal(p.tools[0].type, "function");
    assert.equal(p.tools[0].function.name, `<${S.toolName.length} chars>`);
    assert.equal(p.tool_choice.type, "function");
    assert.equal(p.user, `<${S.future.length} chars>`);
    assert.equal(p[`<key, ${S.key.length} chars>`], 1);
    const call = (shape.messages[3]!.more as any).tool_calls[0];
    assert.deepEqual(call, { id: `<${S.callId.length} chars>`, type: "function", function: { name: `<${S.toolName.length} chars>`, arguments: `<${JSON.stringify({ prompt: S.toolArgs }).length} chars>` } });
    assert.equal(shape.size.messages, 7);
    assert.ok(shape.size.bytes > shape.size.chars && shape.size.estTokens > 0);

    // A structural key's value is kept only when it has that key's shape.
    const odd = describeRequest({ model: `a model called ${S.future}`, messages: [{ role: `user ${S.user}`, content: "" }] });
    assert.deepEqual(leaks(JSON.stringify(odd), Object.values(S)), []);
    assert.equal(odd.messages[0]!.role, `<${`user ${S.user}`.length} chars>`);
  });

  test("the flags say what is unusual about the order", () => {
    const flags = describeRequest(body).flags;
    assert.ok(flags.includes("2 assistant messages in a row: #2–#3"), flags.join("\n"));
    assert.ok(flags.includes("system message after the start: #5"), flags.join("\n"));
    assert.ok(flags.includes("it ends on assistant, not user"), flags.join("\n"));
    assert.ok(flags.includes("empty content: #6"), flags.join("\n")); // #3 is empty too, but carries its tool call
    assert.ok(!flags.some((f) => f.includes("tool")), "#3's call is answered by #4, and the request has tools");

    const plain = describeRequest({ messages: [{ role: "system", content: "x" }, { role: "user", content: "a" }, { role: "user", content: "b" }, { role: "assistant", content: "c" }, { role: "user", content: "d" }] });
    assert.deepEqual(plain.flags, ["user messages in a row (usual with several brains, whose replies are framed as user): #1–#2"]);
    const noTools = describeRequest({ messages: [{ role: "system", content: "x" }, { role: "assistant", content: "", tool_calls: [{ id: "c" }] }, { role: "user", content: "y" }] });
    assert.ok(noTools.flags.includes("#1 carries tool_calls, but the request has no tools"));
    assert.ok(noTools.flags.includes("#1 carries tool_calls, and #2 isn't a tool result"));
  });

  test("Venice's words reach the log only where they don't repeat the request", () => {
    const words = [S.user, `line one of a note\nline two of ${S.system}`, "tiny"];
    // Quoted as is, as JSON (\n escaped) and as a short whole string; Venice's own words stay.
    const said = `chat completions inference processing failed: input_value='${S.user}' and "line one of a note\\nline two of ${S.system}"`;
    const masked = maskEcho(said, words);
    assert.deepEqual(leaks(masked, [S.user, S.system, "line one of a note"]), []);
    assert.match(masked, /^chat completions inference processing failed: input_value='\[\d+ chars that repeat the request, masked\]'/);
    assert.equal(maskEcho("tiny words", ["tiny"]), "tiny words", "a string of 5 characters or less can't be told from Venice's own words");

    const core: ChatDiagnostics = {
      stage: "refused",
      what: "It answered HTTP 400.",
      request: describeRequest(body),
      timing: { headersMs: 30, failedMs: 31 },
      venice: { status: 400, error: `Bad request: '${S.assistant}'`, headers: { "x-request-id": "req-1", "content-type": "application/json" } },
    };
    const user = forUser(core, body, "Game Master");
    assert.equal(user.request.messages[1]!.from, "the user");
    assert.ok(formatDiagnostics(user).includes(S.assistant), "the user sees Venice's whole answer");
    // forLog describes the request afresh, so the user's `from` can't come along even if handed the user's view.
    const log = formatDiagnostics(forLog(user, body, { conversation: "c_x", brain: "b_y", user: "u_z", encrypted: true }));
    assert.deepEqual(leaks(log, [...Object.values(S), "Game Master", "the user"]), []);
    assert.match(log, /conversation c_x · brain b_y · user u_z \(encrypted\)/);
    assert.match(log, /x-request-id: req-1/);
    assert.match(log, /Bad request: '\[\d+ chars that repeat the request, masked\]'/);
  });
});

describe("diagnostics end to end (CLI → server → mock Venice), and the log names nothing", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  const log: string[] = [];
  before(async () => {
    t = await startTestServer({ log: (line) => log.push(line) });
  });
  after(() => t.close());

  const P = {
    username: "dev-diag-wolfsbane",
    title: "Saltmarsh title",
    system: "Gravenhurst system prompt",
    dice: "Dice Fenwhistle",
    painter: "Painter Calloway",
    toolDesc: "Larkspur tool description",
    toolName: "paint_Ormsby",
    stop: "Pellucid stop",
    message: "Wyvernholt player message",
    words: "Ashgrove words in a brain's mouth",
    steer: "Oakhaven steer",
    thought: "Bramblecote thought",
  };

  test("a refused, a broken and an echoing request: the user gets the diagnostics, the log the record", async () => {
    const ok = async (argv: string[]) => {
      const r = await t.cli(argv);
      assert.equal(r.code, 0, `${argv.join(" ")}\n${r.stderr}`);
      return r;
    };
    await ok(["user.create", "--username", P.username, "--password", "pw-diag"]);
    await ok(["auth.login", "--username", P.username, "--password", "pw-diag"]);
    const conv = JSON.parse((await ok(["conversation.create", "--title", P.title, "--system-prompt", P.system, "--json"])).stdout) as Conversation;
    const c = conv.id;
    await ok(["brain.update", "--conversation", c, "--stop", "<!-- from:", "--stop", P.stop]);
    await ok(["brain.add", "--conversation", c, "--name", P.dice, "--system-prompt", P.system, "--no-final-reminder.enabled"]);
    await ok(["brain.add", "--conversation", c, "--name", P.painter, "--kind", "image", "--system-prompt", P.system, "--tool.name", P.toolName, "--tool.description", P.toolDesc, "--no-final-reminder.enabled"]);
    await ok(["turn", "--conversation", c, "--content", P.message]); // a reply that worked: the anchor
    await ok(["turn", "--conversation", c, "--brain", P.painter]); // its prompt (a tool call) quotes P.message
    await ok(["message.add", "--conversation", c, "--as", P.dice, "--content", P.words]);
    const before = log.length;

    // 1. Refused up front (HTTP 500): the readable block under the error, with names, Venice's words and its request id.
    const refused = await t.cli(["turn", "--conversation", c, "--content", `${P.message} MOCK_ERROR`]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /^error: Venice 500 on \/chat\/completions: mock: forced error/);
    for (const want of [/What failed: everything about the request but its words/, /Venice refused the request before streaming anything/, /HTTP status: 500/, /Venice said: \{"error":"mock: forced error \(MOCK_ERROR\)"\}/, /x-request-id: mock-req-\d+/, /Model: deepseek-v4-1-flash \(context [\d,]+ tokens/, /Reasoning: off \(reasoning_effort: none\)/, /stop 2 sequences/, /Last reply here that worked: m_\w+, \d+ messages? ago/]) {
      assert.match(refused.stderr, want);
    }
    assert.ok(refused.stderr.includes(`from ${P.dice}`), "the user's view says who each message is from");
    assert.ok(refused.stderr.includes("Asked: Assistant"));

    // --json: the error as the server sent it, the diagnostics as data.
    const asJson = await t.cli(["turn", "--conversation", c, "--content", `${P.message} MOCK_ERROR`, "--json"]);
    assert.equal(asJson.code, 1);
    const d = JSON.parse(asJson.stdout).error.details.diagnostics as ChatDiagnostics;
    assert.equal(d.stage, "refused");
    assert.equal(d.venice.status, 500);
    assert.ok(d.lastWorked && d.lastWorked.promptTokens > 0);
    assert.ok(d.model?.contextLength);
    assert.deepEqual(d.request.messages.map((m) => m.role), ["system", "user", "assistant", "user", "user", "user"]);
    assert.ok(d.timing.headersMs !== undefined && d.timing.failedMs >= d.timing.headersMs);

    // 2. Broken mid-stream: what arrived, and the Retry still rides along.
    const broken = await t.cli(["turn", "--conversation", c, "--content", `${P.message} MOCK_MIDSTREAM_ERROR`, "--json"]);
    assert.equal(broken.code, 1);
    const ev = JSON.parse(broken.stdout.trim().split("\n").at(-1)!);
    assert.equal(ev.type, "error");
    assert.deepEqual(ev.error.details.retry, { command: "turn", args: { conversation: c, brain: conv.defaultBrainId } });
    const b = ev.error.details.diagnostics as ChatDiagnostics;
    assert.equal(b.stage, "stream");
    assert.ok(b.received && b.received.chunks > 0 && b.received.contentChars > 0 && !b.received.done && b.received.finishReason === undefined);
    assert.ok(b.timing.firstChunkMs !== undefined);
    assert.match(b.venice.headers?.["x-request-id"] ?? "", /^mock-req-\d+$/);
    const brokenText = await t.cli(["turn", "--conversation", c, "--brain", conv.defaultBrainId, "--content", "MOCK_MIDSTREAM_ERROR"]);
    assert.match(brokenText.stderr, /To retry, send again[\s\S]*Received before it broke: \d+ chunks/);

    // 3. A validation error that quotes the message: the user sees it whole.
    const echo = await t.cli(["turn", "--conversation", c, "--content", `${P.message} MOCK_ECHO_ERROR`]);
    assert.equal(echo.code, 1);
    assert.ok(echo.stderr.includes(`content: input_value='<!-- from: the user -->\\n${P.message} MOCK_ECHO_ERROR' was refused","type"`), echo.stderr);

    // 4. A steered regenerate, a fresh take and an image brain's prompt call fail the same way.
    await ok(["message.add", "--conversation", c, "--as", "Assistant", "--content", P.words]); // a reply to regenerate
    const steered = await t.cli(["message.regenerate", "--conversation", c, "--steer", `${P.steer} MOCK_ERROR`]);
    assert.match(steered.stderr, /HTTP status: 500[\s\S]*Messages \(#, role, chars, from\)/);
    const fresh = await t.cli(["message.regenerate", "--conversation", c, "--thought", `${P.thought} MOCK_ERROR`]);
    assert.match(fresh.stderr, /HTTP status: 500/);
    const painted = await t.cli(["turn", "--conversation", c, "--brain", P.painter, "--content", `${P.message} MOCK_ERROR`]);
    assert.match(painted.stderr, /tools 1, tool_choice function \(forced\)/);
    assert.match(painted.stderr, /#\d+ +assistant +0 +\{"tool_calls":\[\{"id":"<\d+ chars>","type":"function","function":\{"name":"<12 chars>","arguments":"<\d+ chars>"\}\}\]\}/);

    // The log: one record per failed request, by id, with the user as a pseudonym.
    const failures = log.slice(before).filter((l) => / failed: 502 venice_error/.test(l));
    assert.deepEqual(failures.map((l) => l.split("\n")[0]), [
      "turn failed: 502 venice_error",
      "turn failed: 502 venice_error",
      "turn failed: 502 venice_error",
      "turn failed: 502 venice_error",
      "turn failed: 502 venice_error",
      "message.regenerate failed: 502 venice_error",
      "message.regenerate failed: 502 venice_error",
      "turn failed: 502 venice_error",
    ]);
    const pseudonym = `u_${createHash("sha256").update(P.username).digest("hex").slice(0, 10)}`;
    for (const record of failures) {
      assert.match(record, /What failed: everything about the request but its words/);
      assert.ok(record.includes(`conversation ${c} · brain b_`) && record.includes(`user ${pseudonym} (encrypted)`), record);
      assert.match(record, /x-request-id: mock-req-\d+/);
      assert.match(record, /Messages \(#, role, chars\)\n/);
    }
    assert.match(failures[0]!, /Venice said: \{"error":"mock: forced error \(MOCK_ERROR\)"\}/, "Venice's own words are the clue, and they stay");
    assert.match(failures[4]!, /input_value='\[\d+ chars that repeat the request, masked\]' was refused/, "the echo of the message is masked");

    // No word of the conversation, no name, no title and no username anywhere in the log; the control is the
    // user's own view above, which had the brain names and the echoed message.
    assert.ok(echo.stderr.includes(P.message) && refused.stderr.includes(P.dice));
    assert.deepEqual(leaks(log.join("\n"), Object.values(P)), []);
  });
});
