/**
 * The commands the web app calls, with their argument and result shapes. They mirror the server's zod
 * schemas (`./ss help <name>` shows each one). When a ticket gives the UI a new command, add a line here:
 * the client is typed from these maps, so a typo in a command name or an argument is a type error.
 */

export type User = { username: string; encrypted: boolean };
export type Who = User | { username: null };

export type UserSummary = { username: string; encrypted: boolean; createdAt: string };

export type Health = {
  ok: true;
  mode: "live" | "mock";
  venice: string;
  url: string;
  pid: number;
  startedAt: string;
  uptimeSec: number;
  web: "built" | "not built";
  commands: number;
};

/** For commands that take no arguments: they can then be called as api.call("auth.whoami"). */
export type NoArgs = Record<string, never>;

/** JSON commands: POST /api/<name> with args, answered with result. */
export type Commands = {
  health: { args: NoArgs; result: Health };
  "user.list": { args: NoArgs; result: { users: UserSummary[] } };
  "auth.login": { args: { username: string; password: string }; result: User };
  "auth.logout": { args: NoArgs; result: { loggedOut: string | null } };
  "auth.whoami": { args: NoArgs; result: Who };
};

/** NDJSON stream commands: POST /api/<name> with args, answered with StreamEvent lines. T02 adds `turn`. */
export type StreamCommands = {};

/**
 * The NDJSON events of docs/design.md ("Command surface"). Every stream ends with exactly one `done` or
 * `error`. The client turns `error` into a thrown ApiError, so a consumer only ever sees the rest.
 * `message` is the ledger message; T02 gives it a real type.
 */
export type StreamEvent =
  | { type: "message"; message: unknown }
  | { type: "start"; brainId?: string; brainName?: string }
  | { type: "reasoning"; delta: string }
  | { type: "delta"; delta: string }
  | { type: "tool_args"; delta: string }
  | { type: "image_pending"; messageId: string; imageId: string }
  | { type: "image_done"; messageId: string; imageId: string }
  | { type: "image_error"; messageId: string; error: string }
  | { type: "done"; message: unknown }
  | { type: "error"; error: { code: string; message: string; details?: unknown } };

/** What a stream consumer receives: every event except `error`, which arrives as a thrown ApiError. */
export type StreamYield = Exclude<StreamEvent, { type: "error" }>;
