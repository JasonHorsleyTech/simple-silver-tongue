import { z } from "zod";
import { command } from "../registry.ts";
import { unlockUser } from "../storage/users.ts";
import { username } from "./users.ts";

type Who = { username: string; encrypted: boolean } | { username: null };

const describeWho = (w: Who) =>
  w.username === null ? "Not logged in." : `${w.username} (${w.encrypted ? "encrypted" : "unencrypted"})`;

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
    if (ctx.session) ctx.deps.sessions.destroy(ctx.session.token);
    ctx.setSession(ctx.deps.sessions.create(user.username, user.encrypted, vault));
    return { username: user.username, encrypted: user.encrypted };
  },
  format: (w: Who) => `Logged in as ${describeWho(w)}.`,
});

export const authLogout = command({
  name: "auth.logout",
  description: "Log out: forget the session and wipe its key from server memory.",
  auth: false,
  args: z.object({}),
  handler: (_args, ctx) => {
    const was = ctx.session?.username ?? null;
    if (ctx.session) ctx.deps.sessions.destroy(ctx.session.token);
    ctx.setSession(null);
    return { loggedOut: was };
  },
  format: (r: { loggedOut: string | null }) => (r.loggedOut ? `Logged out ${r.loggedOut}.` : "Was not logged in."),
});

export const authWhoami = command({
  name: "auth.whoami",
  description: "Show the logged-in user, or username: null when there is no session.",
  auth: false,
  args: z.object({}),
  handler: (_args, ctx): Who =>
    ctx.session ? { username: ctx.session.username, encrypted: ctx.session.encrypted } : { username: null },
  format: describeWho,
});

export default [authLogin, authLogout, authWhoami];
