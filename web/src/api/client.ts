import { ApiError, isAbortError } from "./errors.ts";
import { readNdjson } from "./ndjson.ts";
import type { Commands, StreamCommands, StreamEvent, StreamYield } from "./types.ts";

/**
 * The one way the web app talks to the server. It speaks only the command endpoints the CLI uses:
 *   call(name, args)    POST /api/<name>, JSON in and out
 *   stream(name, args)  POST /api/<name>, NDJSON events out, as they arrive
 *   binaryUrl(name, q)  GET  /api/<name>?q, for <img src> (binary commands only)
 * The session is the server's httpOnly cookie, which the browser sends by itself; this code never sees it.
 */

export type CommandMap = Record<string, { args: object; result: unknown }>;
export type StreamMap = Record<string, { args: object }>;
export type CallOptions = { signal?: AbortSignal };

/** No-argument commands may omit args: api.call("auth.whoami"). */
type Rest<A> = Record<string, never> extends A ? [args?: A, opts?: CallOptions] : [args: A, opts?: CallOptions];

export type ClientOptions = {
  /** Prefix for /api. Empty in the browser (same origin); tests point it at an in-process server. */
  baseUrl?: string;
  fetch?: typeof fetch;
};

/** Codes that mean "your session is gone": the view should go back to the login screen. */
const SESSION_GONE = new Set(["unauthenticated", "session_ended"]);

export function createClient<C extends CommandMap = Commands, S extends StreamMap = StreamCommands>(opts: ClientOptions = {}) {
  const base = opts.baseUrl ?? "";
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const lostListeners = new Set<() => void>();

  const sessionLost = () => {
    for (const fn of lostListeners) fn();
  };

  /** Report an error, letting session listeners know when it means the login is gone. */
  const noticed = (err: ApiError): ApiError => {
    if (SESSION_GONE.has(err.code)) sessionLost();
    return err;
  };

  async function post(name: string, args: object | undefined, signal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(`${base}/api/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args ?? {}),
        signal,
      });
    } catch (err) {
      if (isAbortError(err)) throw err;
      throw new ApiError(0, "network", "Can't reach the simple-silver server. Start it with npm run up, then try again.");
    }
    // The server marks responses to a cookie it no longer knows (it restarted, or we logged out elsewhere).
    // A login replaces that cookie and a logout is leaving anyway, so only other commands count.
    if (res.headers.get("x-ss-session") === "invalid" && name !== "auth.login" && name !== "auth.logout") {
      sessionLost();
    }
    if (!res.ok) throw noticed(await errorFrom(res));
    return res;
  }

  async function call<K extends keyof C & string>(name: K, ...[args, o]: Rest<C[K]["args"]>): Promise<C[K]["result"]> {
    const res = await post(name, args, o?.signal);
    try {
      return (await res.json()) as C[K]["result"];
    } catch (err) {
      if (isAbortError(err)) throw err;
      throw new ApiError(res.status, "bad_response", `${name} answered with something that isn't JSON.`);
    }
  }

  /**
   * Yields each event as it arrives. A server `error` event, a dropped connection and a stream that ends
   * without `done` all throw an ApiError, so `for await ... catch` sees every failure. Text already
   * received stays with the caller. Aborting the signal stops reading; the server finishes and saves anyway.
   */
  async function* stream<K extends keyof S & string>(name: K, ...[args, o]: Rest<S[K]["args"]>): AsyncGenerator<StreamYield, void, undefined> {
    const res = await post(name, args, o?.signal);
    if (!res.body) throw new ApiError(res.status, "bad_stream", `${name} answered without a body.`);
    let done = false;
    try {
      for await (const raw of readNdjson(res.body)) {
        const ev = raw as StreamEvent;
        if (typeof ev !== "object" || ev === null || typeof ev.type !== "string") {
          throw new ApiError(0, "bad_stream", `${name} sent an event without a type.`);
        }
        if (ev.type === "error") throw noticed(new ApiError(0, ev.error.code, ev.error.message, ev.error.details));
        yield ev;
        if (ev.type === "done") done = true;
      }
    } catch (err) {
      if (err instanceof ApiError || isAbortError(err)) throw err;
      throw new ApiError(0, "stream_broken", "The connection to the server dropped before the reply finished.");
    }
    if (!done) throw new ApiError(0, "stream_broken", `${name} ended without saying it was done.`);
  }

  /** URL for a binary command (an image), so <img src> can GET it with the session cookie. */
  function binaryUrl(name: string, query: Record<string, string>): string {
    return `${base}/api/${name}?${new URLSearchParams(query)}`;
  }

  /** Called when the server says the session is gone. Returns an unsubscribe function. */
  function onSessionLost(fn: () => void): () => void {
    lostListeners.add(fn);
    return () => void lostListeners.delete(fn);
  }

  return { call, stream, binaryUrl, onSessionLost };
}

export type ApiClient<C extends CommandMap = Commands, S extends StreamMap = StreamCommands> = ReturnType<
  typeof createClient<C, S>
>;

/** The app's shared client. */
export const api: ApiClient = createClient();

async function errorFrom(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // not JSON: fall through to the generic message
  }
  const e = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)?.error;
  if (e && typeof e.code === "string" && typeof e.message === "string") {
    return new ApiError(res.status, e.code, e.message, e.details);
  }
  return new ApiError(res.status, `http_${res.status}`, `The server answered ${res.status} ${res.statusText}`.trim());
}
