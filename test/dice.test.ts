import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { DEFAULT_TEMPLATES, newConversation } from "../src/conversations/defaults.ts";
import { rollD20 } from "../src/conversations/dice.ts";
import { planTurn, rollMessage } from "../src/conversations/turn.ts";
import { SCHEMA_VERSION, type ChatRequest, type Conversation, type LedgerMessage } from "../src/conversations/types.ts";
import { ROLL_PREVIEW_NOTE, rollLabel } from "../src/conversations/wording.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 };
const DEEPSEEK = { reasoning: { supported: true, effortOptions: ["none", "low", "high", "max"] } };
const line = (n: number | string) => `🎲 I rolled a d20: **${n}**`;
const framed = (n: number | string) => `<!-- from: the user -->\n${line(n)}`;

describe("dice: the server rolls a d20 (T09)", () => {
  test("rolls are whole numbers from 1 to 20, and every face turns up", () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 4000; i++) {
      const r = rollD20();
      assert.equal(r.die, "d20");
      assert.ok(Number.isInteger(r.result) && r.result >= 1 && r.result <= 20, `rolled ${r.result}`);
      counts.set(r.result, (counts.get(r.result) ?? 0) + 1);
    }
    assert.deepEqual([...counts.keys()].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
    // 200 expected per face, sd ~14: a face under 100 or over 300 is ~7 sd out, so a real bias, not bad luck.
    for (const [face, n] of counts) assert.ok(n > 100 && n < 300, `face ${face} came up ${n} times in 4000`);
  });

  test("planTurn: the roll goes after your text, framed as yours; a preview keeps {{roll}} and says why", () => {
    const conv = newConversation({ title: "t", systemPrompt: "You are the GM." });
    const rolled = planTurn(conv, { content: "I haggle.", roll: { die: "d20", result: 7 } }, DEEPSEEK);
    assert.equal(rolled.player?.versions[0]!.content, "I haggle.");
    assert.deepEqual(rolled.roll?.versions[0], { content: line(7), source: "authored", createdAt: rolled.roll!.createdAt, roll: { die: "d20", result: 7 } });
    assert.equal(rolled.roll?.author.type, "player");
    assert.deepEqual(rolled.body.messages.slice(-2).map((m) => m.content), ["<!-- from: the user -->\nI haggle.", framed(7)]);
    assert.ok(!rolled.notes.includes(ROLL_PREVIEW_NOTE));

    const preview = planTurn(conv, { roll: "unrolled" }, DEEPSEEK);
    assert.equal(preview.player, null);
    assert.equal(preview.roll?.versions[0]!.roll, undefined, "nothing was rolled");
    assert.equal(preview.body.messages.at(-1)!.content, framed("{{roll}}"));
    assert.equal(preview.notes[0], ROLL_PREVIEW_NOTE);
    assert.equal(preview.refusal, undefined, "a roll is something to answer");

    // A file written before conversation.update checked the placeholder can't lose the number silently.
    assert.throws(() => rollMessage({ ...conv, templates: { ...conv.templates, roll: "I rolled." } }, { die: "d20", result: 3 }), /no \{\{roll\}\}/);
    assert.equal(rollLabel({ die: "d20", result: 14 }), "🎲 d20: 14");
  });
});

describe("dice end to end: CLI → server → mock Venice (T09)", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    t = await startTestServer();
    await createUser(t.config.dataDir, "dev-t09", "", FAST_KDF);
  });
  after(() => t.close());

  const ok = async (argv: string[]) => {
    const r = await t.cli(argv);
    assert.equal(r.code, 0, `${argv.join(" ")}\n${r.stderr}`);
    return r;
  };
  const json = async (argv: string[]) => JSON.parse((await ok([...argv, "--json"])).stdout);
  const fails = async (argv: string[], message: RegExp) => {
    const r = await t.cli(argv);
    assert.equal(r.code, 1, argv.join(" "));
    assert.match(r.stderr, message);
    return r;
  };
  const get = async (id: string) => (await json(["conversation.get", "--id", id])) as Conversation;
  const chatRequests = () => t.mock.state.requests.filter((r) => r.path === "/chat/completions");
  const lastSent = () => chatRequests()[0]?.body as ChatRequest;
  const preview = async (c: string, ...extra: string[]) => (await json(["prompt.preview", "--conversation", c, ...extra])) as { body: ChatRequest; notes: string[] };
  const rollOf = (m: LedgerMessage) => m.versions[m.activeVersion]!.roll;

  /** A GM (default, no reminder), a Dice Master (reminder on) and a Scene Painter (image, reminder off). */
  async function table() {
    await ok(["auth.login", "--username", "dev-t09", "--password", ""]);
    const conv = (await json(["conversation.create", "--title", "Dice", "--system-prompt", "You are the GM."])) as Conversation;
    const c = conv.id;
    await ok(["brain.update", "--conversation", c, "--name", "Game Master"]);
    await ok(["brain.add", "--conversation", c, "--name", "Dice Master", "--system-prompt", "You name the odds."]);
    await ok(["brain.add", "--conversation", c, "--name", "Scene Painter", "--kind", "image", "--system-prompt", "You paint.", "--no-final-reminder.enabled"]);
    return c;
  }

  test("acceptance: turn --roll prints the roll, then the reply; every brain sees it framed as a player line; preview == send but the number", async () => {
    const c = await table();
    const p = await preview(c, "--brain", "Game Master", "--content", "I talk him down to half price.", "--roll");
    assert.equal(p.notes[0], ROLL_PREVIEW_NOTE);
    assert.equal(p.body.messages.at(-1)!.content, framed("{{roll}}"));
    assert.match((await ok(["prompt.preview", "--conversation", c, "--roll"])).stdout, /Note: The d20 isn't rolled yet/);

    const r = await ok(["turn", "--conversation", c, "--brain", "Game Master", "--content", "I talk him down to half price.", "--roll"]);
    const conv = await get(c);
    const [mine, roll, reply] = conv.messages;
    const n = rollOf(roll!)!.result;
    assert.deepEqual(rollOf(roll!), { die: "d20", result: n });
    assert.equal(roll!.versions[0]!.content, line(n));
    assert.deepEqual([mine!.author.type, roll!.author.type, reply!.author.type], ["player", "player", "brain"], "your text, then your roll, then the reply");
    assert.equal(rollOf(mine!), undefined);
    // The roll is printed (stderr, so `turn > reply.md` keeps only the reply), before the brain's header and reply.
    assert.match(r.stderr, new RegExp(`^🎲 d20: ${n}\\n.*\\[Game Master\\]`, "s"));
    assert.equal(r.stdout, `${reply!.versions[0]!.content}\n`);
    assert.match(r.stdout, new RegExp(`saw 3 messages; last: "<!-- from: the user --> 🎲 I rolled a d20: \\*\\*${n}\\*\\*"`));
    // The preview was the request, but for the number it couldn't know.
    const expected = JSON.parse(JSON.stringify(p.body).replace("{{roll}}", String(n)));
    assert.deepEqual(lastSent(), expected);

    for (const brain of ["Game Master", "Dice Master", "Scene Painter"]) {
      const msgs = (await preview(c, "--brain", brain)).body.messages;
      assert.ok(msgs.some((m) => m.role === "user" && m.content === framed(n)), `${brain} sees the roll as a player line`);
    }
    const text = (await ok(["conversation.get", "--id", c])).stdout;
    assert.match(text, new RegExp(`── you · ${roll!.id} · 🎲 d20: ${n} ──\\n🎲 I rolled a d20: \\*\\*${n}\\*\\*`));
  });

  test("roll-and-send to an image brain: the roll lands, then the painter paints it", async () => {
    const c = await table();
    const r = await ok(["turn", "--conversation", c, "--brain", "Scene Painter", "--roll"]);
    const [roll, painted] = (await get(c)).messages;
    const n = rollOf(roll!)!.result;
    assert.match(r.stderr, new RegExp(`^🎲 d20: ${n}\\n`));
    assert.equal(painted!.kind, "image");
    assert.match(painted!.versions[0]!.content, /🎲 I rolled a d20/, "the mock's prompt quotes the last message: the roll");
    assert.equal(painted!.versions[0]!.image?.status, "done");
  });

  test("the honor system: a roll is an ordinary message; editing it changes what the next brain sees", async () => {
    const c = await table();
    const before = chatRequests().length;
    const added = await json(["message.roll", "--conversation", c]);
    assert.equal(chatRequests().length, before, "message.roll asks no brain");
    const n = rollOf(added.message)!.result;

    const fake = n === 20 ? 19 : 20; // an edit to the same text changes nothing, so make it a real change
    await ok(["message.edit", "--conversation", c, "--message", added.message.id, "--content", line(fake)]);
    const msgs = (await preview(c, "--brain", "Dice Master")).body.messages;
    assert.ok(msgs.some((m) => m.content === framed(fake)), "the edited roll is what the brains read");
    assert.ok(!msgs.some((m) => m.content === framed(n)), "and the rolled number is gone from every request");
    const edited = (await get(c)).messages[0]!;
    assert.deepEqual(rollOf(edited), { die: "d20", result: n }, "the die's own result is kept, for display");
    assert.match((await ok(["conversation.get", "--id", c])).stdout, new RegExp(`🎲 d20: ${n} · edited ──\\n${line(fake).replace(/\*/g, "\\*")}`));
    await ok(["message.delete", "--conversation", c, "--message", edited.id]);
    assert.equal((await get(c)).messages.length, 0);
    assert.match((await ok(["message.roll", "--conversation", c])).stdout, /^🎲 d20: \d+\nAdded m_\w+ \(your roll\)/);
  });

  test("the wording is a template: editable, checked, used from the next roll on; old files get the default", async () => {
    const c = await table();
    await fails(["conversation.update", "--id", c, "--templates.roll", "I rolled well."], /no \{\{roll\}\}/);
    await ok(["message.roll", "--conversation", c]);
    await ok(["conversation.update", "--id", c, "--templates.roll", "(I roll the d20 and get {{roll}}.)"]);
    assert.equal((await preview(c, "--roll")).body.messages.at(-1)!.content, "<!-- from: the user -->\n(I roll the d20 and get {{roll}}.)");
    await ok(["message.roll", "--conversation", c]);
    const [first, second] = (await get(c)).messages;
    assert.equal(first!.versions[0]!.content, line(rollOf(first!)!.result), "an earlier roll keeps its text");
    assert.equal(second!.versions[0]!.content, `(I roll the d20 and get ${rollOf(second!)!.result}.)`);

    // A conversation saved before T09: no roll template, schema 2. It gets the default on load.
    const file = join(t.config.dataDir, "users", "dev-t09", "conversations", `${c}.json`);
    const old = JSON.parse(readFileSync(file, "utf8"));
    old.schemaVersion = 2;
    delete old.templates.roll;
    writeFileSync(file, JSON.stringify(old));
    const loaded = await get(c);
    assert.equal(loaded.schemaVersion, SCHEMA_VERSION);
    assert.equal(loaded.templates.roll, DEFAULT_TEMPLATES.roll);
    await ok(["message.roll", "--conversation", c]);
  });

  test("failures: a refusal saves no roll; a broken reply keeps it, and the retry doesn't roll again", async () => {
    const c = await table();
    // Mock triggers are read from the last message, which is the roll's line: put them in the template.
    await ok(["conversation.update", "--id", c, "--templates.roll", "MOCK_ERROR {{roll}}"]);
    await fails(["turn", "--conversation", c, "--roll"], /mock: forced error/i);
    assert.equal((await get(c)).messages.length, 0, "refused up front: the roll was never saved, nor shown");

    await ok(["conversation.update", "--id", c, "--templates.roll", "MOCK_MIDSTREAM_ERROR {{roll}}"]);
    const r = await fails(["turn", "--conversation", c, "--roll"], /Your roll is saved; the reply isn't\. To retry, send again to Game Master with no new message and no new roll: turn --brain b_\w+ without --content or --roll/);
    assert.match(r.stderr, /^🎲 d20: \d+\n/);
    const [roll] = (await get(c)).messages;
    assert.ok(rollOf(roll!));
    await fails(["turn", "--conversation", c, "--content", "x", "--roll", "--brain", "Nobody"], /No brain "Nobody"/);
  });

  test("prompt.preview: --roll is a turn preview, not a regenerate one; campaign files keep a roll", async () => {
    const c = await table();
    await fails(["prompt.preview", "--conversation", c, "--regenerate", "--roll"], /takes no content, roll or brain/);
    await ok(["turn", "--conversation", c, "--roll"]);
    const doc = await get(c);
    const copy = await json(["conversation.import", "--campaign", JSON.stringify(doc)]);
    assert.deepEqual(rollOf((copy as Conversation).messages[0]!), rollOf(doc.messages[0]!));
    assert.equal((copy as Conversation).templates.roll, DEFAULT_TEMPLATES.roll);
  });
});
