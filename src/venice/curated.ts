/**
 * The models the pickers offer: Jason's picks (2026-10-14) from Venice's ~130 text and ~45 image models.
 * Private only (Venice keeps no data), one per family (its newest or best), plus an uncensored twin where
 * there is one (one anonymized exception, Jason's pick: Abliterated Large V2, GLM 5.3's uncensored twin). Left out
 * on purpose: anonymized models (proxied to OpenAI, Anthropic, Google, ...), the e2ee-*
 * models (they need client-side encryption and can't call tools), models being retired, text models that
 * can't call tools (an image brain needs one), and Grok 4.7 (a hidden prompt of its own, below). models.list shows these, in this order; `models.list --all`
 * shows everything Venice has, and conversation.update still takes any Venice model by id.
 */
export const CURATED_TEXT: readonly string[] = [
  "deepseek-v4-1-flash", // the default
  // T15 (2026-10-15): with reasoning off, a request ending on its own message came back empty 2 runs in 2; with
  // reasoning low it worked 1 in 1. It may need reasoning on for that (a fresh take for a brain with no reminder).
  "google-gemma-4-31b-it",
  "gemma-4-uncensored",
  // Grok 4.7 (grok-4-7) is out, Jason's call (2026-10-21, T18 triage), on the T18 measurement: it adds ~1,240 prompt
  // tokens of its own to every request, whatever the body (a two-line body: 21 on DeepSeek, 1,261 on Grok; the GM's:
  // 1,185 and 2,406), 1,152 of them cached even on a first call. A provider-side prompt we can't see or edit, against
  // hard requirement 1. It also reasons with reasoning off (disable_thinking: true still gave 50-221 reasoning tokens,
  // billed, none of it streamed). Still usable by id. docs/design.md, "Models".
  "kimi-k3",
  "kimi-k2-6",
  "kimi-k2-5",
  "qwen-3-8-2-4t-a95b",
  "qwen-3-8-27b", // uncensored
  // GLM 5.3 and its uncensored twin (2026-10-19, back from T15's parking, so Jason can compare them in play). Both
  // always reason (ALWAYS_REASONS below): give their brains reasoning on. T15's failures (</think> in the reply
  // once, empty once) came from a request ending on the brain's own words, which T17 removed. Live with reasoning on
  // (docs/design.md, "Models"), both clean: a GM turn, an image brain's forced tool call, a hidden note; GLM 5.3 a
  // T17 fresh take too. At their default depth a long task can think for 10k+ tokens. The 4.7 heretic stays out.
  "z-ai-glm-5-3",
  // Uncensored, and the one exception to "private only", at Jason's request (2026-10-19): its privacy is
  // "anonymized", Venice proxies it to Abliteration AI. GLM 5.3 abliterated and fine-tuned. Its reasoning streams
  // as delta.reasoning, not reasoning_content (chunkEvents reads either); it counted the same prompt tokens as GLM 5.3
  // for the same body, so its proxy adds no system prompt.
  "abliteration-abliterated-model-large-v2",
  "minimax-m3-preview",
  "venice-uncensored-1-2",
  "venice-uncensored-role-play",
  // T18 QA-2 (2026-10-21): as an image brain's text model it wrote a framing line and a sentence before its forced
  // generate_image call (the text is set aside), and once looped in that text for over two minutes with no call at
  // all. An image brain's reply now ends after IMAGE_TEXT_LIMIT characters of text with no call (turn.ts).
  "mistral-small-3-2-24b-instruct",
  "nvidia-nemotron-3-ultra-550b-a55b",
  "xiaomi-mimo-v2-6-flash",
  "llama-3.3-70b",
  "inkling",
];

/**
 * Text models that reason whatever a brain's Reasoning switch says, and what reasoning off does to them, measured
 * live (2026-10-19). Venice's capabilities can't tell (both say supportsReasoning, supportsReasoningEffort: false),
 * so the payload view and the brain editor learn it here (ModelInfo.reasoning.always). Nothing sent changes.
 * - "refused": Venice answers 400 (GLM 5.3: "a thinking-only model; disabling thinking (reasoning_effort='none') is
 *   not supported").
 * - "ignored": Venice takes disable_thinking and the model reasons anyway (Abliterated Large V2: a one-word answer
 *   came with 20 reasoning tokens).
 */
export const ALWAYS_REASONS: Readonly<Record<string, "refused" | "ignored">> = {
  "z-ai-glm-5-3": "refused",
  "abliteration-abliterated-model-large-v2": "ignored",
};

export const CURATED_IMAGE: readonly string[] = [
  "z-image-turbo", // the default
  "chroma", // uncensored
  "grok-imagine-image-2-0",
  "krea-2-turbo", // uncensored
  "hunyuan-image-v3",
  "lustify-v8", // uncensored
  "wai-Illustrious", // anime, uncensored
];

/** Keep the curated models, text first, each in the curated order. A pick Venice no longer lists simply drops out. */
export function curated<T extends { id: string; type: string }>(models: T[]): T[] {
  const rank = (m: T) => (m.type === "image" ? CURATED_IMAGE : CURATED_TEXT).indexOf(m.id);
  const key = (m: T) => (m.type === "image" ? 1000 : 0) + rank(m);
  return models.filter((m) => rank(m) >= 0).sort((a, b) => key(a) - key(b));
}
