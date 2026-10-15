/**
 * The models the pickers offer: Jason's picks (2026-10-14) from Venice's ~130 text and ~45 image models.
 * Private only (Venice keeps no data), one per family (its newest or best), plus an uncensored twin where
 * there is one. Left out on purpose: anonymized models (proxied to OpenAI, Anthropic, Google, ...), the e2ee-*
 * models (they need client-side encryption and can't call tools), models being retired, and text models that
 * can't call tools (an image brain needs one). models.list shows these, in this order; `models.list --all`
 * shows everything Venice has, and conversation.update still takes any Venice model by id.
 */
export const CURATED_TEXT: readonly string[] = [
  "deepseek-v4-1-flash", // the default
  // T15 (2026-10-15): with reasoning off, a request ending on its own message came back empty 2 runs in 2; with
  // reasoning low it worked 1 in 1. It may need reasoning on for that (a fresh take for a brain with no reminder).
  "google-gemma-4-31b-it",
  "gemma-4-uncensored",
  // T15 (2026-10-15): it reported 2,419 prompt tokens for a request the other models counted at about 1,200. There
  // may be a system prompt we aren't sending (xAI's own, or Venice's despite include_venice_system_prompt: false),
  // which would break hard requirement 1. Look into it before relying on Grok.
  "grok-4-7",
  "kimi-k3",
  "kimi-k2-6",
  "kimi-k2-5",
  "qwen-3-8-2-4t-a95b",
  "qwen-3-8-27b", // uncensored
  // GLM (z-ai-glm-5-3, olafangensan-glm-4.7-flash-heretic) is parked until we look into it (T15, 2026-10-15). GLM 5.3
  // is thinking-only: with reasoning off (every brain starts so) Venice answers 400 "GLM-5.3 is a thinking-only
  // model; disabling thinking (reasoning_effort='none') is not supported". With thinking on, a request ending on
  // its own message leaked </think> into the reply once and came back empty once. Still usable by id
  // (models.list --all, conversation.update --settings.text-model).
  "minimax-m3-preview",
  "venice-uncensored-1-2",
  "venice-uncensored-role-play",
  "mistral-small-3-2-24b-instruct",
  "nvidia-nemotron-3-ultra-550b-a55b",
  "xiaomi-mimo-v2-6-flash",
  "llama-3.3-70b",
  "inkling",
];

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
