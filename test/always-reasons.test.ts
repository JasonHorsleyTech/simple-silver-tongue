import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ChatRequest, Conversation } from "../src/conversations/types.ts";
import { alwaysReasonsNote, REASONING_NOTE } from "../src/conversations/wording.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

/**
 * 2026-10-19: GLM 5.3 and Abliterated Large V2 always reason (src/venice/curated.ts, ALWAYS_REASONS). Live, Venice
 * refuses GLM 5.3's request with reasoning off (400 "thinking-only"), and Abliterated Large V2 takes it and reasons
 * anyway, streaming its reasoning as `delta.reasoning`; the mock does both. Nothing sent changes: the payload view
 * says what will happen, and the 400 says which switch to flip.
 */
describe("models that always reason (GLM 5.3, Abliterated Large V2)", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    t = await startTestServer();
    await createUser(t.config.dataDir, "dev-always", "", { N: 2 ** 10, r: 8, p: 1 });
  });
  after(() => t.close());

  const ok = async (argv: string[]) => {
    const r = await t.cli(argv);
    assert.equal(r.code, 0, `${argv.join(" ")}\n${r.stderr}`);
    return r;
  };
  const json = async (argv: string[]) => JSON.parse((await ok([...argv, "--json"])).stdout);
  const lastSent = () => t.mock.state.requests.find((r) => r.path === "/chat/completions")!.body as ChatRequest;

  test("GLM 5.3 with reasoning off: the preview says Venice will refuse it, the 400 says how to fix it; with reasoning on it answers", async () => {
    await ok(["auth.login", "--username", "dev-always", "--password", ""]);
    const conv = (await json(["conversation.create", "--system-prompt", "You are the GM.", "--text-model", "z-ai-glm-5-3"])) as Conversation;
    await ok(["brain.update", "--conversation", conv.id, "--stop", "[]"]);

    const off = await json(["prompt.preview", "--conversation", conv.id, "--content", "Hello"]);
    assert.equal(off.body.venice_parameters.disable_thinking, true, "the brain's switch is what is sent: off stays off");
    assert.deepEqual(off.notes, [alwaysReasonsNote("GLM 5.3", "refused", "Assistant")]);

    const sends = t.mock.state.requests.length;
    const r = await t.cli(["turn", "--conversation", conv.id, "--content", "Hello"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /thinking-only model.*Turn reasoning on for Assistant: .*brain\.update --brain "Assistant" --reasoning\.enabled/s);
    assert.equal(t.mock.state.requests.length, sends + 1, "Venice was asked, and refused");
    assert.equal((await json(["conversation.get", "--id", conv.id])).messages.length, 0, "nothing saved");

    await ok(["brain.update", "--conversation", conv.id, "--reasoning.enabled"]);
    const on = await json(["prompt.preview", "--conversation", conv.id, "--content", "Hello"]);
    assert.deepEqual(on.notes, [REASONING_NOTE]);
    assert.equal(on.body.venice_parameters.disable_thinking, undefined);
    assert.equal(on.body.reasoning_effort, undefined, "no effort levels: reasoning on sends nothing about reasoning");
    await ok(["turn", "--conversation", conv.id, "--content", "Hello"]);
    assert.deepEqual(lastSent(), on.body);
    const v = (await json(["conversation.get", "--id", conv.id])).messages.at(-1).versions[0];
    assert.match(v.reasoning, /^MOCK reasoning/);
  });

  test("Abliterated Large V2 with reasoning off: the preview says it reasons anyway, and its reasoning (delta.reasoning) is kept", async () => {
    await ok(["auth.login", "--username", "dev-always", "--password", ""]);
    const conv = (await json(["conversation.create", "--system-prompt", "You are the GM.", "--text-model", "abliteration-abliterated-model-large-v2"])) as Conversation;
    await ok(["brain.update", "--conversation", conv.id, "--stop", "[]"]);
    const preview = await json(["prompt.preview", "--conversation", conv.id, "--content", "Hello"]);
    assert.equal(preview.body.venice_parameters.disable_thinking, true);
    assert.deepEqual(preview.notes, [alwaysReasonsNote("Abliterated Large V2", "ignored", "Assistant")]);

    const r = await ok(["turn", "--conversation", conv.id, "--content", "Hello", "--json"]);
    const events = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
    const streamed = events.filter((e) => e.type === "reasoning").map((e) => e.delta).join("");
    assert.match(streamed, /^MOCK reasoning/, "the reasoning came as delta.reasoning and still reached the client");
    const v = (await json(["conversation.get", "--id", conv.id])).messages.at(-1).versions[0];
    assert.equal(v.reasoning, streamed);
  });

  test("models.list shows both, the twin as anonymized, and says they always reason", async () => {
    const text = (await ok(["models.list", "--type", "text"])).stdout;
    assert.match(text, /z-ai-glm-5-3 +GLM 5\.3 +private .* always/);
    assert.match(text, /abliteration-abliterated-model-large-v2 +Abliterated Large V2 +anonymized +\$3\.00\/M in, \$5\.00\/M out +always/);
    const models = (await json(["models.list", "--type", "text"])).models;
    assert.equal(models.find((m: { id: string }) => m.id === "deepseek-v4-1-flash").reasoning.always, undefined);
  });
});
