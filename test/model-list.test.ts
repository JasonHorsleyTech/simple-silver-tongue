import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL, ROOT } from "../src/config.ts";
import { modelListPath, MODELS_EXAMPLE_FILE, parseModelList, readModelList } from "../src/venice/model-list.ts";
import { startTestServer } from "./helpers.ts";

/**
 * T19: the models the pickers offer come from models.ini (gitignored), or the committed models.example.ini when there
 * is none. A fresh clone offers exactly the example's models; nobody's own list ever reaches a test.
 */
describe("the model list file", () => {
  test("sections, comments, order, a section opened twice; mistakes name their line", () => {
    const text = [
      "# a comment",
      "[text]",
      "deepseek-v4-1-flash   # the default",
      "# kimi-k3             # off",
      "",
      "[image]\r",
      "z-image-turbo",
      "[ TEXT ]",
      "llama-3.3-70b",
      "deepseek-v4-1-flash",
    ].join("\n");
    assert.deepEqual(parseModelList(text), { text: ["deepseek-v4-1-flash", "llama-3.3-70b"], image: ["z-image-turbo"] });

    assert.throws(() => parseModelList("kimi-k3\n", "x.ini"), { code: "bad_models_file", message: /^x\.ini line 1: "kimi-k3" comes before any section/ });
    assert.throws(() => parseModelList("[text]\n\n[video]\n"), { message: /line 3: unknown section \[video\]/ });
    assert.throws(() => parseModelList("[text]\nkimi-k3 kimi-k2-6\n"), { message: /line 2: "kimi-k3 kimi-k2-6" isn't a model id/ });
  });

  test("no models.ini: the example; with one: it; SST_MODELS_FILE wins", async () => {
    const root = await mkdtemp(join(tmpdir(), "sst-models-"));
    try {
      await writeFile(join(root, MODELS_EXAMPLE_FILE), "[text]\nexample-text\n[image]\nexample-image\n");
      assert.deepEqual(modelListPath(undefined, root), { path: join(root, MODELS_EXAMPLE_FILE), fromExample: true });
      assert.deepEqual(readModelList(undefined, root), { text: ["example-text"], image: ["example-image"], source: MODELS_EXAMPLE_FILE, fromExample: true });

      await writeFile(join(root, "models.ini"), "[text]\nmine\n");
      assert.deepEqual(readModelList(undefined, root), { text: ["mine"], image: [], source: "models.ini", fromExample: false });

      const elsewhere = join(root, "other.ini");
      await writeFile(elsewhere, "[image]\nother-image\n");
      assert.deepEqual(readModelList(elsewhere, root).image, ["other-image"]);
      assert.throws(() => readModelList(join(root, "missing.ini"), root), { code: "bad_models_file", message: /Check SST_MODELS_FILE/ });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("the example enables two text models and two image models, the defaults among them, and never names Lustify", async () => {
    const raw = await readFile(join(ROOT, MODELS_EXAMPLE_FILE), "utf8");
    const list = parseModelList(raw, MODELS_EXAMPLE_FILE);
    assert.deepEqual(list, { text: ["deepseek-v4-1-flash", "google-gemma-4-31b-it"], image: ["z-image-turbo", "hunyuan-image-v3"] });
    assert.equal(list.text[0], DEFAULT_TEXT_MODEL);
    assert.equal(list.image[0], DEFAULT_IMAGE_MODEL);
    assert.doesNotMatch(raw, /lustify/i);
    // Everything after the uncensored banner is commented out.
    const banner = raw.indexOf("Uncensored: off by default");
    assert.ok(banner > 0);
    assert.deepEqual(parseModelList(raw.slice(raw.indexOf("\n", banner))), { text: [], image: [] });
  });

  test("the example campaigns and the presets use only models the example enables", async () => {
    const list = parseModelList(await readFile(join(ROOT, MODELS_EXAMPLE_FILE), "utf8"));
    const files: string[] = [];
    for (const dir of ["examples", "presets"]) {
      for (const f of await readdir(join(ROOT, dir))) if (f.endsWith(".json")) files.push(join(dir, f));
    }
    assert.ok(files.length >= 2);
    type Models = { textModel?: string | null; imageModel?: string | null };
    for (const file of files) {
      const doc = JSON.parse(await readFile(join(ROOT, file), "utf8")) as {
        settings?: Models;
        brains: Array<Models & { name: string; makes?: { blueprint?: Models } | null }>;
      };
      const check = (where: string, m: Models | undefined) => {
        if (m?.textModel) assert.ok(list.text.includes(m.textModel), `${file} ${where}: text model ${m.textModel} isn't enabled`);
        if (m?.imageModel) assert.ok(list.image.includes(m.imageModel), `${file} ${where}: image model ${m.imageModel} isn't enabled`);
      };
      check("settings", doc.settings);
      for (const b of doc.brains) {
        check(b.name, b);
        check(`${b.name}'s blueprint`, b.makes?.blueprint);
      }
    }
  });
});

describe("models.list reads the model list", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  let dir: string;
  const file = () => join(dir, "models.ini");
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "sst-models-list-"));
    await writeFile(file(), "[text]\nz-ai-glm-5-3\ndeepseek-v4-1-flash\nnot-at-venice\n[image]\nkrea-2-turbo\n");
    t = await startTestServer({ modelsFile: file() });
  });
  after(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("in the file's order, saying which file; an edit shows at once; --all ignores it", async () => {
    const r = await t.cli(["models.list", "--json"]);
    const result = JSON.parse(r.stdout);
    assert.deepEqual(result.models.map((m: { id: string }) => m.id), ["z-ai-glm-5-3", "deepseek-v4-1-flash", "krea-2-turbo"], "a model Venice doesn't list drops out");
    assert.equal(result.source, file());
    assert.match((await t.cli(["models.list"])).stdout, /From .*models\.ini\. --all: every Venice model\./);

    await writeFile(file(), "[text]\n# z-ai-glm-5-3\ndeepseek-v4-1-flash\n");
    const ids = JSON.parse((await t.cli(["models.list", "--json"])).stdout).models.map((m: { id: string }) => m.id);
    assert.deepEqual(ids, ["deepseek-v4-1-flash"], "no restart needed");
    assert.equal(JSON.parse((await t.cli(["models.list", "--all", "--json"])).stdout).models.length, 9);
  });

  test("a mistake in the file is a clear error, and a model it hides still works by id", async () => {
    await writeFile(file(), "[text]\ndeepseek-v4-1-flash\n[audio]\n");
    const r = await t.cli(["models.list"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /models\.ini line 3: unknown section \[audio\]/);

    await writeFile(file(), "[text]\ndeepseek-v4-1-flash\n");
    await t.cli(["user.create", "--username", "dev-models", "--password", ""]);
    await t.cli(["auth.login", "--username", "dev-models", "--password", ""]);
    const conv = JSON.parse((await t.cli(["conversation.create", "--system-prompt", "Be brief.", "--text-model", "z-ai-glm-5-3", "--json"])).stdout);
    assert.equal(conv.settings.textModel, "z-ai-glm-5-3");
  });
});
