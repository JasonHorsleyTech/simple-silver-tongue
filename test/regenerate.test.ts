import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { ChatRequest, Conversation, LedgerMessage } from "../src/conversations/types.ts";
import { MOCK_MARKDOWN } from "../src/dev/mock-markdown.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 };
const STEER_HEAD = "<!-- Behind-the-scenes direction from the user. This is not part of the conversation. Write your previous response again, following this direction: -->";

describe("steered regeneration, versions, edit and delete: CLI → server → mock Venice (T03)", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    t = await startTestServer();
    await createUser(t.config.dataDir, "dev-t03", "", FAST_KDF);
  });
  after(() => t.close());

  const ok = async (argv: string[]) => {
    const r = await t.cli(argv);
    assert.equal(r.code, 0, `${argv.join(" ")}\n${r.stderr}`);
    return r;
  };
  const json = async (argv: string[]) => JSON.parse((await ok([...argv, "--json"])).stdout);
  const fails = async (argv: string[], code: RegExp) => {
    const r = await t.cli(argv);
    assert.equal(r.code, 1, argv.join(" "));
    assert.match(r.stderr, code);
  };
  const login = () => ok(["auth.login", "--username", "dev-t03", "--password", ""]);
  const get = async (id: string) => (await json(["conversation.get", "--id", id])) as Conversation;
  const lastSent = () => t.mock.state.requests.find((r) => r.path === "/chat/completions")?.body as ChatRequest;
  const sentCount = () => t.mock.state.requests.filter((r) => r.path === "/chat/completions").length;
  const preview = async (c: string, ...extra: string[]) => (await json(["prompt.preview", "--conversation", c, ...extra])).body as ChatRequest;
  const chat = async (turns: string[]) => {
    const conv = (await json(["conversation.create", "--title", "Colors", "--system-prompt", "You answer in one word."])) as Conversation;
    for (const content of turns) await ok(["turn", "--conversation", conv.id, "--content", content]);
    return conv.id;
  };
  const cookie = () => `ss_session=${JSON.parse(readFileSync(join(t.config.runDir, "cli-session.json"), "utf8")).token}`;
  const post = (cmd: string, body: unknown) =>
    t.app.fetch(new Request(`http://localhost/api/${cmd}`, { method: "POST", headers: { host: "localhost", "content-type": "application/json", cookie: cookie() }, body: JSON.stringify(body) }));
  const lines = async (res: Response) => (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  /** Poll until `fn` returns a value: the drain after a stop records its cost a little later. */
  const until = async <T,>(fn: () => Promise<T | undefined>, what: string, ms = 5000): Promise<T> => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) {
      const v = await fn();
      if (v !== undefined) return v;
    }
    assert.fail(`timed out waiting for ${what}`);
  };
  /** Start a stream, read it until `n` deltas have arrived, then stop it. Returns the whole stream and the stop's result. */
  const stopAfter = async (cmd: string, args: Record<string, unknown>, n: number) => {
    const res = await post(cmd, args);
    assert.equal(res.status, 200);
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    while ((text.match(/"type":"delta"/g) ?? []).length < n) text += (await reader.read()).value ?? "";
    const stop = (await (await post("generation.stop", args.conversation ? { conversation: args.conversation } : {})).json()) as { stopped: boolean; message: LedgerMessage; note: string };
    for (let r = await reader.read(); !r.done; r = await reader.read()) text += r.value;
    return { events: text.trim().split("\n").map((l) => JSON.parse(l)), stop };
  };
  const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

  test("green, blue, green: each steer is sent once, revises the active version, and leaves no trace in the next prompt", async () => {
    await login();
    const c = await chat(["What color is a lime?"]);
    const [question, reply] = (await get(c)).messages as [LedgerMessage, LedgerMessage];
    const v1 = reply.versions[0]!.content;

    // Each steered request is previewed first, then must be exactly what the mock receives.
    const steered = async (steer: string) => {
      const want = await preview(c, "--regenerate", "--steer", steer);
      const r = await ok(["message.regenerate", "--conversation", c, "--steer", steer]);
      assert.deepEqual(lastSent(), want, "preview --regenerate is the request");
      return { body: want, r };
    };
    const blue = await steered("Say it's blue.");
    assert.deepEqual(blue.body.messages.slice(1), [
      { role: "user", content: `<!-- from: the user -->\nWhat color is a lime?` },
      { role: "assistant", content: v1 }, // the reply being revised stays in, before the steer
      { role: "user", content: `${STEER_HEAD}\nSay it's blue.` },
    ]);
    assert.match(blue.r.stderr, /\[Assistant · version 2\/2 · steered · /);
    const v2 = (await get(c)).messages[1]!.versions[1]!.content;

    const green = await steered("No, say it's green.");
    assert.deepEqual(green.body.messages.slice(2), [
      { role: "assistant", content: v2 }, // revises version 2, the active one, and carries no earlier steer
      { role: "user", content: `${STEER_HEAD}\nNo, say it's green.` },
    ]);

    let msg = (await get(c)).messages[1]!;
    assert.equal(msg.id, reply.id, "regenerate adds versions to the same message");
    assert.deepEqual(
      msg.versions.map((v) => [v.steer, v.steeredFrom, v.source]),
      [[undefined, undefined, "generated"], ["Say it's blue.", 0, "generated"], ["No, say it's green.", 1, "generated"]],
    );
    assert.equal(msg.activeVersion, 2);
    const v3 = msg.versions[2]!.content;

    // The next turn: system, the question, the active version as if the brain wrote it on its own, the new message.
    const next = await preview(c, "--content", "Why?");
    assert.deepEqual(next.messages, [
      { role: "system", content: "You answer in one word." },
      { role: "user", content: "<!-- from: the user -->\nWhat color is a lime?" },
      { role: "assistant", content: v3 },
      { role: "user", content: "<!-- from: the user -->\nWhy?" },
    ]);
    const others = JSON.stringify(next.messages.filter((m) => m.role !== "assistant"));
    for (const trace of ["Behind-the-scenes", "blue", "green"]) assert.ok(!others.includes(trace), trace);
    assert.ok(!JSON.stringify(next).includes(v1) && !JSON.stringify(next).includes(v2), "inactive versions are never sent");

    // Go back to version 2 and keep playing from it: a steer now revises version 2, as version 4.
    assert.match((await ok(["message.select-version", "--conversation", c, "--message", reply.id, "--version", "2"])).stdout, /now shows version 2\/3 \(steer: "Say it's blue\."\)/);
    assert.deepEqual((await preview(c, "--content", "Why?")).messages[2], { role: "assistant", content: v2 });
    const iambic = await steered("Make it iambic pentameter.");
    assert.deepEqual(iambic.body.messages.at(-2), { role: "assistant", content: v2 });
    msg = (await get(c)).messages[1]!;
    assert.deepEqual([msg.activeVersion, msg.versions[3]!.steeredFrom], [3, 1]);
    assert.match((await ok(["message.get", "--conversation", c, "--message", reply.id])).stdout, /version 4\/4 \(active\) · generated · steer "Make it iambic pentameter\." on version 2/);

    // A plain re-roll leaves the message out, so the request ends with the question.
    const reroll = await preview(c, "--regenerate");
    assert.deepEqual(reroll.messages.slice(1), [{ role: "user", content: "<!-- from: the user -->\nWhat color is a lime?" }]);
    await ok(["message.regenerate", "--conversation", c, "--message", reply.id, "--steer", "   "]); // blank = re-roll
    assert.deepEqual(lastSent(), reroll);
    msg = (await get(c)).messages[1]!;
    assert.deepEqual([msg.versions.length, msg.activeVersion, msg.versions[4]!.steer], [5, 4, undefined]);
    assert.equal(question.versions.length, 1, "the player message is untouched");
  });

  test("regenerate is refused for anything but the last message, when it's a brain's; nothing is sent", async () => {
    await login();
    const c = await chat(["one", "two"]);
    const [p1, a1, , a2] = (await get(c)).messages as LedgerMessage[];
    const before = sentCount();
    await fails(["message.regenerate", "--conversation", c, "--message", a1!.id], new RegExp(`Only the last message can be regenerated, and ${a1!.id} is not the last one \\(${a2!.id} is\\)`));
    await fails(["message.regenerate", "--conversation", c, "--message", p1!.id, "--steer", "x"], /is not the last one/);
    await fails(["prompt.preview", "--conversation", c, "--regenerate", "--message", a1!.id], /is not the last one/);
    await ok(["message.delete", "--conversation", c, "--message", a2!.id]);
    await fails(["message.regenerate", "--conversation", c], /is your own message, so there is no reply to regenerate/);
    await fails(["prompt.preview", "--conversation", c, "--steer", "x"], /only apply to a regenerate preview/);
    await fails(["prompt.preview", "--conversation", c, "--regenerate", "--content", "x"], /takes no content, roll or brain/);
    assert.equal(sentCount(), before, "nothing went upstream");
  });

  test("edit and delete any message at any depth: the next prompt treats the new text as what was always there", async () => {
    await login();
    const c = await chat(["Turn one.", "Turn two.", "Turn three.", "Turn four."]);
    const ids = (await get(c)).messages.map((m) => m.id);
    // A user message 3 turns back and an assistant message 2 turns back.
    await ok(["message.edit", "--conversation", c, "--message", ids[2]!, "--content", "Turn two, EDITED."]);
    await ok(["message.edit", "--conversation", c, "--message", ids[5]!, "--content", "An EDITED answer."]);
    let body = await preview(c, "--content", "Turn five.");
    assert.deepEqual(body.messages[3], { role: "user", content: "<!-- from: the user -->\nTurn two, EDITED." });
    assert.deepEqual(body.messages[6], { role: "assistant", content: "An EDITED answer." });
    // (The mock's own reply to turn two still quotes the old text: that reply is what it was, and wasn't edited.)
    assert.ok(!body.messages.some((m) => m.role === "user" && m.content.endsWith("Turn two.")));
    await ok(["turn", "--conversation", c, "--content", "Turn five."]);
    const sent = t.mock.state.requests.find((r) => r.path === "/chat/completions")!.body as ChatRequest;
    assert.deepEqual(sent.messages, [...body.messages], "and that is what was sent");
    const edited = (await get(c)).messages[5]!.versions[0]!;
    assert.deepEqual([edited.content, edited.edited, edited.source], ["An EDITED answer.", true, "generated"]);

    // Delete a pair in the middle: gone from every later prompt.
    await ok(["message.delete", "--conversation", c, "--message", ids[2]!]);
    assert.match((await ok(["message.delete", "--conversation", c, "--message", ids[3]!])).stdout, /Deleted m_\w+\. 8 messages left\./);
    body = await preview(c, "--content", "six");
    assert.equal(body.messages.length, 10);
    assert.ok(!JSON.stringify(body).includes("Turn two"), "both gone, and with them the only reply that quoted it");

    await fails(["message.edit", "--conversation", c, "--message", ids[0]!, "--content", "  "], /can't be empty\. To remove a message, delete it/);
    await fails(["message.edit", "--conversation", c, "--message", "m_nosuchmsg", "--content", "x"], /No message m_nosuchmsg/);
    await fails(["message.select-version", "--conversation", c, "--message", ids[0]!, "--version", "2"], /has 1 version, so there is no version 2/);
  });

  test("while a reply is generated the ledger can't change (409); generation.stop keeps what had arrived", async () => {
    await login();
    const c = await chat(["Hello."]);
    const [p1, a1] = (await get(c)).messages as LedgerMessage[];

    // A slow, long steered regenerate (seconds of text), followed from another "tab", then stopped after a few deltas.
    const STEER = "MOCK_SLOW MOCK_MARKDOWN longer please";
    const res = await post("message.regenerate", { conversation: c, steer: STEER });
    assert.equal(res.status, 200);
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    while ((text.match(/"type":"delta"/g) ?? []).length < 3) text += (await reader.read()).value ?? "";
    for (const [cmd, args] of [
      ["message.edit", { conversation: c, message: p1!.id, content: "x" }],
      ["message.delete", { conversation: c, message: p1!.id }],
      ["message.select-version", { conversation: c, message: a1!.id, version: 1 }],
      ["turn", { conversation: c, content: "me too" }],
    ] as const) {
      const r = await post(cmd, args);
      assert.equal(r.status, 409, cmd);
    }
    const follow = post("generation.follow", { conversation: c });
    const stop = await post("generation.stop", { conversation: c });
    const outcome = (await stop.json()) as { stopped: boolean; message: LedgerMessage };
    for (let r = await reader.read(); !r.done; r = await reader.read()) text += r.value;
    const own = text.trim().split("\n").map((l) => JSON.parse(l));
    const followed = await lines(await follow);

    assert.deepEqual(own[0], { type: "start", brainId: own[0].brainId, brainName: "Assistant", messageId: a1!.id, regenerate: true, kind: "text", model: "deepseek-v4-1-flash", conversationTitle: own[0].conversationTitle, steer: STEER });
    assert.deepEqual(followed.slice(0, 2).map((e) => e.type), ["following", "start"]);
    assert.equal(followed[1].regenerate, true, "a reloaded tab knows to render it in the message's slot");
    assert.equal(own.at(-1).type, "done");
    assert.deepEqual(followed.at(-1), own.at(-1));
    assert.equal(outcome.stopped, true);
    const saved = (await get(c)).messages[1]!;
    assert.deepEqual(outcome.message, saved, "stop returns once the stopped version is saved");
    const v = saved.versions[1]!;
    assert.deepEqual([saved.activeVersion, v.stopped, v.steer], [1, true, STEER]);
    const streamed = own.filter((e) => e.type === "delta").map((e) => e.delta).join("");
    assert.equal(v.content, streamed, "the partial text is exactly what had streamed");
    assert.ok(v.content.length > 0 && !v.content.includes(MOCK_MARKDOWN.trim().slice(-40)), "cut short");

    // The lock is free again, and nothing is running to stop.
    assert.match((await ok(["generation.stop", "--conversation", c])).stdout, /Nothing is being generated/);
    await ok(["message.select-version", "--conversation", c, "--message", a1!.id, "--version", "1"]);
  });

  test("stop before any reply text: a turn keeps only the player message, a regenerate keeps the current version", async () => {
    await login();
    const c = await chat(["Hello."]);
    await ok(["brain.update", "--conversation", c, "--reasoning.enabled"]); // reasoning streams first, then text
    const stopAtFirst = async (cmd: string, args: unknown) => {
      const res = await post(cmd, args);
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let text = "";
      while (!text.includes('"type":"reasoning"')) text += (await reader.read()).value ?? "";
      const stop = (await (await post("generation.stop", { conversation: c })).json()) as { stopped: boolean; message: unknown; error?: { code: string; message: string }; note: string };
      for (let r = await reader.read(); !r.done; r = await reader.read()) text += r.value;
      return { stop, last: JSON.parse(text.trim().split("\n").at(-1)!) };
    };

    const spentBefore = (await get(c)).spentUsd!;
    const balanceBefore = t.mock.state.balanceUsd;
    let r = await stopAtFirst("turn", { conversation: c, content: "MOCK_SLOW again" });
    assert.equal(r.last.type, "error");
    assert.match(r.last.error.message, /^Stopped before any reply text arrived\. Your message is saved; the reply isn't\. To get a reply, send again to Assistant with no new message: turn --brain b_\w+ without --content\.$/);
    assert.equal(r.last.error.code, "stopped");
    assert.deepEqual(r.stop, { stopped: true, message: null, error: r.last.error, note: r.stop.note });
    assert.match(r.stop.note, /^Stopping saves waiting, not money/);
    assert.deepEqual((await get(c)).messages.map((m) => m.author.type), ["player", "brain", "player"]);
    // Nothing was saved, but Venice billed the reply, so the drain adds what it cost to the running total (T03 QA-2).
    const spent = await until(async () => {
      const s = (await get(c)).spentUsd!;
      return s > spentBefore ? s : undefined;
    }, "the drained cost");
    close(spent - spentBefore, balanceBefore - t.mock.state.balanceUsd);

    await ok(["turn", "--conversation", c]); // answer it, so there is a reply to regenerate
    r = await stopAtFirst("message.regenerate", { conversation: c, steer: "MOCK_SLOW" });
    assert.match(r.last.error.message, /^Stopped before any reply text arrived\. No new version was saved; m_\w+ keeps its current version\.$/);
    const last = (await get(c)).messages[3]!;
    assert.deepEqual([last.versions.length, last.activeVersion], [1, 0]);
  });

  test("a stopped reply's real cost arrives from the drain, and the total never goes down when messages are deleted (T03 QA-2)", async () => {
    await login();
    const c = await chat(["Hello."]);
    const first = (await get(c)).messages[1]!.versions[0]!.costUsd!;
    close((await get(c)).spentUsd!, first);

    // A turn stopped after two deltas: the partial text is saved at once, and the whole reply's cost a moment later.
    let balance = t.mock.state.balanceUsd;
    const turn = await stopAfter("turn", { conversation: c, content: "MOCK_SLOW count to ten slowly" }, 2);
    assert.match(turn.stop.note, /Venice still writes and bills the whole reply/);
    const id = turn.stop.message.id;
    const streamed = turn.events.filter((e) => e.type === "delta").map((e) => e.delta).join("");
    const turnCost = await until(async () => (await get(c)).messages.find((m) => m.id === id)!.versions[0]!.costUsd, "the stopped turn's cost");
    const billed = balance - t.mock.state.balanceUsd;
    close(turnCost, billed);
    let v = (await get(c)).messages.find((m) => m.id === id)!.versions[0]!;
    assert.deepEqual([v.stopped, v.content], [true, streamed], "the text stays what had arrived; only the cost is added");
    assert.ok(v.usage!.completionTokens > Math.ceil(streamed.length / 4), "usage is the whole reply's, as billed");
    close((await get(c)).spentUsd!, first + turnCost);

    // A regenerate stopped the same way: the cost lands on the new version, not the old one.
    balance = t.mock.state.balanceUsd;
    await stopAfter("message.regenerate", { conversation: c, steer: "MOCK_SLOW once more" }, 2);
    const regenCost = await until(async () => (await get(c)).messages.find((m) => m.id === id)!.versions[1]?.costUsd, "the stopped regenerate's cost");
    close(regenCost, balance - t.mock.state.balanceUsd);
    v = (await get(c)).messages.find((m) => m.id === id)!.versions[0]!;
    close(v.costUsd!, turnCost);
    const total = first + turnCost + regenCost;
    close((await get(c)).spentUsd!, total);

    // Deleting messages removes them from every prompt, not from the bill.
    for (const m of (await get(c)).messages) await ok(["message.delete", "--conversation", c, "--message", m.id]);
    const after = await get(c);
    assert.equal(after.messages.length, 0);
    close(after.spentUsd!, total);
    const listed = (await json(["conversation.list"])).conversations.find((x: { id: string }) => x.id === c);
    close(listed.costUsd, total);
  });

  test("a steer template without {{instruction}} is refused, never silently dropping the steer (T03 QA-3)", async () => {
    await login();
    const c = await chat(["What color is a lime?"]);
    for (const broken of ["", "   ", "Rewrite it."]) {
      await fails(["conversation.update", "--id", c, "--templates.steer", broken], /steer template has no \{\{instruction\}\}, so your steer would be left out/);
    }
    await fails(["conversation.update", "--id", c, "--templates.player", "<!-- from: the user -->"], /player template has no \{\{content\}\}/);
    assert.equal((await get(c)).templates.steer, STEER_HEAD + "\n{{instruction}}", "nothing was changed");

    // A file written before the check (or by hand) is refused where the template is used, with nothing sent.
    const file = join(t.config.dataDir, "users", "dev-t03", "conversations", `${c}.json`);
    const doc = JSON.parse(readFileSync(file, "utf8")) as Conversation;
    doc.templates.steer = "";
    writeFileSync(file, JSON.stringify(doc));
    const before = sentCount();
    await fails(["prompt.preview", "--conversation", c, "--regenerate", "--steer", "Hidden?"], /steer template has no \{\{instruction\}\}/);
    await fails(["message.regenerate", "--conversation", c, "--steer", "Hidden?"], /steer template has no \{\{instruction\}\}/);
    assert.equal(sentCount(), before, "nothing went upstream");
    await ok(["message.regenerate", "--conversation", c]); // a plain re-roll doesn't use the steer template
  });
});
