import { z } from "zod";
import { DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL } from "../config.ts";
import { table } from "../lib/text.ts";
import { command } from "../registry.ts";
import type { Balance } from "../venice/client.ts";
import { pickModels, readModelList } from "../venice/model-list.ts";
import type { ModelInfo, ModelType } from "../venice/models.ts";

/** `source`: the model list file the offered models came from (absent with --all, which lists every one). */
type ModelsResult = { models: ModelInfo[]; defaults: { text: string; image: string }; source?: string; fromExample?: boolean };

function textRow(m: ModelInfo) {
  const r = m.reasoning;
  const reasoning = !r?.supported ? "-" : r.effortOptions ? r.effortOptions.join("/") : r.always ? "always" : "on";
  return [mark(m), m.name, privacyOf(m), m.price, reasoning, m.contextLength ? (m.contextLength >= 1e6 ? `${m.contextLength / 1e6}M` : `${Math.round(m.contextLength / 1000)}k`) : ""];
}

function imageRow(m: ModelInfo) {
  const c = m.constraints ?? {};
  const sizes = Array.isArray(c.resolutions)
    ? `res ${(c.resolutions as string[]).join("/")}`
    : Array.isArray(c.aspectRatios)
      ? "aspect ratio"
      : c.widthHeightDivisor
        ? `w×h /${c.widthHeightDivisor}`
        : "";
  return [mark(m), m.name, privacyOf(m), m.price, sizes];
}

const privacyOf = (m: ModelInfo) => (m.uncensored ? `${m.privacy}, uncensored` : m.privacy);

const mark = (m: ModelInfo) =>
  `${m.id === DEFAULT_TEXT_MODEL || m.id === DEFAULT_IMAGE_MODEL ? "*" : " "}${m.id}${m.offline ? " (offline)" : ""}`;

export const modelsList = command({
  name: "models.list",
  description: `List the Venice text and image models the pickers offer, with price and privacy (cached ~10 minutes).
Those are the models enabled in models.ini (models.example.ini when there is no models.ini; src/venice/model-list.ts),
in its order. --all lists every model Venice has, and any of them can still be set by id. "private" models keep no
data; "anonymized" ones are proxied to a third party; "uncensored" is Venice's own label. * marks the app default.`,
  auth: false,
  args: z.object({
    type: z.enum(["text", "image"]).optional().describe("Only this type (default: both)"),
    all: z.boolean().optional().describe("Every model Venice has, not just the ones the model list enables"),
    refresh: z.boolean().optional().describe("Bypass the cache"),
  }),
  examples: ["./sst models.list --type image", "./sst models.list --type text --json", "./sst models.list --all"],
  handler: async (args, ctx): Promise<ModelsResult> => {
    const types: ModelType[] = args.type ? [args.type] : ["text", "image"];
    const lists = await Promise.all(types.map((t) => ctx.deps.venice.listModels(t, { refresh: args.refresh })));
    const models = lists.flatMap((l) => l.models);
    const defaults = { text: DEFAULT_TEXT_MODEL, image: DEFAULT_IMAGE_MODEL };
    if (args.all) return { models, defaults };
    const list = readModelList(ctx.deps.config.modelsFile);
    return { models: pickModels(models, list), defaults, source: list.source, fromExample: list.fromExample };
  },
  format: (r: ModelsResult) => {
    const text = r.models.filter((m) => m.type === "text");
    const image = r.models.filter((m) => m.type === "image");
    const out: string[] = [];
    if (text.length)
      out.push(`Text models (${text.length})`, table([" ID", "NAME", "PRIVACY", "PRICE", "REASONING", "CONTEXT"], text.map(textRow)));
    if (image.length)
      out.push(`${out.length ? "\n" : ""}Image models (${image.length})`, table([" ID", "NAME", "PRIVACY", "PRICE", "SIZES"], image.map(imageRow)));
    if (!out.length) out.push("No models.");
    if (r.source) out.push(`\nFrom ${r.source}${r.fromExample ? " (no models.ini yet: copy this file to models.ini to choose your own)" : ""}. --all: every Venice model.`);
    return out.join("\n");
  },
});

export const veniceBalance = command({
  name: "venice.balance",
  description: "Show the Venice account balance (USD and DIEM). Free to call.",
  auth: false,
  args: z.object({}),
  handler: async (_args, ctx): Promise<Balance & { mode: string }> => ({
    ...(await ctx.deps.venice.balance()),
    mode: ctx.deps.config.mode,
  }),
  format: (b) =>
    `${b.mode === "mock" ? "MOCK " : ""}Venice balance: $${b.usd} USD · DIEM ${b.diem} · tier ${b.tier}`,
});

export default [modelsList, veniceBalance];
