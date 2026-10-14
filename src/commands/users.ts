import { z } from "zod";
import { paintingFor } from "../conversations/images.ts";
import { generatingFor } from "../conversations/store.ts";
import { badRequest, CommandError, isUnreadable, notFound } from "../lib/errors.ts";
import { table } from "../lib/text.ts";
import { command } from "../registry.ts";
import {
  changePassword,
  countUserFiles,
  createUser,
  listUsers,
  loadUser,
  removeUserFolder,
  summarize,
  userDir,
  USERNAME_RE,
  USERNAME_RULE,
  type UnreadableUser,
  type UserSummary,
} from "../storage/users.ts";
import { closeVaultsOf, forksOpen } from "../storage/vault.ts";

export const username = z
  .string()
  .regex(USERNAME_RE, `Username must be ${USERNAME_RULE}`)
  .describe(`Login name (${USERNAME_RULE})`);

export const userCreate = command({
  name: "user.create",
  description: `Create a local user.
With a password, all of the user's data (conversations and images) is encrypted on disk with a key
derived from it. There is no recovery: lose the password and the data is gone.
With an empty password the user is unencrypted and their files are readable JSON (for debugging).
Leave --password out to be asked for it (hidden, twice): a password typed on the command line stays in your shell history.`,
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
  handler: async (_args, ctx) => listUsers(ctx.deps.config.dataDir),
  format: (r: { users: UserSummary[]; unreadable: UnreadableUser[] }) => {
    const out: string[] = [];
    if (r.users.length) out.push(table(["USERNAME", "ENCRYPTED", "CREATED"], r.users.map((u) => [u.username, u.encrypted ? "yes" : "no", u.createdAt])));
    else if (!r.unreadable.length) out.push("No users yet. Create one with ./ss user.create --username <name>.");
    if (r.unreadable.length) {
      out.push(`${r.users.length ? "\n" : ""}Users whose user.json is damaged (${r.unreadable.length}):`);
      for (const u of r.unreadable) out.push(`  ${u.username}: ${u.error}`);
    }
    return out.join("\n");
  },
});

/** encrypted is null when user.json was damaged: such a user can still be removed (T06 QA-5). */
type Deleted = { deleted: string; encrypted: boolean | null; conversations: number; images: number; loggedOut: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const userDelete = command({
  name: "user.delete",
  description: `Delete a local user and all of their data (conversations and images), for good.
There is no undo and no trash: the user's folder is removed from disk, and the username is free again.
You confirm by typing the username again (--confirm, or the prompt). No password is needed: anyone at this
computer can remove the folder anyway, and a user whose password is lost can still be cleared away.
Refused (409, nothing deleted) while that user has work running: a reply or an image being made, or a stopped
reply whose cost is still being recorded. Wait for it, or stop the reply, then try again. That user is logged
out everywhere.`,
  auth: false,
  args: z.object({
    username,
    confirm: z
      .string()
      .meta({ ask: true, prompt: "This deletes {username} and all of their conversations and images, for good. Type the username again to confirm: " })
      .describe("The username again, to confirm"),
  }),
  examples: ["./ss user.delete --username dev-old", "./ss user.delete --username dev-old --confirm dev-old"],
  handler: async (args, ctx): Promise<Deleted> => {
    const { dataDir } = ctx.deps.config;
    const name = args.username;
    if (args.confirm !== name) throw badRequest(`Not deleted: the confirmation must be the username, ${name}, typed exactly.`);
    const user = await loadUser(dataDir, name).catch((err) => {
      if (isUnreadable(err)) return { encrypted: null };
      throw err;
    });
    if (!user) throw notFound(`No user named ${name}. ./ss user.list shows them.`);
    const dir = userDir(dataDir, name);
    const counts = await countUserFiles(dataDir, name);

    // Work running on this user's data holds a fork of its key (vault.ts). Deleting under it would make its last
    // save bring the folder back with no user.json (T01 QA-2), or lose an image Venice is making and billing.
    // The caller's own request doesn't count. No await from this check until the sessions are gone, so nothing
    // can start in between.
    const mine = ctx.session?.username === name ? ctx.session.vault : null;
    const running = forksOpen(dir, mine);
    if (running) throw userBusy(name, dir, running);
    let loggedOut = ctx.deps.sessions.destroyUser(name, "deleted");
    closeVaultsOf(dir);

    await removeUserFolder(dataDir, name);
    // A login that was deriving its key while the folder went: its key is closed too (unlockUser also re-checks).
    loggedOut += ctx.deps.sessions.destroyUser(name, "deleted");
    closeVaultsOf(dir);
    if (mine) ctx.setSession(null);
    return { deleted: name, encrypted: user.encrypted, ...counts, loggedOut };
  },
  format: (r: Deleted) =>
    `Deleted ${r.deleted} (${r.encrypted === null ? "damaged user.json" : r.encrypted ? "encrypted" : "unencrypted"}) with ${plural(r.conversations, "conversation")} and ${plural(r.images, "image")}, for good.${r.loggedOut ? ` Logged out ${plural(r.loggedOut, "session")}.` : ""}`,
});

function userBusy(name: string, dir: string, forks: number): CommandError {
  const replies = generatingFor(dir);
  const images = paintingFor(dir);
  const what: string[] = [];
  if (replies.length) what.push(`a reply is being written (${replies.join(", ")})`);
  if (images.length) {
    const where = [...new Set(images.map((j) => j.convId))].join(", ");
    what.push(`${images.length === 1 ? "an image is" : `${images.length} images are`} being made (${where}), which Venice is already billing`);
  }
  if (!what.length) what.push(`${forks === 1 ? "a request is" : `${forks} requests are`} still using its data (a stream, or a stopped reply whose cost hasn't arrived yet)`);
  return new CommandError(
    409,
    "user_busy",
    `Can't delete ${name} yet: ${what.join(", and ")}. Wait for it to finish${replies.length ? ", or stop the reply (generation.stop)" : ""}, then try again. Nothing was deleted.`,
    { replies, images: images.map((j) => ({ conversation: j.convId, message: j.messageId, image: j.imageId })), requests: forks },
  );
}

export const userChangePassword = command({
  name: "user.change-password",
  description: `Change an encrypted user's password.
Quick by design: the files are encrypted with the user's own random data key, which the password only wraps, so
just user.json changes (a fresh salt and wrapped key) and no file is touched. The old password stops working at
once, and the user is logged out everywhere (work already running finishes). A plaintext user has no password to
change, and an encrypted user can't drop its password. Note: a copy of user.json taken before the change still
opens with the old password, since the data key stays the same.`,
  auth: false,
  args: z.object({
    username,
    password: z.string().meta({ secret: true, prompt: "Current password for {username}: " }).describe("The current password"),
    newPassword: z.string().meta({ secret: true, confirm: true, prompt: "New password for {username}: " }).describe("The new password (not empty)"),
  }),
  examples: ["./ss user.change-password --username jason", "printf 'old\\nnew\\n' | ./ss user.change-password --username dev-b"],
  handler: async (args, ctx) => {
    await changePassword(ctx.deps.config.dataDir, args.username, args.password, args.newPassword);
    const loggedOut = ctx.deps.sessions.destroyUser(args.username, "password-changed");
    if (ctx.session?.username === args.username) ctx.setSession(null);
    return { username: args.username, loggedOut };
  },
  format: (r: { username: string; loggedOut: number }) =>
    `Changed the password for ${r.username}.${r.loggedOut ? ` Logged out ${plural(r.loggedOut, "session")}.` : ""} Log in with: ./ss auth.login --username ${r.username}`,
});

export default [userCreate, userList, userDelete, userChangePassword];
