/**
 * What we measured about particular models that Venice's metadata doesn't say, for the code to act on. Which models
 * the pickers offer is a separate, editable choice (models.ini, src/venice/model-list.ts); these facts hold for a
 * model whether it is offered or set by id. design.md, "Models", has the measurements.
 */

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
