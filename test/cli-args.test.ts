import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFlags, splitArgv, UsageError } from "../src/cli/args.ts";
import type { JsonSchema } from "../src/registry.ts";

const schema: JsonSchema = {
  type: "object",
  properties: {
    username: { type: "string" },
    content: { type: "string" },
    maxTokens: { type: "integer" },
    refresh: { type: "boolean" },
    type: { type: "string", enum: ["text", "image"] },
    tags: { type: "array", items: { type: "string" } },
    settings: { type: "object", properties: { temperature: { type: "number" }, textModel: { type: "string" } } },
    note: { anyOf: [{ type: "string" }, { type: "null" }] },
    password: { type: "string", secret: true },
  },
};

const files: Record<string, string> = { "scene.md": "# Tavern\n\nA *hooded* figure.\n" };
const readers = {
  readFile: async (p: string) => {
    if (!(p in files)) throw Object.assign(new Error("nope"), { code: "ENOENT" });
    return files[p]!;
  },
  readStdin: async () => "from stdin\n",
};
const parse = (argv: string[]) => parseFlags(argv, schema, readers).then((r) => r.args);

test("splitArgv finds the command and the global flags anywhere", () => {
  const s = splitArgv(["--json", "user.create", "--username", "dev-a", "--out", "x.png", "-h"]);
  assert.equal(s.command, "user.create");
  assert.deepEqual(s.global, { json: true, help: true, open: false, reveal: false, out: "x.png" });
  assert.deepEqual(s.rest, ["--username", "dev-a"]);
  assert.equal(splitArgv(["conversation.get", "--reveal", "--id", "c_x"]).global.reveal, true, "T08");
});

test("strings, empty strings, numbers, kebab-case and = syntax", async () => {
  assert.deepEqual(await parse(["--username", "dev-a", "--content", "", "--max-tokens", "300"]), {
    username: "dev-a",
    content: "",
    maxTokens: 300,
  });
  assert.deepEqual(await parse(["--maxTokens=5", "--content=a=b"]), { maxTokens: 5, content: "a=b" });
  assert.deepEqual(await parse(["--content", "-5"]), { content: "-5" }, "a dash-prefixed value is still a value");
});

test("booleans: bare, explicit, negated", async () => {
  assert.deepEqual(await parse(["--refresh"]), { refresh: true });
  assert.deepEqual(await parse(["--refresh", "false"]), { refresh: false });
  assert.deepEqual(await parse(["--refresh=no"]), { refresh: false });
  assert.deepEqual(await parse(["--no-refresh"]), { refresh: false });
  assert.deepEqual(await parse(["--refresh", "--username", "x"]), { refresh: true, username: "x" });
});

test("@file, - for stdin, and @@ escape", async () => {
  assert.deepEqual(await parse(["--content", "@scene.md"]), { content: "# Tavern\n\nA *hooded* figure." });
  assert.deepEqual(await parse(["--content", "-"]), { content: "from stdin" });
  assert.deepEqual(await parse(["--content", "@@handle"]), { content: "@handle" });
  assert.deepEqual(await parse(["--content", "@"]), { content: "@" });
  await assert.rejects(parse(["--content", "@missing.md"]), /cannot read missing\.md/);
  await assert.rejects(parse(["--content", "-", "--username", "-"]), /stdin can only be read once/);
});

test("arrays, objects, dotted paths and nullable fields", async () => {
  assert.deepEqual(await parse(["--tags", "a", "--tags", "b"]), { tags: ["a", "b"] });
  assert.deepEqual(await parse(["--tags", '["x","y"]']), { tags: ["x", "y"] });
  assert.deepEqual(await parse(["--settings", '{"temperature":0.7}']), { settings: { temperature: 0.7 } });
  assert.deepEqual(await parse(["--settings.temperature", "0.2", "--settings.text-model", "m1"]), {
    settings: { temperature: 0.2, textModel: "m1" },
  });
  assert.deepEqual(await parse(["--note", "hi"]), { note: "hi" });
  // T18: "null" is null for a field that takes it (brain.update --text-model null), and the word everywhere else.
  assert.deepEqual(await parse(["--note", "null"]), { note: null });
  assert.deepEqual(await parse(["--username", "null"]), { username: "null" });
});

test("usage errors are clear", async () => {
  await assert.rejects(parse(["--usernme", "x"]), (e: Error) => e instanceof UsageError && /unknown flag --usernme/.test(e.message));
  await assert.rejects(parse(["--username"]), /--username needs a value/);
  await assert.rejects(parse(["--username", "--content", "x"]), /--username needs a value/);
  await assert.rejects(parse(["--max-tokens", "lots"]), /expects a number/);
  await assert.rejects(parse(["--settings", "{nope"]), /expects JSON/);
});

test("secret args are literal: no @file expansion (T01 QA-8), but - still reads stdin", async () => {
  assert.deepEqual(await parse(["--password", "@Horse-qa1"]), { password: "@Horse-qa1" });
  assert.deepEqual(await parse(["--password", "@scene.md"]), { password: "@scene.md" });
  assert.deepEqual(await parse(["--password", "-"]), { password: "from stdin" });
});
