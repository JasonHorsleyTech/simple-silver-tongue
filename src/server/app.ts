import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { stream } from "hono/streaming";
import type { z } from "zod";
import { toErrorBody } from "../lib/errors.ts";
import { toText } from "../lib/text.ts";
import { describeCommand, indexCommands, requireSessionFrom, type AnyCommand, type Ctx, type Deps } from "../registry.ts";
import { safeJoin } from "../storage/files.ts";
import { closeVault, forkVault } from "../storage/vault.ts";
import { endedError, type Session } from "./sessions.ts";

export const SESSION_COOKIE = "ss_session";

export type Logger = (line: string) => void;
/**
 * A visible browser tab asks these every 30 s (T06), two log lines a minute per window. A successful one says
 * nothing a log reader needs, so only their failures are logged (T07 frontend).
 */
const QUIET_PATHS = new Set(["/api/auth.whoami", "/api/health"]);

export const consoleLogger: Logger = (line) => console.log(`${new Date().toISOString()} ${line}`);

/**
 * HTTP adapter over the command registry.
 *   POST /api/<name>  JSON args in, JSON out (stream commands: NDJSON events).
 *   GET  /api/<name>  binary commands (and health), args from the query string.
 * Sending `x-ss-cli: 1` wraps JSON results as {result, text}, where text is the command's CLI rendering;
 * `x-ss-reveal: 1` asks that rendering to show hidden notes instead of folding them (./ss --reveal, T08).
 * We never log args, results or bodies: only method, path, status and timing.
 */
export function createApp(base: Omit<Deps, "commands">, commands: AnyCommand[], log: Logger = consoleLogger): Hono {
  const index = indexCommands(commands);
  const deps: Deps = { ...base, commands };
  const app = new Hono();

  app.use("*", async (c, next) => {
    // Local only: refuse other Host names (DNS rebinding) and cross-site Origins (CSRF).
    if (!isLoopback(hostOf(c.req.header("host")))) return apiError(c, 403, "forbidden", "Host not allowed.");
    const origin = c.req.header("origin");
    if (origin !== undefined && !isLoopback(originHost(origin))) {
      return apiError(c, 403, "forbidden", "Cross-origin requests are not allowed.");
    }
    const t0 = performance.now();
    await next();
    if (QUIET_PATHS.has(c.req.path) && c.res.status < 300) return;
    log(`${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - t0)}ms`);
  });

  app.all("/api/:name", async (c) => {
    c.header("Cache-Control", "no-store"); // decrypted bytes must never land in a browser disk cache
    const name = c.req.param("name");
    const cmd = index.get(name);
    if (!cmd) return apiError(c, 404, "unknown_command", `Unknown command ${name}. Run ./ss help for the list.`);
    const info = describeCommand(cmd);

    let raw: unknown;
    if (c.req.method === "POST") {
      // CSRF: without a CORS preflight a page can only send text/plain or form bodies, and we never approve
      // a preflight. Requiring JSON blocks blind cookie-carrying posts from other localhost ports.
      if (!isJsonType(c.req.header("content-type"))) {
        return apiError(c, 415, "unsupported_media_type", "POST /api/<command> needs Content-Type: application/json.");
      }
      const text = await c.req.text();
      try {
        raw = text.trim() === "" ? {} : JSON.parse(text);
      } catch {
        return apiError(c, 400, "bad_json", "The request body must be a JSON object of arguments.");
      }
    } else if (c.req.method === "GET" && info.httpGet) {
      raw = Object.fromEntries(new URL(c.req.url).searchParams);
    } else {
      return apiError(c, 405, "method_not_allowed", `${name} only accepts POST.`);
    }

    const parsed = cmd.args.safeParse(raw);
    if (!parsed.success) {
      const issues = formatIssues(parsed.error.issues);
      const message = `Invalid arguments for ${name}: ${issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ")}`;
      return apiError(c, 400, "bad_args", message, { issues });
    }

    const token = getCookie(c, SESSION_COOKIE) ?? bearer(c.req.header("authorization"));
    const known = deps.sessions.lookup(token);
    const found = known && "session" in known ? known.session : null;
    const ended = known !== null && "ended" in known ? known : null;
    // Lets a client drop a stale token and say why: "expired" (T06 triage), "logged-out" (logout --all),
    // "password-changed" or "deleted" (T06 frontend), and "invalid" for a token the server doesn't know (a restart).
    if (token && !found) c.header("x-ss-session", ended?.ended ?? "invalid");
    // This request's own copy of the key (see vault.ts). Logging out wipes the session's key, not this one,
    // so work already running still saves under the real key. Closed once the request's work is done.
    const session: Session | null = found ? { ...found, vault: forkVault(found.vault) } : null;
    const release = () => session && closeVault(session.vault);
    let handedOff = false; // a stream releases the lease itself, after draining
    let change: { session: Session | null } | null = null;
    const ctx: Ctx = {
      deps,
      session,
      requireSession: () => requireSessionFrom(session, ended ? endedError(ended.ended, ended.username, deps.sessions.idleMinutes) : undefined),
      setSession: (s) => {
        change = { session: s };
      },
      signal: c.req.raw.signal,
    };
    const applySession = () => {
      if (!change) return;
      if (change.session) {
        setCookie(c, SESSION_COOKIE, change.session.token, { httpOnly: true, sameSite: "Strict", path: "/" });
      } else {
        deleteCookie(c, SESSION_COOKIE, { path: "/" });
      }
    };

    try {
      if (info.auth) {
        ctx.requireSession();
        deps.sessions.touch(found!); // only a command that needs the login counts as activity (sessions.ts)
      }

      if (cmd.kind === "json") {
        const result = await cmd.handler(parsed.data, ctx);
        applySession();
        if (c.req.header("x-ss-cli")) {
          const opts = { reveal: c.req.header("x-ss-reveal") === "1" };
          return c.json({ result: result ?? null, text: cmd.format ? cmd.format(result, opts) : toText(result) });
        }
        return c.json(result ?? null);
      }

      if (cmd.kind === "binary") {
        const r = await cmd.handler(parsed.data, ctx);
        applySession();
        c.header("Content-Type", r.contentType);
        if (r.filename) c.header("Content-Disposition", `inline; filename="${r.filename.replace(/"/g, "")}"`);
        return c.body(r.bytes as Uint8Array<ArrayBuffer>);
      }

      // Stream: pull the first event before answering, so early failures (bad id, 409 busy) get a real status.
      const it = cmd.handler(parsed.data, ctx)[Symbol.asyncIterator]();
      const first = await it.next();
      applySession();
      c.header("Content-Type", "application/x-ndjson; charset=utf-8");
      c.header("X-Content-Type-Options", "nosniff");
      handedOff = true;
      return stream(c, async (s) => {
        // The work never waits on the client (T02 QA-2). Writes are queued, never awaited: a client that
        // left before the response started is never read from or cancelled by @hono/node-server, so an
        // awaited write would block forever and park the generator (holding the 409 lock and its key).
        // Once the request's signal says the client is gone, stop writing and drop the queue. Events are
        // small and a reply is finite, so the queue for a slow but live reader stays small.
        const gone = c.req.raw.signal;
        let open = true;
        const hangUp = () => {
          open = false;
          s.abort();
        };
        s.onAbort(() => {
          open = false;
        });
        if (gone.aborted) hangUp();
        else gone.addEventListener("abort", hangUp, { once: true });
        const send = (ev: unknown) => {
          if (open) void s.write(`${JSON.stringify(ev)}\n`); // StreamingApi.write never rejects
        };
        try {
          if (!first.done) send(first.value);
          // Keep draining after a disconnect so the work finishes and persists.
          for (let r = await it.next(); !r.done; r = await it.next()) send(r.value);
        } catch (err) {
          logFailure(log, name, err);
          send({ type: "error", error: toErrorBody(err).body });
        } finally {
          gone.removeEventListener("abort", hangUp);
          release();
        }
      });
    } catch (err) {
      logFailure(log, name, err);
      const { status, body } = toErrorBody(err);
      return c.json({ error: body }, status as 400);
    } finally {
      if (!handedOff) release();
    }
  });

  app.all("/api/*", (c) => apiError(c, 404, "unknown_command", "Unknown API path. Commands live at /api/<name>."));

  app.get("*", (c) => serveWeb(c, deps.config.webDist));

  return app;
}

function apiError(c: Context, status: number, code: string, message: string, details?: unknown) {
  return c.json({ error: details === undefined ? { code, message } : { code, message, details } }, status as 400);
}

function logFailure(log: Logger, name: string, err: unknown) {
  const { status, body } = toErrorBody(err);
  if (status >= 500 && body.code === "internal") log(`ERROR ${name}: ${err instanceof Error ? err.stack : String(err)}`);
  else log(`${name} failed: ${status} ${body.code}`);
}

function formatIssues(issues: z.core.$ZodIssue[]): { path: string; message: string }[] {
  return issues.map((i) => ({
    path: i.path.map(String).join("."),
    message: i.message.endsWith("received undefined") ? "required" : i.message,
  }));
}

function isJsonType(h: string | undefined): boolean {
  return (h ?? "").split(";")[0]!.trim().toLowerCase() === "application/json";
}

function bearer(h: string | undefined): string | undefined {
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : undefined;
}

function hostOf(host: string | undefined): string {
  if (!host) return "";
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0]!;
}

function originHost(origin: string): string {
  try {
    const h = new URL(origin).hostname;
    return h.includes(":") && !h.startsWith("[") ? `[${h}]` : h;
  } catch {
    return ""; // includes Origin: null
  }
}

const isLoopback = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "[::1]";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

/** Serves web/dist with an SPA fallback. Looked up per request, so a fresh build needs no restart. */
async function serveWeb(c: Context, dist: string) {
  const indexHtml = join(dist, "index.html");
  if (!existsSync(indexHtml)) return c.html(PLACEHOLDER);
  let file = indexHtml;
  const pathname = new URL(c.req.url).pathname;
  if (pathname !== "/") {
    try {
      const candidate = safeJoin(dist, decodeURIComponent(pathname).replace(/^\/+/, ""));
      if (existsSync(candidate) && statSync(candidate).isFile()) file = candidate;
      else if (extname(pathname)) return c.text("Not found", 404);
    } catch {
      return c.text("Not found", 404);
    }
  }
  const body = await readFile(file);
  c.header("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
  c.header("Cache-Control", file.includes(`${join(dist, "assets")}`) ? "public, max-age=31536000, immutable" : "no-cache");
  return c.body(body);
}

const PLACEHOLDER = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>simple-silver</title>
<style>body{background:#0b0d10;color:#d6dae0;font:15px/1.6 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem}
code{background:#1a1e24;padding:.1rem .35rem;border-radius:4px}</style></head>
<body><h1>simple-silver is running</h1>
<p>The web UI is not built yet (there is no <code>web/dist</code>). Everything works from the terminal:</p>
<p><code>./ss help</code></p></body></html>`;
