import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { Conversation } from "../src/conversations/types.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

/** T13: each setup message is sent with its own role (user, assistant, system), verbatim, in order. */
describe("setup message roles", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    t = await startTestServer();
    await createUser(t.config.dataDir, "dev-t13", "", { N: 2 ** 10, r: 8, p: 1 });
    assert.equal((await t.cli(["auth.login", "--username", "dev-t13", "--password", ""])).code, 0);
  });
  after(() => t.close());

  const json = async (argv: string[]) => {
    const r = await t.cli([...argv, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const roles = (body: { messages: { role: string; content: string }[] }) => body.messages.map((m) => [m.role, m.content.split("\n")[0]]);

  test("preview shows each role in order, and is exactly what turn sends", async () => {
    const conv = (await json(["conversation.create", "--title", "Roles", "--system-prompt", "You are the GM."])) as Conversation;
    const c = ["--conversation", conv.id];
    await json(["setup.add", ...c, "--label", "World Bible", "--role", "system", "--content", "The Goat is a tavern."]);
    await json(["setup.add", ...c, "--label", "House rules", "--content", "Keep it short."]);
    const listed = await json(["setup.add", ...c, "--label", "Understood", "--role", "assistant", "--content", "Understood."]);
    assert.deepEqual(listed.setup.map((s: { role: string }) => s.role), ["system", "user", "assistant"]);
    assert.match((await t.cli(["setup.list", ...c])).stdout, /1\. World Bible \(s_\w+\) · system · 21 chars/);

    // Nothing after the staged exchange yet: it ends with the brain's "own" words, so turn refuses it.
    assert.match((await json(["prompt.preview", ...c])).refusal, /own reply/);

    const preview = await json(["prompt.preview", ...c, "--content", "I sit down."]);
    assert.deepEqual(roles(preview.body), [
      ["system", "You are the GM."],
      ["system", "The Goat is a tavern."],
      ["user", "Keep it short."],
      ["assistant", "Understood."],
      ["user", "<!-- from: the user -->"],
    ]);
    assert.equal((await t.cli(["turn", ...c, "--content", "I sit down."])).code, 0);
    assert.deepEqual(t.mock.state.requests.find((r) => r.path === "/chat/completions")?.body, preview.body);

    // setup.update --role changes it; a system setup message last is refused as well.
    await json(["setup.update", ...c, "--setup", "Understood", "--role", "system"]);
    const clone = (await json(["conversation.clone", "--id", conv.id, "--title", "Copy", "--without-messages"])) as Conversation;
    assert.deepEqual(clone.setup.map((s) => s.role), ["system", "user", "system"], "a clone keeps the roles");
    assert.match((await json(["prompt.preview", "--conversation", clone.id])).refusal, /end with a system setup message/);
  });

  test("a setup message from before T13 (no role) loads, imports and sends as user", async () => {
    const conv = (await json(["conversation.create", "--title", "Old", "--system-prompt", "You are the GM."])) as Conversation;
    await json(["setup.add", "--conversation", conv.id, "--content", "Old bible."]);
    const file = join(t.config.dataDir, "users", "dev-t13", "conversations", `${conv.id}.json`);
    const doc = JSON.parse(await readFile(file, "utf8"));
    delete doc.setup[0].role;
    doc.schemaVersion = 3;
    await writeFile(file, JSON.stringify(doc));
    assert.equal(((await json(["conversation.get", "--id", conv.id])) as Conversation).setup[0]!.role, "user");
    assert.deepEqual(roles((await json(["prompt.preview", "--conversation", conv.id, "--content", "Hi"])).body)[1], ["user", "Old bible."]);

    // A campaign file without roles imports as user; one with a role keeps it.
    const campaign = { brains: [{ name: "GM", systemPrompt: "You are the GM." }], setup: [{ label: "A", content: "a" }, { label: "B", role: "system", content: "b" }] };
    const r = await t.cli(["conversation.import", "--campaign", "-", "--json"], { stdin: JSON.stringify(campaign) });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual((JSON.parse(r.stdout) as Conversation).setup.map((s) => s.role), ["user", "system"]);
  });
});
