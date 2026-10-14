import assert from "node:assert/strict";
import { test } from "node:test";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { startMockVenice } from "../src/dev/mock-venice.ts";
import { chunkEvents, openChatStream, sseData } from "../src/venice/chat.ts";
import { createVeniceClient } from "../src/venice/client.ts";

async function* pieces(text: string, size: number) {
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i += size) yield bytes.slice(i, i + size);
}

async function collect(text: string, size: number) {
  const out: string[] = [];
  for await (const d of sseData(pieces(text, size))) out.push(d);
  return out;
}

test("sseData: events survive any chunking, CRLF, comments and split multi-byte characters", async () => {
  const wire =
    ': keep-alive\r\n\r\n' +
    'data: {"a":"héllo 🎲"}\r\n\r\n' +
    'event: message\ndata: {"b":1}\n\n' +
    "data: line one\ndata: line two\n\n" +
    "data: [DONE]"; // no trailing blank line
  const want = ['{"a":"héllo 🎲"}', '{"b":1}', "line one\nline two", "[DONE]"];
  for (const size of [1, 2, 3, 7, 1000]) assert.deepEqual(await collect(wire, size), want, `chunk size ${size}`);
});

test("chunkEvents: reasoning, content on the finishing chunk, tool fragments and usage with cost", () => {
  assert.deepEqual(chunkEvents({ choices: [{ delta: { role: "assistant" }, finish_reason: null }], usage: null }), []);
  assert.deepEqual(chunkEvents({ choices: [{ delta: { reasoning_content: "hmm" } }] }), [{ type: "reasoning", delta: "hmm" }]);
  // Live Venice puts the last words in the same chunk as finish_reason when max_tokens cuts the reply.
  assert.deepEqual(chunkEvents({ choices: [{ delta: { content: "end" }, finish_reason: "length" }] }), [
    { type: "content", delta: "end" },
    { type: "finish", reason: "length" },
  ]);
  assert.deepEqual(
    chunkEvents({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "generate_image", arguments: "" } }] } }] }),
    [{ type: "tool_call", index: 0, id: "call_1", name: "generate_image", argsDelta: "" }],
  );
  assert.deepEqual(
    chunkEvents({
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 20 }, prompt_tokens_details: { cached_tokens: 0 } },
      cost: { usd: 0.0000396, diem: 0 },
    }),
    [{ type: "usage", usage: { promptTokens: 12, completionTokens: 30, reasoningTokens: 20 }, costUsd: 0.0000396 }],
  );
  assert.throws(() => chunkEvents({ error: { message: "upstream overloaded" } }), { code: "venice_error", message: /upstream overloaded/ });
});

test("openChatStream: a GC between opening and reading doesn't lose the reply (undici cancels unread bodies)", async () => {
  setFlagsFromString("--expose-gc");
  const gc = runInNewContext("gc") as () => void;
  const mock = await startMockVenice({ delayMs: 0 });
  try {
    const venice = createVeniceClient({ baseUrl: mock.url, apiKey: "test" });
    const body = {
      model: "venice-uncensored-1-2",
      messages: [{ role: "system" as const, content: "Be brief." }, { role: "user" as const, content: "hi" }],
      stream: true as const,
      stream_options: { include_usage: true as const },
      venice_parameters: { include_venice_system_prompt: false as const, enable_web_search: "off" as const, enable_web_scraping: false as const },
    };
    for (let i = 0; i < 3; i++) {
      const events = await openChatStream(venice, body);
      await new Promise((r) => setTimeout(r, 20)); // the body has arrived, and nobody has read it yet
      gc();
      await new Promise((r) => setTimeout(r, 20));
      let text = "";
      for await (const ev of events) if (ev.type === "content") text += ev.delta;
      assert.match(text, /^MOCK reply to brain "Be brief\."/);
    }
  } finally {
    await mock.close();
  }
});

test("openChatStream refuses a body with nothing to answer, whoever built it (T02 QA-3, QA-5)", async () => {
  const venice = { request: () => assert.fail("nothing may go upstream") } as unknown as Parameters<typeof openChatStream>[0];
  const vp = { include_venice_system_prompt: false, enable_web_search: "off", enable_web_scraping: false } as const;
  const base = { model: "m", stream: true, stream_options: { include_usage: true }, venice_parameters: vp } as const;
  for (const messages of [
    [{ role: "system", content: "Sys." }],
    [{ role: "system", content: "Sys." }, { role: "user", content: "Hi" }, { role: "assistant", content: "Yellow." }],
  ] as const) {
    await assert.rejects(openChatStream(venice, { ...base, messages: [...messages] }), { code: "nothing_to_answer" });
  }
});
