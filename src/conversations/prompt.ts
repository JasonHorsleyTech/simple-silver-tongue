import { badRequest, CommandError, notFound } from "../lib/errors.ts";
import type { Brain, ChatMessage, ChatRequest, Conversation, LedgerMessage, PinRole, Templates } from "./types.ts";

/**
 * Prompt assembly (docs/design.md, "Prompt assembly"). buildRequest is a pure function from the conversation
 * document to the exact /chat/completions body. prompt.preview returns its result and turn sends it, so the
 * two cannot drift. Every string in the result comes from a user-editable field: this file adds no prose.
 */

/** What buildRequest needs to know about settings.textModel (from GET /models). null: unknown, so no reasoning params. */
export type ModelCaps = {
  name?: string;
  reasoning?: { supported: boolean; effortOptions: string[] | null; always?: "refused" | "ignored" };
} | null;

export type BuildOptions = {
  model: ModelCaps;
  /** Regenerate: stop before this ledger message (it and everything after it are left out). */
  excludeFromMessageId?: string;
  /** Regenerate with a one-off direction: rendered with templates.steer and sent last. Never stored in the ledger. */
  steer?: string;
};

const PLACEHOLDER = /\{\{(content|brain|prompt|instruction|roll|thought)\}\}/g;
type Vars = Partial<Record<"content" | "brain" | "prompt" | "instruction" | "roll" | "thought", string>>;

/**
 * Literal placeholder replacement in one pass, so a value that itself contains "{{brain}}" or "$&" is never
 * expanded again. A placeholder this template has no value for stays as typed (and shows in the preview).
 */
export function render(template: string, vars: Vars): string {
  return template.replace(PLACEHOLDER, (whole, key: keyof Vars) => vars[key] ?? whole);
}

/**
 * The placeholder each template can't do without: it is where the text goes, so a template without it would
 * silently leave that text out of the request (T03 QA-3: a blank steer template dropped the steer, and the
 * request then ended with an empty message after the brain's own reply). conversation.update refuses such a
 * template, and buildRequest refuses to use one, for files written before that check.
 */
const TEMPLATE_SLOTS: Record<keyof Templates, { label: string; placeholder: string; what: string }> = {
  player: { label: "player", placeholder: "{{content}}", what: "your messages" },
  otherBrainText: { label: "other-brain text", placeholder: "{{content}}", what: "other brains' replies" },
  otherBrainImage: { label: "other-brain image", placeholder: "{{prompt}}", what: "other brains' image prompts" },
  steer: { label: "steer", placeholder: "{{instruction}}", what: "your steer" },
  roll: { label: "roll", placeholder: "{{roll}}", what: "the number you rolled" },
  thought: { label: "thought", placeholder: "{{thought}}", what: "your thought" },
};

/** Why this template can't be used, or null when it has its placeholder. */
export function templateProblem(name: keyof Templates, template: string): string | null {
  const { label, placeholder, what } = TEMPLATE_SLOTS[name];
  if (template.includes(placeholder)) return null;
  return `The ${label} template has no ${placeholder}, so ${what} would be left out of the request. Put ${placeholder} back in the template, where the text should go.`;
}

/** Design hard rule 1: some Venice models inject their own prompt when the system message is missing or empty. */
export const emptySystemPrompt = (brain: { name: string }, convId: string) =>
  new CommandError(
    400,
    "empty_system_prompt",
    `Brain "${brain.name}" has an empty system prompt, so nothing was sent (some Venice models inject their own prompt when there is none). Give it one: ./ss brain.update --conversation ${convId} --brain "${brain.name}" --system-prompt "..."`,
  );

/** A brain by id, then by name (case-insensitive). No ref: the conversation's default brain. */
export function resolveBrain(conv: Conversation, ref?: string): Brain {
  const want = ref?.trim();
  if (!want) {
    const def = conv.brains.find((b) => b.id === conv.defaultBrainId);
    if (!def) throw new Error(`conversation ${conv.id}: default brain ${conv.defaultBrainId} is missing`);
    return def;
  }
  const brain =
    conv.brains.find((b) => b.id === want) ?? conv.brains.find((b) => b.name.toLowerCase() === want.toLowerCase());
  if (!brain) throw notFound(`No brain "${want}" in this conversation. Brains: ${conv.brains.map((b) => b.name).join(", ")}.`);
  return brain;
}

export function activeVersion(m: LedgerMessage) {
  const v = m.versions[m.activeVersion];
  if (!v) throw new Error(`message ${m.id}: active version ${m.activeVersion} does not exist`);
  return v;
}

/** The exact request body for brain `brainId` (docs/design.md steps 1-5). */
export function buildRequest(conv: Conversation, brainId: string, opts: BuildOptions): ChatRequest {
  return assembleRequest(conv, brainId, opts).body;
}

/** T16: where a pinned message landed in a body: the index of its (first) chat message. Display only. */
export type PinnedAt = { index: number; messageId: string; as: PinRole };

/**
 * buildRequest, plus where each pinned message went (T16), for prompt.preview to point out. The body is the same
 * object buildRequest returns, so the preview and the send can't differ.
 */
export function assembleRequest(conv: Conversation, brainId: string, opts: BuildOptions): { body: ChatRequest; pinned: PinnedAt[] } {
  const brain = conv.brains.find((b) => b.id === brainId);
  if (!brain) throw notFound(`No brain ${brainId} in conversation ${conv.id}.`);
  if (!brain.systemPrompt.trim()) throw emptySystemPrompt(brain, conv.id);
  // A blank steer is a caller bug, not "no steer": with a steer the message being revised stays in, so dropping
  // the steer silently would leave the brain's own reply last (T02 QA-5). A plain re-roll passes no steer.
  if (opts.steer !== undefined && !opts.steer.trim()) {
    throw badRequest("A steer can't be blank. Leave it out for a plain re-roll.");
  }
  if (brain.kind === "image" && !brain.tool) {
    throw new CommandError(400, "bad_brain", `Image brain "${brain.name}" has no tool text (tool.name, description, ...).`);
  }
  const t = conv.templates;
  const frame = (name: keyof Templates, vars: Vars) => {
    const problem = templateProblem(name, t[name]);
    if (problem) throw new CommandError(400, "bad_template", problem);
    return render(t[name], vars);
  };

  // The ledger this request sees: everything before the message a regenerate leaves out.
  let ledger = conv.messages;
  if (opts.excludeFromMessageId !== undefined) {
    const at = conv.messages.findIndex((m) => m.id === opts.excludeFromMessageId);
    if (at < 0) throw notFound(`No message ${opts.excludeFromMessageId} in this conversation.`);
    ledger = conv.messages.slice(0, at);
  }

  /** One ledger message as this brain sees it at its place (step 3). */
  const view = (m: LedgerMessage): ChatMessage[] => {
    const { content } = activeVersion(m);
    if (m.author.type === "player") return [{ role: "user", content: frame("player", { content }) }];
    if (m.author.brainId === brain.id) {
      if (m.kind === "text") return [{ role: "assistant", content }];
      // Its own image: the forced tool call it made, then the (user-editable) tool result.
      if (!brain.tool) throw new CommandError(400, "bad_brain", `Brain "${brain.name}" has image messages but no tool text.`);
      const id = `call_${m.id}`;
      return [
        { role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name: brain.tool.name, arguments: JSON.stringify({ prompt: content }) } }] },
        { role: "tool", tool_call_id: id, content: brain.tool.resultContent },
      ];
    }
    const other = conv.brains.find((b) => b.id === (m.author as { brainId: string }).brainId);
    if (!other) throw new Error(`message ${m.id}: author brain is missing from conversation ${conv.id}`);
    return [
      {
        role: "user",
        content: m.kind === "text" ? frame("otherBrainText", { brain: other.name, content }) : frame("otherBrainImage", { brain: other.name, prompt: content }),
      },
    ];
  };

  // 1. System prompt, verbatim.
  const messages: ChatMessage[] = [{ role: "system", content: brain.systemPrompt }];

  // 2. Setup messages, verbatim, in order, each with its own role (T13): a system one is a second system message,
  // never merged into the prompt above. Blank ones are skipped rather than sent as empty messages.
  for (const s of conv.setup) if (s.content.trim()) messages.push({ role: s.role, content: s.content });

  // 2b. T16: the messages pinned to this brain, in ledger order, right after the setup: a live link (the active
  // version as it stands), sent here instead of at their place. Only those this request's ledger holds (a
  // regenerate's message, and whatever follows it, is left out here too). `system` and `assistant` send the text
  // verbatim with that role, and skip it when blank, as setup messages are; `ledger` sends what step 3 would.
  const pinAs = new Map((brain.pins ?? []).map((p) => [p.messageId, p.as]));
  // A steer revises the last message, which must stay right before the steer ("write your previous response
  // again"), even when it is pinned to its own brain.
  if (opts.steer !== undefined && ledger.length) pinAs.delete(ledger.at(-1)!.id);
  const pinned: PinnedAt[] = [];
  for (const m of ledger) {
    const as = pinAs.get(m.id);
    if (!as) continue;
    const { content } = activeVersion(m);
    const own = m.author.type === "brain" && m.author.brainId === brain.id;
    // The brain's own image call can only be sent as the call it was (a bare prompt as "its words" would be a reply it never wrote).
    const sent: ChatMessage[] = as === "ledger" || (own && m.kind === "image") ? view(m) : content.trim() ? [{ role: as, content }] : [];
    if (!sent.length) continue;
    pinned.push({ index: messages.length, messageId: m.id, as });
    messages.push(...sent);
  }

  // 3. The ledger, from this brain's point of view, using each message's active version. Pinned ones are above.
  for (const m of ledger) if (!pinAs.has(m.id)) messages.push(...view(m));

  // 4. Final reminder, verbatim.
  if (brain.finalReminder.enabled && brain.finalReminder.content.trim()) {
    messages.push({ role: "user", content: brain.finalReminder.content });
  }

  // 5. Steer, last, so everything before it stays a cacheable prefix.
  if (opts.steer !== undefined) messages.push({ role: "user", content: frame("steer", { instruction: opts.steer }) });

  const body: ChatRequest = {
    model: conv.settings.textModel,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    // Turn off everything on Venice's side that would add text we didn't write.
    venice_parameters: { include_venice_system_prompt: false, enable_web_search: "off", enable_web_scraping: false },
  };

  const r = opts.model?.reasoning;
  if (r?.supported) {
    if (!brain.reasoning.enabled) {
      if (r.effortOptions?.includes("none")) body.reasoning_effort = "none";
      else body.venice_parameters.disable_thinking = true;
    } else if (r.effortOptions) {
      body.reasoning_effort = brain.reasoning.effort;
    }
  }
  if (conv.settings.maxTokens !== undefined) body.max_tokens = conv.settings.maxTokens;
  if (conv.settings.temperature !== undefined) body.temperature = conv.settings.temperature;
  // A decoding setting, not text: Venice ends the reply just before any of these (T07 triage, QA-2).
  if (brain.stop?.length) body.stop = [...brain.stop];

  if (brain.kind === "image" && brain.tool) {
    const tool = brain.tool;
    body.tools = [
      {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: "object",
            properties: { prompt: { type: "string", description: tool.promptParamDescription } },
            required: ["prompt"],
          },
        },
      },
    ];
    body.tool_choice = { type: "function", function: { name: tool.name } };
  }

  assertSendable(body);
  return { body, pinned };
}

/**
 * The last check before any chat body leaves the server (the send path calls it too, whatever built the body):
 * the first message is a non-empty, user-written system message, and Venice's own system prompt is off.
 */
export function assertSendable(body: Pick<ChatRequest, "messages" | "venice_parameters">): void {
  if (body.venice_parameters?.include_venice_system_prompt !== false) {
    throw new Error("refusing to send a chat request without venice_parameters.include_venice_system_prompt: false");
  }
  const first = body.messages?.[0];
  if (!first || first.role !== "system" || typeof first.content !== "string" || !first.content.trim()) {
    throw new CommandError(
      400,
      "empty_system_prompt",
      "Refusing to send a chat request whose first message is not a non-empty system message (design.md hard rule 1).",
    );
  }
}

/**
 * Why a body gives the model nothing to answer, or null when it ends with a user or tool message. Live,
 * deepseek-v4-1-flash treats a trailing assistant message as a prefix to continue (it repeated its reply and
 * leaked a raw </think>), and a body that is only the system prompt gets continued as text (T02 QA-3).
 * Every plan reports it (prompt.preview shows the body with this note) and the send path refuses it.
 *
 * No exception (T17): T15 let a fresh take end on the brain's own planted thought (a prefill), and live it broke
 * too often (mid-word starts, other languages, code). A fresh take's thought is now the Muse's note, a `user`
 * message like any helper's, so its body ends on a user message whatever the brain.
 */
export function nothingToAnswer(body: Pick<ChatRequest, "messages">, brainName = "the brain"): string | null {
  const last = body.messages.at(-1)?.role;
  if (last === "user" || last === "tool") return null;
  if (last === "assistant") {
    return `The last message is ${brainName}'s own reply, so there is nothing new for it to answer. Write a message for it first.`;
  }
  // T13: a system setup message can end the body too (nothing after it).
  if (body.messages.length > 1) return `There is nothing for ${brainName} to answer yet: the request would end with a system setup message. Write a message for it first.`;
  return `There is nothing for ${brainName} to answer yet: the request would hold only its system prompt. Write a message for it first.`;
}

/** The send path's copy of the check above, whoever built the body (so T03's regenerate can't skip it). */
export function assertAnswerable(body: Pick<ChatRequest, "messages">): void {
  const why = nothingToAnswer(body);
  if (why) throw new CommandError(400, "nothing_to_answer", why);
}

/** The payload view's words for reasoning; in wording.ts so the browser's brain editor shows the same sentence. */
export { REASONING_NOTE } from "./wording.ts";

/** Whether this brain's request turns reasoning on: its toggle is on and the model can reason. */
export function reasoningOn(brain: Brain, model: ModelCaps): boolean {
  return brain.reasoning.enabled && model?.reasoning?.supported === true;
}
