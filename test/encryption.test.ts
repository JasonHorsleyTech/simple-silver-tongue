import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { after, before, describe, test } from "node:test";
import { z } from "zod";
import { commands } from "../src/commands/index.ts";
import { ROOT } from "../src/config.ts";
import type { Brain, Conversation, LedgerMessage } from "../src/conversations/types.ts";
import { streamCommand } from "../src/registry.ts";
import { MAGIC } from "../src/storage/crypto.ts";
import { startTestServer } from "./helpers.ts";

/**
 * T06, Jason's checkpoint 5: "If someone else comes to my computer and manually opens the flat files where we're
 * saving these conversations, all of the messages back and forth would be garbled nonsense." That includes images.
 *
 * One scenario, played by a plaintext user and by an encrypted one, puts a unique phrase into every kind of text a
 * user writes. The plaintext user is the control: every phrase must turn up in its files, which proves the phrases
 * really reach disk and the grep would find them. Then nothing on disk outside that user's folder may hold any of
 * them: not the encrypted user's folder, not the run dir (CLI session), not the server log.
 */
const PHRASES = {
  title: "Amberwolf ledger title",
  systemPrompt: "Glasshollow warden system prompt",
  reminder: "Cinder-oath final reminder",
  setupLabel: "Mirefen bible label",
  setup: "Quillmouth river setup message",
  brainName: "Bonepicker Oracle",
  brainPrompt: "Moonbear knucklebone brain prompt",
  painterName: "Lantern Painter",
  painterPrompt: "Soot and saffron painter prompt",
  toolDescription: "Lanternlight tool description",
  template: "Thornvale player template",
  negativePrompt: "Gargoyle negative prompt",
  message: "Velzaroth player message",
  steer: "Brine riddles steer",
  edit: "Silver thimble edited message",
  imagePrompt: "Violet comet image prompt",
  wordsInMouth: "Iron grate words in a brain mouth",
  rollTemplate: "Hexmoor roll template", // T09: in the template and in the roll's message it makes
  thought: "Gloamreach fresh take thought", // T15: in the merged version and its `thought`
  thoughtTemplate: "Wyrmglass thought template",
  makerPattern: "Quarrystone", // T16: a maker's name pattern, and the name of the brain it made
  blueprint: "Hollowmere blueprint prompt", // T16: in the maker's blueprint and the made brain's prompt
};
/** Only ever in requests that fail: never stored, and never logged either. */
const FAILING = { brain: "Nosuch Velzaroth brain", template: "Placeholderless Thornvale template" };
const PASSWORD = "t06-Hunter2-correct-horse";

type Cli = Awaited<ReturnType<typeof startTestServer>>["cli"];

/** Every file under dir (recursive), skipping `skip` folders. */
function walk(dir: string, skip: string[] = []): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (skip.includes(p)) continue;
    if (statSync(p).isDirectory()) out.push(...walk(p, skip));
    else out.push(p);
  }
  return out;
}

/** Which of `needles` occur in any of `files` (raw bytes), as [phrase, file] pairs. */
function hits(files: string[], needles: string[], base: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const f of files) {
    const bytes = readFileSync(f);
    for (const n of needles) if (bytes.includes(Buffer.from(n, "utf8"))) found.push([n, relative(base, f)]);
  }
  return found;
}

async function play(cli: Cli, username: string, password: string) {
  const ok = async (argv: string[]) => {
    const r = await cli(argv);
    assert.equal(r.code, 0, `${argv.join(" ")}\n${r.stderr}`);
    return r;
  };
  const json = async <T,>(argv: string[]) => JSON.parse((await ok([...argv, "--json"])).stdout) as T;
  const P = PHRASES;

  await ok(["auth.login", "--username", username, "--password", password]);
  const c = (await json<Conversation>(["conversation.create", "--title", P.title, "--system-prompt", P.systemPrompt])).id;
  await ok(["brain.update", "--conversation", c, "--final-reminder.enabled", "--final-reminder.content", P.reminder]);
  await ok(["setup.add", "--conversation", c, "--label", P.setupLabel, "--content", P.setup]);
  await ok(["brain.add", "--conversation", c, "--name", P.brainName, "--system-prompt", P.brainPrompt, "--no-final-reminder.enabled"]);
  await json<Brain>(["brain.add", "--conversation", c, "--name", P.painterName, "--kind", "image", "--system-prompt", P.painterPrompt, "--tool.description", P.toolDescription, "--no-final-reminder.enabled"]);
  await ok(["conversation.update", "--id", c, "--templates.player", `<!-- ${P.template} -->\n{{content}}`, "--settings.image.negative-prompt", P.negativePrompt]);

  await ok(["turn", "--conversation", c, "--content", P.message]);
  await ok(["message.regenerate", "--conversation", c, "--steer", P.steer]);
  await ok(["message.regenerate", "--conversation", c, "--thought", `\`\`\`hidden\n${P.thought}\n\`\`\``]);
  const draft = await json<{ message: LedgerMessage }>(["message.add", "--conversation", c, "--as", "player", "--content", "A draft line, edited next."]);
  await ok(["message.edit", "--conversation", c, "--message", draft.message.id, "--content", P.edit]); // an edit replaces the text

  const added = await json<{ message: LedgerMessage }>(["message.add", "--conversation", c, "--as", P.painterName, "--content", P.imagePrompt]);
  await ok(["image.follow", "--conversation", c, "--message", added.message.id]); // the image is on disk once this ends
  await ok(["message.add", "--conversation", c, "--as", P.brainName, "--content", P.wordsInMouth]);
  await ok(["turn", "--conversation", c, "--brain", P.painterName]); // its prompt quotes the last message; the stream waits for the image
  await ok(["conversation.update", "--id", c, "--templates.roll", `${P.rollTemplate}: {{roll}}`, "--templates.thought", `${P.thoughtTemplate}: {{thought}}`]);
  await ok(["message.roll", "--conversation", c]);
  // T16: a brain that makes brains, and the brain its new message makes.
  await ok(["brain.update", "--conversation", c, "--brain", P.brainName, "--makes.name", `${P.makerPattern} {{n}}`, "--makes.blueprint.system-prompt", P.blueprint]);
  await ok(["message.add", "--conversation", c, "--as", P.brainName, "--content", "A sheet, which makes a brain."]);

  // Requests that fail, carrying text of their own: the client hears why, the log only the code.
  assert.equal((await cli(["turn", "--conversation", c, "--brain", FAILING.brain])).code, 1);
  assert.equal((await cli(["conversation.update", "--id", c, "--templates.player", FAILING.template])).code, 1);

  const final = await json<Conversation>(["conversation.get", "--id", c]);
  const images = final.messages.flatMap((m) => m.versions.map((v) => v.image)).filter((i) => i?.status === "done");
  assert.equal(images.length, 2, "both images were made");
  return { c, final, imageIds: images.map((i) => i!.id) };
}

describe("T06: an encrypted user's files hold nothing readable (CLI → server → mock Venice)", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  const log: string[] = [];
  before(async () => {
    t = await startTestServer({ log: (line) => log.push(line) });
  });
  after(() => t.close());

  test("every phrase a user writes is ciphertext on disk, and nowhere else; the plaintext user is the control", async () => {
    const users = join(t.config.dataDir, "users");
    assert.equal((await t.cli(["user.create", "--username", "dev-t06-plain", "--password", ""])).code, 0);
    assert.equal((await t.cli(["user.create", "--username", "dev-t06-enc"], { secrets: [PASSWORD, PASSWORD] })).code, 0);
    const phrases = Object.values(PHRASES);

    const plain = await play(t.cli, "dev-t06-plain", "");
    const plainDir = join(users, "dev-t06-plain");
    const plainHits = hits(walk(plainDir), phrases, plainDir).map(([p]) => p);
    assert.deepEqual(phrases.filter((p) => !plainHits.includes(p)), [], "the control: every phrase is on disk in plain text for the plaintext user");
    assert.ok(readdirSync(join(plainDir, "images")).every((f) => f.endsWith(".png")), "a plaintext user's images open in a viewer");

    const enc = await play(t.cli, "dev-t06-enc", PASSWORD);
    const encDir = join(users, "dev-t06-enc");
    // Not vacuous: the encrypted user really stored every phrase, and reads them back.
    const readBack = JSON.stringify(enc.final);
    assert.deepEqual(phrases.filter((p) => !readBack.includes(p)), [], "conversation.get decrypts every phrase");

    // 1. Every file but user.json is ciphertext, temp files included, and none holds a phrase or the password.
    const files = walk(encDir);
    assert.ok(files.length >= 4, `conversation, user.json and two images: ${files.map((f) => relative(encDir, f))}`);
    for (const f of files) {
      if (relative(encDir, f) === "user.json") continue;
      assert.ok(readFileSync(f).subarray(0, MAGIC.length).equals(MAGIC), `${relative(encDir, f)} is ciphertext`);
      assert.ok(!f.endsWith(".tmp"), `no temp file left: ${f}`);
    }
    assert.deepEqual(hits(files, [...phrases, PASSWORD], encDir), []);

    // 2. user.json is metadata only: no password, no raw key, nothing the user wrote.
    const userJson = JSON.parse(readFileSync(join(encDir, "user.json"), "utf8"));
    assert.deepEqual(Object.keys(userJson).sort(), ["createdAt", "encrypted", "kdf", "username", "version", "wrappedKey"]);
    assert.equal(userJson.encrypted, true);

    // 3. Images: a neutral name (the type was a hint at the model, T05 QA-6), and none of the real bytes.
    const imageFiles = readdirSync(join(encDir, "images"));
    assert.deepEqual(imageFiles.sort(), enc.imageIds.map((id) => `${id}.bin`).sort());
    const exports = join(t.tmp, "exports");
    mkdirSync(exports);
    for (const id of enc.imageIds) {
      const out = join(exports, `${id}.png`);
      const r = await t.cli(["image.get", "--id", id, "--out", out]);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stderr, /image\/png/, "image.get still knows the type: it sniffs the decrypted bytes");
      const real = readFileSync(out);
      const stored = readFileSync(join(encDir, "images", `${id}.bin`));
      assert.ok(real.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "the export is a real PNG");
      const mid = Math.floor(real.length / 2);
      for (const window of [real.subarray(0, 16), real.subarray(mid, mid + 16), real.subarray(-16)]) {
        assert.ok(!stored.includes(window), "no run of the image's bytes is on disk");
      }
      assert.ok(!stored.includes(real.subarray(0, 8)), "no PNG signature on disk"); // 8 bytes: chance can't match it (3 could)
    }

    // 4. Nowhere else on disk (the data dir minus the control user, the run dir with the CLI session file), and
    //    not in the server log, not even from the requests that failed. The password is nowhere at all.
    const elsewhere = walk(t.tmp, [plainDir, exports]);
    assert.ok(elsewhere.some((f) => f.endsWith("cli-session.json")), "the run dir was searched too");
    assert.deepEqual(hits(elsewhere, [...phrases, ...Object.values(FAILING), PASSWORD], t.tmp), []);
    assert.deepEqual(hits(walk(plainDir), [PASSWORD], t.tmp), []);
    assert.ok(log.length > 50, "the server logged every request");
    const logged = log.join("\n");
    assert.deepEqual([...phrases, ...Object.values(FAILING), PASSWORD].filter((p) => logged.includes(p)), [], "the log names commands, statuses and codes only");
    assert.ok(log.includes("turn failed: 404 not_found"), "a failure is logged by its code");
    assert.ok(log.some((l) => /^POST \/api\/conversation\.update 400 \d+ms$/.test(l)), "a bad argument is logged as its status");

    // 5. An encrypted image file from before T06 (typed name) is still found, and gets the neutral name at login.
    const [first] = enc.imageIds;
    execFileSync("mv", [join(encDir, "images", `${first}.bin`), join(encDir, "images", `${first}.webp`)]);
    assert.equal((await t.cli(["image.get", "--id", first!, "--out", join(exports, "old.png")])).code, 0, "an old name is still found");
    assert.equal((await t.cli(["auth.login", "--username", "dev-t06-enc", "--password", PASSWORD])).code, 0);
    assert.ok(readdirSync(join(encDir, "images")).every((f) => f.endsWith(".bin")), "renamed to .bin at login");
  });

  test("every /api answer says Cache-Control: no-store, so the browser never caches decrypted data on disk", async () => {
    const saved = JSON.parse(readFileSync(join(t.config.runDir, "cli-session.json"), "utf8")) as { token: string };
    const cookie = `ss_session=${saved.token}`;
    const post = (name: string, body: unknown) =>
      fetch(`${t.url}/api/${name}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
    const list = (await (await post("conversation.list", {})).json()) as { conversations: Array<{ id: string }> };
    const c = list.conversations[0]!.id;
    const conv = (await (await post("conversation.get", { id: c })).json()) as Conversation;
    const img = conv.messages.flatMap((m) => m.versions).find((v) => v.image?.status === "done")!.image!.id;
    const answers = {
      json: await post("conversation.get", { id: c }),
      "json error": await post("conversation.get", { id: "c_nosuchthing" }),
      "bad args": await post("conversation.get", {}),
      stream: await post("generation.follow", { conversation: c }),
      "image (GET, as <img src>)": await fetch(`${t.url}/api/image.get?id=${img}`, { headers: { cookie } }),
      "image 404": await fetch(`${t.url}/api/image.get?id=img_nosuchthing`, { headers: { cookie } }),
      "not logged in": await fetch(`${t.url}/api/conversation.list`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
    };
    for (const [what, res] of Object.entries(answers)) {
      await res.arrayBuffer();
      assert.equal(res.headers.get("cache-control"), "no-store", what);
    }
    assert.equal(answers["image (GET, as <img src>)"].headers.get("content-type"), "image/png");
  });
});

describe("T06: the CLI keeps secrets out of ps", { skip: process.platform === "win32" }, () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  before(async () => {
    const hold = streamCommand({
      name: "test.hold",
      description: "Waits until the test lets go.",
      auth: false,
      args: z.object({ text: z.string() }),
      async *handler() {
        yield { type: "start" };
        await held;
        yield { type: "done", message: null };
      },
    });
    t = await startTestServer({ commands: [...commands, hold] });
  });
  after(() => t.close());

  test("once ./ss is running, ps shows 'ss', not its arguments", async () => {
    const secret = "ps-should-never-show-this-Velzaroth";
    const child = spawn(process.execPath, [join(ROOT, "src", "cli", "main.ts"), "test.hold", "--text", secret], {
      env: { ...process.env, SS_URL: t.url, SS_RUN_DIR: join(t.tmp, "run") },
      stdio: "ignore",
    });
    try {
      let args = "";
      for (let i = 0; i < 40 && !args.trim().startsWith("ss"); i++) {
        await new Promise((r) => setTimeout(r, 50));
        args = execFileSync("ps", ["-o", "args=", "-p", String(child.pid)], { encoding: "utf8" });
      }
      assert.ok(!args.includes(secret), `ps showed: ${args}`);
      assert.match(args.trim(), /^ss\b/);
    } finally {
      release();
      await new Promise((r) => child.once("exit", r));
    }
  });
});
