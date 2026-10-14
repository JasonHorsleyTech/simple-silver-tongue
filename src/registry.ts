import { z } from "zod";
import type { Config } from "./config.ts";
import { unauthenticated } from "./lib/errors.ts";
import type { Session, SessionStore } from "./server/sessions.ts";
import type { VeniceClient } from "./venice/client.ts";

/**
 * The command registry is the whole app surface. The HTTP adapter (src/server/app.ts) exposes each command
 * as POST /api/<name>, and the CLI (src/cli) is a thin client over those endpoints, so anything the
 * browser can do, ./ss can do too.
 */

export type Deps = {
  config: Config;
  sessions: SessionStore;
  venice: VeniceClient;
  startedAt: string;
  /** Filled in by createApp: every registered command, for `help`. */
  commands: AnyCommand[];
};

export type Ctx = {
  deps: Deps;
  /** The caller's session, if any. Commands with auth: true can rely on it via requireSession(). */
  session: Session | null;
  requireSession(): Session;
  /** Log the caller in (non-null) or out (null). The HTTP adapter turns this into the session cookie. */
  setSession(session: Session | null): void;
  /** Aborts when the client disconnects. Long jobs that must persist anyway should ignore it. */
  signal: AbortSignal;
};

/** NDJSON stream events. Later tickets add the chat event types from docs/design.md. */
export type StreamEvent = { type: string; [key: string]: unknown };

export type BinaryResult = { contentType: string; bytes: Uint8Array; filename?: string };

type Args = z.ZodObject<any, any>;

type Base<A extends Args> = {
  name: string;
  /** First line is the summary shown in `./ss help`; the rest shows in `./ss help <name>`. */
  description: string;
  args: A;
  /** Require a logged-in session. Default true. */
  auth?: boolean;
  examples?: string[];
};

export type JsonCommand<A extends Args = Args, R = any> = Base<A> & {
  kind: "json";
  /** Also answer GET /api/<name> (only for side-effect-free commands). */
  httpGet?: boolean;
  handler(args: z.output<A>, ctx: Ctx): Promise<R> | R;
  /** Plain-text rendering for the CLI. Without it the CLI prints a generic key/value view. */
  format?(result: R): string;
};

export type StreamCommand<A extends Args = Args> = Base<A> & {
  kind: "stream";
  /** Errors thrown before the first event become a normal HTTP error status (e.g. 409 busy). */
  handler(args: z.output<A>, ctx: Ctx): AsyncIterable<StreamEvent>;
};

export type BinaryCommand<A extends Args = Args> = Base<A> & {
  kind: "binary";
  /** Binary commands also answer GET /api/<name>?arg=value so <img src> works. Query values arrive as strings. */
  handler(args: z.output<A>, ctx: Ctx): Promise<BinaryResult>;
};

export type AnyCommand = JsonCommand | StreamCommand | BinaryCommand;

const strict = <A extends Args>(a: A): A => a.strict() as A;

export function command<A extends Args, R>(def: Omit<JsonCommand<A, R>, "kind">): AnyCommand {
  return { ...def, kind: "json", args: strict(def.args) } as unknown as AnyCommand;
}

export function streamCommand<A extends Args>(def: Omit<StreamCommand<A>, "kind">): AnyCommand {
  return { ...def, kind: "stream", args: strict(def.args) } as unknown as AnyCommand;
}

export function binaryCommand<A extends Args>(def: Omit<BinaryCommand<A>, "kind">): AnyCommand {
  return { ...def, kind: "binary", args: strict(def.args) } as unknown as AnyCommand;
}

/** `why` explains a missing session better than "Not logged in" when the adapter knows more (it timed out). */
export function requireSessionFrom(session: Session | null, why?: Error): Session {
  if (!session) throw why ?? unauthenticated();
  return session;
}

/** What `help` returns: enough for the CLI to parse flags and for anyone to read. */
export type CommandInfo = {
  name: string;
  summary: string;
  description: string;
  kind: AnyCommand["kind"];
  auth: boolean;
  httpGet: boolean;
  examples: string[];
  args: JsonSchema;
};

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  default?: unknown;
  /** Custom meta: the CLI prompts for it with hidden input when omitted. */
  secret?: boolean;
  /** Custom meta: with `secret`, the CLI asks twice when the value is not empty. */
  confirm?: boolean;
  /** Custom meta: the CLI's prompt text for a secret (or an `ask`); {otherArg} is filled from the given args. */
  prompt?: string;
  /** Custom meta: like `secret`, the CLI asks for it when omitted, but the answer is shown (a confirmation). */
  ask?: boolean;
  [key: string]: unknown;
};

const infoCache = new WeakMap<AnyCommand, CommandInfo>();

export function describeCommand(cmd: AnyCommand): CommandInfo {
  let info = infoCache.get(cmd);
  if (!info) {
    const schema = z.toJSONSchema(cmd.args, { io: "input", unrepresentable: "any" }) as JsonSchema;
    delete schema.$schema;
    const [summary = "", ...rest] = cmd.description.trim().split("\n");
    info = {
      name: cmd.name,
      summary: summary.trim(),
      description: rest.join("\n").trim(),
      kind: cmd.kind,
      auth: cmd.auth !== false,
      httpGet: cmd.kind === "binary" || (cmd.kind === "json" && cmd.httpGet === true),
      examples: cmd.examples ?? [],
      args: schema,
    };
    infoCache.set(cmd, info);
  }
  return info;
}

export function indexCommands(commands: AnyCommand[]): Map<string, AnyCommand> {
  const map = new Map<string, AnyCommand>();
  for (const c of commands) {
    if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/.test(c.name)) throw new Error(`bad command name: ${c.name}`);
    if (map.has(c.name)) throw new Error(`duplicate command: ${c.name}`);
    map.set(c.name, c);
  }
  return map;
}
