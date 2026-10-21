import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { DEFAULT_TEMPLATES, T15_THOUGHT_TEMPLATE } from "../src/conversations/defaults.ts";
import { SCHEMA_VERSION, type Brain, type ChatRequest, type Conversation, type LedgerMessage } from "../src/conversations/types.ts";
import { MUSE_REMINDER, MUSE_SYSTEM_PROMPT } from "../src/conversations/wording.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 };
const IDEA = "The hooded stranger is always an old man. Subvert it: three goblins in a trench coat.";
const NOTE = `\`\`\`hidden\nAn idea for the Assistant's next reply, which the player won't see:\n\n${IDEA}\n\`\`\``;
const framed = (text: string) => ({ role: "user", content: `<!-- from: Muse -->\n${text}` });

describe("a fresh take: the Muse's note right before the message, then the brain answers it (T17)", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    t = await startTestServer({ mock: { slowDelayMs: 60 } });
    await createUser(t.config.dataDir, "dev-t17", "", FAST_KDF);
  });
  after(() => t.close());

  const ok = async (argv: string[]) => {
    const r = await t.cli(argv);
    assert.equal(r.code, 0, `${argv.join(" ")}\n${r.stderr}`);
    return r;
  };
  const json = async (argv: string[]) => JSON.parse((await ok([...argv, "--json"])).stdout);
  const fails = async (argv: string[], why: RegExp) => {
    const r = await t.cli(argv);
    assert.notEqual(r.code, 0, argv.join(" "));
    assert.match(r.stderr, why);
  };
  const get = async (id: string) => (await json(["conversation.get", "--id", id])) as Conversation;
  const lastSent = () => t.mock.state.requests.find((r) => r.path === "/chat/completions")?.body as ChatRequest;
  const cookie = () => `sst_session=${JSON.parse(readFileSync(join(t.config.runDir, "cli-session.json"), "utf8")).token}`;
  const post = (cmd: string, body: unknown) =>
    t.app.fetch(new Request(`http://localhost/api/${cmd}`, { method: "POST", headers: { host: "localhost", "content-type": "application/json", cookie: cookie() }, body: JSON.stringify(body) }));
  const events = async (res: Response) => (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  const streamed = (evs: { type: string; delta?: string }[]) => evs.filter((e) => e.type === "delta").map((e) => e.delta).join("");
  const muse = (c: Conversation) => c.brains.find((b) => b.name === "Muse");
  const activeVersionText = (m: LedgerMessage) => m.versions[m.activeVersion]!.content;
  const start = async () => {
    await ok(["auth.login", "--username", "dev-t17", "--password", ""]);
    const c = (await json(["conversation.create", "--title", "Tavern", "--system-prompt", "You are the GM."])) as Conversation;
    await ok(["turn", "--conversation", c.id, "--content", "I walk up to the hooded figure."]);
    return c.id;
  };

  test("no final reminder: the note goes in before the reply, the body ends on it (a user message), preview == send, the version is the reply alone", async () => {
    const c = await start();
    const before = await get(c);
    const reply = before.messages[1]!;
    const v1 = reply.versions[0]!.content;

    const preview = await json(["prompt.preview", "--conversation", c, "--regenerate", "--thought", NOTE]);
    assert.deepEqual(preview.body.messages.slice(1), [{ role: "user", content: "<!-- from: the user -->\nI walk up to the hooded figure." }, framed(NOTE)]);
    assert.equal(preview.refusal, undefined);
    assert.match(preview.notes[0], /^A fresh take: the Muse's note goes in as a new message/);
    assert.deepEqual([preview.regenerate.thought, preview.regenerate.note.isNew, preview.regenerate.note.museCreated, preview.regenerate.note.version], [NOTE, true, true, 1]);
    assert.equal((await get(c)).brains.length, 1, "the preview adds nothing");
    assert.match((await ok(["prompt.preview", "--conversation", c, "--regenerate", "--thought", NOTE])).stdout, /a fresh take, so the message is left out and Assistant answers the Muse's note right before it/);

    const res = await post("message.regenerate", { conversation: c, thought: NOTE });
    const evs = await events(res);
    assert.deepEqual(lastSent(), preview.body, "the preview is the request");
    assert.deepEqual(evs.map((e) => e.type).slice(0, 2), ["muse_note", "start"], "the note is saved and said before the reply starts");
    const [noteEv, startEv] = evs;
    assert.equal(noteEv.before, reply.id);
    assert.equal(noteEv.brainCreated, true);
    assert.equal(noteEv.brain.name, "Muse");
    assert.equal(startEv.thought, NOTE);
    assert.match(streamed(evs), /^MOCK reply to brain/, "the reply alone streams: no head");

    const after = await get(c);
    const m = muse(after)!;
    assert.deepEqual([m.kind, m.systemPrompt, m.finalReminder, m.id === after.defaultBrainId], ["text", MUSE_SYSTEM_PROMPT, { enabled: true, content: MUSE_REMINDER }, false]);
    assert.deepEqual(after.messages.map((x) => x.author.type === "brain" ? (x.author.brainId === m.id ? "muse" : "gm") : "you"), ["you", "muse", "gm"]);
    const note = after.messages[1]!;
    assert.deepEqual([note.versions.length, note.versions[0]!.content, note.versions[0]!.source], [1, NOTE, "authored"]);
    const v2 = after.messages[2]!.versions[1]!;
    assert.equal(after.messages[2]!.activeVersion, 1);
    assert.equal(v2.thought, NOTE, "marked as a fresh take, for display");
    assert.equal(v2.content, streamed(evs), "the reply alone");

    // The next turn: the note at its place, framed; the replaced version gone; the reply the brain's own.
    const next = (await json(["prompt.preview", "--conversation", c, "--content", "Go on."])).body as ChatRequest;
    assert.deepEqual(next.messages.slice(1), [
      { role: "user", content: "<!-- from: the user -->\nI walk up to the hooded figure." },
      framed(NOTE),
      { role: "assistant", content: v2.content },
      { role: "user", content: "<!-- from: the user -->\nGo on." },
    ]);
    assert.ok(!JSON.stringify(next).includes(v1));
    const shown = (await ok(["message.get", "--conversation", c, "--message", after.messages[2]!.id])).stdout;
    assert.match(shown, /version 2\/2 \(active\) · generated · fresh take · \$[0-9.]+ ──\nMOCK reply[^\n]*\n\(the fresh take's thought, as sent; display only:\)\n\[Hidden · 3 lines\]/);
    assert.match((await ok(["conversation.get", "--id", c])).stdout, /Muse[^\n]*\n\[Hidden · 3 lines\]/, "the note folds like any hidden note");

    // --wrap fills the template, {{brain}} included; a steer with it, a blank one, or one outside a regenerate is a 400.
    const wrapped = await json(["prompt.preview", "--conversation", c, "--regenerate", "--thought", "Goblins.", "--wrap"]);
    assert.deepEqual(wrapped.body.messages.at(-1), framed("```hidden\nAn idea for Assistant's next reply, which the player won't see:\n\nGoblins.\n```"));
    const sent = t.mock.state.requests.length;
    await fails(["message.regenerate", "--conversation", c, "--thought", "x", "--steer", "y"], /a steer .* or a thought .*, not both/);
    await fails(["message.regenerate", "--conversation", c, "--thought", "  "], /thought can't be blank/);
    await fails(["prompt.preview", "--conversation", c, "--thought", "x"], /only apply to a regenerate preview/);
    assert.equal(t.mock.state.requests.length, sent, "nothing went upstream");
  });

  test("a second fresh take is a new version of the same note; every brain reads it in its place; deleting it takes it out", async () => {
    const c = await start();
    await ok(["brain.add", "--conversation", c, "--name", "Dice Master", "--system-prompt", "You name the odds."]);
    await ok(["turn", "--conversation", c, "--brain", "Dice Master"]);
    // A brain with a reminder: the body ends on the reminder, the note right before it.
    let preview = await json(["prompt.preview", "--conversation", c, "--regenerate", "--thought", NOTE]);
    assert.deepEqual(preview.body.messages.at(-2), framed(NOTE));
    assert.equal(preview.body.messages.at(-1).role, "user");
    assert.match(preview.body.messages.at(-1).content, /^<!-- System reminder -->/);
    const r = await ok(["message.regenerate", "--conversation", c, "--thought", NOTE]);
    assert.deepEqual(lastSent(), preview.body);
    assert.match(r.stderr, /added a brain called Muse/);
    assert.match(r.stderr, /Muse's note m_\w+, right before the reply: every brain reads it; --reveal shows it/);
    assert.ok(!r.stdout.includes("goblins"), "the note's text isn't printed without --reveal");

    // Again, with another idea: the same note gets a version (its own pager), not a second note.
    const second = "```hidden\nMake it a natural 1.\n```";
    preview = await json(["prompt.preview", "--conversation", c, "--regenerate", "--thought", second]);
    assert.deepEqual([preview.regenerate.note.isNew, preview.regenerate.note.version, preview.regenerate.note.museCreated], [false, 2, false]);
    const r2 = await ok(["message.regenerate", "--conversation", c, "--thought", second, "--reveal"]);
    assert.deepEqual(lastSent(), preview.body);
    assert.match(r2.stderr, /Muse's note m_\w+, version 2\/2, right before the reply:\]\n```hidden\nMake it a natural 1\.\n```/);
    let conv = await get(c);
    const m = muse(conv)!;
    const notes = conv.messages.filter((x) => x.author.type === "brain" && x.author.brainId === m.id);
    assert.equal(notes.length, 1, "one note");
    assert.deepEqual([notes[0]!.versions.length, notes[0]!.activeVersion, conv.messages.at(-2)!.id], [2, 1, notes[0]!.id]);
    assert.equal(conv.messages.at(-1)!.versions.length, 3);
    // The same text again: the note stays as it is; the reply gets another version.
    await ok(["message.regenerate", "--conversation", c, "--thought", second]);
    conv = await get(c);
    assert.deepEqual([conv.messages.at(-2)!.versions.length, conv.messages.at(-1)!.versions.length], [2, 4]);

    // Every brain's view has the note framed in its place: the default brain's next turn, and the Dice Master's.
    for (const brain of ["Assistant", "Dice Master"]) {
      const body = (await json(["prompt.preview", "--conversation", c, "--brain", brain])).body as ChatRequest;
      assert.equal(body.messages.filter((x) => x.content === framed(second).content).length, 1, brain);
    }
    // Deleting the note takes it out of every later request (the Muse stays, a brain like any other).
    await ok(["message.delete", "--conversation", c, "--message", notes[0]!.id]);
    for (const brain of ["Assistant", "Dice Master"]) {
      const body = (await json(["prompt.preview", "--conversation", c, "--brain", brain])).body as ChatRequest;
      assert.ok(!JSON.stringify(body).includes("<!-- from: Muse -->"), brain);
    }
    assert.ok(muse(await get(c)));
  });

  test("the stream: the note is kept when the reply breaks or stops, and the retry is a plain re-roll that answers it", async () => {
    const c = await start();
    const id = (await get(c)).messages[1]!.id;
    // Mock triggers are read from the last message, which for a brain with no reminder is the framed note.
    const broken = "```hidden\nMOCK_MIDSTREAM_ERROR\n```";
    let evs = await events(await post("message.regenerate", { conversation: c, thought: broken }));
    const err = evs.at(-1);
    assert.equal(err.type, "error");
    assert.deepEqual(err.error.details.retry, { command: "message.regenerate", args: { conversation: c, message: id } }, "a plain re-roll: the note is in the ledger");
    assert.match(err.error.message, /The Muse's note m_\w+ stays, so a plain regenerate \(no thought\) answers it/);
    let conv = await get(c);
    assert.deepEqual([conv.messages.length, conv.messages[2]!.versions.length], [3, 1], "the note stays; no new version");
    const plain = await json(["prompt.preview", "--conversation", c, "--regenerate"]);
    assert.deepEqual(plain.body.messages.at(-1), framed(broken), "the plain re-roll answers the note");

    // A stop mid-reply keeps the partial reply as the new version (the reply alone); the note was saved first.
    const slow = "```hidden\nMOCK_SLOW take your time\n```";
    const res = await post("message.regenerate", { conversation: c, thought: slow });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    while ((text.match(/"type":"delta"/g) ?? []).length < 3) text += (await reader.read()).value ?? "";
    const stop = (await (await post("generation.stop", { conversation: c })).json()) as { stopped: boolean; message: LedgerMessage };
    for (let r = await reader.read(); !r.done; r = await reader.read()) text += r.value;
    evs = text.trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(stop.stopped, true);
    conv = await get(c);
    const note = conv.messages[1]!;
    assert.deepEqual([note.versions.length, note.versions[1]!.content], [2, slow], "the note's new version is kept");
    const v = conv.messages[2]!.versions[1]!;
    assert.deepEqual([v.stopped, v.thought], [true, slow]);
    assert.equal(v.content, streamed(evs), "what streamed is what is saved: the partial reply alone");
    assert.ok(v.content.startsWith("MOCK reply"));
  });

  test("an image brain: the note goes in before its reminder, the new prompt is saved alone, the note's text beside it", async () => {
    const c = await start();
    await ok(["brain.add", "--conversation", c, "--name", "Scene Painter", "--kind", "image", "--system-prompt", "You paint the scene."]);
    await ok(["turn", "--conversation", c, "--brain", "Scene Painter"]);
    const preview = await json(["prompt.preview", "--conversation", c, "--regenerate", "--thought", NOTE]);
    assert.deepEqual(preview.body.messages.at(-2), framed(NOTE));
    assert.equal(preview.body.messages.at(-1).role, "user");
    const evs = await events(await post("message.regenerate", { conversation: c, thought: NOTE }));
    assert.equal(evs[0].type, "muse_note");
    assert.equal(evs[1].thought, NOTE);
    assert.ok(!evs.some((e) => e.type === "delta"), "an image prompt streams as prompt events only");
    assert.deepEqual(lastSent(), preview.body);
    await ok(["image.follow", "--conversation", c, "--message", evs[1].messageId]); // the image lands
    const conv = await get(c);
    const v = conv.messages.at(-1)!.versions[1]!;
    assert.equal(conv.messages.at(-2)!.versions[0]!.content, NOTE, "the note, right before the painter's message");
    assert.equal(v.thought, NOTE);
    assert.equal(v.content, streamed(evs.map((e) => (e.type === "prompt" ? { ...e, type: "delta" } : e))), "the prompt alone, word for word");
    assert.ok(!v.content.startsWith("```"), "no hidden block goes to the image model");
  });

  test("by hand: message.add --as Muse adds the Muse and writes a note the next turn answers; set-author moves a note to it", async () => {
    const c = await start();
    const r = await ok(["message.add", "--conversation", c, "--as", "muse", "--content", NOTE]);
    assert.match(r.stdout, /Added a brain called Muse \(b_\w+\): fresh takes' notes are its/);
    const conv = await get(c);
    assert.equal(conv.brains.filter((b) => b.name === "Muse").length, 1);
    const body = (await json(["prompt.preview", "--conversation", c])).body as ChatRequest;
    assert.deepEqual(body.messages.at(-1), framed(NOTE), "the GM's turn answers the note");
    // A second add finds the same Muse; set-author to the Muse moves a note of yours to it.
    await ok(["message.add", "--conversation", c, "--as", "Muse", "--content", "Another idea."]);
    const mine = (await json(["message.add", "--conversation", c, "--as", "player", "--content", "```hidden\nMy idea.\n```"])).message as LedgerMessage;
    await ok(["message.set-author", "--conversation", c, "--message", mine.id, "--as", "Muse"]);
    const after = await get(c);
    assert.equal(after.brains.filter((b) => b.name === "Muse").length, 1);
    assert.deepEqual(after.messages.at(-1)!.author, { type: "brain", brainId: muse(after)!.id });
    // An image brain called Muse can't write notes: the fresh take says what to do.
    const c2 = await start();
    await ok(["brain.add", "--conversation", c2, "--name", "Muse", "--kind", "image", "--system-prompt", "Paint."]);
    await fails(["message.regenerate", "--conversation", c2, "--thought", "x"], /Muse here is an image brain\. Rename it/);
  });

  test("old files: T15's thought template becomes the Muse's note (schema 7), a changed one is kept; T15 fresh-take versions load; clone and import carry the note", async () => {
    const c = await start();
    await ok(["message.regenerate", "--conversation", c, "--thought", NOTE]);
    const file = join(t.config.dataDir, "users", "dev-t17", "conversations", `${c}.json`);
    const old = JSON.parse(readFileSync(file, "utf8")) as Conversation;
    // As T15 left it: schema 6, its thought template, and a merged fresh-take version (thought + reply).
    old.schemaVersion = 6;
    old.templates.thought = T15_THOUGHT_TEMPLATE;
    const merged = "```hidden\nGoblins.\n\nThat sounds good, I'll respond next.\n```\n\nThe figure is short.";
    old.messages[2]!.versions.push({ content: merged, thought: "```hidden\nGoblins.\n\nThat sounds good, I'll respond next.\n```", source: "generated", createdAt: old.createdAt });
    old.messages[2]!.activeVersion = 2;
    writeFileSync(file, JSON.stringify(old));
    const loaded = await get(c);
    assert.equal(loaded.schemaVersion, SCHEMA_VERSION);
    assert.equal(loaded.templates.thought, DEFAULT_TEMPLATES.thought);
    assert.match(DEFAULT_TEMPLATES.thought, /\{\{brain\}\}/);
    const shown = (await ok(["message.get", "--conversation", c, "--message", loaded.messages[2]!.id])).stdout;
    assert.match(shown, /version 3\/3 \(active\) · generated · fresh take ──\n\[Hidden · 3 lines\]\n\nThe figure is short\.(\n|$)/, "a T15 version shows as it was, its thought at its head");
    // A template someone changed is theirs.
    old.templates.thought = "(thinking: {{thought}})";
    writeFileSync(file, JSON.stringify(old));
    assert.equal((await get(c)).templates.thought, "(thinking: {{thought}})");
    await fails(["conversation.update", "--id", c, "--templates.thought", "```hidden\n\n```"], /thought template has no \{\{thought\}\}/);

    const copy = (await json(["conversation.clone", "--id", c])) as Conversation;
    const m = muse(copy) as Brain;
    assert.ok(m);
    assert.deepEqual(copy.messages[1]!.author, { type: "brain", brainId: m.id }, "the note, by the copy's Muse");
    assert.equal(copy.messages[2]!.versions[1]!.thought, NOTE);
    // A campaign file (conversation.get --json is one) brings the Muse and its note; T15's template is swapped there too.
    const doc = await get(c);
    doc.templates.thought = T15_THOUGHT_TEMPLATE;
    doc.schemaVersion = 6;
    const r = await t.cli(["conversation.import", "--campaign", "-", "--json"], { stdin: JSON.stringify(doc) });
    assert.equal(r.code, 0, r.stderr);
    const imported = JSON.parse(r.stdout) as Conversation;
    assert.equal(imported.templates.thought, DEFAULT_TEMPLATES.thought);
    assert.equal(imported.messages[1]!.versions[0]!.content, NOTE);
    assert.equal(muse(imported)?.id, (imported.messages[1]!.author as { brainId: string }).brainId);

    // T17 QA-2: the swap is once, for files from before schema 7. T15's wording, set on purpose since, is yours.
    await ok(["conversation.update", "--id", imported.id, "--templates.thought", T15_THOUGHT_TEMPLATE]);
    assert.equal((await get(imported.id)).templates.thought, T15_THOUGHT_TEMPLATE, "a schema-7 file keeps T15's wording");
    const again = await get(imported.id);
    const r2 = await t.cli(["conversation.import", "--campaign", "-", "--json"], { stdin: JSON.stringify(again) });
    assert.equal(r2.code, 0, r2.stderr);
    assert.equal((JSON.parse(r2.stdout) as Conversation).templates.thought, T15_THOUGHT_TEMPLATE, "and so does its export, imported");
  });

  test("the Muse's own messages (T17 triage): one it generated stays and the note goes in after it; an image Muse is a 400; the payload says what the note will do", async () => {
    // QA-1: a brain called Muse that writes poems. Its poem, right before the reply, is not a note to re-version.
    const c = await start();
    await ok(["brain.add", "--conversation", c, "--name", "Muse", "--system-prompt", "You are a poet.", "--no-final-reminder.enabled"]);
    await ok(["turn", "--conversation", c, "--brain", "Muse", "--content", "Write me a poem."]);
    await ok(["turn", "--conversation", c]);
    const poem = (await get(c)).messages.at(-2)!;
    const IDEA2 = "Critique the poem kindly.";
    const preview = await json(["prompt.preview", "--conversation", c, "--regenerate", "--thought", IDEA2]);
    assert.equal(preview.regenerate.note.isNew, true, "a new note, after the poem");
    assert.match(preview.notes[0], /the player sees it as written \(it has no ```hidden block/, "QA-5: a note with no hidden block isn't folded");
    const r = await ok(["message.regenerate", "--conversation", c, "--thought", IDEA2]);
    assert.match(r.stderr, /right before the reply: every brain reads it\]\nCritique the poem kindly\./, "QA-5: the CLI prints a note the player sees in full");
    assert.deepEqual(lastSent(), preview.body);
    const after = await get(c);
    const p = after.messages.find((m) => m.id === poem.id)!;
    assert.deepEqual([p.versions.length, p.activeVersion, p.versions[0]!.source], [1, 0, "generated"], "the poem is untouched");
    assert.deepEqual(after.messages.slice(-3).map((m) => (m.id === poem.id ? "poem" : activeVersionText(m))), ["poem", IDEA2, activeVersionText(after.messages.at(-1)!)]);
    // The note this fresh take wrote is the one the next one re-versions.
    const second = await json(["prompt.preview", "--conversation", c, "--regenerate", "--thought", "Praise it instead."]);
    assert.deepEqual([second.regenerate.note.isNew, second.regenerate.note.version], [false, 2]);

    // QA-3: an image brain called Muse is a 400 bad_brain (the browser shows the words), not a 409 conflict.
    const c2 = await start();
    await ok(["brain.add", "--conversation", c2, "--name", "Muse", "--kind", "image", "--system-prompt", "Paint."]);
    const res = await post("message.regenerate", { conversation: c2, thought: "x" });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "bad_brain");

    // QA-6: a Muse that makes brains makes one from a new note, and the payload view says so.
    const c3 = await start();
    await ok(["message.add", "--conversation", c3, "--as", "Muse", "--content", "A note."]);
    await ok(["brain.update", "--conversation", c3, "--brain", "Muse", "--makes.name", "Idea {{n}}", "--makes.blueprint.system-prompt", "You are an idea."]);
    await ok(["turn", "--conversation", c3, "--content", "Go on."]);
    const made = await json(["prompt.preview", "--conversation", c3, "--regenerate", "--thought", "Another note."]);
    assert.ok(made.notes.some((n: string) => /^Muse makes a brain from each new message, so this note will make one too: Idea 1/.test(n)), made.notes.join("\n"));
  });
});
