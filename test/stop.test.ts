import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { SCHEMA_VERSION, type ChatRequest, type Conversation } from "../src/conversations/types.ts";
import { FRAMING_STOP, stopNote } from "../src/conversations/wording.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

/**
 * T07 triage (QA-2): a brain can continue the framing pattern and write lines for the other speakers. Every text
 * brain has stop sequences, ["<!-- from:"] by default, sent as the request's `stop`: Venice ends the reply just
 * before such a line. They are a request setting, shown in prompt.preview and brain.list and editable per brain.
 */
describe("stop sequences: a brain can't write another speaker's framing (T07 triage)", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    t = await startTestServer();
    await createUser(t.config.dataDir, "dev-stop", "", { N: 2 ** 10, r: 8, p: 1 }); // plaintext, so a test can write an old file
  });
  after(() => t.close());

  const ok = async (argv: string[]) => {
    const r = await t.cli(argv);
    assert.equal(r.code, 0, `${argv.join(" ")}\n${r.stderr}`);
    return r;
  };
  const json = async (argv: string[]) => JSON.parse((await ok([...argv, "--json"])).stdout);
  const get = async (id: string) => (await json(["conversation.get", "--id", id])) as Conversation;
  const lastSent = () => t.mock.state.requests.find((r) => r.path === "/chat/completions")!.body as ChatRequest;
  const fileOf = (id: string) => join(t.config.dataDir, "users", "dev-stop", "conversations", `${id}.json`);

  test("a text brain stops before a framing line it writes itself; the preview shows the stop and says what it does", async () => {
    await ok(["auth.login", "--username", "dev-stop", "--password", ""]);
    const conv = (await json(["conversation.create", "--system-prompt", "You are the GM."])) as Conversation;
    assert.deepEqual(conv.brains[0]!.stop, [FRAMING_STOP]);

    const preview = await json(["prompt.preview", "--conversation", conv.id, "--content", "MOCK_IMPERSONATE"]);
    assert.deepEqual(preview.body.stop, [FRAMING_STOP]);
    assert.deepEqual(preview.notes, [stopNote([FRAMING_STOP])]);
    assert.match((await ok(["prompt.preview", "--conversation", conv.id])).stdout, /"stop":\["<!-- from:"\]/, "the text view's body line shows it");

    const r = await ok(["turn", "--conversation", conv.id, "--content", "MOCK_IMPERSONATE"]);
    assert.deepEqual(lastSent(), preview.body, "the preview is what was sent, stop included");
    const reply = (await get(conv.id)).messages.at(-1)!.versions[0]!.content;
    assert.match(reply, /^MOCK reply/);
    assert.doesNotMatch(reply.replace(/^MOCK reply[^\n]*/, ""), /<!-- from:/, "the fake Dice Master line was cut");
    assert.doesNotMatch(r.stdout, /Dice Master -->/);

    // The control: with no stop sequences, the same reply carries the fake line (so the check above proves something).
    await ok(["brain.update", "--conversation", conv.id, "--stop", "[]"]);
    const bare = await json(["prompt.preview", "--conversation", conv.id]);
    assert.equal(bare.body.stop, undefined, "an empty list isn't sent");
    assert.deepEqual(bare.notes, []);
    await ok(["message.regenerate", "--conversation", conv.id]);
    assert.match((await get(conv.id)).messages.at(-1)!.versions[1]!.content, /<!-- from: Dice Master -->/);
  });

  test("brain.add and brain.update take --stop (repeatable, at most 4, never blank); brain.list shows them; image brains start with none", async () => {
    await ok(["auth.login", "--username", "dev-stop", "--password", ""]);
    const conv = (await json(["conversation.create", "--system-prompt", "You are the GM."])) as Conversation;
    const c = ["--conversation", conv.id];
    const dice = await json(["brain.add", ...c, "--name", "Dice Master", "--system-prompt", "You roll."]);
    assert.deepEqual(dice.stop, [FRAMING_STOP], "an added text brain gets the default too");
    const painter = await json(["brain.add", ...c, "--name", "Scene Painter", "--kind", "image", "--system-prompt", "You paint."]);
    assert.deepEqual(painter.stop, [], "an image brain answers with a forced tool call");
    assert.equal((await json(["prompt.preview", ...c, "--brain", "Scene Painter"])).body.stop, undefined);

    const two = await json(["brain.update", ...c, "--brain", "Dice Master", "--stop", FRAMING_STOP, "--stop", "<!-- System"]);
    assert.deepEqual(two.stop, [FRAMING_STOP, "<!-- System"]);
    assert.deepEqual((await json(["prompt.preview", ...c, "--brain", "Dice Master"])).body.stop, [FRAMING_STOP, "<!-- System"]);
    const five = ["a", "b", "c", "d", "e"].flatMap((s) => ["--stop", s]);
    const r5 = await t.cli(["brain.update", ...c, ...five]);
    assert.equal(r5.code, 1);
    assert.match(r5.stderr, /At most 4 stop sequences/);
    const blank = await t.cli(["brain.update", ...c, "--stop", "  "]);
    assert.match(blank.stderr, /A stop sequence can't be blank/);

    const list = (await ok(["brain.list", ...c])).stdout;
    assert.match(list, /Stop sequences \(Venice ends the reply just before any of them\): "<!-- from:", "<!-- System"/);
    assert.match(list, /Scene Painter[^\n]*no stop sequences/);
  });

  test("a conversation saved before stop sequences gets them on load (text brains only); an emptied list stays empty", async () => {
    await ok(["auth.login", "--username", "dev-stop", "--password", ""]);
    const conv = (await json(["conversation.create", "--system-prompt", "You are the GM."])) as Conversation;
    await ok(["brain.add", "--conversation", conv.id, "--name", "Scene Painter", "--kind", "image", "--system-prompt", "You paint."]);
    await ok(["brain.add", "--conversation", conv.id, "--name", "Quiet", "--system-prompt", "You whisper.", "--stop", "[]"]);
    // Make it look like a pre-T07-triage file: schema 1, and no stop field on the brains that never had one.
    const old = JSON.parse(readFileSync(fileOf(conv.id), "utf8"));
    old.schemaVersion = 1;
    for (const b of old.brains) if (b.name !== "Quiet") delete b.stop;
    writeFileSync(fileOf(conv.id), JSON.stringify(old));

    const loaded = await get(conv.id);
    assert.equal(loaded.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(loaded.brains.map((b) => [b.name, b.stop]), [["Assistant", [FRAMING_STOP]], ["Scene Painter", []], ["Quiet", []]]);
    assert.deepEqual((await json(["prompt.preview", "--conversation", conv.id, "--content", "hi"])).body.stop, [FRAMING_STOP]);
    // The next write saves the upgrade.
    await ok(["conversation.update", "--id", conv.id, "--title", "Upgraded"]);
    const saved = JSON.parse(readFileSync(fileOf(conv.id), "utf8"));
    assert.equal(saved.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(saved.brains.map((b: { stop: string[] }) => b.stop), [[FRAMING_STOP], [], []]);
  });

  test("import: a campaign file without stop gets each kind's default; one that says [] keeps it; a bad list is refused", async () => {
    await ok(["auth.login", "--username", "dev-stop", "--password", ""]);
    const file = (brains: unknown[]) => JSON.stringify({ brains });
    const imported = async (brains: unknown[]) => {
      const r = await t.cli(["conversation.import", "--campaign", "-", "--json"], { stdin: file(brains) });
      assert.equal(r.code, 0, r.stderr);
      return JSON.parse(r.stdout) as Conversation;
    };
    const a = await imported([{ name: "GM", systemPrompt: "S" }, { name: "Painter", kind: "image", systemPrompt: "P" }, { name: "Quiet", systemPrompt: "Q", stop: [] }]);
    assert.deepEqual(a.brains.map((b) => b.stop), [[FRAMING_STOP], [], []]);
    const bad = await t.cli(["conversation.import", "--campaign", "-"], { stdin: file([{ name: "GM", systemPrompt: "S", stop: ["", "x"] }]) });
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /brains\.0\.stop\.0: A stop sequence can't be blank/);
  });
});
