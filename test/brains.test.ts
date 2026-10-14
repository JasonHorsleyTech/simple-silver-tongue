import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { REMINDER_EXAMPLE } from "../src/conversations/defaults.ts";
import type { Brain, ChatRequest, Conversation } from "../src/conversations/types.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 };
const BIBLE = "<!-- This is the World Bible. -->\nThe Gilded Goat is a smoky tavern. A hooded figure sits by the fire.";
const OPENER = "Rain hammers the shutters. By the fire, a hooded figure turns a coin over and over.";
const DICE_REMINDER = "<!-- System reminder -->\nOnly call for checks and roll dice. Never narrate.";

describe("multiple brains, setup messages and hand-written lines: CLI → server → mock Venice (T04)", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    // A MOCK_SLOW echo is ~15 words: at 100 ms a word, the lock test has ~1.5 s to make its checks.
    t = await startTestServer({ mock: { slowDelayMs: 100 } });
    await createUser(t.config.dataDir, "dev-t04", "", FAST_KDF);
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
  };
  const get = async (id: string) => (await json(["conversation.get", "--id", id])) as Conversation;
  const lastSent = () => t.mock.state.requests.find((r) => r.path === "/chat/completions")?.body as ChatRequest;
  const preview = async (c: string, ...extra: string[]) => (await json(["prompt.preview", "--conversation", c, ...extra])).body as ChatRequest;
  const reply = async (c: string, i: number) => (await get(c)).messages[i]!.versions[0]!.content;
  const user = (content: string) => ({ role: "user", content });
  const assistant = (content: string) => ({ role: "assistant", content });

  /** The acceptance table: a GM (default), a World Bible, a hand-written GM opener and a Dice Master with a reminder. */
  async function dnd() {
    await ok(["auth.login", "--username", "dev-t04", "--password", ""]);
    const conv = (await json(["conversation.create", "--title", "Gilded Goat", "--system-prompt", "You are the GM."])) as Conversation;
    const c = conv.id;
    await ok(["brain.update", "--conversation", c, "--name", "Game Master"]);
    const added = await json(["setup.add", "--conversation", c]);
    assert.deepEqual(added.setup.map((s: { label: string; content: string }) => [s.label, s.content]), [["World Bible", "<!-- This is the World Bible. -->"]], "pre-filled");
    await ok(["setup.update", "--conversation", c, "--setup", "world bible", "--content", BIBLE]);
    await ok(["message.add", "--conversation", c, "--as", "Game Master", "--content", OPENER]);
    const dice = (await json(["brain.add", "--conversation", c, "--name", "Dice Master", "--system-prompt", "You roll dice."])) as Brain;
    assert.deepEqual(dice.finalReminder, { enabled: true, content: REMINDER_EXAMPLE }, "a new brain's reminder is on and pre-filled");
    await ok(["brain.update", "--conversation", c, "--brain", dice.id, "--final-reminder.content", DICE_REMINDER]);
    return { c, gm: conv.brains[0]!, dice };
  }

  test("acceptance: player → GM → player → Dice Master → player → GM, then each brain's own view of the ledger", async () => {
    const { c, gm, dice } = await dnd();
    await ok(["turn", "--conversation", c, "--content", "I sit by the figure."]);
    await ok(["turn", "--conversation", c, "--brain", "Dice Master", "--content", "I read its intentions."]);
    await ok(["turn", "--conversation", c, "--brain", gm.id, "--content", "I order two ales."]);
    const [gm1, dm1, gm2] = [await reply(c, 2), await reply(c, 4), await reply(c, 6)];
    assert.match(dm1, /^MOCK reply to brain "You roll dice\."/, "the Dice Master answered");

    // Dice Master: its own prompt, the World Bible, GM lines framed, player lines framed, its own reply as assistant, its reminder last.
    assert.deepEqual((await preview(c, "--brain", "Dice Master")).messages, [
      { role: "system", content: "You roll dice." },
      user(BIBLE),
      user(`<!-- from: Game Master -->\n${OPENER}`),
      user("<!-- from: the user -->\nI sit by the figure."),
      user(`<!-- from: Game Master -->\n${gm1}`),
      user("<!-- from: the user -->\nI read its intentions."),
      assistant(dm1),
      user("<!-- from: the user -->\nI order two ales."),
      user(`<!-- from: Game Master -->\n${gm2}`),
      user(DICE_REMINDER),
    ]);
    // Game Master: the Dice Master's line framed, its own lines (the hand-written opener too) as assistant, no reminder.
    const gmView = await json(["prompt.preview", "--conversation", c, "--brain", "Game Master"]);
    assert.deepEqual(gmView.body.messages, [
      { role: "system", content: "You are the GM." },
      user(BIBLE),
      assistant(OPENER),
      user("<!-- from: the user -->\nI sit by the figure."),
      assistant(gm1),
      user("<!-- from: the user -->\nI read its intentions."),
      user(`<!-- from: Dice Master -->\n${dm1}`),
      user("<!-- from: the user -->\nI order two ales."),
      assistant(gm2),
    ]);
    assert.match(gmView.refusal, /last message is Game Master's own reply/, "the GM has nothing new to answer");

    // The Dice Master's empty-content turn is exactly its preview: a brain just responds.
    const want = await preview(c, "--brain", dice.id);
    await ok(["turn", "--conversation", c, "--brain", "dice master"]);
    assert.deepEqual(lastSent(), want, "preview --brain is the request");
    assert.equal((await get(c)).messages.length, 8, "no player message for an empty turn");

    // Its latest reply regenerates in its own brain, with its reminder before the steer.
    const steered = await preview(c, "--regenerate", "--steer", "Roll a 1.");
    assert.equal(steered.messages[0]!.content, "You roll dice.");
    assert.deepEqual(steered.messages.slice(-2).map((m) => m.content.split("\n")[0]), ["<!-- System reminder -->", "<!-- Behind-the-scenes direction from the user. This is not part of the conversation. Write your previous response again, following this direction: -->"]);
    const regen = await ok(["message.regenerate", "--conversation", c, "--steer", "Roll a 1."]);
    assert.match(regen.stderr, /\[Dice Master · version 2\/2 · steered/);
    assert.deepEqual(lastSent(), steered);
  });

  test("editing a GM line changes what the Dice Master sees; a third brain and a new GM prompt work mid-game", async () => {
    const { c, gm } = await dnd();
    await ok(["turn", "--conversation", c, "--content", "I sit."]);
    const opener = (await get(c)).messages[0]!;
    await ok(["message.edit", "--conversation", c, "--message", opener.id, "--content", "EDITED: Thunder rolls."]);
    assert.deepEqual((await preview(c, "--brain", "Dice Master")).messages[2], user("<!-- from: Game Master -->\nEDITED: Thunder rolls."));
    assert.deepEqual((await preview(c, "--brain", "Game Master")).messages[2], assistant("EDITED: Thunder rolls."));

    const jester = (await json(["brain.add", "--conversation", c, "--name", "Joke Teller", "--system-prompt", "You tell jokes."])) as Brain;
    assert.notEqual(jester.color, gm.color, "a new brain gets an unused badge color");
    const jokes = await preview(c, "--brain", "Joke Teller");
    assert.deepEqual(jokes.messages.map((m) => m.role), ["system", "user", "user", "user", "user", "user"], "everyone else's lines are framed for a newcomer");
    assert.deepEqual(jokes.messages.at(-1), user(REMINDER_EXAMPLE));
    await ok(["turn", "--conversation", c, "--brain", "Joke Teller"]);
    assert.deepEqual(lastSent(), jokes);

    await ok(["brain.update", "--conversation", c, "--brain", "Game Master", "--system-prompt", "You are the GM, now grim."]);
    await ok(["turn", "--conversation", c, "--content", "I drink."]);
    assert.equal(lastSent().messages[0]!.content, "You are the GM, now grim.");
    assert.deepEqual(lastSent().messages.at(-2), user(`<!-- from: Joke Teller -->\n${await reply(c, 3)}`));

    // Setup messages: add first, move, delete. Every brain gets them in this order, right after its system prompt.
    await ok(["setup.add", "--conversation", c, "--label", "House rules", "--content", "Keep it short.", "--position", "1"]);
    assert.deepEqual((await preview(c, "--brain", "Dice Master", "--content", "x")).messages.slice(1, 3), [user("Keep it short."), user("<!-- This is the World Bible. -->\nThe Gilded Goat is a smoky tavern. A hooded figure sits by the fire.")]);
    await ok(["setup.move", "--conversation", c, "--setup", "house rules", "--position", "2"]);
    assert.deepEqual((await preview(c, "--content", "x")).messages[2], user("Keep it short."));
    await fails(["setup.move", "--conversation", c, "--setup", "house rules", "--position", "3"], /Position 3 is past the end: there are 2 places/);
    await ok(["setup.delete", "--conversation", c, "--setup", "House rules"]);
    assert.deepEqual((await get(c)).setup.map((s) => s.label), ["World Bible"]);
    await fails(["setup.update", "--conversation", c, "--setup", "Module", "--content", "x"], /No setup message "Module".*World Bible \(s_/);
  });

  test("brain rules: a brain that has spoken, or the default, can't be deleted; kind locks once it has messages; names are unique", async () => {
    const { c, gm, dice } = await dnd();
    await ok(["turn", "--conversation", c, "--brain", "Dice Master", "--content", "I roll."]);
    await fails(["brain.delete", "--conversation", c, "--brain", "Dice Master"], /Dice Master has 1 message in this conversation, so it can't be deleted/);
    await fails(["brain.delete", "--conversation", c, "--brain", gm.id], /Game Master is the default brain\. Make another brain the default first/);
    await fails(["brain.update", "--conversation", c, "--brain", dice.id, "--kind", "image"], /Dice Master has 1 message, so it stays a text brain/);
    await fails(["brain.add", "--conversation", c, "--name", "DICE MASTER", "--system-prompt", "x"], /already called "Dice Master"/);
    await fails(["brain.add", "--conversation", c, "--name", "player", "--system-prompt", "x"], /reserved/);
    await fails(["brain.add", "--conversation", c, "--name", "Bard", "--system-prompt", "  "], /system prompt can't be empty/);
    await fails(["turn", "--conversation", c, "--brain", "Bard", "--content", "x"], /No brain "Bard".*Game Master, Dice Master/);

    // An unused brain: change its kind both ways, make it the default and back, then delete it.
    const painter = (await json(["brain.add", "--conversation", c, "--name", "Painter", "--kind", "image", "--system-prompt", "You paint."])) as Brain;
    assert.equal(painter.safeMode, true);
    assert.equal(painter.tool?.name, "generate_image");
    const body = await preview(c, "--brain", "Painter");
    assert.deepEqual(body.tool_choice, { type: "function", function: { name: "generate_image" } });
    const asText = (await json(["brain.update", "--conversation", c, "--brain", "Painter", "--kind", "text"])) as Brain;
    assert.equal(asText.kind, "text");
    await fails(["brain.update", "--conversation", c, "--brain", "Painter", "--safe-mode"], /for image brains/);
    await ok(["brain.set-default", "--conversation", c, "--brain", "Painter"]);
    assert.equal((await get(c)).defaultBrainId, painter.id);
    await ok(["brain.set-default", "--conversation", c, "--brain", "game master"]);
    await ok(["brain.delete", "--conversation", c, "--brain", painter.id]);
    assert.deepEqual((await get(c)).brains.map((b) => b.name), ["Game Master", "Dice Master"]);

    // message.add: your own line, or words in a brain's mouth; never blank.
    const mine = await json(["message.add", "--conversation", c, "--as", "player", "--content", "I wait."]);
    assert.deepEqual([mine.message.author, mine.message.versions[0].source], [{ type: "player" }, "authored"]);
    await fails(["message.add", "--conversation", c, "--as", "player", "--content", " "], /message can't be empty/);
    await fails(["message.add", "--conversation", c, "--as", "Nobody", "--content", "x"], /No brain "Nobody"/);
  });

  test("a broken reply's retry names the brain that failed, in the text and as details.retry (T04 QA-1)", async () => {
    const { c, dice } = await dnd();
    await ok(["brain.update", "--conversation", c, "--brain", dice.id, "--final-reminder.content", "MOCK_MIDSTREAM_ERROR"]);
    const r = await t.cli(["turn", "--conversation", c, "--brain", "Dice Master", "--content", "I read her intentions.", "--json"]);
    assert.equal(r.code, 1);
    const end = JSON.parse(r.stdout.trim().split("\n").at(-1)!);
    assert.equal(end.type, "error");
    assert.match(end.error.message, new RegExp(`send again to Dice Master with no new message: turn --brain ${dice.id} without --content`));
    assert.deepEqual(end.error.details.retry, { command: "turn", args: { conversation: c, brain: dice.id } });
    // Replaying it reaches the Dice Master, not the default brain.
    assert.equal((await json(["prompt.preview", "--conversation", c, "--brain", end.error.details.retry.args.brain])).brainName, "Dice Master");

    // A regenerate's retry is the same message with the same steer.
    await ok(["brain.update", "--conversation", c, "--brain", dice.id, "--final-reminder.content", DICE_REMINDER]);
    await ok(["turn", "--conversation", c, "--brain", "Dice Master"]);
    const last = (await get(c)).messages.at(-1)!.id;
    const g = await t.cli(["message.regenerate", "--conversation", c, "--steer", "MOCK_MIDSTREAM_ERROR roll again", "--json"]);
    assert.equal(g.code, 1);
    const gEnd = JSON.parse(g.stdout.trim().split("\n").at(-1)!);
    assert.deepEqual(gEnd.error.details.retry, { command: "message.regenerate", args: { conversation: c, message: last, steer: "MOCK_MIDSTREAM_ERROR roll again" } });
  });

  test("names and refs: a brain name is one line of visible text; a blank --as or --brain is refused, not the default (T04 QA-2, QA-3)", async () => {
    const { c } = await dnd();
    for (const bad of ["Line\nBreak", "Tab\there", "\u200b", "\u200b\u200d"]) {
      await fails(["brain.add", "--conversation", c, "--name", bad, "--system-prompt", "x"], /one line|visible character/);
    }
    await fails(["brain.update", "--conversation", c, "--brain", "Dice Master", "--name", "Dice\nMaster"], /one line/);
    await ok(["brain.add", "--conversation", c, "--name", "Bard 🎲", "--system-prompt", "x"]);
    const before = (await get(c)).messages.length;
    await fails(["message.add", "--conversation", c, "--as", "   ", "--content", "Who said this?"], /Say who wrote it/);
    await fails(["turn", "--conversation", c, "--brain", " ", "--content", "x"], /blank brain names no one/);
    await fails(["brain.delete", "--conversation", c, "--brain", " "], /blank brain names no one/);
    assert.equal((await get(c)).messages.length, before, "nothing was added");
  });

  test("while a brain writes a reply, it can't be deleted or change kind, and nothing can be added to the ledger; other brains can go", async () => {
    const { c } = await dnd();
    // No reminder, so the mock sees MOCK_SLOW in the last message.
    await ok(["brain.add", "--conversation", c, "--name", "Bard", "--system-prompt", "You sing.", "--no-final-reminder.enabled"]);
    await ok(["brain.add", "--conversation", c, "--name", "Spare", "--system-prompt", "Unused."]);
    const running = t.cli(["turn", "--conversation", c, "--brain", "Bard", "--content", "MOCK_SLOW sing"]);
    for (let i = 0; i < 200 && !t.mock.state.requests.some((r) => r.path === "/chat/completions" && JSON.stringify(r.body).includes("MOCK_SLOW sing")); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await fails(["brain.delete", "--conversation", c, "--brain", "Bard"], /Can't delete Bard: Bard is writing a reply right now/);
    await fails(["brain.update", "--conversation", c, "--brain", "Bard", "--kind", "image"], /Can't change the kind of Bard/);
    await fails(["message.add", "--conversation", c, "--as", "player", "--content", "x"], /busy/);
    await ok(["brain.delete", "--conversation", c, "--brain", "Spare"]);
    await ok(["brain.update", "--conversation", c, "--brain", "Bard", "--system-prompt", "You sing badly."]);
    assert.equal((await running).code, 0);
    const conv = await get(c);
    assert.equal(conv.messages.at(-1)?.author.type === "brain" && conv.brains.find((b) => b.id === (conv.messages.at(-1)!.author as { brainId: string }).brainId)?.name, "Bard");
    await fails(["brain.delete", "--conversation", c, "--brain", "Bard"], /Bard has 1 message/);
  });
});
