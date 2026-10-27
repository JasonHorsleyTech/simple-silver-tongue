import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { compactionCut, messageCount } from "../src/conversations/compaction.ts";
import { newBrain, newConversation } from "../src/conversations/defaults.ts";
import { assembleRequest, buildRequest, type ModelCaps } from "../src/conversations/prompt.ts";
import { estimateSize, lastCount } from "../src/conversations/size.ts";
import { newMessage, planCompact, planRegenerate, planTurn } from "../src/conversations/turn.ts";
import type { Author, Brain, ChatRequest, Conversation, LedgerMessage } from "../src/conversations/types.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

const DEEPSEEK: ModelCaps = { reasoning: { supported: true, effortOptions: ["none", "low", "high", "max"] } };
const AT = "2026-10-27T00:00:00.000Z";
const user = (content: string) => ({ role: "user", content });
const assistant = (content: string) => ({ role: "assistant", content });

/**
 * A table with a GM, a character whose sheet is pinned, and a Chronicler whose messages are compactions. Nothing in
 * the code knows what a sheet or a summary is: a pin and the `compacts` setting are all it takes.
 */
function table() {
  const conv = newConversation({ title: "Harbor", systemPrompt: "You are the GM." });
  const gm = conv.brains[0]!;
  gm.name = "Game Master";
  const alice = newBrain({ name: "Alice", systemPrompt: "You are Alice.", isDefault: false });
  alice.finalReminder.enabled = false;
  const chron = newBrain({ name: "Chronicler", systemPrompt: "You keep the record.", isDefault: false });
  chron.compacts = true;
  chron.finalReminder.content = "The story so far is {{count}} messages. {{count}}, once more; {{brain}} stays as typed.";
  conv.brains.push(alice, chron);
  conv.setup.push({ id: "s_1", label: "World Bible", role: "user", content: "WORLD" });
  const add = (author: Author, content: string) => {
    const m = newMessage(author, "text", { content, source: "authored", createdAt: AT });
    conv.messages.push(m);
    return m;
  };
  const by = (b: Brain): Author => ({ type: "brain", brainId: b.id });
  const opener = add(by(gm), "A hooded figure waits.");
  const sheet = add(by(gm), "SHEET: Alice keeps a secret."); // stands in for the Creator's sheet, pinned to Alice
  alice.pins = [{ messageId: sheet.id, as: "ledger" }];
  const p1 = add({ type: "player" }, "I approach.");
  const a1 = add(by(alice), "Alice: hello.");
  return { conv, gm, alice, chron, opener, sheet, p1, a1, add, by };
}

describe("compaction (T20): the cut in prompt assembly", () => {
  test("every brain's request starts at the newest compaction; a pin from before the cut still reaches its brain", () => {
    const { conv, gm, alice, chron, sheet, add, by } = table();
    const c1 = add(by(chron), "SUMMARY ONE");
    const p2 = add({ type: "player" }, "I sit down.");
    assert.equal(compactionCut(conv, conv.messages), 4);

    const forGm = assembleRequest(conv, gm.id, { model: DEEPSEEK });
    assert.deepEqual(forGm.body.messages, [
      { role: "system", content: "You are the GM." },
      user("WORLD"),
      user("<!-- from: Chronicler -->\nSUMMARY ONE"),
      user("<!-- from: the user -->\nI sit down."),
    ]);
    assert.deepEqual(forGm.cut, { messageId: c1.id, before: 4 });

    // Alice: system, setup, her sheet (pinned, from before the cut), the compaction, the turns since. Jason's order.
    const forAlice = assembleRequest(conv, alice.id, { model: DEEPSEEK });
    assert.deepEqual(forAlice.body.messages, [
      { role: "system", content: "You are Alice." },
      user("WORLD"),
      user("<!-- from: Game Master -->\nSHEET: Alice keeps a secret."),
      user("<!-- from: Chronicler -->\nSUMMARY ONE"),
      user("<!-- from: the user -->\nI sit down."),
    ]);
    assert.deepEqual(forAlice.pinned, [{ index: 2, messageId: sheet.id, as: "ledger" }]);

    // The Chronicler sees its own compaction as its own words.
    const forChron = buildRequest(conv, chron.id, { model: DEEPSEEK });
    assert.deepEqual(forChron.messages.slice(2, 4), [assistant("SUMMARY ONE"), user("<!-- from: the user -->\nI sit down.")]);

    // Deleting the compaction brings everything back: nothing was removed, only left out.
    conv.messages.splice(conv.messages.indexOf(c1), 1);
    const back = assembleRequest(conv, gm.id, { model: DEEPSEEK });
    assert.equal(back.cut, null);
    assert.equal(back.body.messages.length, 2 + 5);
    assert.ok(p2);
  });

  test("{{count}} in a final reminder: every message so far, compactions not counted; the preview notes it", () => {
    const { conv, chron, add, by } = table();
    const plan = planTurn(conv, { brain: chron.id }, DEEPSEEK);
    assert.equal(plan.body.messages.at(-1)!.content, "The story so far is 4 messages. 4, once more; {{brain}} stays as typed.");
    assert.ok(plan.notes.some((n) => n.includes("{{count}} is sent as 4")));
    assert.ok(plan.notes.some((n) => n.includes("Chronicler's messages are compactions")), "a turn to it says it moves the cut");
    add(by(chron), "SUMMARY ONE");
    for (let i = 0; i < 3; i++) add({ type: "player" }, `more ${i}`);
    // A second compaction counts the whole story it stands for: 4 + 3, not the compaction.
    assert.equal(messageCount(conv, conv.messages), 7);
    const second = planTurn(conv, { brain: chron.id }, DEEPSEEK);
    assert.match(second.body.messages.at(-1)!.content, /^The story so far is 7 messages\./);
    // ...and its request starts at the first compaction.
    assert.deepEqual(second.body.messages[2], assistant("SUMMARY ONE"));
  });

  test("regenerating a compaction re-asks what it summarized; a steer of it keeps the material too; a fresh take too", () => {
    const { conv, chron, add, by } = table();
    const c1 = add(by(chron), "SUMMARY ONE");
    add({ type: "player" }, "later");
    const c2 = add(by(chron), "SUMMARY TWO");
    // A plain re-roll of c2: the ledger before it, cut at c1.
    const reroll = planRegenerate(conv, {}, DEEPSEEK);
    assert.deepEqual(reroll.cut, { messageId: c1.id, before: 4 });
    assert.deepEqual(reroll.body.messages.slice(2, 4), [assistant("SUMMARY ONE"), user("<!-- from: the user -->\nlater")]);
    // A steer of c2 keeps c2 (the reply being revised) and still cuts at c1, not at c2 itself.
    const steered = planRegenerate(conv, { steer: "Shorter." }, DEEPSEEK);
    assert.deepEqual(steered.cut, { messageId: c1.id, before: 4 });
    assert.deepEqual(steered.body.messages.slice(2, 5), [assistant("SUMMARY ONE"), user("<!-- from: the user -->\nlater"), assistant("SUMMARY TWO")]);
    // A fresh take: the Muse's note goes right before c2, and the request is cut at c1, the note included.
    const fresh = planRegenerate(conv, { thought: "Mention the dagger." }, DEEPSEEK);
    assert.deepEqual(fresh.cut, { messageId: c1.id, before: 4 });
    assert.equal(fresh.body.messages.filter((m) => m.content.includes("Mention the dagger.")).length, 1);
    assert.equal(c2.versions.length, 1);
  });

  test("an image brain's messages are never compactions, even in a hand-edited file", () => {
    const { conv, add, by } = table();
    const painter: Brain = { ...newBrain({ name: "Painter", systemPrompt: "Paint.", isDefault: false, kind: "image" }), compacts: true };
    conv.brains.push(painter);
    const img = add(by(painter), "a prompt");
    img.kind = "image";
    assert.equal(compactionCut(conv, conv.messages), -1);
  });

  test("planCompact: through a middle message, the reply goes right after it; refusals; a re-roll of the newest", () => {
    const { conv, gm, chron, p1, a1, add, by } = table();
    const p2 = add({ type: "player" }, "I sit down.");
    // Through the last message it is just a turn by the compaction brain: the same body.
    assert.deepEqual(planCompact(conv, {}, DEEPSEEK).body, planTurn(conv, { brain: chron.id }, DEEPSEEK).body);
    // Through p1 (a middle message): the ledger up to and including it, nothing after.
    const plan = planCompact(conv, { message: p1.id }, DEEPSEEK);
    assert.equal(plan.brain.id, chron.id);
    assert.deepEqual(plan.into, { kind: "new" });
    assert.equal(plan.after, 2);
    assert.equal(plan.body.messages.at(-2)!.content, "<!-- from: the user -->\nI approach.");
    assert.match(plan.body.messages.at(-1)!.content, /^The story so far is 3 messages\./);
    assert.ok(plan.notes[0]!.startsWith(`A compaction through ${p1.id}`));

    // Once it is in (right after p1), compacting a1 is fine (after the cut); compacting the opener isn't (above it).
    const c1 = newMessage(by(chron), "text", { content: "SUMMARY ONE", source: "generated", createdAt: AT });
    conv.messages.splice(conv.messages.indexOf(p1) + 1, 0, c1);
    assert.throws(() => planCompact(conv, { message: conv.messages[0]!.id }, DEEPSEEK), /above the newest compaction/);
    assert.throws(() => planCompact(conv, { message: c1.id }, DEEPSEEK), /is a compaction itself/);
    const later = planCompact(conv, { message: a1.id }, DEEPSEEK);
    assert.deepEqual(later.cut, { messageId: c1.id, before: 3 });
    assert.equal(later.after, 1);
    // Right before your own newest compaction: a new version of it (a re-roll that works at any depth).
    const again = planCompact(conv, { message: p1.id }, DEEPSEEK);
    assert.deepEqual(again.into, { kind: "version", message: c1 });
    assert.equal(again.after, 2);
    assert.ok(again.notes[0]!.includes(`version 2 of the compaction right after it (${c1.id})`));

    // Which brain: --brain must compact; with none, say how to get one; with two, say which.
    assert.throws(() => planCompact(conv, { brain: gm.id }, DEEPSEEK), /aren't compactions/);
    const two = structuredClone(conv);
    two.brains.push({ ...newBrain({ name: "Archivist", systemPrompt: "x", isDefault: false }), compacts: true });
    assert.throws(() => planCompact(two, {}, DEEPSEEK), /2 compaction brains \(Chronicler, Archivist\)/);
    const none = structuredClone(conv);
    delete none.brains.find((b) => b.name === "Chronicler")!.compacts;
    assert.throws(() => planCompact(none, {}, DEEPSEEK), /brain\.import --conversation c_\w+ --preset tabletop-rpg --brain Chronicler/);
    assert.ok(p2);
  });

  test("the size estimate and the last real count", () => {
    const { conv, gm, alice, add, by } = table();
    const body = buildRequest(conv, gm.id, { model: DEEPSEEK });
    const chars = body.messages.reduce((n, m) => n + m.content.length, 0);
    assert.deepEqual(estimateSize(body), { chars, tokens: Math.ceil(chars / 4.4) + 4 * body.messages.length });
    assert.equal(lastCount(conv, gm.id), null);
    const r1 = newMessage(by(gm), "text", { content: "x", source: "generated", createdAt: "2026-10-27T01:00:00.000Z", usage: { promptTokens: 900, completionTokens: 10, cachedTokens: 512 } });
    r1.versions.push({ content: "y", source: "generated", createdAt: "2026-10-27T02:00:00.000Z", usage: { promptTokens: 950, completionTokens: 12 } });
    conv.messages.push(r1);
    add({ type: "player" }, "and then");
    assert.deepEqual(lastCount(conv, gm.id), { messageId: r1.id, version: 2, at: "2026-10-27T02:00:00.000Z", promptTokens: 950, completionTokens: 12, messagesAgo: 1 });
    assert.equal(lastCount(conv, alice.id), null, "authored lines have no count");
  });
});

describe("compaction (T20): CLI → server → mock Venice", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    t = await startTestServer({ mock: { slowDelayMs: 100 } });
    await createUser(t.config.dataDir, "dev-t20", "", { N: 2 ** 10, r: 8, p: 1 });
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
  const lastSent = () => t.mock.state.requests.find((r) => r.path === "/chat/completions")?.body as ChatRequest;
  const firstLines = (body: ChatRequest) => body.messages.map((m) => [m.role, m.content.split("\n")[0]]);
  const add = (c: string, as: string, content: string) => json(["message.add", "--conversation", c, "--as", as, "--content", content]);
  const cookie = () => `sst_session=${JSON.parse(readFileSync(join(t.config.runDir, "cli-session.json"), "utf8")).token}`;
  const post = (cmd: string, body: unknown) =>
    t.app.fetch(new Request(`http://localhost/api/${cmd}`, { method: "POST", headers: { host: "localhost", "content-type": "application/json", cookie: cookie() }, body: JSON.stringify(body) }));

  /** The Tabletop RPG preset: a World Bible, the GM's opener, a sheet in the Creator's mouth (it makes Character 1), and a few turns. */
  async function harbor() {
    await ok(["auth.login", "--username", "dev-t20", "--password", ""]);
    const c = ((await json(["conversation.import", "--preset", "tabletop-rpg", "--title", "Harbor"])) as Conversation).id;
    await ok(["setup.add", "--conversation", c, "--content", "<!-- This is the World Bible. -->\nSaltmere, a rainy harbor town."]);
    await add(c, "Game Master", "Rain on the shutters. A hooded figure sits in the corner booth.");
    await add(c, "player", "I sit down across from her.");
    const sheet = (await add(c, "Character Creator", "```hidden\n**Known to the player as:** the hooded figure\n**Name:** Isolde\n```")).message as LedgerMessage;
    await add(c, "Character 1", "**The hooded figure:** \"Sit, clerk.\"");
    await add(c, "player", "I ask what she wants.");
    await add(c, "Game Master", "She slides a scrap of oilcloth across the table.");
    return { c, sheet };
  }

  test("acceptance: compact the last message; preview == send; a made character's view is system, setup, its sheet, the compaction, the turns since, its reminder", async () => {
    const { c, sheet } = await harbor();
    const preview = await json(["prompt.preview", "--conversation", c, "--compact"]);
    assert.equal(preview.brainName, "Chronicler");
    assert.equal(preview.compact.after, 0);
    assert.match(preview.body.messages.at(-1).content, /The story so far is 6 messages long/, "the count, rendered, in the payload view");
    assert.ok(preview.size.tokens > 0 && preview.size.chars > 0);
    const out = await ok(["message.compact", "--conversation", c]);
    assert.match(out.stderr, /\[Chronicler · compacting through m_\w+\]/);
    assert.deepEqual(lastSent(), preview.body, "prompt.preview --compact is exactly what was sent");

    const conv = await get(c);
    const compaction = conv.messages.at(-1)!;
    assert.equal(conv.brains.find((b) => b.id === (compaction.author as { brainId: string }).brainId)!.name, "Chronicler");
    await add(c, "player", "I pocket the oilcloth.");
    const p = await json(["prompt.preview", "--conversation", c, "--brain", "Character 1", "--content", "Who sent you?"]);
    assert.equal(p.body.messages[0].role, "system");
    assert.deepEqual(firstLines(p.body).slice(1), [
      ["user", "<!-- This is the World Bible. -->"],
      ["user", "<!-- from: Character Creator -->"],
      ["user", "<!-- from: Chronicler -->"],
      ["user", "<!-- from: the user -->"],
      ["user", "<!-- from: the user -->"],
      ["user", "<!-- System reminder -->"],
    ]);
    assert.deepEqual(p.pinned, [{ index: 2, messageId: sheet.id, as: "ledger" }], "the sheet, written before the cut, still reaches its brain");
    assert.deepEqual(p.cut, { messageId: compaction.id, before: 6 });
    assert.ok(p.notes.some((n: string) => n.startsWith(`Compacted: this request starts at ${compaction.id}, Chronicler's compaction, and the 6 messages before it are left out`) && n.includes("One of them is pinned to this brain")));
    // The turn after it sends what its preview showed.
    await ok(["turn", "--conversation", c, "--brain", "Character 1", "--content", "Who sent you?"]);
    assert.deepEqual(lastSent(), p.body);

    // conversation.get says where requests start.
    const text = (await ok(["conversation.get", "--id", c])).stdout;
    assert.match(text, new RegExp(`Compacted at ${compaction.id}: every request starts there, and the 6 messages above it are left out`));
    assert.match(text, /compaction: every request starts here/);
    assert.equal((text.match(/compacted: left out of requests/g) ?? []).length, 6);

    // Deleting the compaction brings everything back.
    const del = await ok(["message.delete", "--conversation", c, "--message", compaction.id]);
    assert.match(del.stdout, /No compaction is left, so every brain's request holds the whole ledger again/);
    const full = await json(["prompt.preview", "--conversation", c]);
    assert.equal(full.cut, undefined);
    assert.equal(full.body.messages.filter((m: { content: string }) => m.content.includes("A hooded figure sits")).length, 1);
  });

  test("a compaction on a middle message leaves the later ones verbatim; a second compaction starts at the first; the cut follows set-author", async () => {
    const { c } = await harbor();
    const before = await get(c);
    const middle = before.messages[2]!; // the sheet
    const after = before.messages.slice(3).map((m) => m.id);
    const preview = await json(["prompt.preview", "--conversation", c, "--compact", "--message", middle.id]);
    assert.deepEqual(preview.compact, { through: middle.id, after: 3 });
    await ok(["message.compact", "--conversation", c, "--message", middle.id]);
    assert.deepEqual(lastSent(), preview.body);
    const conv = await get(c);
    const c1 = conv.messages[3]!;
    assert.deepEqual(conv.messages.slice(4).map((m) => m.id), after, "the messages after it stay, verbatim, below it");
    assert.deepEqual(conv.messages.slice(0, 3).map((m) => m.id), before.messages.slice(0, 3).map((m) => m.id));
    const gm = await json(["prompt.preview", "--conversation", c]);
    assert.deepEqual(firstLines(gm.body).slice(1), [
      ["user", "<!-- This is the World Bible. -->"],
      ["user", "<!-- from: Chronicler -->"],
      ["user", "<!-- from: Character 1 -->"],
      ["user", "<!-- from: the user -->"],
      ["assistant", "She slides a scrap of oilcloth across the table."],
      ["user", "<!-- System reminder -->"],
    ]);

    // Compacting the sheet again: a new version of c1 (a re-roll at any depth), not a second message.
    const again = await json(["prompt.preview", "--conversation", c, "--compact", "--message", middle.id]);
    assert.deepEqual(again.compact, { through: middle.id, after: 3, messageId: c1.id, newVersion: 2 });
    await ok(["message.compact", "--conversation", c, "--message", middle.id]);
    assert.deepEqual(lastSent(), again.body);
    const reversioned = (await get(c)).messages[3]!;
    assert.deepEqual([reversioned.id, reversioned.versions.length, reversioned.activeVersion], [c1.id, 2, 1]);

    // Above the newest compaction: refused, nothing sent.
    const sent = t.mock.state.requests.length;
    await fails(["message.compact", "--conversation", c, "--message", conv.messages[0]!.id], /above the newest compaction/);
    assert.equal(t.mock.state.requests.length, sent);

    // A second compaction, through the last message: its request starts at the first, and counts the whole story.
    const second = await json(["prompt.preview", "--conversation", c, "--compact"]);
    assert.deepEqual(firstLines(second.body).slice(2, 4), [["assistant", reversioned.versions[1]!.content.split("\n")[0]], ["user", "<!-- from: Character 1 -->"]]);
    assert.match(second.body.messages.at(-1).content, /The story so far is 6 messages long/);
    await ok(["message.compact", "--conversation", c]);
    const two = await get(c);
    const c2 = two.messages.at(-1)!;
    const after2 = await json(["prompt.preview", "--conversation", c]);
    assert.deepEqual(after2.cut, { messageId: c2.id, before: two.messages.length - 1 });

    // Moving c2 to the Game Master stops it being a compaction: requests start at c1 again.
    const moved = await ok(["message.set-author", "--conversation", c, "--message", c2.id, "--as", "Game Master"]);
    assert.match(moved.stdout, new RegExp(`now starts at the compaction ${c1.id} \\(it started at ${c2.id}\\)`));
    assert.deepEqual((await json(["prompt.preview", "--conversation", c])).cut, { messageId: c1.id, before: 3 });
  });

  test("prompt.size: each brain's last real count (cached tokens included) and an estimate of its request now", async () => {
    const { c } = await harbor();
    await ok(["turn", "--conversation", c, "--content", "I order a drink."]);
    await ok(["turn", "--conversation", c, "--content", "And another."]);
    const sizes = await json(["prompt.size", "--conversation", c]);
    const gm = sizes.brains.find((b: { name: string }) => b.name === "Game Master");
    const conv = await get(c);
    const reply = conv.messages.at(-1)!.versions[0]!;
    assert.equal(gm.last.messageId, conv.messages.at(-1)!.id);
    assert.equal(gm.last.promptTokens, reply.usage!.promptTokens);
    assert.ok(gm.last.cachedTokens > 0, "the mock's cache: the second turn shares the first one's opening");
    assert.equal(gm.last.cachedTokens, reply.usage!.cachedTokens);
    assert.ok(gm.now.tokens > 0);
    assert.equal(sizes.brains.find((b: { name: string }) => b.name === "Co-GM").last, undefined);
    const text = (await ok(["prompt.size", "--conversation", c])).stdout;
    assert.match(text, /Game Master\s+\d[\d,]* in \(\d[\d,]* cached\) · m_\w+, the newest message\s+~\d/);
    assert.match(text, /An estimate:/);
    // After a compaction, the last count says it is from before the cut.
    await ok(["message.compact", "--conversation", c]);
    const cut = await json(["prompt.size", "--conversation", c]);
    assert.equal(cut.brains.find((b: { name: string }) => b.name === "Game Master").last.beforeCut, true);
    assert.ok(cut.cut.messageId);
  });

  test("settings, campaigns and clone: --compacts on text brains only; the setting round-trips and the cut follows the messages", async () => {
    const { c } = await harbor();
    await fails(["brain.update", "--conversation", c, "--brain", "Scene Painter", "--compacts"], /only a text brain writes compactions/);
    await fails(["brain.add", "--conversation", c, "--name", "P2", "--kind", "image", "--system-prompt", "x", "--compacts"], /only a text brain writes compactions/);
    const listed = (await ok(["brain.list", "--conversation", c])).stdout;
    assert.match(listed, /── Chronicler \(b_\w+\) · text · .* · compacts ·/);
    await ok(["message.compact", "--conversation", c]);
    const src = await get(c);

    const imported = (await json(["conversation.import", "--campaign", JSON.stringify(src)])) as Conversation;
    assert.equal(imported.brains.find((b) => b.name === "Chronicler")!.compacts, true);
    assert.deepEqual((await json(["prompt.preview", "--conversation", imported.id])).cut, { messageId: imported.messages.at(-1)!.id, before: 6 });
    const bad = structuredClone(src) as unknown as { brains: Array<{ name: string; compacts?: boolean }> };
    bad.brains.find((b) => b.name === "Scene Painter")!.compacts = true;
    await fails(["conversation.import", "--campaign", JSON.stringify(bad)], /brains\.4\.compacts: only a text brain writes compactions/);

    // Clone through a message before the compaction: no cut in the copy; the Chronicler still compacts.
    const early = (await json(["conversation.clone", "--id", c, "--through", src.messages[3]!.id, "--title", "Early"])) as Conversation;
    assert.equal((await json(["prompt.preview", "--conversation", early.id])).cut, undefined);
    assert.equal(early.brains.find((b) => b.name === "Chronicler")!.compacts, true);

    // brain.import brings the setting, and says what it does.
    const other = (await json(["conversation.create", "--title", "Elsewhere", "--system-prompt", "x"])) as Conversation;
    const imp = await json(["brain.import", "--conversation", other.id, "--preset", "tabletop-rpg", "--brain", "Chronicler"]);
    assert.equal(imp.brain.compacts, true);
    assert.ok(imp.notes.some((n: string) => n.includes("Chronicler's messages are compactions")));
    await fails(["message.compact", "--conversation", other.id, "--brain", "Assistant"], /Assistant's messages aren't compactions/);
  });

  test("compacting is a generation: 409 while one runs; a failed one saves nothing and says how to retry", async () => {
    const { c } = await harbor();
    await ok(["brain.update", "--conversation", c, "--brain", "Character 1", "--no-final-reminder.enabled"]);
    const slow = post("turn", { conversation: c, brain: "Character 1", content: "MOCK_SLOW tell me everything" });
    const res = await slow;
    await new Promise((r) => setTimeout(r, 150));
    const busy = await post("message.compact", { conversation: c });
    assert.equal(busy.status, 409);
    await res.text();
    const n = (await get(c)).messages.length;
    await ok(["brain.update", "--conversation", c, "--brain", "Chronicler", "--final-reminder.content", "MOCK_MIDSTREAM_ERROR {{count}}"]);
    const failed = await t.cli(["message.compact", "--conversation", c]);
    assert.equal(failed.code, 1);
    assert.match(failed.stderr, /No compaction was saved, so requests start where they did\. To retry, compact again/);
    assert.equal((await get(c)).messages.length, n);
  });
});
