import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DEFAULT_PORT, ROOT } from "../config.ts";
import { renderCommandHelp, renderCommandList } from "../lib/help-text.ts";
import type { CommandInfo, JsonSchema } from "../registry.ts";
import { parseFlags, splitArgv, UsageError } from "./args.ts";
import { promptHidden, readAllStdin } from "./prompt.ts";

/**
 * ./ss: a thin HTTP client over the server's command registry. It asks the server for the command
 * catalog (help), parses flags against each command's JSON schema, and POSTs to /api/<name>, the same
 * endpoints the browser uses. It never touches data/ itself.
 */

export type Io = {
  env: Record<string, string | undefined>;
  cwd: string;
  stdout: { write(s: string | Uint8Array): unknown; isTTY?: boolean };
  stderr: { write(s: string): unknown; isTTY?: boolean };
  stdinIsTTY: boolean;
  readStdin(): Promise<string>;
  /** Ask on the terminal. Hidden input unless `visible` (a confirmation, not a secret). */
  promptSecret(question: string, opts?: { visible?: boolean }): Promise<string>;
};

type SavedSession = { token: string; username?: string; url: string; savedAt: string };

const EXIT = { ok: 0, failed: 1, usage: 2, noServer: 3 } as const;

export async function run(argv: string[], io: Io): Promise<number> {
  const base = (io.env.SS_URL || `http://127.0.0.1:${io.env.SS_PORT || DEFAULT_PORT}`).replace(/\/+$/, "");
  // SS_SESSION_FILE gives a terminal its own login, so two terminals can be two users side by side (T06).
  const sessionFile = io.env.SS_SESSION_FILE
    ? resolve(io.cwd, io.env.SS_SESSION_FILE)
    : join(resolve(io.env.SS_RUN_DIR || join(ROOT, ".run")), "cli-session.json");
  const err = (s: string) => io.stderr.write(`${s}\n`);
  const dim = (s: string) => (io.stderr.isTTY ? `\x1b[2m${s}\x1b[0m` : s);

  let split;
  try {
    split = splitArgv(argv);
  } catch (e) {
    err(`error: ${(e as Error).message}`);
    return EXIT.usage;
  }
  const { global } = split;
  let name = split.command ?? "help";
  let rest = split.rest;
  if (global.help && name !== "help") {
    rest = ["--command", name];
    name = "help";
  } else if (name === "help" && rest.length === 1 && !rest[0]!.startsWith("-")) {
    rest = ["--command", rest[0]!]; // ./ss help user.create
  }

  const saved = await loadSession(sessionFile);

  async function call(cmd: string, args: unknown, opts: { text: boolean }): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.text) headers["x-ss-cli"] = "1";
    if (saved) headers.cookie = `ss_session=${saved.token}`;
    return fetch(`${base}/api/${cmd}`, { method: "POST", headers, body: JSON.stringify(args) });
  }

  try {
    // 1. The catalog tells us each command's kind and argument schema.
    let info: CommandInfo | undefined;
    if (name === "help") {
      info = HELP_INFO;
    } else {
      const res = await call("help", {}, { text: false });
      if (!res.ok) throw new Error(`could not load the command catalog (${res.status})`);
      const catalog = ((await res.json()) as { commands: CommandInfo[] }).commands;
      info = catalog.find((c) => c.name === name);
      if (!info) {
        const near = catalog.filter((c) => c.name.startsWith(name.split(".")[0]!) || c.name.includes(name)).map((c) => c.name);
        err(`error: unknown command ${name}.${near.length ? ` Did you mean: ${near.join(", ")}?` : ""} Run ./ss help.`);
        return EXIT.usage;
      }
    }

    // 2. Flags → typed args, then prompt for any secrets that weren't given.
    const { args, positionals, inlineSecrets, stdinUsed } = await parseFlags(rest, info.args, {
      readFile: (p) => readFile(resolve(io.cwd, p), "utf8"),
      readStdin: io.readStdin,
    });
    if (positionals.length) throw new UsageError(`unexpected argument ${JSON.stringify(positionals[0])} (flags look like --name value)`);
    for (const flag of inlineSecrets) {
      // The data on disk is ciphertext, but a password typed here sits in ~/.zsh_history in plain text (T06).
      err(`warning: ${flag} on the command line is saved in your shell history (and shows in ps while ./ss runs). Leave it out to be asked for it, or pass ${flag} - and pipe it in.`);
    }
    await promptForSecrets(info.args, args, io, stdinUsed);

    // 3. Call the server.
    const res = await call(name, args, { text: !global.json && info.kind === "json" });
    if (res.headers.get("x-ss-session") === "invalid" && saved) {
      await rm(sessionFile, { force: true });
      err(dim(`(Saved CLI session${saved.username ? ` for ${saved.username}` : ""} is no longer valid: the server restarted, or it was ended elsewhere by a logout, a password change or user.delete.)`));
    }
    if (!res.ok) return await printError(res, saved, err);

    if (info.kind === "stream") return await printStream(res, global.json, io, dim);

    if (info.kind === "binary") {
      const bytes = new Uint8Array(await res.arrayBuffer());
      const type = res.headers.get("content-type") ?? "application/octet-stream";
      if (global.out) {
        await writeFile(resolve(io.cwd, global.out), bytes);
        err(`Wrote ${bytes.length} bytes (${type}) to ${global.out}`);
      } else if (!io.stdout.isTTY) {
        io.stdout.write(bytes);
      } else {
        err(`error: ${name} returns binary data (${type}). Use --out <file>, or pipe the output.`);
        return EXIT.usage;
      }
      return EXIT.ok;
    }

    const body = (await res.json()) as unknown;
    const result = global.json ? body : (body as { result: unknown }).result;
    await syncSession(res, result, sessionFile, base);
    io.stdout.write(global.json ? `${JSON.stringify(body, null, 2)}\n` : `${(body as { text: string }).text}\n`);
    return EXIT.ok;
  } catch (e) {
    if (e instanceof UsageError) {
      err(`error: ${e.message}. Run ./ss help ${name}.`);
      return EXIT.usage;
    }
    if (isConnectionError(e)) {
      if (name === "help") return offlineHelp(rest, io);
      err(`error: the server is not running at ${base}. Start it with: npm run up (or npm run up:mock)`);
      return EXIT.noServer;
    }
    err(`error: ${(e as Error).message}`);
    return EXIT.failed;
  }
}

/** Static schema for `help`, so `./ss help` needs one request and works offline. */
const HELP_INFO: CommandInfo = {
  name: "help",
  summary: "",
  description: "",
  kind: "json",
  auth: false,
  httpGet: false,
  examples: [],
  args: { type: "object", properties: { command: { type: "string" } } },
};

/** Ask for each required secret (hidden) or `ask` (shown) that wasn't given as a flag. */
async function promptForSecrets(schema: JsonSchema, args: Record<string, unknown>, io: Io, stdinUsed: boolean) {
  let line = 0;
  for (const [key, s] of Object.entries(schema.properties ?? {})) {
    if (!(s.secret || s.ask) || args[key] !== undefined || !(schema.required ?? []).includes(key)) continue;
    const question = (s.prompt ?? `${key}: `).replace(/\{(\w+)\}/g, (_, k: string) => String(args[k] ?? k));
    if (!io.stdinIsTTY) {
      // Scripted use: one line of stdin per answer, in order (user.change-password takes two). No input at all
      // is not a choice, so refuse it rather than read it as an empty password, which would quietly make an
      // unencrypted user.
      const flag = `--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
      // A flag's "-" took stdin already: reading it again would answer this one with that value.
      if (stdinUsed) throw new UsageError(`${flag} is required, and stdin went to another flag. Pass ${flag} too`);
      const input = await io.readStdin();
      if (input === "") throw new UsageError(`${flag} is required and there is no terminal to prompt on. Pass ${flag} '' for none, or pipe it on stdin`);
      args[key] = input.split(/\r?\n/)[line++] ?? "";
      continue;
    }
    const value = await io.promptSecret(question, { visible: s.ask === true });
    if (s.secret && s.confirm && value !== "") {
      if ((await io.promptSecret("Repeat it: ")) !== value) throw new UsageError("the two entries did not match");
    }
    args[key] = value;
  }
}

async function printError(res: Response, saved: SavedSession | null, err: (s: string) => void): Promise<number> {
  let message = `HTTP ${res.status}`;
  let code = "";
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    message = body.error?.message ?? message;
    code = body.error?.code ?? "";
  } catch {
    /* not JSON */
  }
  err(`error: ${message}`);
  if (code === "unauthenticated" && saved?.username) err(`Log in again: ./ss auth.login --username ${saved.username}`);
  return EXIT.failed;
}

/** Stream events: text deltas go to stdout as they arrive; reasoning and status lines go to stderr. */
async function printStream(res: Response, json: boolean, io: Io, dim: (s: string) => string): Promise<number> {
  if (!res.body) return EXIT.failed;
  let code: number = EXIT.ok;
  let ended = false;
  let inReasoning = false;
  let buf = "";
  const decoder = new TextDecoder();
  const handle = (line: string) => {
    if (!line.trim()) return;
    if (json) {
      io.stdout.write(`${line}\n`);
    }
    const ev = JSON.parse(line) as { type: string; [k: string]: any };
    if (ev.type === "done" || ev.type === "error") ended = true;
    // An image_error means the message is saved but its image isn't (T05): exit 1 so a script notices.
    if (ev.type === "error" || ev.type === "image_error") code = EXIT.failed;
    if (json) return;
    if (inReasoning && ev.type !== "reasoning") {
      io.stderr.write("\n");
      inReasoning = false;
    }
    switch (ev.type) {
      case "delta":
      case "prompt":
        io.stdout.write(String(ev.delta ?? ""));
        break;
      case "reasoning":
        io.stderr.write(dim(String(ev.delta ?? "")));
        inReasoning = true;
        break;
      case "following":
        io.stderr.write(dim("(following a reply in progress: what has streamed so far, then the rest live)\n"));
        break;
      case "start":
        io.stderr.write(dim(`[${ev.brainName ?? ev.brainId ?? "start"}]\n`));
        break;
      case "image_pending":
        io.stderr.write(dim(`\n(making image ${ev.imageId ?? ""} with ${ev.model ?? "the image model"}... the conversation is free meanwhile)\n`));
        break;
      case "image_done": {
        const ext = String(ev.image?.mime ?? "image/png").replace("image/", "").replace("jpeg", "jpg");
        const flags = [ev.image?.blurred ? "blurred by safe mode" : "", ev.image?.contentViolation ? "flagged by Venice's content policy" : ""].filter(Boolean);
        io.stderr.write(dim(`(image ready${flags.length ? `, ${flags.join(", ")}` : ""}: ./ss image.get --id ${ev.imageId} --out ${ev.imageId}.${ext})\n`));
        break;
      }
      case "image_error":
        io.stderr.write(`\nimage error: ${ev.error?.message ?? ev.error}\nRetry it: ./ss image.retry --conversation ${ev.retry?.args?.conversation ?? "<conversation>"} --message ${ev.messageId}\n`);
        break;
      case "done":
        io.stdout.write("\n");
        if (typeof ev.note === "string") io.stderr.write(dim(`[${ev.note}]\n`));
        break;
      case "error":
        io.stderr.write(`\nerror: ${ev.error?.message ?? JSON.stringify(ev.error)}\n`);
        break;
    }
  };
  try {
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk as Uint8Array, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        handle(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
  } catch {
    // undici just says "terminated" (T02 QA-8). The server keeps working after a disconnect, so say so.
    io.stderr.write("\nerror: lost the connection to the server mid-stream (did it restart?). Check what was saved with ./ss conversation.get.\n");
    return EXIT.failed;
  }
  handle(buf);
  if (!ended) {
    io.stderr.write("\nerror: the stream ended unexpectedly\n");
    return EXIT.failed;
  }
  return code;
}

async function loadSession(file: string): Promise<SavedSession | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as SavedSession;
  } catch {
    return null;
  }
}

/** The server sets or clears the ss_session cookie; mirror that into .run/cli-session.json. */
async function syncSession(res: Response, result: unknown, file: string, url: string) {
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("ss_session="));
  if (cookie === undefined) return;
  const token = cookie.slice("ss_session=".length).split(";")[0] ?? "";
  if (!token || /max-age=0/i.test(cookie)) {
    await rm(file, { force: true });
    return;
  }
  const username = (result as { username?: unknown } | null)?.username;
  const saved: SavedSession = { token, url, savedAt: new Date().toISOString() };
  if (typeof username === "string") saved.username = username;
  await mkdir(join(file, ".."), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
}

function isConnectionError(e: unknown): boolean {
  const cause = (e as { cause?: { code?: string } })?.cause;
  return e instanceof TypeError && ["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENOTFOUND"].includes(cause?.code ?? "");
}

async function offlineHelp(rest: string[], io: Io): Promise<number> {
  // Same renderer as the server's help command, fed from the local code.
  const [{ commands }, { describeCommand }] = await Promise.all([import("../commands/index.ts"), import("../registry.ts")]);
  const all = commands.map(describeCommand);
  const want = rest[0] === "--command" ? rest[1] : undefined;
  const one = want ? all.find((c) => c.name === want) : undefined;
  if (want && !one) {
    io.stderr.write(`error: unknown command ${want}\n`);
    return EXIT.usage;
  }
  io.stdout.write(`${one ? renderCommandHelp(one) : renderCommandList(all, "simple-silver commands:")}\n`);
  io.stderr.write("(The server is not running, so this help comes from the local code. Start it with npm run up.)\n");
  return EXIT.ok;
}

if (import.meta.main) {
  // ps shows a process's arguments, and they may hold a password or private text (--content "..."). On macOS
  // and Linux, setting the title overwrites them, so after the first few milliseconds ps shows just "ss" (T06).
  process.title = "ss";
  // `./ss ... | head` closes stdout early: exit quietly, as cat does, instead of a stack trace (T04 QA-4).
  // The server never waits on us, so a reply still being streamed finishes and is saved.
  process.stdout.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code !== "EPIPE") throw e;
    process.exit(0);
  });
  let stdinCache: Promise<string> | null = null;
  const code = await run(process.argv.slice(2), {
    env: process.env,
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
    stdinIsTTY: process.stdin.isTTY === true,
    readStdin: () => (stdinCache ??= readAllStdin()),
    promptSecret: (question, opts) => promptHidden(question, { echo: opts?.visible === true }),
  });
  process.exitCode = code;
}
