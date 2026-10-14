import { z } from "zod";
import { table } from "../lib/text.ts";
import { command } from "../registry.ts";
import { createUser, listUsers, summarize, USERNAME_RE, USERNAME_RULE, type UserSummary } from "../storage/users.ts";

export const username = z
  .string()
  .regex(USERNAME_RE, `Username must be ${USERNAME_RULE}`)
  .describe(`Login name (${USERNAME_RULE})`);

export const userCreate = command({
  name: "user.create",
  description: `Create a local user.
With a password, all of the user's data (conversations and images) is encrypted on disk with a key
derived from it. There is no recovery: lose the password and the data is gone.
With an empty password the user is unencrypted and their files are readable JSON (for debugging).`,
  auth: false,
  args: z.object({
    username,
    password: z
      .string()
      .meta({ secret: true, confirm: true, prompt: "New password for {username} (leave empty for no encryption): " })
      .describe("Password. Empty (--password '') = no encryption."),
  }),
  examples: ["./ss user.create --username jason", "./ss user.create --username dev-a --password ''"],
  handler: async (args, ctx) => summarize(await createUser(ctx.deps.config.dataDir, args.username, args.password)),
  format: (u: UserSummary) =>
    `Created ${u.username} (${u.encrypted ? "encrypted" : "unencrypted"}). Log in with: ./ss auth.login --username ${u.username}`,
});

export const userList = command({
  name: "user.list",
  description: "List local users and whether each one is encrypted.",
  auth: false,
  args: z.object({}),
  handler: async (_args, ctx) => ({ users: await listUsers(ctx.deps.config.dataDir) }),
  format: (r: { users: UserSummary[] }) =>
    r.users.length === 0
      ? "No users yet. Create one with ./ss user.create --username <name>."
      : table(
          ["USERNAME", "ENCRYPTED", "CREATED"],
          r.users.map((u) => [u.username, u.encrypted ? "yes" : "no", u.createdAt]),
        ),
});

export default [userCreate, userList];
