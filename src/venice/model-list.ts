import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { ROOT } from "../config.ts";
import { CommandError } from "../lib/errors.ts";

/**
 * The models the pickers offer (and models.list lists), from a file you edit: `models.ini` in the project folder,
 * gitignored, or, when there is none, the committed `models.example.ini`. A fresh clone therefore offers exactly
 * the example's models, and nobody's own list is ever committed. SST_MODELS_FILE points somewhere else (tests pin
 * the example with it, so nobody's models.ini changes what they see).
 *
 * The format is INI-like, so it can carry comments: a `[text]` and an `[image]` section, one Venice model id per
 * line, in the order the pickers show them; `#` starts a comment, so a model is switched off by commenting its line
 * out. The file is read on every models.list, so an edit shows on the next one (a page reload): no restart.
 *
 * The list only decides what is offered. Any model Venice lists still works by id from the terminal
 * (`brain.update --text-model`, `conversation.update --settings.text-model`), and `models.list --all` lists them all.
 */
export const MODELS_FILE = "models.ini";
export const MODELS_EXAMPLE_FILE = "models.example.ini";

export type ModelList = {
  text: string[];
  image: string[];
  /** The file it came from, relative to the project folder when inside it. */
  source: string;
  /** True when there is no models.ini, so the example is in use. */
  fromExample: boolean;
};

/** Which file the list comes from: the override, else models.ini, else the example (`root`: the project folder). */
export function modelListPath(override?: string, root = ROOT): { path: string; fromExample: boolean } {
  if (override) return { path: resolve(override), fromExample: false };
  const local = join(root, MODELS_FILE);
  return existsSync(local) ? { path: local, fromExample: false } : { path: join(root, MODELS_EXAMPLE_FILE), fromExample: true };
}

export function readModelList(override?: string, root = ROOT): ModelList {
  const { path, fromExample } = modelListPath(override, root);
  const rel = relative(root, path);
  const source = rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : path;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new CommandError(500, "bad_models_file", `Can't read the model list ${source}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}.${override ? " Check SST_MODELS_FILE." : ""}`);
  }
  return { ...parseModelList(text, source), source, fromExample };
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

/** Parse the file's text. A mistake names its line, so the pickers' error says where to look. */
export function parseModelList(text: string, source = MODELS_FILE): { text: string[]; image: string[] } {
  const out: { text: string[]; image: string[] } = { text: [], image: [] };
  let section: "text" | "image" | null = null;
  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) return;
    const bad = (why: string) => new CommandError(500, "bad_models_file", `${source} line ${i + 1}: ${why}`);
    const header = /^\[(.*)\]$/.exec(line);
    if (header) {
      const name = header[1]!.trim().toLowerCase();
      if (name !== "text" && name !== "image") throw bad(`unknown section [${header[1]}]; the sections are [text] and [image].`);
      section = name;
      return;
    }
    if (!section) throw bad(`"${line}" comes before any section; put it under [text] or [image].`);
    if (!ID.test(line)) throw bad(`"${line}" isn't a model id. One Venice model id per line; # starts a comment.`);
    if (!out[section].includes(line)) out[section].push(line);
  });
  return out;
}

/** Keep the listed models, text first, each in the file's order. A model Venice no longer lists simply drops out. */
export function pickModels<T extends { id: string; type: string }>(models: T[], list: { text: readonly string[]; image: readonly string[] }): T[] {
  const rank = (m: T) => (m.type === "image" ? list.image : list.text).indexOf(m.id);
  const key = (m: T) => (m.type === "image" ? 1e6 : 0) + rank(m);
  return models.filter((m) => rank(m) >= 0).sort((a, b) => key(a) - key(b));
}
