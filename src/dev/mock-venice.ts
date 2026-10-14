import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { crc32, deflateSync } from "node:zlib";
import { MOCK_MODELS } from "./mock-models.ts";

/**
 * A small, deterministic stand-in for the Venice API (base path /api/v1), so everything can be exercised
 * for free. Replies echo structure, not prose:
 *   MOCK reply to brain "<system prompt, first 30 chars>"; saw N messages; last: "<last message, first 60 chars>"
 *
 * Endpoints: GET /models, GET /api_keys/rate_limits, POST /chat/completions (SSE or JSON, reasoning,
 * forced tool calls), POST /image/generate (a tiny real PNG).
 * Dev-only extras: GET /health, and GET /_mock/requests (the last 20 request bodies, newest first), so you
 * can compare what the app really sent against ./ss prompt.preview.
 *
 * Triggers inside the last message (chat) or the prompt (image):
 *   MOCK_ERROR            → HTTP error before anything streams
 *   MOCK_SLOW             → much slower stream / image (handy for 409 and stop tests)
 *   MOCK_MIDSTREAM_ERROR  → the connection drops halfway through the stream
 * max_tokens is honored (counted in content words): the reply is cut with finish_reason "length".
 *
 * Rules enforced like a strict Venice: a Bearer token is required, and chat requests must send
 * venice_parameters.include_venice_system_prompt: false (our no-hidden-text hard rule).
 */

export type MockOptions = { port?: number; delayMs?: number; imageDelayMs?: number; balanceUsd?: number; log?: boolean };
export type MockRequest = { at: string; method: string; path: string; body: unknown };
export type MockVenice = {
  url: string; // base URL to use as VENICE_BASE_URL
  port: number;
  state: { balanceUsd: number; requests: MockRequest[] };
  close(): Promise<void>;
};

const BASE = "/api/v1";

export async function startMockVenice(opts: MockOptions = {}): Promise<MockVenice> {
  const delayMs = opts.delayMs ?? 15;
  const imageDelayMs = opts.imageDelayMs ?? 200;
  const state = { balanceUsd: opts.balanceUsd ?? 10, requests: [] as MockRequest[] };
  let seq = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const path = url.pathname;
    res.on("finish", () => {
      if (opts.log) console.log(`${new Date().toISOString()} ${req.method} ${path} ${res.statusCode}`);
    });
    try {
      if (path === "/health") return json(res, 200, { ok: true, mock: true });
      if (path === "/_mock/requests") return json(res, 200, { requests: state.requests });
      if (!path.startsWith(BASE)) return json(res, 404, { error: `mock: no route ${path}` });
      const route = path.slice(BASE.length);
      const body = req.method === "POST" ? await readJson(req) : undefined;
      if (route !== "/models") {
        state.requests.unshift({ at: new Date().toISOString(), method: req.method ?? "", path: route, body });
        state.requests.length = Math.min(state.requests.length, 20);
      }
      if (!/^Bearer \S+/.test(req.headers.authorization ?? "")) return json(res, 401, { error: "Authentication failed" });

      if (req.method === "GET" && route === "/models") {
        const type = url.searchParams.get("type") ?? "text";
        const data = MOCK_MODELS.filter((m) => type === "all" || m.type === type);
        return json(res, 200, { object: "list", type, data });
      }
      if (req.method === "GET" && route === "/api_keys/rate_limits") {
        return json(res, 200, {
          data: {
            accessPermitted: true,
            apiTier: { id: "paid", isCharged: true },
            balances: { USD: Number(state.balanceUsd.toFixed(8)), DIEM: 0, BUNDLED_CREDITS: 0 },
            keyExpiration: null,
            nextEpochBegins: new Date(Date.now() + 86_400_000).toISOString(),
            rateLimits: [],
          },
        });
      }
      if (req.method === "POST" && route === "/chat/completions") return await chat(res, body as ChatBody, ++seq);
      if (req.method === "POST" && route === "/image/generate") return await image(res, body as ImageBody, ++seq);
      return json(res, 404, { error: `mock: no route ${req.method} ${route}` });
    } catch (err) {
      if (!res.headersSent) json(res, 400, { error: `mock: ${err instanceof Error ? err.message : String(err)}` });
      else res.destroy();
    }
  });

  type Msg = { role: string; content?: unknown; tool_calls?: unknown[] };
  type ChatBody = {
    model?: string;
    messages?: Msg[];
    stream?: boolean;
    stream_options?: { include_usage?: boolean };
    venice_parameters?: { include_venice_system_prompt?: boolean };
    reasoning_effort?: string;
    max_tokens?: number;
    tools?: Array<{ type: string; function: { name: string } }>;
    tool_choice?: { type: string; function?: { name: string } } | string;
  };

  async function chat(res: ServerResponse, body: ChatBody, n: number) {
    if (body?.venice_parameters?.include_venice_system_prompt !== false) {
      return json(res, 400, {
        error: "mock: venice_parameters.include_venice_system_prompt must be false (hard rule: no hidden text)",
      });
    }
    const model = MOCK_MODELS.find((m) => m.id === body.model && m.type === "text");
    if (!model) return json(res, 404, { error: `Specified model not found: ${body.model}` });
    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) return json(res, 400, { error: "messages must be a non-empty array" });

    const lastText = contentText(messages.at(-1));
    if (lastText.includes("MOCK_ERROR")) return json(res, 500, { error: "mock: forced error (MOCK_ERROR)" });
    const stepMs = lastText.includes("MOCK_SLOW") ? 250 : delayMs;
    const caps = model.model_spec.capabilities ?? {};
    const system = messages.find((m) => m.role === "system");
    const brain = system ? excerpt(contentText(system), 30) : "(no system prompt)";

    const effort = body.reasoning_effort;
    const reasoning =
      caps.supportsReasoning && effort !== "none"
        ? `MOCK reasoning (effort: ${effort ?? caps.defaultReasoningEffort ?? "default"}) over ${messages.length} messages.`
        : "";

    let toolName: string | null = null;
    if (typeof body.tool_choice === "object" && body.tool_choice?.type === "function") {
      toolName = body.tool_choice.function?.name ?? null;
      if (!toolName || !body.tools?.some((t) => t.function?.name === toolName)) {
        return json(res, 400, { error: `mock: tool_choice names a tool that is not in tools: ${toolName}` });
      }
    }
    const fullContent = toolName
      ? ""
      : `MOCK reply to brain "${brain}"; saw ${messages.length} messages; last: "${excerpt(lastText, 60)}"`;
    // max_tokens counts content words here (one word ≈ one token). Like live, a cut ends with
    // finish_reason "length", and the last content delta rides in the same chunk as the finish reason.
    let contentWords: string[] = words(fullContent);
    const cut = !toolName && typeof body.max_tokens === "number" && contentWords.length > body.max_tokens;
    if (cut) contentWords = contentWords.slice(0, Math.max(0, body.max_tokens!));
    const content = contentWords.join("");
    const toolArgs = toolName
      ? JSON.stringify({ prompt: `MOCK image prompt after ${messages.length} messages; last: "${excerpt(lastText, 60)}"` })
      : "";

    const promptTokens = Math.ceil(messages.reduce((a, m) => a + contentText(m).length, 0) / 4) + 1;
    const reasoningTokens = Math.ceil(reasoning.length / 4);
    const completionTokens = Math.ceil((content.length + toolArgs.length) / 4) + reasoningTokens;
    const pricing = model.model_spec.pricing;
    const cost = (promptTokens * pricing.input.usd + completionTokens * pricing.output.usd) / 1e6;
    state.balanceUsd -= cost;
    const usage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: reasoningTokens },
    };
    const costObj = { usd: Number(cost.toFixed(8)), diem: 0 };
    const id = `chatcmpl-mock-${n}`;
    const created = Math.floor(Date.now() / 1000);
    const callId = `call_mock_${n}`;
    const finish = toolName ? "tool_calls" : cut ? "length" : "stop";

    if (!body.stream) {
      const message: Record<string, unknown> = { role: "assistant", content: toolName ? null : content };
      if (reasoning) message.reasoning_content = reasoning;
      if (toolName) message.tool_calls = [{ id: callId, type: "function", function: { name: toolName, arguments: toolArgs } }];
      return json(res, 200, {
        id,
        object: "chat.completion",
        created,
        model: model.id,
        choices: [{ index: 0, message, finish_reason: finish }],
        usage,
        cost: costObj,
      });
    }

    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" });
    const chunk = (delta: unknown, finish_reason: string | null = null) =>
      ({ id, object: "chat.completion.chunk", created, model: model.id, choices: [{ index: 0, delta, finish_reason }], usage: null });
    // Live sends content: "" in the role chunk for models without reasoning.
    const deltas: unknown[] = [chunk(caps.supportsReasoning ? { role: "assistant" } : { role: "assistant", content: "" })];
    for (const w of words(reasoning)) deltas.push(chunk({ reasoning_content: w }));
    if (toolName) {
      deltas.push(chunk({ tool_calls: [{ index: 0, id: callId, type: "function", function: { name: toolName, arguments: "" } }] }));
      for (const piece of toolArgs.match(/.{1,12}/g) ?? []) deltas.push(chunk({ tool_calls: [{ index: 0, function: { arguments: piece } }] }));
    }
    const tail = cut ? contentWords.pop() : undefined;
    for (const w of contentWords) deltas.push(chunk({ content: w }));
    deltas.push(chunk(tail === undefined ? {} : { content: tail }, finish));
    if (body.stream_options?.include_usage) {
      deltas.push({ id, object: "chat.completion.chunk", created, model: model.id, choices: [], usage, cost: costObj });
    }
    const dropAt = lastText.includes("MOCK_MIDSTREAM_ERROR") ? Math.floor(deltas.length / 2) : -1;
    for (let i = 0; i < deltas.length; i++) {
      if (res.destroyed) return;
      if (i === dropAt) return void res.destroy();
      res.write(`data: ${JSON.stringify(deltas[i])}\n\n`);
      if (stepMs) await sleep(stepMs);
    }
    res.end("data: [DONE]\n\n");
  }

  type ImageBody = { model?: string; prompt?: string; width?: number; height?: number; resolution?: string; return_binary?: boolean };

  async function image(res: ServerResponse, body: ImageBody, n: number) {
    const model = MOCK_MODELS.find((m) => m.id === body?.model && m.type === "image");
    if (!model) return json(res, 404, { error: `Specified model not found: ${body?.model}` });
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    if (!prompt.trim()) return json(res, 400, { error: "prompt is required" });
    const limit = model.model_spec.constraints?.promptCharacterLimit;
    if (limit && prompt.length > limit) return json(res, 400, { error: `prompt exceeds ${limit} characters` });
    if (prompt.includes("MOCK_ERROR")) return json(res, 400, { error: "mock: forced image error (MOCK_ERROR)" });
    await sleep(prompt.includes("MOCK_SLOW") ? 2000 : imageDelayMs);

    const p = model.model_spec.pricing;
    const res0 = body.resolution ?? model.model_spec.constraints?.defaultResolution;
    const cost = p.generation?.usd ?? p.resolutions?.[res0]?.usd ?? 0;
    state.balanceUsd -= cost;

    const w = clamp(body.width ?? 64, 8, 256);
    const h = clamp(body.height ?? 64, 8, 256);
    const bytes = solidPng(w, h, colorFor(prompt));
    if (body.return_binary) {
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": bytes.length, ...IMAGE_HEADERS });
      return void res.end(bytes);
    }
    return json(res, 200, {
      id: `mock-img-${n}`,
      images: [bytes.toString("base64")],
      request: body,
      timing: { inferenceDuration: imageDelayMs, inferencePreprocessingTime: 0, inferenceQueueTime: 0, total: imageDelayMs },
    }, IMAGE_HEADERS);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}${BASE}`,
    port,
    state,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// Live /image/generate responses carry these (T05's safe-mode UX reads them). The mock never blurs.
const IMAGE_HEADERS = { "x-venice-is-blurred": "false", "x-venice-is-content-violation": "false" };

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const parts: Buffer[] = [];
  for await (const p of req) parts.push(p as Buffer);
  const text = Buffer.concat(parts).toString("utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("request body is not valid JSON");
  }
}

function contentText(m: { content?: unknown } | undefined): string {
  const c = m?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p?.text === "string" ? p.text : "")).join(" ");
  return "";
}

const excerpt = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);
const words = (s: string) => s.match(/\S+\s*/g) ?? [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

function colorFor(s: string): [number, number, number] {
  const h = crc32(s);
  return [h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff];
}

/** Minimal valid RGB PNG of one color. */
export function solidPng(w: number, h: number, [r, g, b]: [number, number, number]): Buffer {
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, RGB, deflate, no filter, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

if (import.meta.main) {
  const port = Number(process.env.MOCK_VENICE_PORT || 4748);
  const mock = await startMockVenice({
    port,
    delayMs: process.env.MOCK_DELAY_MS ? Number(process.env.MOCK_DELAY_MS) : undefined,
    log: true,
  });
  console.log(`${new Date().toISOString()} mock Venice listening on ${mock.url}`);
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => void mock.close().then(() => process.exit(0)));
}
