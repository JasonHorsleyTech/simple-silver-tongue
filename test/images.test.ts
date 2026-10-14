import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { Brain, ChatRequest, Conversation, ImageRequest, LedgerMessage } from "../src/conversations/types.ts";
import { finishInFlight, type StopOutcome } from "../src/conversations/store.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 };
const FRAME = "<!-- from: Scene Painter. It called generate_image with this exact prompt: -->";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("image brains: CLI → server → mock Venice, encrypted user (T05)", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    // MOCK_IMAGE_SLOW images take 400 ms and MOCK_SLOW chunks 60 ms: long enough to act mid-way, short for a test.
    t = await startTestServer({ mock: { imageSlowMs: 400, slowDelayMs: 60 } });
    await createUser(t.config.dataDir, "dev-t05", "t05-secret", FAST_KDF);
  });
  after(() => t.close());

  const ok = async (argv: string[]) => {
    const r = await t.cli(argv);
    assert.equal(r.code, 0, `${argv.join(" ")}\n${r.stderr}`);
    return r;
  };
  const json = async (argv: string[]) => JSON.parse((await ok([...argv, "--json"])).stdout);
  const events = async (argv: string[], code: number | undefined = 0) => {
    const r = await t.cli([...argv, "--json"]);
    if (code !== undefined) assert.equal(r.code, code, `${argv.join(" ")}\n${r.stderr}`);
    return r.stdout.trim().split("\n").map((l) => JSON.parse(l)) as Array<{ type: string; [k: string]: any }>;
  };
  const get = async (id: string) => (await json(["conversation.get", "--id", id])) as Conversation;
  const last = async (c: string) => (await get(c)).messages.at(-1)!;
  const sent = (path: string) => t.mock.state.requests.find((r) => r.path === path)?.body;
  const imageFiles = () => readdirSync(join(t.config.dataDir, "users", "dev-t05", "images"));
  const until = async <T,>(fn: () => Promise<T | undefined>, what: string, ms = 5000): Promise<T> => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) {
      const v = await fn();
      if (v !== undefined) return v;
    }
    assert.fail(`timed out waiting for ${what}`);
  };
  /** Wait for a message's images to land: image.follow ends with the message as saved (T05 triage). */
  const settled = async (c: string, id: string) => {
    const evs = await events(["image.follow", "--conversation", c, "--message", id], undefined);
    const m = evs.at(-1)!.message as LedgerMessage;
    assert.ok(m.versions.every((v) => v.image?.status !== "pending"), "nothing pending once image.follow is done");
    return m;
  };

  /** A GM and a Scene Painter whose last message is yours (no reminder), so mock triggers reach the image prompt. */
  async function table() {
    await ok(["auth.login", "--username", "dev-t05", "--password", "t05-secret"]);
    const conv = (await json(["conversation.create", "--title", "Gilded Goat", "--system-prompt", "You are the GM."])) as Conversation;
    await ok(["brain.update", "--conversation", conv.id, "--name", "Game Master"]);
    const painter = (await json(["brain.add", "--conversation", conv.id, "--name", "Scene Painter", "--kind", "image", "--system-prompt", "You paint the scene.", "--no-final-reminder.enabled"])) as Brain;
    return { c: conv.id, painter };
  }

  test("acceptance: a Scene Painter's tool call becomes an image, stored encrypted; the GM sees the exact prompt framed", async () => {
    const { c, painter } = await table();
    const preview = await json(["prompt.preview", "--conversation", c, "--brain", "Scene Painter", "--content", "Paint the hooded figure."]);
    const balance = t.mock.state.balanceUsd;
    const evs = await events(["turn", "--conversation", c, "--brain", "Scene Painter", "--content", "Paint the hooded figure."]);
    assert.deepEqual(sent("/chat/completions"), preview.body, "prompt.preview is the chat request");
    assert.deepEqual((preview.body as ChatRequest).tool_choice, { type: "function", function: { name: "generate_image" } });

    assert.deepEqual(evs.map((e) => e.type).filter((x, i, a) => a[i - 1] !== x), ["message", "start", "prompt", "image_pending", "image_done", "done"]);
    assert.equal(evs.find((e) => e.type === "start")!.kind, "image");
    const prompt = evs.filter((e) => e.type === "prompt").map((e) => e.delta).join("");
    const m = evs.at(-1)!.message as LedgerMessage;
    const v = m.versions[0]!;
    assert.equal(m.kind, "image");
    assert.equal(v.content, prompt, "the prompt streamed as words, and that is the message");
    assert.match(prompt, /^MOCK image prompt after 2 messages; last: "<!-- from: the user --> Paint the hooded figure\."$/);
    assert.deepEqual([v.image?.status, v.image?.mime, v.image?.model, v.image?.safeMode, v.image?.costUsd], ["done", "image/png", "z-image-turbo", true, 0.01]);

    // The image request is the preview's params plus the prompt, word for word, and its cost is counted.
    assert.deepEqual(sent("/image/generate"), { ...preview.image.params, prompt } satisfies ImageRequest);
    const conv = await get(c);
    assert.ok(Math.abs((conv.spentUsd ?? 0) - (balance - t.mock.state.balanceUsd)) < 1e-9, "spentUsd is what the mock charged, image included");

    // image.get writes a valid file; on disk it is ciphertext.
    const out = join(t.tmp, "scene.png");
    await ok(["image.get", "--id", v.image!.id, "--out", out]);
    assert.deepEqual(readFileSync(out).subarray(0, 8), PNG);
    // An encrypted user's image files all end in .bin: the type would hint at the model (T05 QA-6, fixed in T06).
    const disk = readFileSync(join(t.config.dataDir, "users", "dev-t05", "images", `${v.image!.id}.bin`));
    assert.equal(disk.subarray(0, 6).toString(), "SSENC1");
    assert.ok(!disk.includes(PNG), "no PNG bytes on disk");
    const res = await t.app.fetch(new Request(`http://localhost/api/image.get?id=${v.image!.id}`, { headers: { host: "localhost", cookie: cookie() } }));
    assert.deepEqual([res.status, res.headers.get("content-type")], [200, "image/png"], "GET works for <img src>");

    // Every other brain sees the exact prompt, framed; the painter sees its own call and the tool result.
    const gm = (await json(["prompt.preview", "--conversation", c])).body as ChatRequest;
    assert.deepEqual(gm.messages.at(-1), { role: "user", content: `${FRAME}\n${prompt}` });
    const own = (await json(["prompt.preview", "--conversation", c, "--brain", painter.id])).body as ChatRequest;
    assert.deepEqual(own.messages.slice(-2), [
      { role: "assistant", content: "", tool_calls: [{ id: `call_${m.id}`, type: "function", function: { name: "generate_image", arguments: JSON.stringify({ prompt }) } }] },
      { role: "tool", tool_call_id: `call_${m.id}`, content: painter.tool!.resultContent },
    ]);
  });

  test("a steer gives a new prompt and a new image, as a new version; editing the prompt swaps a new image in", async () => {
    const { c } = await table();
    await ok(["turn", "--conversation", c, "--brain", "Scene Painter", "--content", "Paint the bar."]);
    const first = await last(c);
    const steered = await events(["message.regenerate", "--conversation", c, "--steer", "Make it brighter."]);
    const m = steered.at(-1)!.message as LedgerMessage;
    assert.equal(m.id, first.id);
    assert.deepEqual(m.versions.map((v) => [v.steer, v.image?.status]), [[undefined, "done"], ["Make it brighter.", "done"]]);
    assert.notEqual(m.versions[1]!.content, m.versions[0]!.content, "a new prompt");
    assert.notEqual(m.versions[1]!.image!.id, m.versions[0]!.image!.id, "and a new image");
    const gm = (await json(["prompt.preview", "--conversation", c])).body as ChatRequest;
    assert.equal(gm.messages.at(-1)!.content, `${FRAME}\n${m.versions[1]!.content}`);
    assert.ok(!JSON.stringify(gm).includes("Make it brighter"), "no trace of the steer");

    // Edit the active prompt: answered at once, the old image is still shown until the new one is done.
    const old = m.versions[1]!.image!.id;
    const edited = await json(["message.edit", "--conversation", c, "--message", m.id, "--content", "MOCK_IMAGE_SLOW A worn leather coat by the fire."]);
    const pending = edited.message.versions[1].image;
    assert.deepEqual([pending.status, pending.previous?.id, edited.painting.imageId], ["pending", old, pending.id]);
    const again = await t.cli(["message.edit", "--conversation", c, "--message", m.id, "--content", "Something else."]);
    assert.deepEqual([again.code, /its image img_\w+ is still being made/.test(again.stderr)], [1, true], "its own image waits to land first");
    const done = await settled(c, m.id);
    const img = done.versions[1]!.image!;
    assert.deepEqual([img.id, img.status, img.previous], [pending.id, "done", undefined], "swapped in");
    assert.ok(!imageFiles().some((f) => f.startsWith(old)), "the replaced image's file is gone");
    assert.match(((await json(["prompt.preview", "--conversation", c])).body as ChatRequest).messages.at(-1)!.content, /worn leather coat/);
  });

  test("a failed image keeps its prompt and says how to retry; image.retry paints it", async () => {
    const { c } = await table();
    const evs = await events(["turn", "--conversation", c, "--brain", "Scene Painter", "--content", "MOCK_IMAGE_FLAKY the cellar"], 1);
    const err = evs.find((e) => e.type === "image_error")!;
    assert.match(err.error, /Venice 503 on \/image\/generate/);
    assert.deepEqual(err.retry, { command: "image.retry", args: { conversation: c, message: err.messageId } });
    assert.equal(evs.at(-1)!.type, "done", "the message is saved: the stream ends with done");
    const retried = await events(["image.retry", "--conversation", c, "--message", err.messageId]);
    assert.deepEqual(retried.map((e) => e.type), ["start", "image_pending", "image_done", "done"]);
    assert.equal(retried[0]!.imageOnly, true);
    assert.equal((await last(c)).versions[0]!.image!.status, "done");
    const text = await t.cli(["image.retry", "--conversation", c, "--message", (await get(c)).messages[0]!.id]);
    assert.match(text.stderr, /a text message, so it has no image/);
  });

  test("the image finishes and is saved after the client goes away; so does an edit's image after logout", async () => {
    const { c } = await table();
    const body = JSON.stringify({ conversation: c, brain: "Scene Painter", content: "MOCK_IMAGE_SLOW the stairs" });
    await new Promise<void>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: new URL(t.url).port, path: "/api/turn", method: "POST", agent: false, headers: { "content-type": "application/json", cookie: cookie() } }, (res) => {
        let seen = "";
        res.on("data", (d) => {
          seen += d;
          if (seen.includes('"image_pending"')) {
            req.destroy(); // gone mid-image
            resolve();
          }
        });
      });
      req.on("error", () => {});
      req.end(body);
      setTimeout(() => reject(new Error("no image_pending")), 3000);
    });
    const m = await last(c);
    assert.equal(m.versions[0]!.image!.status, "pending");
    assert.equal((await settled(c, m.id)).versions[0]!.image!.status, "done");

    await ok(["message.edit", "--conversation", c, "--message", m.id, "--content", "MOCK_IMAGE_SLOW the stairs, at night"]);
    await ok(["auth.logout"]);
    await ok(["auth.login", "--username", "dev-t05", "--password", "t05-secret"]);
    const after = await settled(c, m.id);
    assert.deepEqual([after.versions[0]!.image!.status, after.versions[0]!.content], ["done", "MOCK_IMAGE_SLOW the stairs, at night"]);
  });

  test("a stop mid-prompt keeps the prompt without an image; once the prompt is saved there is nothing to stop, and the image is kept", async () => {
    const { c } = await table();
    const stopAt = async (content: string, marker: string) => {
      const res = await post("turn", { conversation: c, brain: "Scene Painter", content });
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let text = "";
      while (!text.includes(marker)) text += (await reader.read()).value ?? "";
      const stop = (await (await post("generation.stop", { conversation: c })).json()) as StopOutcome;
      for (let r = await reader.read(); !r.done; r = await reader.read()) text += r.value;
      return { stop, events: text.trim().split("\n").map((l) => JSON.parse(l)) };
    };
    const n0 = t.mock.state.requests.filter((r) => r.path === "/image/generate").length;
    const early = await stopAt("MOCK_SLOW the rafters", '"prompt"');
    const kept = early.stop.message!;
    assert.ok(kept.versions[0]!.content.length > 0 && kept.versions[0]!.stopped);
    assert.equal(kept.versions[0]!.image?.status, "error");
    assert.match(kept.versions[0]!.image!.error!, /Stopped before the image was made/);
    assert.equal(t.mock.state.requests.filter((r) => r.path === "/image/generate").length, n0, "no image was asked for");

    const n = t.mock.state.requests.filter((r) => r.path === "/image/generate").length;
    // Once the prompt is saved the conversation is free: there is nothing to stop, and the image is never cut short.
    const late = await stopAt("MOCK_IMAGE_SLOW the door", '"image_pending"');
    const pendingEv = late.events.find((e) => e.type === "image_pending");
    assert.deepEqual([late.stop.stopped, late.stop.painting], [false, [{ messageId: pendingEv.messageId, imageId: pendingEv.imageId }]], "the stop names the image still being made");
    assert.deepEqual(late.events.map((e) => e.type).slice(-2), ["image_done", "done"], "the turn's stream goes on to the image");
    assert.equal(late.events.at(-1)!.message.versions[0].image.status, "done", "the paid image is kept");
    assert.equal(t.mock.state.requests.filter((r) => r.path === "/image/generate").length, n + 1);
  });

  test("safe mode is sent and a blurred image is marked; parallel calls use the first; no call is a clean failure", async () => {
    const { c, painter } = await table();
    const blurred = await events(["turn", "--conversation", c, "--brain", "Scene Painter", "--content", "MOCK_BLURRED the bathhouse"]);
    assert.equal(blurred.at(-1)!.message.versions[0].image.blurred, true);
    await ok(["brain.update", "--conversation", c, "--brain", painter.id, "--no-safe-mode"]);
    await ok(["image.retry", "--conversation", c, "--message", blurred.at(-1)!.message.id]);
    assert.equal((sent("/image/generate") as ImageRequest).safe_mode, false);
    assert.equal((await last(c)).versions[0]!.image!.blurred, undefined);

    const two = await events(["turn", "--conversation", c, "--brain", "Scene Painter", "--content", "MOCK_TWO_TOOL_CALLS paint"]);
    assert.match(two.at(-1)!.message.versions[0].content, /^MOCK image prompt after/, "the first call's prompt, valid on its own");
    assert.match(two.at(-1)!.note, /made 2 generate_image calls; only the first was used/);

    const before = (await get(c)).messages.length;
    const r = await t.cli(["turn", "--conversation", c, "--brain", "Scene Painter", "--content", "MOCK_NO_TOOL_CALL paint", "--json"]);
    const err = JSON.parse(r.stdout.trim().split("\n").at(-1)!).error;
    assert.deepEqual([r.code, err.code, err.details.retry.command], [1, "no_prompt", "turn"]);
    assert.match(err.message, /answered without calling generate_image \(it wrote text instead\)/);
    assert.equal((await get(c)).messages.length, before + 1, "only your message is saved");
  });

  test("a prompt in the painter's mouth is painted; deleting a message or the conversation deletes its images", async () => {
    const { c } = await table();
    const added = await json(["message.add", "--conversation", c, "--as", "Scene Painter", "--content", "A barkeep with a leather apron."]);
    assert.equal(added.message.kind, "image");
    const m = await settled(c, added.message.id);
    assert.equal(m.versions[0]!.source, "authored");
    await ok(["message.regenerate", "--conversation", c, "--steer", "Older."]);
    const ids = (await last(c)).versions.map((v) => v.image!.id);
    assert.equal(ids.length, 2);
    assert.ok(ids.every((id) => imageFiles().some((f) => f.startsWith(id))));
    const del = await json(["message.delete", "--conversation", c, "--message", m.id]);
    assert.deepEqual(del.imagesDeleted, ids);
    assert.ok(!ids.some((id) => imageFiles().some((f) => f.startsWith(id))));

    await ok(["turn", "--conversation", c, "--brain", "Scene Painter", "--content", "one more"]);
    const id = (await last(c)).versions[0]!.image!.id;
    await ok(["conversation.delete", "--id", c]);
    assert.ok(!imageFiles().some((f) => f.startsWith(id)));
  });

  test("the play loop: once the prompt is saved, the GM can answer while the image is made; changes that would lose that image wait", async () => {
    const { c, painter } = await table();
    const res = await post("turn", { conversation: c, brain: "Scene Painter", content: "MOCK_IMAGE_SLOW the hooded figure" });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    while (!text.includes('"image_pending"')) text += (await reader.read()).value ?? "";
    const m = (await last(c)) as LedgerMessage;
    assert.equal(m.versions[0]!.image!.status, "pending");

    // The GM takes its turn at once and sees the exact prompt, framed, though the image isn't there yet.
    const gm = await events(["turn", "--conversation", c, "--content", "What is the figure wearing?"]);
    assert.equal(gm.at(-1)!.type, "done");
    assert.equal(((sent("/chat/completions") as ChatRequest).messages.at(-2) as { content: string }).content, `${FRAME}\n${m.versions[0]!.content}`);
    assert.equal((await get(c)).messages.find((x) => x.id === m.id)!.versions[0]!.image!.status, "pending", "the GM answered while it painted");

    // What would replace or remove the image waits for it; nothing else does.
    for (const argv of [
      ["message.edit", "--conversation", c, "--message", m.id, "--content", "another prompt"],
      ["message.delete", "--conversation", c, "--message", m.id],
      ["image.retry", "--conversation", c, "--message", m.id],
      ["conversation.delete", "--id", c],
    ]) {
      const r = await t.cli(argv);
      assert.deepEqual([r.code, /being made/.test(r.stderr)], [1, true], `${argv[0]} waits for the image: ${r.stderr}`);
    }
    await ok(["message.edit", "--conversation", c, "--message", gm.at(-1)!.message.id, "--content", "A red coat."]);
    await ok(["brain.update", "--conversation", c, "--brain", painter.id, "--system-prompt", "You paint, brightly."]);

    for (let r = await reader.read(); !r.done; r = await reader.read()) text += r.value;
    const painted = text.trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(painted.map((e) => e.type).slice(-2), ["image_done", "done"]);
    assert.equal(painted.at(-1).message.versions[0].image.status, "done");

    // A follower that attached mid-prompt sees the image land too, as the turn's own stream does.
    const slow = post("turn", { conversation: c, brain: painter.id, content: "MOCK_SLOW MOCK_IMAGE_SLOW the stairs" });
    await until(async () => ((await get(c)).messages.at(-1)!.author.type === "player" ? true : undefined), "the player message");
    const followed = await events(["generation.follow", "--conversation", c]);
    assert.deepEqual(followed.map((e) => e.type).filter((x, i, a) => a[i - 1] !== x).slice(-3), ["image_pending", "image_done", "done"]);
    await (await slow).text();

    // A regenerate while the image is being made: a new version with its own image; the first lands in its own version.
    const r1 = await post("turn", { conversation: c, brain: painter.id, content: "MOCK_IMAGE_SLOW the cellar" });
    const rd = r1.body!.pipeThrough(new TextDecoderStream()).getReader();
    for (let seen = ""; !seen.includes('"image_pending"'); ) seen += (await rd.read()).value ?? "";
    const regen = await events(["message.regenerate", "--conversation", c]);
    for (let r = await rd.read(); !r.done; r = await rd.read());
    const both = await settled(c, regen.at(-1)!.message.id);
    assert.deepEqual(both.versions.map((v) => v.image?.status), ["done", "done"]);
  });

  test("image.follow never misses a result: an image that settled before it attached is reported from the saved record (QA-2)", async () => {
    const { c } = await table();
    await ok(["turn", "--conversation", c, "--brain", "Scene Painter", "--content", "the bar"]);
    const m = await last(c);
    const edited = await json(["message.edit", "--conversation", c, "--message", m.id, "--content", "MOCK_IMAGE_ERROR now"]);
    await until(async () => ((await last(c)).versions[0]!.image!.status === "error" ? true : undefined), "the image to fail");
    const evs = await events(["image.follow", "--conversation", c, "--message", m.id], undefined);
    assert.deepEqual(evs.map((e) => e.type), ["done"]);
    assert.deepEqual([evs[0]!.message.versions[0].image.id, evs[0]!.message.versions[0].image.status], [edited.painting.imageId, "error"]);

    // While one is being made: image_pending, then how it ended, then done.
    await json(["message.edit", "--conversation", c, "--message", m.id, "--content", "MOCK_IMAGE_SLOW later"]);
    const live = await events(["image.follow", "--conversation", c, "--message", m.id]);
    assert.deepEqual(live.map((e) => e.type), ["image_pending", "image_done", "done"]);
    assert.equal(live.at(-1)!.message.versions[0].image.status, "done");
    const r = await t.cli(["image.follow", "--conversation", c, "--message", "m_nosuchmsg"]);
    assert.equal(r.code, 1);
  });

  test("retrying a finished image keeps it: the new image is a new version of the same prompt (QA-5)", async () => {
    const { c } = await table();
    await ok(["turn", "--conversation", c, "--brain", "Scene Painter", "--content", "the hearth"]);
    const m = await last(c);
    const first = m.versions[0]!.image!.id;
    const evs = await events(["image.retry", "--conversation", c, "--message", m.id]);
    const after = evs.at(-1)!.message as LedgerMessage;
    assert.deepEqual([after.versions.length, after.activeVersion, after.versions[1]!.repaintOf, after.versions[1]!.content], [2, 1, 0, m.versions[0]!.content]);
    assert.deepEqual(after.versions.map((v) => v.image?.status), ["done", "done"]);
    assert.ok(imageFiles().some((f) => f.startsWith(first)), "the first image is still on disk");
    // A blurred one is still replaced in place (it was never usable).
    await ok(["turn", "--conversation", c, "--brain", "Scene Painter", "--content", "MOCK_BLURRED the bath"]);
    const b = await last(c);
    await ok(["image.retry", "--conversation", c, "--message", b.id]);
    assert.equal((await last(c)).versions.length, 1);
  });

  test("a graceful shutdown waits for an image being made, so a restart doesn't lose it (QA-1)", async () => {
    const { c } = await table();
    const res = await post("turn", { conversation: c, brain: "Scene Painter", content: "MOCK_IMAGE_SLOW the gate" });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    for (let seen = ""; !seen.includes('"image_pending"'); ) seen += (await reader.read()).value ?? "";
    assert.equal(await finishInFlight(5000), 0, "nothing left running");
    assert.equal((await last(c)).versions[0]!.image!.status, "done", "saved before the server would exit");
    for (let r = await reader.read(); !r.done; r = await reader.read());
  });

  const cookie = () => `ss_session=${JSON.parse(readFileSync(join(t.config.runDir, "cli-session.json"), "utf8")).token}`;
  const post = (cmd: string, body: unknown) =>
    t.app.fetch(new Request(`http://localhost/api/${cmd}`, { method: "POST", headers: { host: "localhost", "content-type": "application/json", cookie: cookie() }, body: JSON.stringify(body) }));
});
