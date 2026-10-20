/**
 * What a failed chat request looked like, everything but its words (2026-10-20). A chat call can fail with almost
 * nothing to go on (live: a 500 "chat completions inference processing failed"), so the error carries this shape:
 * the model and every knob sent, the size and role of each message, what is unusual about their order, how much
 * came back before it broke, and what Venice answered, with its request-id headers and the timing.
 *
 * Two views of one shape. The user who hit it gets theirs in the error (`details.diagnostics`), with who each
 * message is from (read from its framing) and Venice's whole error text. The server log gets `forLog`'s, which
 * names nothing: ids only, every string of the request replaced by its length, and Venice's text with anything
 * that repeats the request masked. The request part is built by allowlisting (`redact`): a string is kept only
 * under a key known to hold structure (model, role, type, reasoning_effort, ...) and matching that key's pattern;
 * every other string becomes "<N chars>", so a field added to the request later is redacted by default.
 *
 * Dependency-free (no Node APIs): the CLI and the browser import `formatDiagnostics` to show the same block.
 */

export type Redacted = null | boolean | number | string | Redacted[] | { [key: string]: Redacted };

/** One message of the request: its role and size, never its words. */
export type MessageShape = {
  role: string;
  /** The content's length in characters (0 when empty, or when it isn't a string: then `more` has it). */
  chars: number;
  /** Every other field of the message (tool_calls, tool_call_id, a content that isn't a string), redacted. */
  more?: Redacted;
  /** The user's view only: who it is from, read from its framing (`<!-- from: Dice Master -->`). Never logged. */
  from?: string;
};

export type RequestShape = {
  model: string;
  /** What reasoning was asked for, from the fields actually sent. */
  reasoning: string;
  messages: MessageShape[];
  /** Every field of the body but `messages`, redacted: what went out besides the conversation. */
  params: Redacted;
  size: {
    messages: number;
    /** Characters of every string the request carries (contents, tool text, stop sequences). */
    chars: number;
    /** The JSON body's size in UTF-8 bytes, as sent. */
    bytes: number;
    /** An estimate (~4 characters a token, plus a few a message): we have no tokenizer. */
    estTokens: number;
  };
  /** Anything unusual: the same role twice in a row, a system message after the start, a body not ending on user... */
  flags: string[];
};

/** How much of the reply arrived before it broke. */
export type Received = {
  /** Server-sent events with data. */
  chunks: number;
  contentChars: number;
  reasoningChars: number;
  toolCallChars: number;
  finishReason?: string;
  usage?: { promptTokens: number; completionTokens: number; reasoningTokens?: number };
  /** The stream's closing `data: [DONE]`. */
  done: boolean;
};

export type VeniceSaid = {
  /** The HTTP status of an up-front refusal. */
  status?: number;
  /** Venice's error: the refusal's whole body, or the error chunk in the stream. The log's is masked and cut (forLog). */
  error?: string;
  /** Its length, when `error` was cut. */
  errorChars?: number;
  /** Request-id-style response headers (and rate limits, date, server), to quote to Venice support. */
  headers?: Record<string, string>;
};

export type LastWorked = {
  messageId: string;
  /** How many ledger messages came after it. */
  messagesAgo: number;
  at: string;
  model?: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
};

export type ChatDiagnostics = {
  /**
   * refused: Venice answered with an HTTP error before streaming anything. no-answer: it never answered (out of
   * reach, or no response in time). stream: the reply had started, then broke.
   */
  stage: "refused" | "no-answer" | "stream";
  /** Our own words for what went wrong (never Venice's text, which is `venice.error`). */
  what: string;
  request: RequestShape;
  /** stage "stream" only. */
  received?: Received;
  timing: { headersMs?: number; firstChunkMs?: number; failedMs: number };
  venice: VeniceSaid;
  /** The model's limits, from the cached model list. */
  model?: { contextLength?: number; maxCompletionTokens?: number; alwaysReasons?: string };
  /** The newest reply in this conversation that worked, for scale: its prompt tokens are Venice's own count. */
  lastWorked?: LastWorked;
  /** The user's view only: the brain that was asked. */
  brain?: string;
  /** The log's view only: who, by id. `user` is a pseudonym (see design.md, "Diagnosing a failed chat request"). */
  ids?: { conversation: string; brain: string; user: string; encrypted: boolean };
};

/**
 * Keys whose string values are structure, not words, and the shape such a value must have to be kept. Anything
 * else, or a value that doesn't match, is replaced by its length. Tool names, stop sequences and ids are left out
 * on purpose: they are user-editable text (tool.name) or say nothing useful.
 */
const STRUCTURAL: Record<string, RegExp> = {
  model: /^[\w.:/-]{1,120}$/,
  role: /^(system|user|assistant|tool|developer|function)$/,
  type: /^[a-z_]{1,32}$/,
  reasoning_effort: /^[a-z]{1,16}$/,
  enable_web_search: /^[a-z]{1,16}$/,
};
const KEY = /^[A-Za-z_][\w-]{0,63}$/;

export const sizeMarker = (s: string) => `<${s.length} chars>`;

/**
 * A JSON value with every string replaced by its length, except structural ones (STRUCTURAL). Numbers, booleans
 * and null stay; a key that doesn't look like a field name is replaced too. `words` collects what was hidden.
 */
export function redact(value: unknown, key?: string, words?: string[]): Redacted {
  if (typeof value === "string") {
    if (key !== undefined && Object.hasOwn(STRUCTURAL, key) && STRUCTURAL[key]!.test(value)) return value;
    words?.push(value);
    return sizeMarker(value);
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, undefined, words));
  if (typeof value === "object") {
    const out: Record<string, Redacted> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const name = KEY.test(k) ? k : (words?.push(k), `<key, ${k.length} chars>`);
      out[name] = redact(v, k, words);
    }
    return out;
  }
  return `<${typeof value}>`;
}

/** Every string `redact` hides in a request body: what an echo in Venice's error text is checked against. */
export function wordsOf(body: unknown): string[] {
  const words: string[] = [];
  redact(body, undefined, words);
  return words;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The request's shape: model, knobs, each message's role and size, totals and flags. No word of it. */
export function describeRequest(body: unknown): RequestShape {
  const b: Obj = isObj(body) ? body : {};
  const { messages: rawMessages, ...rest } = b;
  const list = Array.isArray(rawMessages) ? rawMessages : [];
  const messages = list.map((m): MessageShape => {
    const { role, content, ...more }: Obj = isObj(m) ? m : { content: m };
    const shape: MessageShape = { role: String(redact(role, "role")), chars: typeof content === "string" ? content.length : 0 };
    if (typeof content !== "string" && content !== undefined) more.content = content;
    if (Object.keys(more).length) shape.more = redact(more);
    return shape;
  });
  const words = wordsOf(body);
  const chars = words.reduce((n, w) => n + w.length, 0);
  let json = "";
  try {
    json = JSON.stringify(body) ?? "";
  } catch {
    // a body that can't be serialized was never sent; its size is unknown
  }
  return {
    model: String(redact(b.model, "model")),
    reasoning: reasoningOf(b),
    messages,
    params: redact(rest),
    size: { messages: messages.length, chars, bytes: new TextEncoder().encode(json).length, estTokens: Math.ceil(chars / 4) + 4 * messages.length },
    flags: flagsOf(messages, b),
  };
}

/** Reasoning as the body asks for it: the very fields sent, in words. */
function reasoningOf(b: Obj): string {
  const vp = isObj(b.venice_parameters) ? b.venice_parameters : {};
  const effort = typeof b.reasoning_effort === "string" ? String(redact(b.reasoning_effort, "reasoning_effort")) : undefined;
  if (vp.disable_thinking === true) return `off (venice_parameters.disable_thinking: true${effort ? `, reasoning_effort: ${effort}` : ""})`;
  if (effort === "none") return "off (reasoning_effort: none)";
  if (effort) return `on (reasoning_effort: ${effort})`;
  return "not set (no reasoning_effort, no disable_thinking: the model's default)";
}

const span = (a: number, b: number) => (a === b ? `#${a}` : `#${a}–#${b}`);

/** What is unusual about the messages' order and shape (the role sequence is all it reads, plus sizes). */
function flagsOf(messages: MessageShape[], b: Obj): string[] {
  const flags: string[] = [];
  const roles = messages.map((m) => m.role);
  if (!roles.length) return ["no messages at all"];
  if (roles[0] !== "system") flags.push(`the first message is ${roles[0]}, not system`);
  const lateSystem = roles.flatMap((r, i) => (r === "system" && i > 0 ? [i] : []));
  if (lateSystem.length) flags.push(`system message${lateSystem.length > 1 ? "s" : ""} after the start: ${lateSystem.map((i) => `#${i}`).join(", ")}`);

  // Runs of one role. user runs are routine (other brains' replies and the player's are all framed as user), so
  // they get one line; any other role twice in a row gets its own.
  const userRuns: string[] = [];
  for (let i = 0; i < roles.length; ) {
    let j = i;
    while (j + 1 < roles.length && roles[j + 1] === roles[i]) j++;
    if (j > i) {
      if (roles[i] === "user") userRuns.push(span(i, j));
      else flags.push(`${j - i + 1} ${roles[i]} messages in a row: ${span(i, j)}`);
    }
    i = j + 1;
  }
  if (userRuns.length) flags.push(`user messages in a row (usual with several brains, whose replies are framed as user): ${userRuns.join(", ")}`);

  const last = roles.at(-1)!;
  if (last !== "user") flags.push(`it ends on ${last}, not user`);
  const empty = messages.flatMap((m, i) => (m.chars === 0 && !m.more ? [i] : []));
  if (empty.length) flags.push(`empty content: ${empty.map((i) => `#${i}`).join(", ")}`);

  const hasTools = Array.isArray(b.tools) && b.tools.length > 0;
  messages.forEach((m, i) => {
    const calls = toolCallCount(m);
    if (calls && !hasTools) flags.push(`#${i} carries tool_calls, but the request has no tools`);
    if (calls && roles[i + 1] !== "tool") flags.push(`#${i} carries tool_calls, and #${i + 1} isn't a tool result`);
    if (m.role === "tool" && !(i > 0 && toolCallCount(messages[i - 1]!))) flags.push(`#${i} is a tool result with no tool_calls right before it`);
  });
  return flags;
}

const toolCallCount = (m: MessageShape) => (isObj(m.more) && Array.isArray(m.more.tool_calls) ? m.more.tool_calls.length : 0);

/** Flags that need the model's limits: an estimate near or over its context. */
export function limitFlags(d: Pick<ChatDiagnostics, "request" | "model">): string[] {
  const ctx = d.model?.contextLength;
  if (!ctx) return [];
  const est = d.request.size.estTokens;
  const maxTokens = isObj(d.request.params) && typeof d.request.params.max_tokens === "number" ? d.request.params.max_tokens : 0;
  if (est + maxTokens > ctx) return [`the estimated prompt (about ${num(est)} tokens)${maxTokens ? ` plus max_tokens (${num(maxTokens)})` : ""} is over the model's context (${num(ctx)})`];
  if (est > ctx * 0.8) return [`the estimated prompt (about ${num(est)} tokens) is over 80% of the model's context (${num(ctx)})`];
  return [];
}

/**
 * Venice's text with every run that repeats the request masked, for the log. A run is a match of `k` characters or
 * more with any string the request carries, as sent or JSON-escaped (a validation error may quote a message as JSON
 * or as a Python repr), plus any whole string of 6 characters or more. Leans to masking: a phrase of Venice's that
 * the conversation also happens to contain is masked too.
 */
export function maskEcho(text: string, words: string[], k = 12): string {
  if (!text) return text;
  const hide = new Uint8Array(text.length);
  const grams = new Map<string, number[]>();
  for (let i = 0; i + k <= text.length; i++) {
    const g = text.slice(i, i + k);
    const at = grams.get(g);
    if (at) at.push(i);
    else grams.set(g, [i]);
  }
  const mark = (i: number, n: number) => hide.fill(1, i, i + n);
  for (const w of words) {
    for (const form of new Set([w, JSON.stringify(w).slice(1, -1)])) {
      if (form.length < 6) continue;
      if (form.length < k) {
        for (let i = text.indexOf(form); i !== -1; i = text.indexOf(form, i + 1)) mark(i, form.length);
        continue;
      }
      if (!grams.size) continue;
      for (let i = 0; i + k <= form.length; i++) {
        const at = grams.get(form.slice(i, i + k));
        if (at) for (const j of at) mark(j, k);
      }
    }
  }
  let out = "";
  for (let i = 0; i < text.length; ) {
    if (!hide[i]) {
      out += text[i++];
      continue;
    }
    let j = i;
    while (j < text.length && hide[j]) j++;
    out += `[${j - i} chars that repeat the request, masked]`;
    i = j;
  }
  return out;
}

/** At most `n` characters, saying how many there were. */
export function cut(s: string, n: number): { text: string; chars?: number } {
  return s.length <= n ? { text: s } : { text: `${s.slice(0, n)}…`, chars: s.length };
}

/** The user's view: who each message is from, read from its framing, and the brain asked. */
export function forUser(d: ChatDiagnostics, body: unknown, brain: string): ChatDiagnostics {
  const list = isObj(body) && Array.isArray(body.messages) ? body.messages : [];
  const messages = d.request.messages.map((m, i) => {
    const from = framedFrom((list[i] as Obj | undefined)?.content);
    return from ? { ...m, from } : m;
  });
  return { ...d, brain, request: { ...d.request, messages } };
}

/** The name in a message's framing comment (`<!-- from: Dice Master -->`, `<!-- from: X. It called ... -->`). */
function framedFrom(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  const m = /^\s*<!--\s*from:\s*([^\n]*?)\s*(?:\.\s[^\n]*?)?-->/.exec(content);
  return m?.[1] ? m[1].slice(0, 60) : undefined;
}

/**
 * The log's view: named by ids, the request described afresh from the body (so nothing added for the user, such as
 * `from`, can come along), and every string from Venice masked where it repeats the request, then cut.
 */
export function forLog(d: ChatDiagnostics, body: unknown, ids: NonNullable<ChatDiagnostics["ids"]>): ChatDiagnostics {
  const words = wordsOf(body);
  const clean = (s: string, n: number) => cut(maskEcho(s, words), n).text;
  const venice: VeniceSaid = {};
  if (d.venice.status !== undefined) venice.status = d.venice.status;
  if (d.venice.error !== undefined) {
    const { text, chars } = cut(maskEcho(d.venice.error, words), LOG_ERROR_CHARS);
    venice.error = text;
    const all = d.venice.errorChars ?? (chars !== undefined ? d.venice.error.length : undefined);
    if (all !== undefined) venice.errorChars = all;
  }
  if (d.venice.headers) venice.headers = Object.fromEntries(Object.entries(d.venice.headers).map(([k, v]) => [k, clean(v, 200)]));
  const out: ChatDiagnostics = { stage: d.stage, what: clean(d.what, 300), request: describeRequest(body), timing: { ...d.timing }, venice, ids };
  if (d.received) {
    const r = d.received;
    out.received = { chunks: r.chunks, contentChars: r.contentChars, reasoningChars: r.reasoningChars, toolCallChars: r.toolCallChars, done: r.done };
    if (r.finishReason !== undefined) out.received.finishReason = String(redact(r.finishReason, "type"));
    if (r.usage) out.received.usage = { ...r.usage };
  }
  if (d.model) out.model = { ...d.model };
  if (d.lastWorked) out.lastWorked = { ...d.lastWorked };
  return out;
}

/** How much of Venice's error text the log keeps (after masking). The user's error has it whole, up to VENICE_BODY_CHARS. */
export const LOG_ERROR_CHARS = 600;
export const VENICE_BODY_CHARS = 8000;

/**
 * Response headers worth quoting to Venice support: request and trace ids, Cloudflare's ray, Venice's own x-venice-*,
 * rate limits, retry-after, date, server, content type. Cookies and everything else are left out.
 */
const KEEP_HEADER = /(^|-)(request|trace|correlation|span)-?id$|^cf-ray$|^x-venice-|ratelimit|^retry-after$|^date$|^server$|^content-type$|^via$/i;

export function pickHeaders(h: { forEach(cb: (value: string, key: string) => void): void }): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    if (KEEP_HEADER.test(key)) out[key.toLowerCase()] = value.slice(0, 200);
  });
  return out;
}

const num = (n: number) => n.toLocaleString("en-US");
const ms = (n: number | undefined) => (n === undefined ? "—" : n >= 10_000 ? `${(n / 1000).toFixed(1)} s` : `${num(Math.round(n))} ms`);

const STAGE: Record<ChatDiagnostics["stage"], string> = {
  refused: "Venice refused the request before streaming anything",
  "no-answer": "Venice never answered",
  stream: "The reply started, then broke",
};

/** The readable block: the CLI prints it under the error, the browser shows it under Details, the log keeps one. */
export function formatDiagnostics(d: ChatDiagnostics): string {
  const out: string[] = [];
  const r = d.request;
  out.push(`What failed: everything about the request but its words`);
  out.push(`  ${STAGE[d.stage] ?? d.stage}. ${d.what}`);
  if (d.ids) out.push(`  conversation ${d.ids.conversation} · brain ${d.ids.brain} · user ${d.ids.user} (${d.ids.encrypted ? "encrypted" : "not encrypted"})`);
  else if (d.brain) out.push(`  Asked: ${d.brain} (the assistant messages below are its own replies, or setup or pins sent as assistant)`);
  const v = d.venice;
  if (v.status !== undefined) out.push(`  HTTP status: ${v.status}`);
  if (v.error !== undefined) out.push(`  Venice said${v.errorChars ? ` (${num(v.errorChars)} chars, cut)` : ""}: ${v.error}`);
  if (v.headers && Object.keys(v.headers).length) out.push(`  Response headers: ${Object.entries(v.headers).map(([k, x]) => `${k}: ${x}`).join(" · ")}`);
  const t = d.timing;
  const first = d.stage === "refused" ? "the refusal came" : "response headers";
  out.push(`  Timing: ${first} ${t.headersMs === undefined ? "never came" : `after ${ms(t.headersMs)}`}${t.firstChunkMs !== undefined ? ` · first chunk after ${ms(t.firstChunkMs)}` : ""} · failed after ${ms(t.failedMs)}`);
  if (d.received) {
    const x = d.received;
    out.push(
      `  Received before it broke: ${num(x.chunks)} chunks · reply ${num(x.contentChars)} chars · reasoning ${num(x.reasoningChars)} chars · tool-call arguments ${num(x.toolCallChars)} chars · finish_reason ${x.finishReason ?? "none"} · usage ${x.usage ? `${num(x.usage.promptTokens)} in / ${num(x.usage.completionTokens)} out` : "none"} · [DONE] ${x.done ? "yes" : "no"}`,
    );
  }

  out.push("", "Request");
  const m = d.model;
  const limits = [m?.contextLength ? `context ${num(m.contextLength)} tokens` : "", m?.maxCompletionTokens ? `max reply ${num(m.maxCompletionTokens)}` : "", m?.alwaysReasons ? `always reasons (reasoning off is ${m.alwaysReasons})` : ""].filter(Boolean);
  out.push(`  Model: ${r.model}${limits.length ? ` (${limits.join(" · ")})` : ""}`);
  out.push(`  Reasoning: ${r.reasoning}`);
  out.push(`  Knobs: ${knobs(r.params)}`);
  out.push(`  Size: ${num(r.size.messages)} messages · ${num(r.size.chars)} chars of text · ${num(r.size.bytes)} bytes of JSON · about ${num(r.size.estTokens)} tokens (an estimate: ~4 chars a token; no tokenizer here)`);
  const lw = d.lastWorked;
  out.push(
    lw
      ? `  Last reply here that worked: ${lw.messageId}, ${lw.messagesAgo === 0 ? "the newest message" : `${num(lw.messagesAgo)} message${lw.messagesAgo === 1 ? "" : "s"} ago`} (${lw.at}${lw.model ? `, ${lw.model}` : ""}): ${num(lw.promptTokens)} prompt tokens (Venice's count), ${num(lw.completionTokens)} out${lw.reasoningTokens ? `, ${num(lw.reasoningTokens)} of them reasoning` : ""}`
      : "  Last reply here that worked: none with a token count",
  );

  out.push("", `Messages (#, role, chars${d.ids ? "" : ", from"})`);
  const w = Math.max(1, String(r.messages.length - 1).length);
  const cw = Math.max(1, ...r.messages.map((x) => num(x.chars).length));
  r.messages.forEach((x, i) => {
    const extra = [x.from ? `from ${x.from}` : "", x.more !== undefined ? JSON.stringify(x.more) : ""].filter(Boolean).join("  ");
    out.push(`  #${String(i).padStart(w)}  ${x.role.padEnd(9)} ${num(x.chars).padStart(cw)}${extra ? `  ${extra}` : ""}`);
  });

  const flags = [...r.flags, ...limitFlags(d)];
  out.push("", "Flags");
  out.push(...(flags.length ? flags.map((f) => `  - ${f}`) : ["  none: system first, roles alternate, ends on user"]));

  out.push("", "Sent besides the messages (each string replaced by its length)");
  out.push(`  ${JSON.stringify(r.params)}`);
  return out.join("\n");
}

/** The knobs that matter, in one line, from the redacted params. */
function knobs(p: Redacted): string {
  const o = isObj(p) ? (p as Record<string, Redacted>) : {};
  const stop = Array.isArray(o.stop) ? o.stop.length : typeof o.stop === "string" ? 1 : 0;
  const tools = Array.isArray(o.tools) ? o.tools.length : 0;
  const choice = isObj(o.tool_choice) ? `tool_choice ${String(o.tool_choice.type ?? "set")} (forced)` : o.tool_choice !== undefined ? `tool_choice ${String(o.tool_choice)}` : "";
  const vp = isObj(o.venice_parameters) ? o.venice_parameters : {};
  return [
    `max_tokens ${o.max_tokens ?? "not set"}`,
    `temperature ${o.temperature ?? "not set"}`,
    `stop ${stop ? `${stop} sequence${stop === 1 ? "" : "s"}` : "none"}`,
    `tools ${tools || "none"}${choice ? `, ${choice}` : ""}`,
    `stream ${o.stream === true ? "on" : "off"}${isObj(o.stream_options) && o.stream_options.include_usage === true ? " with usage" : ""}`,
    `include_venice_system_prompt ${String(vp.include_venice_system_prompt)}`,
  ].join(" · ");
}
