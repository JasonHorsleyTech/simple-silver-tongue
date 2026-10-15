import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { SCHEMA_VERSION, type Brain, type ChatRequest, type Conversation, type LedgerMessage } from "../src/conversations/types.ts";
import { readJson, writeJson } from "../src/storage/vault.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 };
const BIBLE = "<!-- This is the World Bible. -->\nA rainy harbor town. The Drowned Lantern tavern.";
const OPENER = "Rain hammers the shutters. A hooded figure sits in the corner booth; the barkeep polishes a glass.";
const SHEET_2 = "```hidden\n**Known to the player as:** the barkeep\n**Name:** Dunmore Pike\n```";

describe("brains that make brains, pinned messages, and who said what (T16): CLI → server → mock Venice", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    t = await startTestServer({ mock: { slowDelayMs: 100 } });
    await createUser(t.config.dataDir, "dev-t16", "", FAST_KDF);
  });
  after(() => t.close());

  const ok = async (argv: string[]) => {
    const r = await t.cli(argv);
    assert.equal(r.code, 0, `${argv.join(" ")}\n${r.stderr}`);
    return r;
  };
  const json = async (argv: string[]) => JSON.parse((await ok([...argv, "--json"])).stdout);
  const fails = async (argv: string[], message: RegExp, code = 1) => {
    const r = await t.cli(argv);
    assert.equal(r.code, code, `${argv.join(" ")}\n${r.stdout}`);
    assert.match(r.stderr, message);
  };
  const get = async (id: string) => (await json(["conversation.get", "--id", id])) as Conversation;
  const brain = async (c: string, name: string) => (await get(c)).brains.find((b) => b.name === name);
  const lastSent = () => t.mock.state.requests.find((r) => r.path === "/chat/completions")?.body as ChatRequest;
  const preview = async (c: string, ...extra: string[]) => await json(["prompt.preview", "--conversation", c, ...extra]);
  const firstLines = (body: ChatRequest) => body.messages.map((m) => [m.role, m.content.split("\n")[0]]);
  const cookie = () => `ss_session=${JSON.parse(readFileSync(join(t.config.runDir, "cli-session.json"), "utf8")).token}`;
  const post = (cmd: string, body: unknown) =>
    t.app.fetch(new Request(`http://localhost/api/${cmd}`, { method: "POST", headers: { host: "localhost", "content-type": "application/json", cookie: cookie() }, body: JSON.stringify(body) }));
  const lines = async (res: Response) => (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  const login = () => ok(["auth.login", "--username", "dev-t16", "--password", ""]);

  /** The Tabletop RPG preset at the tavern: a World Bible and the GM's opener. */
  async function tavern() {
    await login();
    const conv = (await json(["conversation.import", "--preset", "tabletop-rpg", "--title", "Tavern"])) as Conversation;
    const c = conv.id;
    await ok(["setup.add", "--conversation", c, "--content", BIBLE]);
    await ok(["message.add", "--conversation", c, "--as", "Game Master", "--content", OPENER]);
    return c;
  }

  test("acceptance: the Creator's sheet makes Character 1 in the same write; its view has the sheet right after the setup", async () => {
    const c = await tavern();
    const before = await preview(c, "--brain", "Character Creator");
    assert.ok(before.notes.some((n: string) => n.includes("this reply will make a new brain, Character 1")), "the payload view says what sending will make");

    const events = await lines(await post("turn", { conversation: c, brain: "Character Creator", content: "(the hooded figure)" }));
    const types = events.map((e) => e.type);
    assert.deepEqual(types.slice(-2), ["brain_made", "done"], "the made brain comes before done");
    const made = events.at(-2).brain as Brain;
    const sheet = events.at(-1).message as LedgerMessage;
    assert.equal(made.name, "Character 1");
    assert.deepEqual(made.pins, [{ messageId: sheet.id, as: "ledger" }]);
    assert.equal(made.madeFrom, sheet.id);
    assert.deepEqual(made.reasoning, { enabled: true, effort: "low" }, "the blueprint's reasoning");
    const conv = await get(c);
    assert.deepEqual(conv.brains.find((b) => b.id === made.id), made, "saved with the message");
    const creator = conv.brains.find((b) => b.name === "Character Creator")!;
    assert.equal(creator.makes!.next, 2);
    assert.equal(made.systemPrompt, creator.makes!.blueprint.systemPrompt);
    assert.notEqual(made.color, creator.color);

    // Its first turn: its sheet right after the World Bible, not at its place; preview == send.
    const p = await preview(c, "--brain", "Character 1", "--content", "Who are you?");
    assert.deepEqual(p.pinned, [{ index: 2, messageId: sheet.id, as: "ledger" }]);
    assert.deepEqual(firstLines(p.body).slice(1, 6), [
      ["user", "<!-- This is the World Bible. -->"],
      ["user", "<!-- from: Character Creator -->"],
      ["user", "<!-- from: Game Master -->"],
      ["user", "<!-- from: the user -->"], // "(the hooded figure)"
      ["user", "<!-- from: the user -->"], // "Who are you?"
    ]);
    assert.equal(p.body.messages.filter((m: { content: string }) => m.content.includes(sheet.versions[0]!.content)).length, 1, "not sent twice");
    await ok(["turn", "--conversation", c, "--brain", "Character 1", "--content", "Who are you?"]);
    assert.deepEqual(lastSent(), p.body, "the preview is the request");

    // A second character, written by hand in the Creator's mouth, makes Character 2.
    const added = await json(["message.add", "--conversation", c, "--as", "Character Creator", "--content", SHEET_2]);
    assert.equal(added.made.name, "Character 2");
    await ok(["turn", "--conversation", c, "--brain", "Character 2", "--content", "Another ale, barkeep."]);
    // Back to the first: its own sheet at the top, its own line as assistant, Character 2's framed.
    const back = (await preview(c, "--brain", "Character 1", "--content", "I turn back to the figure.")).body as ChatRequest;
    const shape = firstLines(back);
    assert.deepEqual(shape[2], ["user", "<!-- from: Character Creator -->"]);
    assert.ok(back.messages[2]!.content.includes(sheet.versions[0]!.content), "its own sheet, at the top");
    assert.ok(shape.some(([role]) => role === "assistant"), "its own earlier line is its own");
    assert.ok(shape.some(([, line]) => line === "<!-- from: Character 2 -->"), "the barkeep's line is framed");
    assert.ok(back.messages.slice(3).some((m) => m.content.includes("Dunmore Pike")), "the barkeep's sheet is where it is in the ledger");
  });

  test("a live link: edit the sheet, re-roll it (no new brain), rename the brain (everyone's framing changes)", async () => {
    const c = await tavern();
    await ok(["turn", "--conversation", c, "--brain", "Character Creator"]);
    let conv = await get(c);
    const sheet = conv.messages.at(-1)!;
    const count = conv.brains.length;
    const pinned = async () => (await preview(c, "--brain", "Character 1", "--content", "Hi")).body.messages[2].content as string;

    await ok(["message.edit", "--conversation", c, "--message", sheet.id, "--content", "```hidden\nEDITED SHEET\n```"]);
    assert.match(await pinned(), /EDITED SHEET/);
    const rerolled = await lines(await post("message.regenerate", { conversation: c }));
    assert.ok(!rerolled.some((e) => e.type === "brain_made"), "a new version makes no brain");
    conv = await get(c);
    assert.equal(conv.brains.length, count);
    assert.equal(conv.messages.at(-1)!.activeVersion, 1);
    assert.ok(!(await pinned()).includes("EDITED SHEET"), "the pin follows the active version");
    await ok(["message.select-version", "--conversation", c, "--message", sheet.id, "--version", "1"]);
    assert.match(await pinned(), /EDITED SHEET/);

    await ok(["turn", "--conversation", c, "--brain", "Character 1", "--content", "Hello there."]);
    await ok(["brain.update", "--conversation", c, "--brain", "Character 1", "--name", "Ada"]);
    const gm = (await preview(c)).body as ChatRequest;
    assert.ok(gm.messages.some((m) => m.content.startsWith("<!-- from: Ada -->")), "every other brain sees the new name");
    // The counter only counts up: renaming Character 1 doesn't free "1", and a name taken by hand is skipped.
    await ok(["brain.add", "--conversation", c, "--name", "Character 2", "--system-prompt", "Hand-made."]);
    const next = await json(["message.add", "--conversation", c, "--as", "Character Creator", "--content", "```hidden\nthird\n```"]);
    assert.equal(next.made.name, "Character 3");
  });

  test("make a brain by hand from an old sheet, then move the old actor's line onto it (change who said it)", async () => {
    await login();
    const conv = (await json(["conversation.create", "--title", "Old campaign", "--system-prompt", "You are the GM."])) as Conversation;
    const c = conv.id;
    await ok(["brain.add", "--conversation", c, "--name", "Writer", "--system-prompt", "You write sheets."]);
    await ok(["brain.add", "--conversation", c, "--name", "Actor", "--system-prompt", "You play everyone."]);
    const sheet = await json(["message.add", "--conversation", c, "--as", "Writer", "--content", "```hidden\nAlice\n```"]);
    assert.equal(sheet.made, undefined, "a brain without the setting makes nothing");
    const line = await json(["message.add", "--conversation", c, "--as", "Actor", "--content", "**Alice:** Hello."]);

    await fails(["brain.make", "--conversation", c, "--message", sheet.message.id], /Writer doesn't make brains\. Give it the setting first/);
    await fails(["brain.update", "--conversation", c, "--brain", "Writer", "--makes.name", "Character"], /needs \{\{n\}\} where the number goes/);
    await fails(["brain.update", "--conversation", c, "--brain", "Writer", "--makes.name", "Character {{n}}"], /doesn't make brains yet\. To start, give the new brains' name pattern and system prompt/);
    const writer = (await json(["brain.update", "--conversation", c, "--brain", "Writer", "--makes.name", "Character {{n}}", "--makes.blueprint.system-prompt", "You are the person in your sheet.", "--no-makes.enabled"])) as Brain;
    assert.deepEqual(
      { ...writer.makes, blueprint: { ...writer.makes!.blueprint, finalReminder: undefined } },
      { enabled: false, name: "Character {{n}}", next: 1, pinAs: "ledger", blueprint: { kind: "text", systemPrompt: "You are the person in your sheet.", reasoning: { enabled: false, effort: "low" }, finalReminder: undefined, stop: ["<!-- from:"] } },
    );
    const made = (await json(["brain.make", "--conversation", c, "--message", sheet.message.id])).brain as Brain;
    assert.deepEqual([made.name, made.pins, made.madeFrom], ["Character 1", [{ messageId: sheet.message.id, as: "ledger" }], sheet.message.id]);
    await fails(["brain.make", "--conversation", c, "--message", sheet.message.id], /already made Character 1/);
    // Off, a new message makes nothing; brain.make (above) still used the setting.
    assert.equal((await json(["message.add", "--conversation", c, "--as", "Writer", "--content", "x"])).made, undefined);

    // The old Actor's line moves onto Alice's brain: her own assistant words now, the Actor's no more.
    const moved = await json(["message.set-author", "--conversation", c, "--message", line.message.id, "--as", "Character 1"]);
    assert.deepEqual([moved.changed, moved.from, moved.author], [true, "Actor", "Character 1"]);
    const alice = (await preview(c, "--brain", "Character 1", "--content", "Hi")).body as ChatRequest;
    assert.ok(alice.messages.some((m) => m.role === "assistant" && m.content === "**Alice:** Hello."));
    const gm = (await preview(c)).body as ChatRequest;
    assert.ok(gm.messages.some((m) => m.content === "<!-- from: Character 1 -->\n**Alice:** Hello."));
    await ok(["brain.delete", "--conversation", c, "--brain", "Actor"]); // it no longer has said anything

    // Only where it makes sense: a roll stays yours, a message with versions doesn't become yours.
    const roll = await json(["message.roll", "--conversation", c]);
    await fails(["message.set-author", "--conversation", c, "--message", roll.message.id, "--as", "Writer"], /a roll the server made for you/);
    await ok(["turn", "--conversation", c, "--brain", "Writer", "--content", "hi"]);
    const last = (await get(c)).messages.at(-1)!;
    await ok(["message.regenerate", "--conversation", c]);
    await fails(["message.set-author", "--conversation", c, "--message", last.id, "--as", "player"], /has 2 versions, and a message of yours has exactly one/);
    const mine = await json(["message.set-author", "--conversation", c, "--message", line.message.id, "--as", "player"]);
    assert.equal(mine.message.author.type, "player");
  });

  test("deleting a message: a brain made from it goes too if it never spoke; one that spoke stays and loses the pin", async () => {
    const c = await tavern();
    const a = await json(["message.add", "--conversation", c, "--as", "Character Creator", "--content", "```hidden\nfirst\n```"]);
    const b = await json(["message.add", "--conversation", c, "--as", "Character Creator", "--content", "```hidden\nsecond\n```"]);
    await ok(["brain.pin", "--conversation", c, "--brain", "Game Master", "--message", b.message.id, "--as", "system"]);
    await ok(["turn", "--conversation", c, "--brain", "Character 2", "--content", "Hello"]);

    const gone = await json(["message.delete", "--conversation", c, "--message", a.message.id]);
    assert.deepEqual(gone.brainsDeleted, [{ brainId: a.made.id, name: "Character 1" }]);
    assert.equal(await brain(c, "Character 1"), undefined);
    const kept = await ok(["message.delete", "--conversation", c, "--message", b.message.id]);
    assert.match(kept.stdout, /Character 2 \(b_[a-z0-9]+\) was made from this message and stays .* no longer has it pinned/);
    assert.match(kept.stdout, /Game Master \(b_[a-z0-9]+\) had it pinned; the pin is gone/);
    const conv = await get(c);
    assert.ok(conv.brains.every((x) => x.pins.length === 0 && x.madeFrom === undefined));

    // T16 QA-8: deleting the newest made brain's message hands its number back, so a slip leaves no gap.
    assert.equal(conv.brains.find((x) => x.name === "Character Creator")!.makes!.next, 3, "Character 1 wasn't the newest: no change");
    const slip = await json(["message.add", "--conversation", c, "--as", "Character Creator", "--content", "```hidden\nslip\n```"]);
    assert.equal(slip.made.name, "Character 3");
    await ok(["message.delete", "--conversation", c, "--message", slip.message.id]);
    const again = await json(["message.add", "--conversation", c, "--as", "Character Creator", "--content", "```hidden\nagain\n```"]);
    assert.equal(again.made.name, "Character 3", "the slip's number came back");
    await ok(["brain.delete", "--conversation", c, "--brain", "Character 3"]);
    assert.equal((await brain(c, "Character Creator"))!.makes!.next, 3, "brain.delete hands it back too");
  });

  test("triage: an image blueprint gets tool text; an id-shaped pattern is refused; the pin notes and refusals say it right", async () => {
    await login();
    const conv = (await json(["conversation.create", "--title", "Triage", "--system-prompt", "You help."])) as Conversation;
    const c = conv.id;
    // QA-2: a new image blueprint is filled like a new image brain, and its tool text can be set at once.
    const img = (await json([
      "brain.add", "--conversation", c, "--name", "ImgMaker", "--system-prompt", "x",
      "--makes.name", "Pic {{n}}", "--makes.blueprint.system-prompt", "y", "--makes.blueprint.kind", "image", "--makes.blueprint.tool.name", "paint_it",
    ])) as Brain;
    assert.equal(img.makes!.blueprint.tool!.name, "paint_it");
    assert.ok(img.makes!.blueprint.tool!.description && img.makes!.blueprint.safeMode === true && img.makes!.blueprint.shape);
    assert.match((await ok(["brain.list", "--conversation", c])).stdout, /Its tool paint_it:\n\s+description: /);
    // QA-3: names that would look like brain ids are refused when set.
    await fails(["brain.add", "--conversation", c, "--name", "IdMaker", "--system-prompt", "x", "--makes.name", "b_{{n}}", "--makes.blueprint.system-prompt", "y"], /would look like brain ids/);
    // QA-6: a pin of your own message is "(yours)".
    const mine = await json(["message.add", "--conversation", c, "--as", "player", "--content", "My note."]);
    await ok(["brain.pin", "--conversation", c, "--brain", "Assistant", "--message", mine.message.id, "--as", "assistant"]);
    const notes = (await preview(c, "--brain", "Assistant", "--content", "hi")).notes as string[];
    assert.ok(notes.some((n) => n.includes(`${mine.message.id} (yours), as the brain's own words`)), notes.join("\n"));
    // QA-9: a body that ends on a pin says so, not "its own reply".
    await ok(["brain.add", "--conversation", c, "--name", "Maker", "--system-prompt", "x", "--makes.name", "Thing {{n}}", "--makes.blueprint.system-prompt", "y", "--makes.pin-as", "assistant", "--no-makes.blueprint.final-reminder.enabled"]);
    await ok(["message.delete", "--conversation", c, "--message", mine.message.id]);
    await ok(["message.add", "--conversation", c, "--as", "Maker", "--content", "A note."]);
    await fails(["turn", "--conversation", c, "--brain", "Thing 1"], /would end with m_[a-z0-9]+, which is pinned to Thing 1 and sent as the brain's own words, its text verbatim, so there is nothing after it/);
  });

  test("generic: a Place Creator makes Place {{n}} brains; a stopped reply makes one, a failed one makes nothing", async () => {
    await login();
    const conv = (await json(["conversation.create", "--title", "Goat", "--system-prompt", "You are the GM."])) as Conversation;
    const c = conv.id;
    await ok([
      "brain.add", "--conversation", c, "--name", "Place Creator", "--system-prompt", "You describe places in a hidden note.", "--no-final-reminder.enabled",
      "--makes.name", "Place {{n}}", "--makes.blueprint.system-prompt", "You are the place in your pinned note.", "--makes.pin-as", "system",
    ]);
    await ok(["turn", "--conversation", c, "--brain", "Place Creator", "--content", "What's going on here tonight?"]);
    const place = (await brain(c, "Place 1"))!;
    assert.deepEqual(place.pins.map((p) => p.as), ["system"]);
    const view = (await preview(c, "--brain", "Place 1", "--content", "Describe yourself.")).body as ChatRequest;
    assert.deepEqual(view.messages.slice(0, 2).map((m) => m.role), ["system", "system"], "pinned as a system message, verbatim");

    const broken = await post("turn", { conversation: c, brain: "Place Creator", content: "MOCK_ERROR" });
    assert.notEqual(broken.status, 200);
    assert.equal(await brain(c, "Place 2"), undefined, "a failed reply makes nothing");

    const res = await post("turn", { conversation: c, brain: "Place Creator", content: "MOCK_SLOW a slow one" });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    while ((text.match(/"type":"delta"/g) ?? []).length < 2) text += (await reader.read()).value ?? "";
    const stop = (await (await post("generation.stop", { conversation: c })).json()) as { made?: Brain; message: LedgerMessage };
    for (let r = await reader.read(); !r.done; r = await reader.read()) text += r.value;
    assert.equal(stop.made?.name, "Place 2", "a stopped reply is a new message too");
    assert.ok(text.includes('"type":"brain_made"'));
    assert.deepEqual((await brain(c, "Place 2"))!.pins, [{ messageId: stop.message.id, as: "system" }]);

    await ok(["brain.update", "--conversation", c, "--brain", "Place Creator", "--makes", "null"]);
    assert.equal((await brain(c, "Place Creator"))!.makes, undefined);
  });

  test("campaign files: export → import and clone re-point pins and madeFrom; brain.import brings the maker, not the pins", async () => {
    const c = await tavern();
    await ok(["turn", "--conversation", c, "--brain", "Character Creator"]);
    const src = await get(c);
    const copy = (await json(["conversation.import", "--campaign", JSON.stringify(src)])) as Conversation;
    const clone = (await json(["conversation.clone", "--id", c])) as Conversation;
    for (const conv of [copy, clone]) {
      const sheet = conv.messages.at(-1)!;
      const made = conv.brains.find((b) => b.name === "Character 1")!;
      assert.notEqual(sheet.id, src.messages.at(-1)!.id, "fresh ids");
      assert.deepEqual([made.pins, made.madeFrom], [[{ messageId: sheet.id, as: "ledger" }], sheet.id]);
      assert.equal(conv.brains.find((b) => b.name === "Character Creator")!.makes!.next, 2, "the counter comes along");
    }
    const bare = (await json(["conversation.clone", "--id", c, "--without-messages"])) as Conversation;
    assert.ok(bare.brains.every((b) => b.pins.length === 0 && b.madeFrom === undefined), "no ledger, no pins");
    // T16 QA-4: and no brains made from it; the maker counts from 1 again.
    assert.deepEqual(bare.brains.map((b) => b.name), src.brains.filter((b) => !b.madeFrom).map((b) => b.name));
    assert.equal(bare.brains.find((b) => b.name === "Character Creator")!.makes!.next, 1);
    const bareImport = (await json(["conversation.import", "--campaign", JSON.stringify(src), "--without-messages"])) as Conversation;
    assert.equal(bareImport.brains.some((b) => b.name === "Character 1"), false);
    const bad = structuredClone(src) as unknown as { brains: Array<{ pins: Array<{ messageId: string }> }> };
    bad.brains.at(-1)!.pins[0]!.messageId = "m_nowhere";
    await fails(["conversation.import", "--campaign", JSON.stringify(bad)], /brains\.6\.pins\.0\.messageId: no message has the id m_nowhere/);

    const other = (await json(["conversation.create", "--title", "Elsewhere", "--system-prompt", "x"])) as Conversation;
    const imp = await json(["brain.import", "--conversation", other.id, "--preset", "tabletop-rpg", "--brain", "Character Creator"]);
    assert.equal(imp.brain.makes.name, "Character {{n}}");
    assert.ok(imp.notes.some((n: string) => n.includes('makes a brain from each new message ("Character {{n}}"')));
  });

  test("a file from before T16 (schema 5) loads with no pins and no maker", async () => {
    const c = await tavern();
    const vault = { dir: join(t.config.dataDir, "users", "dev-t16"), key: null };
    const file = `conversations/${c}.json`;
    const old = (await readJson<Conversation>(vault, file))!;
    old.schemaVersion = 5;
    for (const b of old.brains as Array<Partial<Brain>>) {
      delete b.pins;
      delete b.makes;
    }
    await writeJson(vault, file, old);
    const loaded = await get(c);
    assert.equal(loaded.schemaVersion, SCHEMA_VERSION);
    assert.ok(loaded.brains.every((b) => Array.isArray(b.pins) && b.pins.length === 0 && b.makes === undefined));
    await ok(["turn", "--conversation", c, "--content", "Hello"]);
  });
});
