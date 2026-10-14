import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startMockVenice, type MockVenice } from "../src/dev/mock-venice.ts";

// Contract tests for the mock, since later tickets build the chat and image clients against it.
let mock: MockVenice;
before(async () => {
  mock = await startMockVenice({ delayMs: 0, imageDelayMs: 0 });
});
after(() => mock.close());

const post = (path: string, body: unknown) =>
  fetch(`${mock.url}${path}`, {
    method: "POST",
    headers: { authorization: "Bearer test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function sse(res: Response): Promise<any[]> {
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.startsWith("data: "));
  assert.equal(lines.at(-1), "data: [DONE]");
  return lines.slice(0, -1).map((l) => JSON.parse(l.slice(6)));
}

const chatBody = {
  model: "deepseek-v4-1-flash",
  stream: true,
  stream_options: { include_usage: true },
  venice_parameters: { include_venice_system_prompt: false },
  reasoning_effort: "low",
  messages: [
    { role: "system", content: "You are the Game Master." },
    { role: "user", content: "<!-- from: the user -->\nI approach the hooded figure." },
  ],
};

test("chat stream: reasoning, then content that echoes structure, then usage with cost", async () => {
  const chunks = await sse(await post("/chat/completions", chatBody));
  const reasoning = chunks.map((c) => c.choices[0]?.delta?.reasoning_content ?? "").join("");
  const content = chunks.map((c) => c.choices[0]?.delta?.content ?? "").join("");
  assert.match(reasoning, /^MOCK reasoning \(effort: low\)/);
  assert.equal(content, 'MOCK reply to brain "You are the Game Master."; saw 2 messages; last: "<!-- from: the user --> I approach the hooded figure."');
  const last = chunks.at(-1);
  assert.deepEqual(last.choices, []);
  assert.ok(last.usage.prompt_tokens > 0 && last.cost.usd > 0);
  assert.equal(chunks.at(-2).choices[0].finish_reason, "stop");
});

test("chat stream: a forced tool call streams JSON argument fragments", async () => {
  const chunks = await sse(
    await post("/chat/completions", {
      ...chatBody,
      reasoning_effort: "none",
      tools: [{ type: "function", function: { name: "generate_image", parameters: {} } }],
      tool_choice: { type: "function", function: { name: "generate_image" } },
    }),
  );
  const calls = chunks.flatMap((c) => c.choices[0]?.delta?.tool_calls ?? []);
  assert.equal(calls[0].function.name, "generate_image");
  const args = JSON.parse(calls.map((c: any) => c.function.arguments ?? "").join(""));
  assert.match(args.prompt, /^MOCK image prompt after 2 messages/);
  assert.ok(chunks.some((c) => c.choices[0]?.finish_reason === "tool_calls"));
});

test("chat stream: max_tokens cuts with finish_reason length, and the last content shares the finish chunk", async () => {
  const chunks = await sse(await post("/chat/completions", { ...chatBody, reasoning_effort: "none", max_tokens: 3 }));
  const finishChunk = chunks.find((c) => c.choices[0]?.finish_reason);
  assert.equal(finishChunk.choices[0].finish_reason, "length");
  assert.equal(finishChunk.choices[0].delta.content, "to ");
  assert.equal(chunks.map((c) => c.choices[0]?.delta?.content ?? "").join(""), "MOCK reply to ");
});

test("chat stream: max_tokens is spent on reasoning first, so a small budget can leave no content (T02 QA-6)", async () => {
  const chunks = await sse(await post("/chat/completions", { ...chatBody, reasoning_effort: "low", max_tokens: 3 }));
  assert.equal(chunks.map((c) => c.choices[0]?.delta?.reasoning_content ?? "").join(""), "MOCK reasoning (effort: ");
  assert.equal(chunks.map((c) => c.choices[0]?.delta?.content ?? "").join(""), "");
  assert.equal(chunks.find((c) => c.choices[0]?.finish_reason)?.choices[0].finish_reason, "length");
});

test("chat stream: the role chunk carries content \"\" on a model without reasoning, like live", async () => {
  const [role] = await sse(await post("/chat/completions", { ...chatBody, model: "venice-uncensored-1-2", reasoning_effort: undefined }));
  assert.deepEqual(role.choices[0].delta, { role: "assistant", content: "" });
  const [roleR] = await sse(await post("/chat/completions", chatBody));
  assert.deepEqual(roleR.choices[0].delta, { role: "assistant" });
});

test("chat: refuses requests that would let Venice inject its system prompt", async () => {
  const res = await post("/chat/completions", { ...chatBody, venice_parameters: {} });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /include_venice_system_prompt must be false/);
});

test("image: returns a real PNG and charges the balance", async () => {
  const before = mock.state.balanceUsd;
  const res = await post("/image/generate", { model: "z-image-turbo", prompt: "a tavern", width: 16, height: 16 });
  assert.equal(res.headers.get("x-venice-is-blurred"), "false");
  assert.equal(res.headers.get("x-venice-is-content-violation"), "false");
  const body = (await res.json()) as { images: string[] };
  const png = Buffer.from(body.images[0]!, "base64");
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 16); // IHDR width
  assert.ok(Math.abs(before - mock.state.balanceUsd - 0.01) < 1e-9);
});
