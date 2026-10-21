import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { newBrain, newConversation, upgradeConversation } from "../src/conversations/defaults.ts";
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
const KREA = model("krea-2-turbo");
const HUNYUAN = model("hunyuan-image-v3");
const GROK = model("grok-imagine-image-2-0");

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

  test("the image request: the brain's shape in the model's own terms, only what the model takes, and notes on what it left out", () => {
    const s = newConversation({ title: "x", systemPrompt: "y" }).settings;
    s.image = { ...s.image, negativePrompt: "text" };
    const base = { prompt: "a tavern", safe_mode: true, format: "webp", hide_watermark: true, negative_prompt: "text" };
    // Width × height models get the shape's size; landscape when the brain has none.
    const z = buildImageRequest(s, Z, "a tavern", true, "portrait");
    assert.deepEqual(z.body, { ...base, model: "z-image-turbo", width: 832, height: 1216 });
    assert.deepEqual(z.notes, []);
    assert.deepEqual([buildImageRequest(s, Z, "x", true).body.width, buildImageRequest(s, Z, "x", true).body.height], [1216, 832]);
    assert.deepEqual([buildImageRequest(s, Z, "x", true, "square").body.width, buildImageRequest(s, Z, "x", true, "square").body.height], [1024, 1024]);
    // Aspect ratio models get the shape's ratio, and a resolution only if they list one.
    const twoK = { ...s, image: { ...s.image, resolution: "2K" } };
    const k = buildImageRequest(twoK, KREA, "a tavern", true, "landscape");
    assert.deepEqual(k.body, { ...base, model: "krea-2-turbo", resolution: "2K", aspect_ratio: "3:2" });
    assert.deepEqual(k.notes, []);
    const h = buildImageRequest(twoK, HUNYUAN, "a tavern", true, "portrait");
    assert.deepEqual(h.body, { ...base, model: "hunyuan-image-v3", aspect_ratio: "2:3" }, "no resolution to a model with no resolution list");
    assert.match(h.notes.join("\n"), /resolution 2K is not sent: hunyuan-image-v3 has no resolution setting/);
    // The nearest listed ratio when the shape's own isn't listed, and a note that says so.
    const fewRatios = { ...HUNYUAN, constraints: { ...HUNYUAN.constraints, aspectRatios: ["1:1", "4:3", "16:9", "9:16"] } };
    const near = buildImageRequest(s, fewRatios, "x", true, "landscape");
    assert.equal(near.body.aspect_ratio, "4:3");
    assert.match(near.notes.join("\n"), /landscape shape is sent as the aspect ratio 4:3, the nearest to 3:2/);
    assert.equal(buildImageRequest(s, fewRatios, "x", true, "portrait").body.aspect_ratio, "9:16");
    const g = buildImageRequest({ ...s, image: { ...s.image, resolution: "8K" } }, GROK, "a tavern", false, "square");
    assert.deepEqual(g.body, { ...base, model: "grok-imagine-image-2-0", safe_mode: false, aspect_ratio: "1:1" });
    assert.match(g.notes.join("\n"), /resolution 8K is not sent: grok-imagine-image-2-0 offers 1K, 2K \(it uses 1K\)/);
    assert.match(buildImageRequest(s, Z, "x".repeat(7501), true).problem ?? "", /7501 characters, and z-image-turbo takes at most 7500/);
    // Prices: flat, per resolution (the default one when none is sent), per quality at the default quality.
    assert.equal(imagePriceUsd(Z, z.body), 0.01);
    assert.equal(imagePriceUsd(HUNYUAN, h.body), 0.09);
    assert.equal(imagePriceUsd(KREA, k.body), 0.06);
    assert.equal(imagePriceUsd(KREA, buildImageRequest(s, KREA, "x", true).body), 0.04, "the default resolution's price");
    assert.equal(imagePriceUsd(GROK, g.body), 0.07, "per quality, at the default quality");
    // conversation.update checks only what it is setting, against the model it will be sent to.
    assert.match(imageSettingsProblem(twoK.image, Z, ["resolution"]) ?? "", /z-image-turbo has no resolution setting/);
    assert.match(imageSettingsProblem({ ...s.image, resolution: "4K" }, KREA, ["resolution"]) ?? "", /offers the resolutions 1K, 2K, not 4K/);
    assert.equal(imageSettingsProblem(twoK.image, KREA, ["resolution"]), null);
    assert.equal(imageSettingsProblem(twoK.image, Z, ["format"]), null, "a stale resolution doesn't block another change");
  });

  test("an older conversation file: its image brains get a shape, and the conversation-wide size they replace is dropped", () => {
    const conv = newConversation({ title: "x", systemPrompt: "y" });
    const painter = newBrain({ name: "Painter", systemPrompt: "Paint.", isDefault: false, kind: "image" });
    assert.equal(painter.shape, "landscape");
    delete painter.shape;
    conv.brains.push(painter);
    Object.assign(conv.settings.image, { width: 1024, height: 768, aspectRatio: "16:9", resolution: "1K" });
    upgradeConversation(conv);
    assert.equal(painter.shape, "landscape");
    assert.equal(conv.brains[0]!.shape, undefined, "a text brain has no shape");
    assert.deepEqual(conv.settings.image, { format: "webp", hideWatermark: true, resolution: "1K" });
  });

  test("the image type comes from the bytes, not from what was asked for", () => {
    assert.deepEqual(sniffImage(solidPng(2, 2, [1, 2, 3])), { mime: "image/png", ext: "png" });
    assert.deepEqual(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), { mime: "image/jpeg", ext: "jpg" });
    assert.deepEqual(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), { mime: "image/webp", ext: "webp" });
    assert.deepEqual(sniffImage(Buffer.from("GIF89a....")), { mime: "image/gif", ext: "gif" });
    assert.equal(sniffImage(Buffer.from("<html>nope</html>")), null);
  });

  test("a pending image no job owns is settled on read: done if its file made it to disk, an error otherwise", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sst-img-"));
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
