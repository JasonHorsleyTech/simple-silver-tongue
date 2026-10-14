import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { DEFAULT_TEMPLATES, defaultStop } from "../src/conversations/defaults.ts";
import type { Brain, ChatRequest, Conversation } from "../src/conversations/types.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 };
const PRESET = JSON.parse(readFileSync(new URL("../presets/tabletop-rpg.json", import.meta.url), "utf8"));
const EXAMPLE = JSON.parse(readFileSync(new URL("../examples/dnd-tavern.json", import.meta.url), "utf8"));
const SEVEN = ["Game Master", "Co-GM", "Show Me the Odds", "Character Creator", "Character Actor", "Scene Painter", "Character Portraitist"];

/** What brain.import must bring over: the whole brain as its file has it (T10). */
const brainOf = (b: Brain) => ({ kind: b.kind, systemPrompt: b.systemPrompt, finalReminder: b.finalReminder, reasoning: b.reasoning, stop: b.stop, safeMode: b.safeMode, tool: b.tool });
const fileBrain = (b: Record<string, unknown>) => ({
  kind: b.kind,
  systemPrompt: b.systemPrompt,
  finalReminder: b.finalReminder,
  reasoning: b.reasoning ?? { enabled: false, effort: "low" },
  stop: b.stop ?? defaultStop(b.kind as Brain["kind"]),
  safeMode: b.safeMode,
  tool: b.tool,
});

describe("presets: list, start one, add one of its brains (T10)", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    t = await startTestServer();
    await createUser(t.config.dataDir, "dev-t10", "t10-secret", FAST_KDF);
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
    assert.equal(r.code, 1, `${argv.join(" ")}\n${r.stdout}`);
    assert.match(r.stderr, message);
  };
  const get = async (id: string) => (await json(["conversation.get", "--id", id])) as Conversation;
  const login = () => ok(["auth.login", "--username", "dev-t10", "--password", "t10-secret"]);

  test("presets.list shows the Tabletop RPG preset, each brain with its job, without a login", async () => {
    const { presets } = await json(["presets.list"]);
    const p = presets.find((x: { name: string }) => x.name === "tabletop-rpg");
    assert.ok(p, "tabletop-rpg is listed");
    assert.equal(p.error, undefined);
    assert.equal(p.title, "Tabletop RPG");
    assert.deepEqual(p.brains.map((b: { name: string }) => b.name), SEVEN);
    assert.deepEqual(p.brains.map((b: { kind: string }) => b.kind), ["text", "text", "text", "text", "text", "image", "image"]);
    assert.ok(p.brains.every((b: { about?: string; color?: string }) => b.about && /^#[0-9a-f]{6}$/i.test(b.color ?? "")), "a line on each brain's job, and its badge color");
    // Reasoning is a labeled opt-in: the list says which brain the preset switches it on for (T10 frontend: the badges).
    assert.deepEqual(
      p.brains.filter((b: { reasoning?: string }) => b.reasoning).map((b: { name: string; reasoning: string }) => [b.name, b.reasoning]),
      [["Character Actor", "low"]],
    );
    assert.equal(p.setup, undefined, "a preset has no setup to list");
    const text = (await ok(["presets.list"])).stdout;
    assert.match(text, /conversation\.import --preset tabletop-rpg/);
    assert.match(text, /brain\.import --conversation c_\.\.\. --preset tabletop-rpg/);

    // The examples' brains say what they do too, for the browser's "add a brain" picker.
    const { examples } = await json(["examples.list"]);
    assert.ok(examples.find((e: { name: string }) => e.name === "dnd-tavern").brains.every((b: { about?: string }) => b.about));
  });

  test('"Chinatown" from the preset: seven brains as the file has them, no setup, no messages, then a World Bible', async () => {
    await login();
    const started = await ok(["conversation.import", "--preset", "tabletop-rpg", "--title", "Chinatown"]);
    assert.match(started.stdout, /Setup: none · 0 messages/);
    assert.match(started.stdout, /No World Bible yet: write one before you play/, "it points at the World Bible");
    const id = started.stdout.match(/Imported (c_[a-z0-9]+)/)![1]!;
    const conv = await get(id);
    assert.equal(conv.title, "Chinatown");
    assert.deepEqual(conv.brains.map((b) => b.name), SEVEN);
    assert.equal(conv.setup.length, 0);
    assert.equal(conv.messages.length, 0);
    assert.equal(conv.brains.find((b) => b.id === conv.defaultBrainId)!.name, "Game Master");
    assert.deepEqual(conv.templates, DEFAULT_TEMPLATES, "a preset uses the default templates, so its brains read any conversation alike");
    for (const [i, b] of conv.brains.entries()) {
      assert.deepEqual(brainOf(b), fileBrain(PRESET.brains[i]), `${b.name} is the file's, word for word`);
      assert.equal((b as Brain & { about?: string }).about, undefined, "the about line is for lists, not stored");
    }

    // The rules every brain shares (TICKETS.md T10): text brains keep the framing stop sequence; image prompts are captions.
    for (const b of conv.brains) {
      assert.ok(b.systemPrompt.includes("```hidden"), `${b.name} knows the hidden-note convention`);
      assert.ok(b.finalReminder.enabled && b.finalReminder.content.trim(), `${b.name}'s reminder is on`);
      assert.doesNotMatch(b.systemPrompt, /Gilded Goat|Millbrook|D&D|Dungeons/, `${b.name} is genre-free`);
      if (b.kind === "text") assert.deepEqual(b.stop, ["<!-- from:"]);
      else {
        assert.deepEqual(b.stop, []);
        assert.equal(b.safeMode, true);
        assert.match(b.tool!.description, /caption/);
        assert.match(b.systemPrompt, /caption/);
      }
    }
    const actor = conv.brains.find((b) => b.name === "Character Actor")!;
    assert.deepEqual(actor.reasoning, { enabled: true, effort: "low" }, "the Actor thinks first (chosen on live evidence; reports/T10-engineer.md)");
    assert.ok(conv.brains.filter((b) => b !== actor).every((b) => !b.reasoning.enabled), "every other brain: reasoning off");

    // Write the World Bible, and every brain reads it right after its system prompt.
    await ok(["setup.add", "--conversation", id, "--content", "<!-- This is the World Bible. -->\nLos Angeles, 1938."]);
    const body = (await json(["prompt.preview", "--conversation", id, "--brain", "Show Me the Odds", "--content", "I try to talk him down to half price."])).body as ChatRequest;
    assert.deepEqual(body.messages.map((m) => m.role), ["system", "user", "user", "user"]);
    assert.match(body.messages[1]!.content as string, /Los Angeles, 1938/);
    assert.equal(body.messages[3]!.content, conv.brains.find((b) => b.name === "Show Me the Odds")!.finalReminder.content);

    // And it plays (mock): the GM, the Creator's hidden note, an image brain.
    await ok(["turn", "--conversation", id, "--content", "I approach the hooded figure."]);
    await ok(["turn", "--conversation", id, "--brain", "Character Portraitist"]);
    assert.equal((await get(id)).messages.length, 3);
  });

  test("brain.import: the Character Actor joins a clone of the Gilded Goat, whole; twice is a 409 until renamed", async () => {
    await login();
    const goat = (await json(["conversation.import", "--example", "dnd-tavern"])) as Conversation;
    const clone = (await json(["conversation.clone", "--id", goat.id, "--title", "Goat with an actor"])) as Conversation;
    const before = clone.brains.length;

    const added = await json(["brain.import", "--conversation", clone.id, "--preset", "tabletop-rpg", "--brain", "character actor"]);
    assert.equal(added.brain.name, "Character Actor", "found by name, ignoring case; added under the file's spelling");
    assert.deepEqual(brainOf(added.brain), fileBrain(PRESET.brains[4]), "the whole brain: prompt, reminder, kind, reasoning, stop");
    assert.deepEqual(added.from, { preset: "tabletop-rpg", title: "Tabletop RPG" });
    assert.match(added.notes.join(" "), /keeps its own templates, which differ/, "it says what it left behind: the Goat frames messages its own way");
    assert.match(added.notes.join(" "), /can't read the other brains' system prompts/, "T10 QA-3: the Goat keeps its secrets in its GM's prompt, which the Actor can't see");
    let conv = await get(clone.id);
    assert.equal(conv.brains.length, before + 1);
    assert.notEqual(conv.defaultBrainId, added.brain.id, "never the default");
    assert.equal(new Set(conv.brains.map((b) => b.color)).size, conv.brains.length, "a color no brain here has");

    const again = await t.cli(["brain.import", "--conversation", clone.id, "--preset", "tabletop-rpg", "--brain", "Character Actor"]);
    assert.equal(again.code, 1);
    assert.match(again.stderr, /Another brain is already called "Character Actor"\. Add this one under another name with --name/);
    assert.equal((await get(clone.id)).brains.length, before + 1, "nothing added");

    const renamed = await json(["brain.import", "--conversation", clone.id, "--preset", "tabletop-rpg", "--brain", "Character Actor", "--name", "Second Actor"]);
    assert.equal(renamed.brain.name, "Second Actor");
    assert.equal(renamed.brain.systemPrompt, added.brain.systemPrompt);
    assert.notEqual(renamed.brain.id, added.brain.id);
    conv = await get(clone.id);
    assert.deepEqual(conv.brains.slice(-2).map((b) => b.name), ["Character Actor", "Second Actor"]);
    // The rename clashes like any name.
    await fails(["brain.import", "--conversation", clone.id, "--preset", "tabletop-rpg", "--brain", "Character Actor", "--name", "dice master"], /Another brain is already called "Dice Master"\.$/m);

    // It works like any brain: it sees the whole ledger, framed in the Goat's own templates.
    const view = (await json(["prompt.preview", "--conversation", clone.id, "--brain", "Character Actor", "--content", "Who are you?"])).body as ChatRequest;
    assert.equal(view.messages[0]!.content, PRESET.brains[4].systemPrompt);
    assert.match(view.messages.at(-2)!.content as string, /^<!-- from: the player -->\nWho are you\?$/);
    assert.equal(view.reasoning_effort, "low");
  });

  test("brain.import from an example: the Dice Master joins a preset conversation, and says where it came from", async () => {
    await login();
    const conv = (await json(["conversation.import", "--preset", "tabletop-rpg", "--title", "Noir with dice"])) as Conversation;
    const r = await json(["brain.import", "--conversation", conv.id, "--example", "dnd-tavern", "--brain", "Dice Master"]);
    const src = EXAMPLE.brains.find((b: { name: string }) => b.name === "Dice Master");
    assert.deepEqual(brainOf(r.brain), fileBrain(src));
    assert.match(r.brain.systemPrompt, /You never roll/, "T10: the Goat's Dice Master no longer rolls for the player");
    assert.deepEqual(r.from, { example: "dnd-tavern", title: EXAMPLE.title });
    assert.equal(r.notes.length, 2, "templates differ, and it was written for another campaign");
    assert.match(r.notes[1], /written for "The Gilded Goat/);
    // The preset has a Scene Painter of its own, so the Goat's comes in under another name.
    const text = (await ok(["brain.import", "--conversation", conv.id, "--example", "dnd-tavern", "--brain", "Scene Painter", "--name", "Tavern Painter"])).stdout;
    assert.match(text, /^Added brain Tavern Painter \(b_[a-z0-9]+\) · image .* from the example "The Gilded Goat \(D&D 5e\)"\./);
    const painter = (await get(conv.id)).brains.at(-1)!;
    assert.deepEqual(painter.tool, EXAMPLE.brains.find((b: { name: string }) => b.name === "Scene Painter").tool, "an image brain's tool text comes along");
  });

  test("brain.import refuses what it can't do, and changes nothing", async () => {
    await login();
    const conv = (await json(["conversation.import", "--preset", "tabletop-rpg"])) as Conversation;
    assert.equal(conv.title, "Tabletop RPG", "no --title: the preset's");
    const c = conv.id;
    await fails(["brain.import", "--conversation", c, "--preset", "tabletop-rpg", "--brain", "Bard"], /has no brain called "Bard"\. Its brains: Game Master, Co-GM/);
    await fails(["brain.import", "--conversation", c, "--preset", "nope", "--brain", "Co-GM"], /No preset "nope"\. Presets: tabletop-rpg/);
    await fails(["brain.import", "--conversation", c, "--preset", "../examples/dnd-tavern", "--brain", "Co-GM"], /Preset names are lowercase letters/);
    await fails(["brain.import", "--conversation", c, "--brain", "Co-GM"], /Pass one of --preset/);
    await fails(["brain.import", "--conversation", c, "--preset", "tabletop-rpg", "--example", "dnd-tavern", "--brain", "Co-GM"], /Pass one of --preset/);
    await fails(["brain.import", "--conversation", c, "--preset", "tabletop-rpg", "--brain", "Co-GM", "--name", "player"], /reserved/);
    await fails(["conversation.import", "--preset", "tabletop-rpg", "--example", "dnd-tavern"], /Pass one of --example/);
    assert.equal((await get(c)).brains.length, 7);
    // Into a conversation of the same preset: same templates, and every brain knows hidden notes, so nothing to say.
    const spare = await json(["brain.import", "--conversation", c, "--preset", "tabletop-rpg", "--brain", "Co-GM", "--name", "Spare Co-GM"]);
    assert.deepEqual(spare.notes, []);
  });
});
