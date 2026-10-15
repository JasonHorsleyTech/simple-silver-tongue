import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { DEFAULT_TEMPLATES } from "../src/conversations/defaults.ts";
import { freshTakeContent } from "../src/conversations/turn.ts";
import { SCHEMA_VERSION, type ChatRequest, type Conversation, type LedgerMessage } from "../src/conversations/types.ts";
import { THOUGHT_LAST_NOTE } from "../src/conversations/wording.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 };
const THOUGHT = "```hidden\nThe hooded stranger is always an old man. Subvert it: three goblins in a trench coat.\n\nThat sounds good, I'll respond next.\n```";

describe("a fresh take: regenerate with a thought planted as the brain's own words (T15)", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    t = await startTestServer({ mock: { slowDelayMs: 60 } });
    await createUser(t.config.dataDir, "dev-t15", "", FAST_KDF);
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
  const cookie = () => `ss_session=${JSON.parse(readFileSync(join(t.config.runDir, "cli-session.json"), "utf8")).token}`;
  const post = (cmd: string, body: unknown) =>
    t.app.fetch(new Request(`http://localhost/api/${cmd}`, { method: "POST", headers: { host: "localhost", "content-type": "application/json", cookie: cookie() }, body: JSON.stringify(body) }));
  const events = async (res: Response) => (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  const streamed = (evs: { type: string; delta?: string }[]) => evs.filter((e) => e.type === "delta").map((e) => e.delta).join("");
  const start = async () => {
    await ok(["auth.login", "--username", "dev-t15", "--password", ""]);
    const c = (await json(["conversation.create", "--title", "Tavern", "--system-prompt", "You are the GM."])) as Conversation;
    await ok(["turn", "--conversation", c.id, "--content", "I walk up to the hooded figure."]);
    return c.id;
  };

  test("no final reminder: the request ends on the thought; preview == send; saved merged, marked, and every later request carries it", async () => {
    const c = await start();
    const v1 = (await get(c)).messages[1]!.versions[0]!.content;

    const preview = await json(["prompt.preview", "--conversation", c, "--regenerate", "--thought", THOUGHT]);
    assert.deepEqual(preview.body.messages.slice(1), [
      { role: "user", content: "<!-- from: the user -->\nI walk up to the hooded figure." },
      { role: "assistant", content: THOUGHT }, // the old reply is left out; the thought is the brain's own, last
    ]);
    assert.equal(preview.refusal, undefined, "allowed for this one body");
    assert.equal(preview.notes[0], THOUGHT_LAST_NOTE);
    assert.equal(preview.regenerate.thought, THOUGHT);
    assert.match((await ok(["prompt.preview", "--conversation", c, "--regenerate", "--thought", THOUGHT])).stdout, /a fresh take, so the message is left out and your thought goes in as Assistant's own words/);

    const r = await ok(["message.regenerate", "--conversation", c, "--thought", THOUGHT]);
    assert.deepEqual(lastSent(), preview.body, "the preview is the request");
    assert.match(r.stdout, /^\[Hidden · 3 lines\]\n\nMOCK reply to brain/, "the thought streams first, folded like any note");
    assert.match(r.stderr, /\[Assistant · version 2\/2 · fresh take · /);

    const m = (await get(c)).messages[1]!;
    const v2 = m.versions[1]!;
    assert.equal(m.activeVersion, 1);
    assert.equal(v2.thought, THOUGHT, "marked as a fresh take, for display");
    assert.equal(v2.steer, undefined);
    assert.ok(v2.content.startsWith(`${THOUGHT}\n\nMOCK reply to brain`), "saved merged: the thought, a blank line, the reply");
    assert.equal(v2.content, freshTakeContent(THOUGHT, v2.content.slice(THOUGHT.length + 2)));

    // The next turn: the merged version is the brain's own reply; the replaced version is gone.
    const next = (await json(["prompt.preview", "--conversation", c, "--content", "Go on."])).body as ChatRequest;
    assert.deepEqual(next.messages.slice(2), [
      { role: "assistant", content: v2.content },
      { role: "user", content: "<!-- from: the user -->\nGo on." },
    ]);
    assert.ok(!JSON.stringify(next).includes(v1));
    assert.match((await ok(["message.get", "--conversation", c, "--message", m.id])).stdout, /version 2\/2 \(active\) · generated · fresh take · \$[0-9.]+ ──\n\[Hidden · 3 lines\]/);
    assert.match((await ok(["message.select-version", "--conversation", c, "--message", m.id, "--version", "2"])).stdout, /version 2\/2 \(a fresh take\)/);

    // --wrap puts the text in the thought template; a steer with it, a blank one, or one outside a regenerate is a 400.
    const wrapped = await json(["prompt.preview", "--conversation", c, "--regenerate", "--thought", "Goblins.", "--wrap"]);
    assert.equal(wrapped.body.messages.at(-1).content, "```hidden\nGoblins.\n\nThat sounds good, I'll respond next.\n```");
    const sent = t.mock.state.requests.length;
    await fails(["message.regenerate", "--conversation", c, "--thought", "x", "--steer", "y"], /a steer .* or a thought .*, not both/);
    await fails(["message.regenerate", "--conversation", c, "--thought", "  "], /thought can't be blank/);
    await fails(["prompt.preview", "--conversation", c, "--thought", "x"], /only apply to a regenerate preview/);
    assert.equal(t.mock.state.requests.length, sent, "nothing went upstream");
  });

  test("a brain with a reminder: the thought goes before it, so the request ends with a user message", async () => {
    const c = await start();
    await ok(["brain.add", "--conversation", c, "--name", "Dice Master", "--system-prompt", "You name the odds."]);
    await ok(["turn", "--conversation", c, "--brain", "Dice Master"]);
    const preview = await json(["prompt.preview", "--conversation", c, "--regenerate", "--thought", THOUGHT]);
    const [thought, reminder] = preview.body.messages.slice(-2);
    assert.deepEqual(thought, { role: "assistant", content: THOUGHT });
    assert.equal(reminder.role, "user");
    assert.match(reminder.content, /^<!-- System reminder -->/);
    assert.ok(!preview.notes.includes(THOUGHT_LAST_NOTE));
    await ok(["message.regenerate", "--conversation", c, "--thought", THOUGHT]);
    assert.deepEqual(lastSent(), preview.body);
  });

  test("the stream: start carries the thought, a break's retry keeps it, a stop keeps the partial version merged", async () => {
    const c = await start();
    const id = (await get(c)).messages[1]!.id;
    // Mock triggers are read from the last message, which here is the thought.
    const broken = "```hidden\nMOCK_MIDSTREAM_ERROR\n```";
    let evs = await events(await post("message.regenerate", { conversation: c, thought: broken }));
    assert.equal(evs[0].type, "start");
    assert.equal(evs[0].thought, broken);
    assert.equal(evs[1].delta, `${broken}\n\n`, "the head streams first");
    const err = evs.at(-1);
    assert.equal(err.type, "error");
    assert.deepEqual(err.error.details.retry, { command: "message.regenerate", args: { conversation: c, message: id, thought: broken } });
    assert.equal((await get(c)).messages[1]!.versions.length, 1, "a break saves nothing");

    const slow = "```hidden\nMOCK_SLOW take your time\n```";
    const res = await post("message.regenerate", { conversation: c, thought: slow });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    while ((text.match(/"type":"delta"/g) ?? []).length < 3) text += (await reader.read()).value ?? "";
    const stop = (await (await post("generation.stop", { conversation: c })).json()) as { stopped: boolean; message: LedgerMessage };
    for (let r = await reader.read(); !r.done; r = await reader.read()) text += r.value;
    evs = text.trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(stop.stopped, true);
    const v = (await get(c)).messages[1]!.versions[1]!;
    assert.deepEqual([v.stopped, v.thought], [true, slow]);
    assert.equal(v.content, streamed(evs), "what streamed is what is saved: the thought, a blank line, the partial reply");
    assert.ok(v.content.startsWith(`${slow}\n\nMOCK reply`));
  });

  test("an image brain: the thought goes in before its reminder, the new prompt is saved alone, the thought beside it", async () => {
    const c = await start();
    await ok(["brain.add", "--conversation", c, "--name", "Scene Painter", "--kind", "image", "--system-prompt", "You paint the scene."]);
    await ok(["turn", "--conversation", c, "--brain", "Scene Painter"]);
    const preview = await json(["prompt.preview", "--conversation", c, "--regenerate", "--thought", THOUGHT]);
    assert.deepEqual(preview.body.messages.at(-2), { role: "assistant", content: THOUGHT });
    assert.equal(preview.body.messages.at(-1).role, "user");
    const evs = await events(await post("message.regenerate", { conversation: c, thought: THOUGHT }));
    assert.equal(evs[0].thought, THOUGHT);
    assert.ok(!evs.some((e) => e.type === "delta"), "an image prompt streams as prompt events only");
    assert.deepEqual(lastSent(), preview.body);
    await ok(["image.follow", "--conversation", c, "--message", evs[0].messageId]); // the image lands
    const v = (await get(c)).messages.at(-1)!.versions[1]!;
    assert.equal(v.thought, THOUGHT);
    assert.equal(v.content, streamed(evs.map((e) => (e.type === "prompt" ? { ...e, type: "delta" } : e))), "the prompt alone, word for word");
    assert.ok(!v.content.includes("Subvert it") && !v.content.startsWith("```"), "no hidden block goes to the image model");
    assert.match((await ok(["message.get", "--conversation", c, "--message", evs[0].messageId])).stdout, /fresh take[^\n]*──\n[^\n]+\n\(the thought it was given, display only:\)\n\[Hidden · 3 lines\]/);
  });

  test("the thought template: older files get the default (schema 5), it must keep {{thought}}, and a clone keeps a version's thought", async () => {
    const c = await start();
    await ok(["message.regenerate", "--conversation", c, "--thought", THOUGHT]);
    const file = join(t.config.dataDir, "users", "dev-t15", "conversations", `${c}.json`);
    const old = JSON.parse(readFileSync(file, "utf8")) as Conversation;
    old.schemaVersion = 4;
    delete (old.templates as Partial<Conversation["templates"]>).thought;
    writeFileSync(file, JSON.stringify(old));
    const loaded = await get(c);
    assert.equal(loaded.schemaVersion, SCHEMA_VERSION);
    assert.equal(loaded.templates.thought, DEFAULT_TEMPLATES.thought);

    await fails(["conversation.update", "--id", c, "--templates.thought", "```hidden\n\n```"], /thought template has no \{\{thought\}\}/);
    await ok(["conversation.update", "--id", c, "--templates.thought", "(thinking: {{thought}})"]);
    const wrapped = await json(["prompt.preview", "--conversation", c, "--regenerate", "--thought", "goblins", "--wrap"]);
    assert.equal(wrapped.body.messages.at(-1).content, "(thinking: goblins)");

    const copy = (await json(["conversation.clone", "--id", c])) as Conversation;
    assert.equal(copy.messages[1]!.versions[1]!.thought, THOUGHT);
    assert.equal(copy.templates.thought, "(thinking: {{thought}})");
    // A campaign file (conversation.get --json is one) brings the thought and the template along.
    const r = await t.cli(["conversation.import", "--campaign", "-", "--json"], { stdin: JSON.stringify(await get(c)) });
    assert.equal(r.code, 0, r.stderr);
    const imported = JSON.parse(r.stdout) as Conversation;
    assert.deepEqual([imported.messages[1]!.versions[1]!.thought, imported.templates.thought], [THOUGHT, "(thinking: {{thought}})"]);
  });
});
