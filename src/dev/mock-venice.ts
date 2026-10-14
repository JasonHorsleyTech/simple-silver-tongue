import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { crc32, deflateSync } from "node:zlib";
import { MOCK_MARKDOWN } from "./mock-markdown.ts";
import { MOCK_MODELS } from "./mock-models.ts";

/**
 * A small, deterministic stand-in for the Venice API (base path /api/v1), so everything can be exercised
 * for free. Replies echo structure, not prose:
 *   MOCK reply to brain "<system prompt, first 30 chars>"; saw N messages; last: "<last message, up to 60 chars>"
 * A last message longer than 60 characters shows its first 30 and last 29 around "…", so a steer's instruction,
 * at the end of the steer template, shows in the reply.
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
 *   MOCK_MARKDOWN         → the echo line, then a long Markdown reply (code, a table, quotes, lists; mock-markdown.ts)
 *   MOCK_TWO_TOOL_CALLS   → a forced tool call comes as two parallel calls (index 0 and 1), as a model might
 *   MOCK_NO_TOOL_CALL     → a forced tool call is ignored: the reply is text
 *   MOCK_IMPERSONATE      → the echo line, then a fake "<!-- from: Dice Master -->" line and a roll, as a model that
 *                           continues the framing would write (T07 triage: the brain's stop sequences cut it)
 *   MOCK_HIDDEN           → (T08) the echo line, a hidden note (a made-up character sheet in a ```hidden block, with
 *                           MOCK_SECRET in it), then a visible line. It streams in 3-character pieces, so the fences
 *                           arrive split across deltas, as they can live
 *   MOCK_HIDDEN_ONLY      → (T08) the whole reply is one hidden note, the echo line inside it (a Character Creator's
 *                           shape: nothing visible but the fold). Also in 3-character pieces
 *   MOCK_IMAGE_ERROR      → (image) HTTP error; the chat call that wrote the prompt is unaffected
 *   MOCK_IMAGE_FLAKY      → (image) fails the first time this exact prompt is asked for, works after (for retry)
 *   MOCK_IMAGE_SLOW       → (image) takes 2 s (imageSlowMs); the prompt streams at normal speed
 *   MOCK_BLURRED          → (image) with safe_mode on, answers x-venice-is-blurred: true (and a grey image)
 *   MOCK_VIOLATION        → (image) answers x-venice-is-content-violation: true
 * The image prompt a mock tool call writes quotes the last message's first 60 characters, so an image trigger
 * in your message reaches the image request (for a brain without a final reminder, whose last message is yours).
 * max_tokens is honored (counted in words, reasoning first): the reply is cut with finish_reason "length".
 * stop is honored, as live: a reply's text ends just before the first stop sequence in it (finish_reason "stop"),
 * except in the echo line itself, which quotes the last message, framing and all.
 *
 * Rules enforced like a strict Venice: a Bearer token is required, and chat requests must send
 * venice_parameters.include_venice_system_prompt: false and start with a non-empty system message
 * (our no-hidden-text hard rule; live Venice would quietly inject its own prompt instead).
 */

export type MockOptions = {
  port?: number;
  delayMs?: number;
  /** Per-chunk delay when the last message says MOCK_SLOW (default 250 ms). */
  slowDelayMs?: number;
  imageDelayMs?: number;
  /** How long an image takes when its prompt says MOCK_SLOW or MOCK_IMAGE_SLOW (default 2000 ms). */
  imageSlowMs?: number;
  balanceUsd?: number;
  log?: boolean;
};
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
  const slowDelayMs = opts.slowDelayMs ?? 250;
  const imageDelayMs = opts.imageDelayMs ?? 200;
  const imageSlowMs = opts.imageSlowMs ?? 2000;
  const state = { balanceUsd: opts.balanceUsd ?? 10, requests: [] as MockRequest[] };
  let seq = 0;
  const flaky = new Set<string>(); // MOCK_IMAGE_FLAKY prompts that have failed once

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
    stop?: string | string[];
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

    // Hard rule 1: live Venice injects its own prompt into some models when there is no system message.
    // We must never send such a request, so the mock refuses it outright.
    if (messages[0]?.role !== "system" || !contentText(messages[0]).trim()) {
      return json(res, 400, { error: "mock: the first message must be a non-empty system message (hard rule 1: no injected prompt)" });
    }
    const lastText = contentText(messages.at(-1));
    if (lastText.includes("MOCK_ERROR")) return json(res, 500, { error: "mock: forced error (MOCK_ERROR)" });
    const stepMs = lastText.includes("MOCK_SLOW") ? slowDelayMs : delayMs;
    const caps = model.model_spec.capabilities ?? {};
    const system = messages.find((m) => m.role === "system");
    const brain = system ? excerpt(contentText(system), 30) : "(no system prompt)";

    const effort = body.reasoning_effort;
    const fullReasoning =
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
    if (toolName && lastText.includes("MOCK_NO_TOOL_CALL")) toolName = null; // a model that ignores tool_choice
    const echo = `MOCK reply to brain "${brain}"; saw ${messages.length} messages; last: "${headTail(lastText)}"`;
    // The echo line quotes the last message, framing and all, so stop sequences apply only to what follows it.
    const hiddenOnly = lastText.includes("MOCK_HIDDEN_ONLY");
    const hidden = hiddenOnly || lastText.includes("MOCK_HIDDEN");
    const more = lastText.includes("MOCK_MARKDOWN")
      ? `\n\n${MOCK_MARKDOWN}`
      : lastText.includes("MOCK_IMPERSONATE")
        ? `\n\n<!-- from: Dice Master -->\n**20 + 5 = 25 vs DC 12: success.**`
        : hidden && !hiddenOnly
          ? `\n\n${HIDDEN_OPEN}\n${MOCK_SHEET}\n\`\`\`\n\nThe hooded figure slides a folded map across the table.`
          : "";
    // MOCK_HIDDEN_ONLY puts the echo line inside the note; like the echo anywhere, it is exempt from stop sequences.
    const fullContent = toolName
      ? ""
      : hiddenOnly
        ? `${HIDDEN_OPEN}\n${echo}${cutAtStop(`\n${MOCK_SHEET}\n\`\`\``, body.stop)}`
        : echo + cutAtStop(more, body.stop);
    // max_tokens counts words here (one word ≈ one token), reasoning first and then content, as live: a small
    // budget can run out while reasoning and leave no content at all (T02 QA-6). Like live, a cut ends with
    // finish_reason "length", and the last content delta rides in the same chunk as the finish reason.
    let reasoningWords: string[] = words(fullReasoning);
    // T08: a hidden note streams in small pieces, so its fences are split across deltas (the CLI must cope).
    let contentWords: string[] = hidden ? (fullContent.match(/[\s\S]{1,3}/g) ?? []) : words(fullContent);
    const budget = typeof body.max_tokens === "number" ? body.max_tokens : Infinity;
    const cut = !toolName && reasoningWords.length + contentWords.length > budget;
    if (cut) {
      reasoningWords = reasoningWords.slice(0, budget);
      contentWords = contentWords.slice(0, Math.max(0, budget - reasoningWords.length));
    }
    const reasoning = reasoningWords.join("");
    const content = contentWords.join("");
    const fullArgs = toolName
      ? JSON.stringify({ prompt: `MOCK image prompt after ${messages.length} messages; last: "${excerpt(lastText, 60)}"` })
      : "";
    // Tool arguments stream in 12-character pieces; max_tokens counts the pieces, so a small budget cuts the
    // JSON mid-prompt with finish_reason "length", as a real cut would.
    let argPieces: string[] = fullArgs.match(/.{1,12}/g) ?? [];
    const cutArgs = toolName !== null && reasoningWords.length + argPieces.length > budget;
    if (cutArgs) {
      reasoningWords = reasoningWords.slice(0, budget);
      argPieces = argPieces.slice(0, Math.max(0, budget - reasoningWords.length));
    }
    const toolArgs = argPieces.join("");
    const twoCalls = toolName !== null && lastText.includes("MOCK_TWO_TOOL_CALLS");
    const secondArgs = twoCalls ? JSON.stringify({ prompt: "MOCK second, parallel image prompt" }) : "";

    const promptTokens = Math.ceil(messages.reduce((a, m) => a + contentText(m).length, 0) / 4) + 1;
    const reasoningTokens = Math.ceil(reasoning.length / 4);
    const completionTokens = Math.ceil((content.length + toolArgs.length + secondArgs.length) / 4) + reasoningTokens;
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
    const finish = cut || cutArgs ? "length" : toolName ? "tool_calls" : "stop";

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
    for (const w of reasoningWords) deltas.push(chunk({ reasoning_content: w }));
    if (toolName) {
      deltas.push(chunk({ tool_calls: [{ index: 0, id: callId, type: "function", function: { name: toolName, arguments: "" } }] }));
      const first = argPieces;
      const second = secondArgs.match(/.{1,12}/g) ?? [];
      if (twoCalls) deltas.push(chunk({ tool_calls: [{ index: 1, id: `${callId}_b`, type: "function", function: { name: toolName, arguments: "" } }] }));
      // Parallel calls' fragments interleave, as they can live: only `index` tells them apart.
      for (let k = 0; k < Math.max(first.length, second.length); k++) {
        if (first[k]) deltas.push(chunk({ tool_calls: [{ index: 0, function: { arguments: first[k] } }] }));
        if (second[k]) deltas.push(chunk({ tool_calls: [{ index: 1, function: { arguments: second[k] } }] }));
      }
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
      if (i === dropAt) {
        await sleep(Math.max(stepMs, 20)); // let what was written reach the client first, even with no delay
        return void res.destroy();
      }
      res.write(`data: ${JSON.stringify(deltas[i])}\n\n`);
      if (stepMs) await sleep(stepMs);
    }
    res.end("data: [DONE]\n\n");
  }

  type ImageBody = { model?: string; prompt?: string; width?: number; height?: number; resolution?: string; aspect_ratio?: string; return_binary?: boolean; safe_mode?: boolean };

  async function image(res: ServerResponse, body: ImageBody, n: number) {
    const model = MOCK_MODELS.find((m) => m.id === body?.model && m.type === "image");
    if (!model) return json(res, 404, { error: `Specified model not found: ${body?.model}` });
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    if (!prompt.trim()) return json(res, 400, { error: "prompt is required" });
    const limit = model.model_spec.constraints?.promptCharacterLimit;
    if (limit && prompt.length > limit) return json(res, 400, { error: `prompt exceeds ${limit} characters` });
    if (prompt.includes("MOCK_ERROR") || prompt.includes("MOCK_IMAGE_ERROR")) return json(res, 400, { error: "mock: forced image error (MOCK_IMAGE_ERROR)" });
    if (prompt.includes("MOCK_IMAGE_FLAKY") && !flaky.has(prompt)) {
      flaky.add(prompt);
      return json(res, 503, { error: "mock: the image service is busy, try again (MOCK_IMAGE_FLAKY)" });
    }
    await sleep(prompt.includes("MOCK_SLOW") || prompt.includes("MOCK_IMAGE_SLOW") ? imageSlowMs : imageDelayMs);

    const p = model.model_spec.pricing;
    const res0 = body.resolution ?? model.model_spec.constraints?.defaultResolution;
    const cost = p.generation?.usd ?? p.resolutions?.[res0]?.usd ?? 0;
    state.balanceUsd -= cost;

    // Sized by width × height (capped at 256 px), or by aspect ratio for the resolution-sized models.
    const [aw, ah] = (body.aspect_ratio ?? "1:1").split(":").map(Number) as [number, number];
    const ratio = aw > 0 && ah > 0 ? aw / ah : 1;
    const want = { w: body.width ?? (ratio >= 1 ? 128 : 128 * ratio), h: body.height ?? (ratio >= 1 ? 128 / ratio : 128) };
    const scale = Math.min(1, 256 / Math.max(want.w, want.h)); // keep the asked shape, at most 256 px a side
    const w = clamp(want.w * scale, 8, 256);
    const h = clamp(want.h * scale, 8, 256);
    // Venice's safe_mode defaults to on. A blurred image comes back grey here, so it looks different too.
    const blurred = prompt.includes("MOCK_BLURRED") && body.safe_mode !== false;
    const bytes = blurred ? solidPng(w, h, [128, 128, 128]) : gradientPng(w, h, colorFor(prompt), colorFor(`${prompt}\u0000`));
    const headers = {
      ...IMAGE_HEADERS,
      "x-venice-is-blurred": String(blurred),
      "x-venice-is-content-violation": String(prompt.includes("MOCK_VIOLATION")),
    };
    if (body.return_binary) {
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": bytes.length, ...headers });
      return void res.end(bytes);
    }
    return json(res, 200, {
      id: `mock-img-${n}`,
      images: [bytes.toString("base64")],
      request: body,
      timing: { inferenceDuration: imageDelayMs, inferencePreprocessingTime: 0, inferenceQueueTime: 0, total: imageDelayMs },
    }, headers);
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

// Live /image/generate responses carry these (T05's safe-mode UX reads them). MOCK_BLURRED / MOCK_VIOLATION set them.
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

/** T08: a made-up character sheet, for MOCK_HIDDEN's note. */
const HIDDEN_OPEN = "```hidden character sheet";
const MOCK_SHEET = [
  "Name: Mara Vell, a mapmaker",
  "Looks: grey hooded cloak, ink-stained fingers, a scar through her left eyebrow",
  "Wants: to sell the map tonight, before the Guild finds her",
  "Secret: MOCK_SECRET the map is a forgery, and she drew it herself",
  "Fears: her brother, who hunts forgers for the Guild",
].join("\n");

function contentText(m: { content?: unknown } | undefined): string {
  const c = m?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p?.text === "string" ? p.text : "")).join(" ");
  return "";
}

/** The text before the first stop sequence in it, as Venice ends a reply (the sequence itself isn't included). */
function cutAtStop(text: string, stop: string | string[] | undefined): string {
  const stops = (Array.isArray(stop) ? stop : stop === undefined ? [] : [stop]).filter((x) => typeof x === "string" && x !== "");
  const at = Math.min(...stops.map((x) => text.indexOf(x)).filter((i) => i >= 0), text.length);
  return text.slice(0, at);
}

const excerpt = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);
/** Up to 60 characters: the start and the end of a longer text (where a steer's instruction is). */
function headTail(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= 60 ? t : `${t.slice(0, 30)}…${t.slice(-29)}`;
}
const words = (s: string) => s.match(/\S+\s*/g) ?? [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

function colorFor(s: string): Rgb {
  const h = crc32(s);
  return [h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff];
}

type Rgb = [number, number, number];

/** Minimal valid RGB PNG of one color. */
export function solidPng(w: number, h: number, rgb: Rgb): Buffer {
  return png(w, h, () => rgb);
}

/**
 * A soft diagonal blend of two colors with a darker rim (T05 frontend): still a tiny, deterministic image per
 * prompt, but one that reads as a picture in the browser rather than a flat swatch.
 */
export function gradientPng(w: number, h: number, a: Rgb, b: Rgb): Buffer {
  return png(w, h, (x, y) => {
    const t = (x / Math.max(1, w - 1) + y / Math.max(1, h - 1)) / 2;
    const dx = x / Math.max(1, w - 1) - 0.5;
    const dy = y / Math.max(1, h - 1) - 0.5;
    const shade = 1 - 0.55 * Math.min(1, (dx * dx + dy * dy) * 2);
    return [0, 1, 2].map((i) => Math.round((a[i]! * (1 - t) + b[i]! * t) * shade)) as Rgb;
  });
}

function png(w: number, h: number, at: (x: number, y: number) => Rgb): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) row.set(at(x, y), 1 + x * 3);
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
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
    // T05 frontend: how long a MOCK_IMAGE_SLOW image takes, to watch a pending image (and reload mid-paint) by hand.
    imageSlowMs: process.env.MOCK_IMAGE_SLOW_MS ? Number(process.env.MOCK_IMAGE_SLOW_MS) : undefined,
    log: true,
  });
  console.log(`${new Date().toISOString()} mock Venice listening on ${mock.url}`);
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => void mock.close().then(() => process.exit(0)));
}
