import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { FILE_MISSING, NOT_IMPORTED } from "../src/conversations/campaign.ts";
import { DEFAULT_TEMPLATES, DEFAULT_TOOL } from "../src/conversations/defaults.ts";
import type { ChatRequest, Conversation, LedgerMessage } from "../src/conversations/types.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 };
const EXAMPLE = JSON.parse(readFileSync(new URL("../examples/dnd-tavern.json", import.meta.url), "utf8"));

describe("campaigns: the example, import, clone (T07)", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    t = await startTestServer();
    await createUser(t.config.dataDir, "dev-t07", "t07-secret", FAST_KDF);
  });
  after(() => t.close());

  const ok = async (argv: string[], stdin?: string) => {
    const r = await t.cli(argv, stdin === undefined ? {} : { stdin });
    assert.equal(r.code, 0, `${argv.join(" ")}\n${r.stderr}`);
    return r;
  };
  const json = async (argv: string[], stdin?: string) => JSON.parse((await ok([...argv, "--json"], stdin)).stdout);
  const fails = async (argv: string[], message: RegExp, stdin?: string) => {
    const r = await t.cli(argv, stdin === undefined ? {} : { stdin });
    assert.equal(r.code, 1, `${argv.join(" ")}\n${r.stdout}`);
    assert.match(r.stderr, message);
  };
  const get = async (id: string) => (await json(["conversation.get", "--id", id])) as Conversation;
  const preview = async (c: string, ...extra: string[]) => (await json(["prompt.preview", "--conversation", c, ...extra])).body as ChatRequest;
  const settled = async (c: string, id: string) => {
    const r = await t.cli(["image.follow", "--conversation", c, "--message", id, "--json"]);
    return JSON.parse(r.stdout.trim().split("\n").at(-1)!).message as LedgerMessage;
  };
  test("examples.list shows the committed example, without a login", async () => {
    const { examples } = await json(["examples.list"]);
    const ex = examples.find((e: { name: string }) => e.name === "dnd-tavern");
    assert.ok(ex, "dnd-tavern is listed");
    assert.equal(ex.error, undefined);
    assert.deepEqual(
      ex.brains.map((b: { name: string; kind: string }) => `${b.name}:${b.kind}`),
      ["Game Master:text", "Dice Master:text", "Joke Teller:text", "Scene Painter:image", "Character Portraitist:image"],
    );
    assert.deepEqual(ex.setup, ["World Bible"]);
  });

  test("import --example: the whole campaign, fresh ids, nothing spent, ready to play", async () => {
    await ok(["auth.login", "--username", "dev-t07", "--password", "t07-secret"]);
    const conv = (await json(["conversation.import", "--example", "dnd-tavern"])) as Conversation;
    assert.equal(conv.title, EXAMPLE.title);
    assert.equal(conv.spentUsd, 0);
    assert.deepEqual(conv.brains.map((b) => b.name), EXAMPLE.brains.map((b: { name: string }) => b.name));
    assert.ok(conv.brains.every((b) => /^b_[a-z0-9]{10}$/.test(b.id)), "the file's readable ids are replaced");
    const gm = conv.brains.find((b) => b.id === conv.defaultBrainId)!;
    assert.equal(gm.name, "Game Master");
    for (const [i, b] of conv.brains.entries()) {
      const src = EXAMPLE.brains[i];
      assert.equal(b.systemPrompt, src.systemPrompt, `${b.name}'s prompt is the file's, word for word`);
      assert.deepEqual(b.finalReminder, src.finalReminder);
      assert.equal(b.kind, src.kind);
      if (b.kind === "image") assert.deepEqual(b.tool, src.tool);
      assert.deepEqual(b.reasoning, { enabled: false, effort: "low" }, "reasoning off: nothing hidden");
    }
    assert.deepEqual(conv.templates, EXAMPLE.templates);
    assert.deepEqual(conv.settings.image, EXAMPLE.settings.image);
    assert.equal(conv.settings.image.hideWatermark, true);
    assert.deepEqual(conv.setup.map((s) => [s.label, s.content]), [["World Bible", EXAMPLE.setup[0].content]]);
    assert.equal(conv.messages.length, 1);
    assert.equal(conv.messages[0]!.versions[0]!.source, "authored");

    // The GM sees its opener as its own words and ends with its reminder; the Dice Master sees it framed.
    const opener = EXAMPLE.messages[0].versions[0].content;
    const gmView = await preview(conv.id, "--content", "I walk up to the hooded figure.");
    assert.deepEqual(gmView.messages.map((m) => m.role), ["system", "user", "assistant", "user", "user"]);
    assert.equal(gmView.messages[2]!.content, opener);
    assert.equal(gmView.messages[3]!.content, "<!-- from: the player -->\nI walk up to the hooded figure.");
    assert.equal(gmView.messages[4]!.content, gm.finalReminder.content);
    const dice = await preview(conv.id, "--brain", "Dice Master");
    assert.equal(dice.messages[2]!.content, `<!-- from: Game Master -->\n${opener}`);

    // And it plays: a turn, then the painter paints, and the GM sees the prompt in the example's own framing.
    await ok(["turn", "--conversation", conv.id, "--content", "I walk up to the hooded figure."]);
    await ok(["turn", "--conversation", conv.id, "--brain", "Scene Painter"]);
    const painted = (await get(conv.id)).messages.at(-1)!;
    assert.equal((await settled(conv.id, painted.id)).versions[0]!.image!.status, "done");
    const after = await preview(conv.id);
    assert.ok(after.messages.some((m) => m.content === EXAMPLE.templates.otherBrainImage.replace("{{brain}}", "Scene Painter").replace("{{prompt}}", painted.versions[0]!.content)));
    const sent = t.mock.state.requests.find((r) => r.path === "/image/generate")!.body as Record<string, unknown>;
    assert.equal(sent.hide_watermark, true);
    assert.deepEqual([sent.width, sent.height], [1024, 768]);
  });

  test("a conversation.get --json imports as a campaign (round trip); images come back as prompts to paint", async () => {
    await ok(["auth.login", "--username", "dev-t07", "--password", "t07-secret"]);
    const src = (await json(["conversation.import", "--example", "dnd-tavern", "--title", "Round trip"])) as Conversation;
    await ok(["turn", "--conversation", src.id, "--brain", "Scene Painter", "--content", "(paint the bar)"]);
    await ok(["message.regenerate", "--conversation", src.id, "--steer", "Make it stormy."]);
    const full = await get(src.id);
    await settled(src.id, full.messages.at(-1)!.id);

    const copy = (await json(["conversation.import", "--campaign", "-"], JSON.stringify(full))) as Conversation;
    assert.notEqual(copy.id, src.id);
    assert.equal(copy.title, "Round trip");
    assert.equal(copy.spentUsd, 0, "a new conversation has cost nothing yet");
    const shape = (c: Conversation) =>
      c.messages.map((m) => ({
        who: m.author.type === "player" ? "player" : c.brains.find((b) => b.id === (m.author as { brainId: string }).brainId)!.name,
        kind: m.kind,
        active: m.activeVersion,
        versions: m.versions.map((v) => [v.content, v.steer ?? null, v.source]),
      }));
    assert.deepEqual(shape(copy), shape(full), "the same ledger, every version and steer, under the new brain ids");
    assert.ok(copy.messages.every((m, i) => m.id !== full.messages[i]!.id));
    const img = copy.messages.at(-1)!.versions.map((v) => v.image!);
    assert.deepEqual(img.map((i) => [i.status, i.error]), [["error", NOT_IMPORTED], ["error", NOT_IMPORTED]]);
    assert.ok(img.every((i) => !full.messages.at(-1)!.versions.some((v) => v.image?.id === i.id)), "fresh image ids");

    // Retry paints the imported prompt.
    await ok(["image.retry", "--conversation", copy.id, "--message", copy.messages.at(-1)!.id]);
    const m = await settled(copy.id, copy.messages.at(-1)!.id);
    assert.equal(m.versions[m.activeVersion]!.image!.status, "done");

    // --without-messages: the setup only.
    const bare = (await json(["conversation.import", "--example", "dnd-tavern", "--without-messages"])) as Conversation;
    assert.equal(bare.messages.length, 0);
    assert.equal(bare.brains.length, 5);
  });

  test("clone: every brain, setup message and template; the ledger and images copied, or left out", async () => {
    await ok(["auth.login", "--username", "dev-t07", "--password", "t07-secret"]);
    const src = (await json(["conversation.import", "--example", "dnd-tavern", "--title", "D&D night"])) as Conversation;
    await ok(["turn", "--conversation", src.id, "--brain", "Character Portraitist", "--content", "(paint Tobin)"]);
    const orig = await get(src.id);
    const painted = await settled(src.id, orig.messages.at(-1)!.id);
    const origImage = painted.versions[0]!.image!;

    const clone = (await json(["conversation.clone", "--id", src.id])) as Conversation;
    assert.equal(clone.title, "D&D night (copy)");
    assert.equal(clone.spentUsd, 0);
    assert.equal(clone.messages.length, orig.messages.length);
    const cloneImage = clone.messages.at(-1)!.versions[0]!.image!;
    assert.equal(cloneImage.status, "done");
    assert.notEqual(cloneImage.id, origImage.id);
    const bytes = async (id: string) => (await t.cli(["image.get", "--id", id, "--out", `${id}.out`])).code === 0 && readFileSync(join(t.tmp, `${id}.out`));
    assert.deepEqual(await bytes(cloneImage.id), await bytes(origImage.id), "the same picture, under its own id");
    const files = readdirSync(join(t.config.dataDir, "users", "dev-t07", "images"));
    assert.ok(files.includes(`${cloneImage.id}.bin`), "an encrypted user's copy has a neutral name too");

    // Deleting the clone leaves the original's image alone.
    await ok(["conversation.delete", "--id", clone.id]);
    assert.ok(await bytes(origImage.id));

    // Pathfinder from the D&D setup: no messages; brains, setup, templates and settings as they were, all editable.
    const pf = (await json(["conversation.clone", "--id", src.id, "--title", "Pathfinder", "--without-messages"])) as Conversation;
    assert.equal(pf.title, "Pathfinder");
    assert.equal(pf.messages.length, 0);
    assert.deepEqual(pf.brains.map((b) => [b.name, b.systemPrompt]), orig.brains.map((b) => [b.name, b.systemPrompt]));
    assert.ok(pf.brains.every((b, i) => b.id !== orig.brains[i]!.id));
    assert.deepEqual(pf.setup.map((s) => s.content), orig.setup.map((s) => s.content));
    assert.deepEqual(pf.templates, orig.templates);
    await ok(["setup.update", "--conversation", pf.id, "--setup", "World Bible", "--content", "<!-- This is the World Bible. -->\nPathfinder 2e, Absalom."]);
    assert.equal((await get(src.id)).setup[0]!.content, EXAMPLE.setup[0].content, "the original is untouched");

    // An image file that has gone missing comes over as an error to retry, not as a broken picture.
    const dir = join(t.config.dataDir, "users", "dev-t07", "images");
    rmSync(join(dir, `${origImage.id}.bin`));
    const broken = (await json(["conversation.clone", "--id", src.id])) as Conversation;
    assert.deepEqual([broken.messages.at(-1)!.versions[0]!.image!.status, broken.messages.at(-1)!.versions[0]!.image!.error], ["error", FILE_MISSING]);
  });

  test("an encrypted user's imported campaign is ciphertext on disk", async () => {
    await ok(["auth.login", "--username", "dev-t07", "--password", "t07-secret"]);
    const conv = (await json(["conversation.import", "--example", "dnd-tavern"])) as Conversation;
    const raw = readFileSync(join(t.config.dataDir, "users", "dev-t07", "conversations", `${conv.id}.json`));
    assert.equal(raw.subarray(0, 6).toString(), "SSENC1");
    for (const phrase of ["Odessa Fenn", "Gilded Goat", "Dice Master", "<!-- from: the player -->"]) assert.equal(raw.indexOf(phrase), -1, phrase);
  });

  test("a bad campaign is refused with where it is wrong, and nothing is created", async () => {
    await ok(["auth.login", "--username", "dev-t07", "--password", "t07-secret"]);
    const before = (await json(["conversation.list"])).conversations.length;
    const bad = (patch: (c: any) => void) => {
      const c = structuredClone(EXAMPLE);
      patch(c);
      return JSON.stringify(c);
    };
    await fails(["conversation.import", "--campaign", "-"], /brains\.1\.systemPrompt: The system prompt can't be empty/, bad((c) => (c.brains[1].systemPrompt = "  ")));
    await fails(["conversation.import", "--campaign", "-"], /two brains are called "Game Master"/, bad((c) => (c.brains[1].name = "game master")));
    await fails(["conversation.import", "--campaign", "-"], /messages\.0\.author\.brainId: no brain has the id b_nobody/, bad((c) => (c.messages[0].author.brainId = "b_nobody")));
    await fails(["conversation.import", "--campaign", "-"], /templates\.player: .*\{\{content\}\}/, bad((c) => (c.templates.player = "<!-- from: the player -->")));
    await fails(["conversation.import", "--campaign", "-"], /Venice has no text model "nope"/, bad((c) => (c.settings.textModel = "nope")));
    await fails(["conversation.import", "--campaign", "-"], /multiples of 8/, bad((c) => (c.settings.image.width = 1001)));
    await fails(["conversation.import", "--example", "nope"], /No example "nope"\. Examples: dnd-tavern/);
    await fails(["conversation.import"], /Pass one of --example/);
    writeFileSync(join(t.tmp, "c.json"), "{not json");
    const r = await t.cli(["conversation.import", "--campaign", "@c.json"]);
    assert.equal(r.code, 2, "bad JSON is a usage error in the CLI");
    assert.equal((await json(["conversation.list"])).conversations.length, before);
  });

  test("SS_CONVERSATION stands in for --conversation in the CLI", async () => {
    await ok(["auth.login", "--username", "dev-t07", "--password", "t07-secret"]);
    const conv = (await json(["conversation.import", "--example", "dnd-tavern", "--without-messages"])) as Conversation;
    const env = { SS_CONVERSATION: conv.id };
    const r = await t.cli(["turn", "--brain", "Dice Master", "--content", "What do I roll?", "--json"], { env });
    assert.equal(r.code, 0, r.stderr);
    assert.equal((await get(conv.id)).messages.length, 2);
    const other = (await json(["conversation.create", "--system-prompt", "x"])) as Conversation;
    const p = await t.cli(["prompt.preview", "--conversation", other.id, "--json"], { env });
    assert.equal(JSON.parse(p.stdout).conversationId, other.id, "a flag still wins");
  });

  test("new conversations: accurate image framing, no watermark", async () => {
    await ok(["auth.login", "--username", "dev-t07", "--password", "t07-secret"]);
    const conv = (await json(["conversation.create", "--system-prompt", "You help."])) as Conversation;
    assert.equal(conv.settings.image.hideWatermark, true);
    assert.equal(conv.templates.otherBrainImage, DEFAULT_TEMPLATES.otherBrainImage);
    assert.doesNotMatch(DEFAULT_TEMPLATES.otherBrainImage, /now on the player's screen/);
    assert.doesNotMatch(DEFAULT_TOOL.resultContent, /now on the player's screen/);
  });
});
