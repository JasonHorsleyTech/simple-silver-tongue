import { z } from "zod";
import { DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL } from "../config.ts";
import { table } from "../lib/text.ts";
import { command } from "../registry.ts";
import type { Balance } from "../venice/client.ts";
import type { ModelInfo, ModelType } from "../venice/models.ts";

type ModelsResult = { models: ModelInfo[]; defaults: { text: string; image: string } };

function textRow(m: ModelInfo) {
  const r = m.reasoning;
  const reasoning = !r?.supported ? "-" : r.effortOptions ? r.effortOptions.join("/") : "on";
  return [mark(m), m.name, m.privacy, m.price, reasoning, m.contextLength ? (m.contextLength >= 1e6 ? `${m.contextLength / 1e6}M` : `${Math.round(m.contextLength / 1000)}k`) : ""];
}

function imageRow(m: ModelInfo) {
  const c = m.constraints ?? {};
  const sizes = Array.isArray(c.resolutions)
    ? `res ${(c.resolutions as string[]).join("/")}`
    : c.widthHeightDivisor
      ? `w×h /${c.widthHeightDivisor}`
      : "";
  return [mark(m), m.name, m.privacy, m.price, sizes];
}

const mark = (m: ModelInfo) =>
  `${m.id === DEFAULT_TEXT_MODEL || m.id === DEFAULT_IMAGE_MODEL ? "*" : " "}${m.id}${m.offline ? " (offline)" : ""}`;

export const modelsList = command({
  name: "models.list",
  description: `List Venice text and image models with price and privacy (cached ~10 minutes).
"private" models keep no data; "anonymized" ones are proxied to a third party. * marks the app default.`,
  auth: false,
  args: z.object({
    type: z.enum(["text", "image"]).optional().describe("Only this type (default: both)"),
    refresh: z.boolean().optional().describe("Bypass the cache"),
  }),
  examples: ["./ss models.list --type image", "./ss models.list --type text --json"],
  handler: async (args, ctx): Promise<ModelsResult> => {
    const types: ModelType[] = args.type ? [args.type] : ["text", "image"];
    const lists = await Promise.all(types.map((t) => ctx.deps.venice.listModels(t, { refresh: args.refresh })));
    return { models: lists.flatMap((l) => l.models), defaults: { text: DEFAULT_TEXT_MODEL, image: DEFAULT_IMAGE_MODEL } };
  },
  format: (r: ModelsResult) => {
    const text = r.models.filter((m) => m.type === "text");
    const image = r.models.filter((m) => m.type === "image");
    const out: string[] = [];
    if (text.length)
      out.push(`Text models (${text.length})`, table([" ID", "NAME", "PRIVACY", "PRICE", "REASONING", "CONTEXT"], text.map(textRow)));
    if (image.length)
      out.push(`${out.length ? "\n" : ""}Image models (${image.length})`, table([" ID", "NAME", "PRIVACY", "PRICE", "SIZES"], image.map(imageRow)));
    return out.join("\n") || "No models.";
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
