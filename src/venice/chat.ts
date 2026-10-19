import type { ChatRequest, Usage } from "../conversations/types.ts";
import { assertAnswerable, assertSendable } from "../conversations/prompt.ts";
import { CommandError, upstreamError } from "../lib/errors.ts";
import type { VeniceClient } from "./client.ts";

/**
 * Streaming /chat/completions. The body goes out exactly as given (after the hard-rule and nothing-to-answer
 * checks), and the SSE reply is parsed by hand into a few plain events. No content is ever put into an error
 * message or a log line, since errors end up in .run/server.log.
 */

export type ChatEvent =
  | { type: "reasoning"; delta: string }
  | { type: "content"; delta: string }
  | { type: "tool_call"; index: number; id?: string; name?: string; argsDelta: string }
  | { type: "finish"; reason: string }
  | { type: "usage"; usage: Usage; costUsd?: number };

export type ChatStreamOptions = {
  /** Abort the upstream request (a future generation.stop). Client disconnects should not abort. */
  signal?: AbortSignal;
  /** Time allowed for Venice to start answering. */
  connectTimeoutMs?: number;
  /** Longest silence allowed between chunks once the stream is running. There is no total limit. */
  idleTimeoutMs?: number;
};

class Timeout extends Error {}

/**
 * Sends the request and waits for the response headers, so an up-front refusal (bad model, no balance)
 * throws here, before the caller has saved or streamed anything. Returns the parsed event stream.
 */
export async function openChatStream(
  venice: VeniceClient,
  body: ChatRequest,
  opts: ChatStreamOptions = {},
): Promise<AsyncGenerator<ChatEvent>> {
  assertSendable(body);
  assertAnswerable(body);
  const { connectTimeoutMs = 120_000, idleTimeoutMs = 180_000 } = opts;
  const ctl = new AbortController();
  const onAbort = () => ctl.abort(opts.signal?.reason);
  if (opts.signal?.aborted) onAbort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => ctl.abort(new Timeout(`${Math.round(ms / 1000)}s`)), ms);
    timer.unref?.();
  };
  const cleanup = () => {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  };

  arm(connectTimeoutMs);
  let res: Response;
  try {
    res = await venice.request("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal: ctl.signal,
      timeoutMs: 0,
    });
  } catch (err) {
    cleanup();
    throw abortError(ctl.signal, "Venice did not start answering within") ?? err;
  }
  if (!res.body) {
    cleanup();
    throw upstreamError("Venice answered the chat request with an empty body.");
  }
  arm(idleTimeoutMs);

  // Lock the body now. undici cancels the body of a Response that is garbage-collected before anyone has
  // read it, and a cancelled body reads as a clean, empty end. Our caller saves the player message before it
  // starts reading, so without the lock a GC in that gap would silently drop the whole reply.
  const reader = res.body.getReader();
  const bytes = (async function* () {
    for (let r = await reader.read(); !r.done; r = await reader.read()) yield r.value;
  })();
  return (async function* events(): AsyncGenerator<ChatEvent> {
    let complete = false;
    let finished = false;
    try {
      for await (const data of sseData(bytes, () => arm(idleTimeoutMs))) {
        if (data === "[DONE]") {
          complete = true;
          break;
        }
        let chunk: unknown;
        try {
          chunk = JSON.parse(data);
        } catch {
          throw upstreamError("Venice sent a malformed stream chunk.");
        }
        for (const ev of chunkEvents(chunk)) {
          if (ev.type === "finish") finished = true;
          yield ev;
        }
      }
      // Some servers skip [DONE]; a finish_reason is enough to know the reply is whole.
      if (!complete && !finished) throw upstreamError("The Venice stream ended before the reply was complete.");
    } catch (err) {
      if (err instanceof CommandError) throw err;
      throw abortError(ctl.signal, "Venice stopped sending for") ?? upstreamError(`The Venice stream broke off (${describe(err)}).`);
    } finally {
      cleanup();
      if (!complete) ctl.abort(); // close the connection if we stopped early
    }
  })();
}

function abortError(signal: AbortSignal, timeoutText: string): CommandError | null {
  if (!signal.aborted) return null;
  const reason: unknown = signal.reason;
  if (reason instanceof Timeout) return upstreamError(`${timeoutText} ${reason.message}.`);
  if (reason instanceof CommandError) return reason;
  return new CommandError(499, "aborted", "The generation was stopped.");
}

const describe = (err: unknown) => {
  const e = err as { message?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.message ?? "connection error";
};

/** The data payloads of a server-sent-events stream, one per event. Comments and other fields are ignored. */
export async function* sseData(body: AsyncIterable<Uint8Array>, onBytes?: () => void): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buf = "";
  let data: string[] = [];
  function* line(raw: string): Generator<string> {
    const l = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (l === "") {
      if (data.length) yield data.join("\n");
      data = [];
    } else if (l.startsWith("data:")) {
      data.push(l.slice(5).replace(/^ /, ""));
    }
  }
  for await (const bytes of body) {
    onBytes?.();
    buf += decoder.decode(bytes, { stream: true });
    for (let nl = buf.indexOf("\n"); nl !== -1; nl = buf.indexOf("\n")) {
      const raw = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      yield* line(raw);
    }
  }
  buf += decoder.decode();
  if (buf) yield* line(buf);
  if (data.length) yield data.join("\n");
}

type Chunk = {
  error?: unknown;
  choices?: Array<{
    delta?: {
      content?: unknown;
      reasoning_content?: unknown;
      /** Some models' reasoning comes here instead (Abliterated Large V2, live 2026-10-19), reasoning_content null. */
      reasoning?: unknown;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  } | null;
  cost?: { usd?: number };
};

/**
 * One parsed chunk → events. Content is read on every chunk, including the one that carries finish_reason
 * (live Venice puts the last words there when max_tokens cuts a reply).
 */
export function chunkEvents(raw: unknown): ChatEvent[] {
  const chunk = (raw ?? {}) as Chunk;
  if (chunk.error !== undefined) {
    const e = chunk.error as { message?: unknown } | string;
    const msg = typeof e === "string" ? e : typeof e?.message === "string" ? e.message : "unknown error";
    throw upstreamError(`Venice reported an error mid-stream: ${msg.slice(0, 300)}`);
  }
  const out: ChatEvent[] = [];
  const choice = chunk.choices?.[0];
  if (choice) {
    const d = choice.delta ?? {};
    // reasoning_content first; `reasoning` only when it is absent, so a provider that sent both can't double it.
    const reasoning = typeof d.reasoning_content === "string" && d.reasoning_content ? d.reasoning_content : typeof d.reasoning === "string" ? d.reasoning : "";
    if (reasoning) out.push({ type: "reasoning", delta: reasoning });
    if (typeof d.content === "string" && d.content) out.push({ type: "content", delta: d.content });
    for (const tc of d.tool_calls ?? []) {
      const ev: ChatEvent = { type: "tool_call", index: tc.index ?? 0, argsDelta: tc.function?.arguments ?? "" };
      if (tc.id) ev.id = tc.id;
      if (tc.function?.name) ev.name = tc.function.name;
      out.push(ev);
    }
    if (choice.finish_reason) out.push({ type: "finish", reason: choice.finish_reason });
  }
  if (chunk.usage && typeof chunk.usage === "object") {
    const u = chunk.usage;
    const usage: Usage = { promptTokens: u.prompt_tokens ?? 0, completionTokens: u.completion_tokens ?? 0 };
    if (u.completion_tokens_details?.reasoning_tokens) usage.reasoningTokens = u.completion_tokens_details.reasoning_tokens;
    if (u.prompt_tokens_details?.cached_tokens) usage.cachedTokens = u.prompt_tokens_details.cached_tokens;
    const ev: ChatEvent = { type: "usage", usage };
    if (typeof chunk.cost?.usd === "number") ev.costUsd = chunk.cost.usd;
    out.push(ev);
  }
  return out;
}
