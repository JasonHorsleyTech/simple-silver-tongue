import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { newConversation } from "../src/conversations/defaults.ts";
import { beginPainting, endPainting, INTERRUPTED, newImageRecord, settleStaleImages } from "../src/conversations/images.ts";
import { partialPrompt, promptOf } from "../src/conversations/tool-call.ts";
import { newMessage, relayReply, type Reply } from "../src/conversations/turn.ts";
import { MOCK_MODELS } from "../src/dev/mock-models.ts";
import { solidPng } from "../src/dev/mock-venice.ts";
import { findImageFile, saveImageFile } from "../src/images/files.ts";
import { buildImageRequest, imagePriceUsd, imageSettingsProblem } from "../src/images/request.ts";
import { sniffImage } from "../src/images/sniff.ts";
import type { StreamEvent } from "../src/registry.ts";
import type { ChatEvent } from "../src/venice/chat.ts";
import { createVeniceClient } from "../src/venice/client.ts";
import { generateImage } from "../src/venice/images.ts";
import type { ImageRequest } from "../src/conversations/types.ts";
import { normalizeModel, type ModelInfo } from "../src/venice/models.ts";

const model = (id: string) => normalizeModel(MOCK_MODELS.find((m) => m.id === id) as never) as ModelInfo;
const Z = model("z-image-turbo");
const NANO = model("nano-banana-2");

describe("image brains' parts (T05)", () => {
  test("the prompt decodes as it streams: split anywhere, escapes included, other keys first", () => {
    const json = JSON.stringify({ style: { a: [1, "}"] }, prompt: 'A "hooded" figure\nby the fire — 🔥 \\ done' });
    let shown = "";
    for (let i = 1; i <= json.length; i++) {
      const p = partialPrompt(json.slice(0, i));
      const text = p?.text ?? "";
      assert.ok(text.startsWith(shown), `the decoded text only grows (at ${i})`);
      shown = text;
    }
    assert.deepEqual(partialPrompt(json), { text: 'A "hooded" figure\nby the fire — 🔥 \\ done', complete: true });
    assert.deepEqual(partialPrompt('{"prompt": "half \\u00'), { text: "half ", complete: false }, "an incomplete escape waits");
    assert.deepEqual(partialPrompt('{"prompt":"fire \\ud83d\\udd25!"}'), { text: "fire 🔥!", complete: true }, "\\u escapes, surrogate pairs included");
    assert.equal(partialPrompt('{"size": 3}'), null, "no prompt key");
    assert.equal(partialPrompt('{"prompt": 7}'), null, "a prompt that isn't a string is no prompt");
  });

  test("parallel tool calls stay apart by index; only the first is used, and only it streams", async () => {
    const piece = (index: number, argsDelta: string): ChatEvent => ({ type: "tool_call", index, argsDelta });
    async function* events(): AsyncGenerator<ChatEvent> {
      yield { type: "tool_call", index: 0, id: "a", name: "generate_image", argsDelta: "" };
      yield { type: "tool_call", index: 1, id: "b", name: "generate_image", argsDelta: "" };
      yield piece(0, '{"prompt":"one');
      yield piece(1, '{"prompt":"two"}');
      yield piece(0, ' tavern"}');
      yield { type: "finish", reason: "tool_calls" };
    }
    const out: StreamEvent[] = [];
    const gen = relayReply(events());
    let r = await gen.next();
    while (!r.done) {
      out.push(r.value);
      r = await gen.next();
    }
    const reply = r.value as Reply;
    assert.deepEqual(reply.toolCalls.map((c) => [c.index, c.args]), [[0, '{"prompt":"one tavern"}'], [1, '{"prompt":"two"}']], "no glued, invalid JSON (T02 QA-7)");
    assert.deepEqual(out, [{ type: "prompt", delta: "one" }, { type: "prompt", delta: " tavern" }]);
    assert.deepEqual(promptOf(reply.toolCalls), { prompt: "one tavern", complete: true, calls: 2 });
    assert.deepEqual(promptOf([{ index: 0, args: '{"prompt":"cut sho' }]), { prompt: "cut sho", complete: false, calls: 1 }, "a cut prompt is kept, marked incomplete");
    assert.deepEqual(promptOf([]), { prompt: "", complete: false, calls: 0 });
  });

  test("the image request sends only what the model takes, and says what it left out", () => {
    const s = newConversation({ title: "x", systemPrompt: "y" }).settings;
    s.image = { ...s.image, width: 1020, height: 768, aspectRatio: "16:9", negativePrompt: "text" };
    const z = buildImageRequest(s, Z, "a tavern", true);
    assert.deepEqual(z.body, { model: "z-image-turbo", prompt: "a tavern", safe_mode: true, format: "webp", hide_watermark: true, width: 1016, height: 768, negative_prompt: "text" });
    assert.equal(z.notes.length, 2, z.notes.join("\n")); // width rounded to a multiple of 8; aspect ratio not sent
    const n = buildImageRequest({ ...s, image: { ...s.image, resolution: "8K" } }, NANO, "a tavern", false);
    assert.deepEqual(n.body, { model: "nano-banana-2", prompt: "a tavern", safe_mode: false, format: "webp", hide_watermark: true, aspect_ratio: "16:9", negative_prompt: "text" });
    assert.match(n.notes.join("\n"), /Width and height are not sent/);
    assert.match(n.notes.join("\n"), /resolution 8K is not sent: nano-banana-2 offers 1K, 2K, 4K \(it uses 1K\)/);
    assert.match(buildImageRequest(s, Z, "x".repeat(7501), true).problem ?? "", /7501 characters, and z-image-turbo takes at most 7500/);
    assert.equal(imagePriceUsd(Z, z.body), 0.01);
    assert.equal(imagePriceUsd(NANO, n.body), 0.1, "the default resolution's price");
    assert.equal(imagePriceUsd(NANO, { ...n.body, resolution: "4K" }), 0.19);
    assert.equal(imagePriceUsd(model("grok-imagine-image-2-0"), { ...n.body, model: "grok-imagine-image-2-0" }), 0.07, "per quality, at the default quality");
    // conversation.update checks only what it is setting, against the model it will be sent to.
    assert.match(imageSettingsProblem({ ...s.image, width: 1001 }, Z, ["width"]) ?? "", /multiples of 8/);
    assert.equal(imageSettingsProblem({ ...s.image, width: 1001 }, Z, ["format"]), null, "a stale size doesn't block another change");
    assert.match(imageSettingsProblem(s.image, Z, ["aspectRatio"]) ?? "", /sized by width and height/);
    assert.match(imageSettingsProblem(s.image, NANO, ["width"]) ?? "", /sized by resolution and aspect ratio/);
  });

  test("the image type comes from the bytes, not from what was asked for", () => {
    assert.deepEqual(sniffImage(solidPng(2, 2, [1, 2, 3])), { mime: "image/png", ext: "png" });
    assert.deepEqual(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), { mime: "image/jpeg", ext: "jpg" });
    assert.deepEqual(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), { mime: "image/webp", ext: "webp" });
    assert.deepEqual(sniffImage(Buffer.from("GIF89a....")), { mime: "image/gif", ext: "gif" });
    assert.equal(sniffImage(Buffer.from("<html>nope</html>")), null);
  });

  test("a pending image no job owns is settled on read: done if its file made it to disk, an error otherwise", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ss-img-"));
    try {
      const vault = { dir, key: null };
      const conv = newConversation({ title: "x", systemPrompt: "y" });
      const by = { type: "brain" as const, brainId: conv.brains[0]!.id };
      const pending = () => newImageRecord({ model: "z-image-turbo", safeMode: true });
      const [written, lost, owned] = [pending(), pending(), pending()];
      for (const image of [written, lost, owned]) conv.messages.push(newMessage(by, "image", { content: "a prompt", source: "generated", createdAt: image.createdAt, image }));
      await saveImageFile(vault, written.id, { mime: "image/png", ext: "png" }, solidPng(2, 2, [9, 9, 9])); // written, then the server stopped
      beginPainting(vault, owned.id, { convId: conv.id, messageId: "m_x" }); // still being painted by a running job: left alone
      await settleStaleImages(vault, conv);
      assert.deepEqual([written.status, written.mime], ["done", "image/png"], "a paid image that reached disk is kept");
      assert.deepEqual([lost.status, lost.error], ["error", INTERRUPTED], "never pending forever");
      assert.equal(owned.status, "pending");
      endPainting(vault, owned.id);
      // A replacement keeps the last finished image to show meanwhile, and never nests them.
      const next = newImageRecord({ model: "z-image-turbo", safeMode: true, replacing: { ...written, previous: lost } });
      assert.equal(next.previous?.id, written.id);
      assert.equal(next.previous?.previous, undefined);
      assert.equal(newImageRecord({ model: "m", safeMode: true, replacing: { ...lost, previous: written } }).previous?.id, written.id, "a failed one keeps showing the last good one");

      // T05 QA-4: an image recovered as done swaps in like a painted one: the image shown meanwhile goes, file and all.
      const shown = { ...newImageRecord({ model: "z-image-turbo", safeMode: true }), status: "done" as const };
      const swapped = { ...newImageRecord({ model: "z-image-turbo", safeMode: true }), previous: shown };
      conv.messages.push(newMessage(by, "image", { content: "p", source: "generated", createdAt: shown.createdAt, image: swapped }));
      await saveImageFile(vault, shown.id, { mime: "image/png", ext: "png" }, solidPng(2, 2, [1, 1, 1]));
      await saveImageFile(vault, swapped.id, { mime: "image/png", ext: "png" }, solidPng(2, 2, [2, 2, 2]));
      await settleStaleImages(vault, conv);
      assert.deepEqual([swapped.status, swapped.previous], ["done", undefined]);
      assert.equal(await findImageFile(vault, shown.id), null, "no orphan left behind for a later replacement");
      assert.ok(await findImageFile(vault, swapped.id));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an image request that times out says Venice may have made (and billed) it, not that it was unreachable (T05 QA-3)", async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
    const venice = createVeniceClient({ baseUrl: "http://127.0.0.1:9/api/v1", apiKey: "k", fetch: hang });
    await assert.rejects(generateImage(venice, { model: "z-image-turbo", prompt: "p" } as ImageRequest, { timeoutMs: 30 }), (err: Error) => {
      assert.match(err.message, /^Venice didn't send the image within 0 s\. It may still have made \(and billed\) it; retry/);
      assert.doesNotMatch(err.message, /Could not reach/);
      return true;
    });
  });
});
