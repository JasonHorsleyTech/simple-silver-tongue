/** Normalized view of Venice's GET /models entries: what the pickers and later tickets need. */
export type ModelType = "text" | "image";

export type ModelInfo = {
  id: string;
  name: string;
  type: ModelType;
  privacy: string; // "private" | "anonymized"
  price: string; // human label, e.g. "$0.30/M in, $1.20/M out" or "$0.01/image"
  offline: boolean;
  traits: string[];
  description?: string;
  /** Raw Venice pricing object, for cost maths later. */
  pricing: Record<string, unknown>;
  // text models
  contextLength?: number;
  maxCompletionTokens?: number;
  reasoning?: { supported: boolean; effortOptions: string[] | null; defaultEffort: string | null };
  functionCalling?: boolean;
  vision?: boolean;
  // image models: raw constraints (widthHeightDivisor, resolutions, aspectRatios, steps, promptCharacterLimit, ...)
  constraints?: Record<string, unknown>;
};

type RawModel = {
  id: string;
  type: string;
  context_length?: number;
  model_spec?: {
    name?: string;
    privacy?: string;
    offline?: boolean;
    traits?: string[];
    description?: string;
    pricing?: Record<string, unknown>;
    availableContextTokens?: number;
    maxCompletionTokens?: number;
    capabilities?: Record<string, unknown>;
    constraints?: Record<string, unknown>;
  };
};

export function normalizeModel(raw: RawModel): ModelInfo | null {
  if (raw.type !== "text" && raw.type !== "image") return null;
  const spec = raw.model_spec ?? {};
  const pricing = spec.pricing ?? {};
  const m: ModelInfo = {
    id: raw.id,
    name: spec.name ?? raw.id,
    type: raw.type,
    privacy: spec.privacy ?? "unknown",
    price: raw.type === "text" ? textPrice(pricing) : imagePrice(pricing),
    offline: spec.offline === true,
    traits: spec.traits ?? [],
    pricing,
  };
  if (spec.description) m.description = spec.description;
  if (raw.type === "text") {
    const caps = spec.capabilities ?? {};
    m.contextLength = spec.availableContextTokens ?? raw.context_length;
    if (spec.maxCompletionTokens) m.maxCompletionTokens = spec.maxCompletionTokens;
    m.reasoning = {
      supported: caps.supportsReasoning === true,
      effortOptions:
        caps.supportsReasoningEffort === true && Array.isArray(caps.reasoningEffortOptions)
          ? (caps.reasoningEffortOptions as string[])
          : null,
      defaultEffort: typeof caps.defaultReasoningEffort === "string" ? caps.defaultReasoningEffort : null,
    };
    m.functionCalling = caps.supportsFunctionCalling === true;
    m.vision = caps.supportsVision === true;
  } else {
    m.constraints = spec.constraints ?? {};
  }
  return m;
}

export function usd(n: number): string {
  if (n === 0) return "$0";
  return n >= 0.01 ? `$${n.toFixed(2)}` : `$${Number(n.toPrecision(2))}`;
}

function usdOf(v: unknown): number | null {
  const n = (v as { usd?: unknown } | undefined)?.usd;
  return typeof n === "number" ? n : null;
}

function textPrice(p: Record<string, unknown>): string {
  const input = usdOf(p.input);
  const output = usdOf(p.output);
  if (input === null || output === null) return "?";
  return `${usd(input)}/M in, ${usd(output)}/M out`;
}

/** Image prices come flat (generation), per resolution, or per resolution and quality. Show the range. */
function imagePrice(p: Record<string, unknown>): string {
  const prices: number[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    const u = usdOf(v);
    if (u !== null) prices.push(u);
    else for (const child of Object.values(v)) walk(child);
  };
  for (const [k, v] of Object.entries(p)) if (k !== "upscale") walk(v);
  if (prices.length === 0) return "?";
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return lo === hi ? `${usd(lo)}/image` : `${usd(lo)}-${usd(hi)}/image`;
}
