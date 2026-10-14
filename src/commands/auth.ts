import { z } from "zod";
import { neutralizeImageNames } from "../images/files.ts";
import { minutes } from "../lib/errors.ts";
import { command, type Ctx } from "../registry.ts";
import type { Session } from "../server/sessions.ts";
import { unlockUser } from "../storage/users.ts";
import { username } from "./users.ts";

/**
 * `idle` (T06 triage): the session ends after `minutes` without use, `secondsLeft` from now if nothing uses it, so the
 * browser can drop to the login screen when it does instead of leaving the campaign on screen. Null: no timeout.
 */
type Idle = { minutes: number; secondsLeft: number | null } | null;
type Who = { username: string; encrypted: boolean; idle: Idle } | { username: null };

const whoOf = (ctx: Ctx, s: Session): Who => ({
  username: s.username,
  encrypted: s.encrypted,
  idle: ctx.deps.sessions.idleMinutes > 0 ? { minutes: ctx.deps.sessions.idleMinutes, secondsLeft: ctx.deps.sessions.secondsLeft(s) } : null,
});

const describeWho = (w: Who) =>
  w.username === null ? "Not logged in." : `${w.username} (${w.encrypted ? "encrypted" : "unencrypted"})`;

const describeIdle = (idle: Idle, left: boolean) =>
  !idle
    ? ""
    : `The session ends after ${minutes(idle.minutes)} without activity${left && idle.secondsLeft !== null ? ` (${minutes(Math.ceil(idle.secondsLeft / 60))} left)` : ""}, and the server wipes its key.`;

export const authLogin = command({
  name: "auth.login",
  description: `Log in. Derives the user's key (encrypted users) and starts a session.
The session lives in server memory only: restarting the server logs everyone out.
The browser gets an httpOnly cookie; the CLI keeps the token in .run/cli-session.json.`,
  auth: false,
  args: z.object({
    username,
    password: z.string().meta({ secret: true, prompt: "Password for {username}: " }).describe("Password. Empty (--password '') for an unencrypted user."),
  }),
  examples: ["./ss auth.login --username jason", "./ss auth.login --username dev-a --password ''"],
  handler: async (args, ctx): Promise<Who> => {
    const { user, vault } = await unlockUser(ctx.deps.config.dataDir, args.username, args.password);
    // Image files from before T06 carry their type in the name; an encrypted user's become .bin (names only).
    await neutralizeImageNames(vault).catch(() => 0);
    if (ctx.session) ctx.deps.sessions.destroy(ctx.session.token);
    const session = ctx.deps.sessions.create(user.username, user.encrypted, vault);
    ctx.setSession(session);
    return whoOf(ctx, session);
  },
  format: (w: Who) =>
    [`Logged in as ${describeWho(w)}.`, "idle" in w ? describeIdle(w.idle, false) : "", "encrypted" in w && w.encrypted ? SHELL_HISTORY_NOTE : ""]
      .filter(Boolean)
      .join("\n"),
});

/** Only the CLI sees it: the data on disk is ciphertext, but what you type on a command line is kept by the shell. */
const SHELL_HISTORY_NOTE =
  'Note: text you type on the ./ss command line (--content "...", --steer "...") is saved in your shell history as plain text. For private text, use --content - and type or paste it (Ctrl-D ends it), or use the browser.';

type LoggedOut = { loggedOut: string | null; sessions?: number };

export const authLogout = command({
  name: "auth.logout",
  description: `Log out: forget the session and wipe its key from server memory.
With --all, end every session of this user: other browser tabs and terminals too (before you step away).`,
  auth: false,
  args: z.object({
    all: z.boolean().optional().describe("Log this user out everywhere: every browser and terminal session"),
  }),
  examples: ["./ss auth.logout", "./ss auth.logout --all"],
  handler: (args, ctx): LoggedOut => {
    const was = ctx.session?.username ?? null;
    let n = 0;
    if (ctx.session) n = args.all ? ctx.deps.sessions.destroyUser(ctx.session.username, "logged-out") : Number(ctx.deps.sessions.destroy(ctx.session.token));
    ctx.setSession(null);
    return args.all ? { loggedOut: was, sessions: n } : { loggedOut: was };
  },
  format: (r: LoggedOut) =>
    !r.loggedOut ? "Was not logged in." : `Logged out ${r.loggedOut}${r.sessions !== undefined ? ` everywhere (${r.sessions === 1 ? "1 session" : `${r.sessions} sessions`})` : ""}.`,
});

export const authWhoami = command({
  name: "auth.whoami",
  description: `Show the logged-in user, or username: null when there is no session.
Asking doesn't count as activity, so it never keeps an idle session alive.`,
  auth: false,
  args: z.object({}),
  handler: (_args, ctx): Who => (ctx.session ? whoOf(ctx, ctx.session) : { username: null }),
  format: (w: Who) => [describeWho(w), "idle" in w ? describeIdle(w.idle, true) : ""].filter(Boolean).join("\n"),
});

export default [authLogin, authLogout, authWhoami];
