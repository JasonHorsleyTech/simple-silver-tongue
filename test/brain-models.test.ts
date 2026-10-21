import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Brain, ChatRequest, Conversation, ImageRequest, LedgerMessage } from "../src/conversations/types.ts";
import { alwaysReasonsNote, REASONING_NOTE } from "../src/conversations/wording.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

/**
 * T18: a model per brain. A brain may name its own text model (an image brain its own image model too); absent means
 * the conversation's. Everything that depends on the model follows the brain's: the request's `model`, the reasoning
 * fields and notes, the painter's sizing and price, the model recorded on each version and image.
 */
describe("a model per brain (T18)", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    t = await startTestServer();
    await createUser(t.config.dataDir, "dev-t18", "", { N: 2 ** 10, r: 8, p: 1 });
  });
  after(() => t.close());

  const ok = async (argv: string[], stdin?: string) => {
    const r = await t.cli(argv, stdin === undefined ? {} : { stdin });
    assert.equal(r.code, 0, `${argv.join(" ")}\n${r.stderr}`);
    return r;
  };
  const json = async (argv: string[], stdin?: string) => JSON.parse((await ok([...argv, "--json"], stdin)).stdout);
  const events = async (argv: string[]) => (await ok([...argv, "--json"])).stdout.trim().split("\n").map((l) => JSON.parse(l)) as Array<{ type: string; [k: string]: any }>;
  const get = async (id: string) => (await json(["conversation.get", "--id", id])) as Conversation;
  const sent = (path: string) => t.mock.state.requests.find((r) => r.path === path)?.body;
  const preview = (c: string, ...rest: string[]) => json(["prompt.preview", "--conversation", c, ...rest]);
  const settled = async (c: string, id: string) => (await events(["image.follow", "--conversation", c, "--message", id])).at(-1)!.message as LedgerMessage;

  /** The default brain (Game Master) on the conversation's model, and a Co-GM on a model of its own. */
  async function table() {
    await ok(["auth.login", "--username", "dev-t18", "--password", ""]);
    const conv = (await json(["conversation.create", "--title", "Two models", "--system-prompt", "You are the GM."])) as Conversation;
    await ok(["brain.update", "--conversation", conv.id, "--name", "Game Master"]);
    const co = (await json(["brain.add", "--conversation", conv.id, "--name", "Co-GM", "--system-prompt", "You answer questions.", "--text-model", "venice-uncensored-1-2"])) as Brain;
    return { c: conv.id, co };
  }

  test("a brain on its own model: preview == send names it, the others the conversation's; the conversation's change moves only them; null puts it back", async () => {
    const { c, co } = await table();
    assert.equal(co.textModel, "venice-uncensored-1-2");

    const gm = await preview(c, "--content", "Hello");
    assert.equal(gm.body.model, "deepseek-v4-1-flash");
    assert.deepEqual(gm.models.text, { id: "deepseek-v4-1-flash", name: "DeepSeek V4.1 Flash", own: false, conversation: "deepseek-v4-1-flash" });
    const p = await preview(c, "--brain", "Co-GM", "--content", "How far is the drop?");
    assert.equal(p.body.model, "venice-uncensored-1-2");
    assert.deepEqual(p.models.text, { id: "venice-uncensored-1-2", name: "Venice Uncensored 1.2", own: true, conversation: "deepseek-v4-1-flash" });
    assert.equal(p.body.reasoning_effort, undefined, "its model doesn't reason: no reasoning fields, though DeepSeek's would say none");
    assert.equal(p.body.venice_parameters.disable_thinking, undefined);
    assert.match((await ok(["prompt.preview", "--conversation", c, "--brain", "Co-GM"])).stdout, /\nText model: Venice Uncensored 1\.2 \(venice-uncensored-1-2\), the brain's own; the conversation's is deepseek-v4-1-flash\.\n/);

    const r = await ok(["turn", "--conversation", c, "--brain", "Co-GM", "--content", "How far is the drop?"]);
    assert.deepEqual(sent("/chat/completions"), p.body, "prompt.preview is what was sent, model included");
    assert.match(r.stderr, /\[Co-GM · own model venice-uncensored-1-2\]/);
    let conv = await get(c);
    assert.equal(conv.messages.at(-1)!.versions[0]!.model, "venice-uncensored-1-2", "the version records the model that wrote it");

    // The Game Master answers on the conversation's model; its header doesn't name one.
    const gmTurn = await ok(["turn", "--conversation", c]);
    assert.equal((sent("/chat/completions") as ChatRequest).model, "deepseek-v4-1-flash");
    assert.match(gmTurn.stderr, /\[Game Master\]/);

    // Regenerate, steer and fresh take of the Co-GM's message use its model. Its reply is last after a new turn to it.
    await ok(["turn", "--conversation", c, "--brain", "Co-GM", "--content", "And the rope?"]);
    for (const extra of [[], ["--steer", "Shorter."], ["--thought", "Say the rope is frayed.", "--wrap"]]) {
      const rp = await preview(c, "--regenerate", ...extra);
      assert.equal(rp.body.model, "venice-uncensored-1-2", extra.join(" "));
      await ok(["message.regenerate", "--conversation", c, ...extra]);
      assert.deepEqual(sent("/chat/completions"), rp.body, `regenerate ${extra.join(" ")}: preview == send`);
    }
    conv = await get(c);
    assert.deepEqual(conv.messages.at(-1)!.versions.map((v) => v.model), ["venice-uncensored-1-2", "venice-uncensored-1-2", "venice-uncensored-1-2", "venice-uncensored-1-2"]);

    // The conversation's model moves every brain without its own, and only those.
    const upd = await ok(["conversation.update", "--id", c, "--settings.text-model", "abliteration-abliterated-model-large-v2"]);
    assert.match(upd.stdout, /Brains on a model of their own, which they keep: Co-GM \(venice-uncensored-1-2\)/);
    assert.equal((await preview(c)).body.model, "abliteration-abliterated-model-large-v2");
    assert.equal((await preview(c, "--brain", "Co-GM", "--content", "x")).body.model, "venice-uncensored-1-2");
    const listed = (await ok(["brain.list", "--conversation", c])).stdout;
    assert.match(listed, /Game Master \(b_\w+\) · text · default · model abliteration-abliterated-model-large-v2 \(the conversation's\)/);
    assert.match(listed, /Co-GM \(b_\w+\) · text · model venice-uncensored-1-2 \(its own\)/);

    // An unknown model is refused when set, and nothing changes.
    const bad = await t.cli(["brain.update", "--conversation", c, "--brain", "Co-GM", "--text-model", "no-such-model"]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /--text-model: Venice has no text model "no-such-model"/);
    assert.equal((await get(c)).brains.find((b) => b.id === co.id)!.textModel, "venice-uncensored-1-2");

    // null: back to the conversation's (the CLI reads --text-model null as null).
    const back = (await json(["brain.update", "--conversation", c, "--brain", "Co-GM", "--text-model", "null"])) as Brain;
    assert.equal("textModel" in back, false);
    const again = await preview(c, "--brain", "Co-GM", "--content", "x");
    assert.equal(again.body.model, "abliteration-abliterated-model-large-v2");
    assert.equal(again.models.text.own, false);
  });

  test("a brain on an always-reasoning model with reasoning off gets that model's note; the conversation's model doesn't reason at all", async () => {
    await ok(["auth.login", "--username", "dev-t18", "--password", ""]);
    const conv = (await json(["conversation.create", "--title", "GLM Co-GM", "--system-prompt", "You are the GM.", "--text-model", "venice-uncensored-1-2"])) as Conversation;
    const c = conv.id;
    await ok(["brain.add", "--conversation", c, "--name", "Co-GM", "--system-prompt", "You answer questions.", "--text-model", "z-ai-glm-5-3"]);

    const gm = await preview(c, "--content", "Hello");
    assert.deepEqual([gm.body.reasoning_effort, gm.body.venice_parameters.disable_thinking], [undefined, undefined], "the conversation's model has no reasoning: nothing about it is sent");
    assert.ok(!gm.notes.some((n: string) => /always|reason/i.test(n)), gm.notes.join("\n"));

    const off = await preview(c, "--brain", "Co-GM", "--content", "Hello");
    assert.equal(off.body.model, "z-ai-glm-5-3");
    assert.equal(off.body.venice_parameters.disable_thinking, true, "the brain's switch is what is sent: off stays off");
    assert.ok(off.notes.includes(alwaysReasonsNote("GLM 5.3", "refused", "Co-GM")), off.notes.join("\n"));
    const refused = await t.cli(["turn", "--conversation", c, "--brain", "Co-GM", "--content", "Hello"]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /thinking-only model.*Turn reasoning on for Co-GM/s);

    await ok(["brain.update", "--conversation", c, "--brain", "Co-GM", "--reasoning.enabled"]);
    const on = await preview(c, "--brain", "Co-GM", "--content", "Hello");
    assert.ok(on.notes.includes(REASONING_NOTE));
    assert.ok(!on.notes.includes(alwaysReasonsNote("GLM 5.3", "refused", "Co-GM")));
    await ok(["turn", "--conversation", c, "--brain", "Co-GM", "--content", "Hello"]);
    assert.deepEqual(sent("/chat/completions"), on.body);
    // The same switch on the conversation's model: still nothing about reasoning (it can't reason).
    await ok(["brain.update", "--conversation", c, "--reasoning.enabled"]);
    const gmOn = await preview(c, "--content", "Hi");
    assert.deepEqual([gmOn.body.reasoning_effort, gmOn.body.venice_parameters.disable_thinking, gmOn.notes.includes(REASONING_NOTE)], [undefined, undefined, false]);
  });

  test("an image brain on its own image (and text) model paints with it, at its price; retry and edit too; null puts it back", async () => {
    const { c } = await table();
    await ok(["brain.add", "--conversation", c, "--name", "Scene Painter", "--kind", "image", "--system-prompt", "You paint the scene.", "--no-final-reminder.enabled", "--image-model", "krea-2-turbo", "--text-model", "venice-uncensored-1-2"]);
    const refused = await t.cli(["brain.update", "--conversation", c, "--brain", "Game Master", "--image-model", "krea-2-turbo"]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /an image model are for image brains, and Game Master is a text brain/);

    const p = await preview(c, "--brain", "Scene Painter", "--content", "Paint the hooded figure.");
    assert.equal(p.body.model, "venice-uncensored-1-2", "its prompt is written by its own text model");
    assert.equal(p.image.params.model, "krea-2-turbo");
    assert.equal(p.image.params.aspect_ratio, "3:2", "sized as its model takes it (an aspect ratio), not as z-image-turbo would be");
    assert.deepEqual(p.models.image, { id: "krea-2-turbo", name: "Krea 2 Turbo", own: true, conversation: "z-image-turbo" });

    const balance = t.mock.state.balanceUsd;
    const evs = await events(["turn", "--conversation", c, "--brain", "Scene Painter", "--content", "Paint the hooded figure."]);
    assert.deepEqual(sent("/chat/completions"), p.body);
    const { prompt: _prompt, ...params } = sent("/image/generate") as ImageRequest;
    assert.deepEqual(params, p.image.params, "the image request is the preview's, its own model included");
    const m = evs.at(-1)!.message as LedgerMessage;
    const v = m.versions[0]!;
    assert.deepEqual([v.model, v.image?.model, v.image?.status, v.image?.costUsd], ["venice-uncensored-1-2", "krea-2-turbo", "done", 0.04], "krea's price at its default 1K, not z-image-turbo's $0.01");
    assert.ok(Math.abs(balance - t.mock.state.balanceUsd - (v.image!.costUsd! + (v.costUsd ?? 0))) < 1e-9, "the balance moved by what was recorded");

    // A resolution only the painter's own model lists is accepted, and sent to it alone.
    await ok(["conversation.update", "--id", c, "--settings.image.resolution", "2K"]);
    assert.equal((await preview(c, "--brain", "Scene Painter")).image.params.resolution, "2K");

    // Retry and an edited prompt paint with its own model too.
    await ok(["image.retry", "--conversation", c, "--message", m.id]);
    assert.equal((sent("/image/generate") as ImageRequest).model, "krea-2-turbo");
    await ok(["message.edit", "--conversation", c, "--message", m.id, "--content", "A hooded figure, in rain."]);
    const edited = await settled(c, m.id);
    assert.equal(edited.versions[edited.activeVersion]!.image?.model, "krea-2-turbo");
    assert.equal((sent("/image/generate") as ImageRequest).model, "krea-2-turbo");

    // Back to the conversation's image model: the next image is z-image-turbo's, sized by width × height.
    await ok(["brain.update", "--conversation", c, "--brain", "Scene Painter", "--image-model", "null"]);
    await ok(["image.retry", "--conversation", c, "--message", m.id]);
    const last = sent("/image/generate") as ImageRequest;
    assert.deepEqual([last.model, last.width, last.aspect_ratio, last.resolution], ["z-image-turbo", 1216, undefined, undefined]);
  });

  test("a campaign file round-trips a brain's models; a clone with --text-model keeps a brain's own; a blueprint gives made brains theirs", async () => {
    const { c, co } = await table();
    const doc = await get(c);
    const imported = (await json(["conversation.import", "--campaign", "-"], JSON.stringify(doc))) as Conversation;
    assert.deepEqual(
      imported.brains.map((b) => [b.name, b.textModel]),
      [["Game Master", undefined], ["Co-GM", "venice-uncensored-1-2"]],
    );

    // A model Venice doesn't list is refused, saying where; an image model on a text brain too. Nothing is created.
    const count = (await json(["conversation.list"])).conversations.length;
    const badModel = structuredClone(doc);
    badModel.brains[1]!.textModel = "no-such-model";
    let r = await t.cli(["conversation.import", "--campaign", "-"], { stdin: JSON.stringify(badModel) });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /The campaign: brains\.1\.textModel: Venice has no text model "no-such-model"/);
    const textImage = structuredClone(doc);
    textImage.brains[1]!.imageModel = "krea-2-turbo";
    r = await t.cli(["conversation.import", "--campaign", "-"], { stdin: JSON.stringify(textImage) });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /brains\.1: safe mode, shape, tool text and an image model are for image brains/);
    assert.equal((await json(["conversation.list"])).conversations.length, count);

    // Clone under another model: the conversation's moves, the Co-GM keeps its own, and the answer says so.
    const clone = await ok(["conversation.clone", "--id", c, "--title", "Under GLM", "--text-model", "z-ai-glm-5-3"]);
    assert.match(clone.stdout, /Co-GM \(its own model venice-uncensored-1-2\)/);
    assert.match(clone.stdout, /Co-GM has a model of its own and keeps it/);
    const copy = (await json(["conversation.list"])).conversations.find((x: { title: string }) => x.title === "Under GLM");
    const cc = await get(copy.id);
    assert.equal(cc.settings.textModel, "z-ai-glm-5-3");
    assert.deepEqual(cc.brains.map((b) => b.textModel), [undefined, "venice-uncensored-1-2"]);
    assert.notEqual(cc.brains[1]!.id, co.id);

    // A maker whose blueprint names a model: the brains it makes have it as their own.
    await ok(["brain.add", "--conversation", c, "--name", "Character Creator", "--system-prompt", "You write sheets.", "--makes.name", "Character {{n}}", "--makes.blueprint.system-prompt", "You are the person in your sheet.", "--makes.blueprint.text-model", "venice-uncensored-1-2"]);
    const listed = (await ok(["brain.list", "--conversation", c])).stdout;
    assert.match(listed, /Each one: text · model venice-uncensored-1-2 \(its own\)/);
    const added = await json(["message.add", "--conversation", c, "--as", "Character Creator", "--content", "```hidden\nKnown to the player as: the barkeep\n```"]);
    assert.equal(added.made.name, "Character 1");
    assert.equal(added.made.textModel, "venice-uncensored-1-2");
    assert.equal((await preview(c, "--brain", "Character 1", "--content", "Hi")).body.model, "venice-uncensored-1-2");
    const badBlueprint = await t.cli(["brain.update", "--conversation", c, "--brain", "Character Creator", "--makes.blueprint.image-model", "krea-2-turbo"]);
    assert.equal(badBlueprint.code, 1);
    assert.match(badBlueprint.stderr, /an image model are for image brains, and Character Creator makes text brains/);
  });
});
