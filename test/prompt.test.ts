import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newBrain, newConversation } from "../src/conversations/defaults.ts";
import {
  assertAnswerable,
  assertSendable,
  buildRequest,
  nothingToAnswer,
  REASONING_NOTE,
  render,
  resolveBrain,
  type ModelCaps,
} from "../src/conversations/prompt.ts";
import { newMessage, planRegenerate, planTurn, reviewBody } from "../src/conversations/turn.ts";
import type { Author, Brain, Conversation, MessageVersion } from "../src/conversations/types.ts";

const DEEPSEEK: ModelCaps = { reasoning: { supported: true, effortOptions: ["none", "low", "high", "max"] } };
const AT = "2026-10-14T00:00:00.000Z";

/** A D&D table with every kind of message, so each brain's point of view can be checked exactly. */
function table() {
  const conv = newConversation({ title: "Gilded Goat", systemPrompt: "You are the GM." });
  const gm = conv.brains[0]!;
  gm.name = "Game Master";
  const dice = newBrain({ name: "Dice Master", systemPrompt: "You roll dice.", isDefault: false });
  dice.finalReminder.content = "<!-- System reminder --> Only roll.";
  const painter: Brain = {
    ...newBrain({ name: "Scene Painter", systemPrompt: "You paint scenes.", isDefault: false }),
    kind: "image",
    safeMode: true,
    tool: { name: "generate_image", description: "Paint it.", promptParamDescription: "The prompt.", resultContent: "It is on screen." },
  };
  conv.brains.push(dice, painter);
  conv.setup.push(
    { id: "s_1", label: "World Bible", content: "<!-- This is the World Bible. -->\nThe Gilded Goat is a tavern." },
    { id: "s_2", label: "Blank", content: "   " },
  );
  const add = (author: Author, content: string, kind: "text" | "image" = "text", extra: Partial<MessageVersion> = {}) => {
    const m = newMessage(author, kind, { content, source: "generated", createdAt: AT, ...extra });
    conv.messages.push(m);
    return m;
  };
  const by = (b: Brain): Author => ({ type: "brain", brainId: b.id });
  add(by(gm), "A hooded figure waits.", "text", { source: "authored" });
  add({ type: "player" }, "I approach.");
  add(by(dice), "Roll: 17.", "text", { reasoning: "SECRET-REASONING" });
  const img = add(by(painter), "A hooded figure in a candle-lit tavern", "image");
  add({ type: "player" }, "I sit down.");
  const last = add(by(gm), "OLD-VERSION");
  last.versions.push({ content: "The figure nods.", source: "generated", steer: "SECRET-STEER", createdAt: AT });
  last.activeVersion = 1;
  return { conv, gm, dice, painter, img, last };
}

const user = (content: string) => ({ role: "user", content });
const assistant = (content: string) => ({ role: "assistant", content });
const BIBLE = user("<!-- This is the World Bible. -->\nThe Gilded Goat is a tavern.");
const PAINTED = user(
  "<!-- from: Scene Painter. It called generate_image with this exact prompt, and that image is now on the player's screen: -->\nA hooded figure in a candle-lit tavern",
);

describe("buildRequest: each brain sees one shared ledger from its own point of view", () => {
  test("default brain: system, setup, framed player and other brains, own replies as assistant, no reminder", () => {
    const { conv, gm } = table();
    const body = buildRequest(conv, gm.id, { model: DEEPSEEK });
    assert.deepEqual(body.messages, [
      { role: "system", content: "You are the GM." },
      BIBLE, // the blank setup message is skipped, not sent empty
      assistant("A hooded figure waits."),
      user("<!-- from: the user -->\nI approach."),
      user("<!-- from: Dice Master -->\nRoll: 17."),
      PAINTED,
      user("<!-- from: the user -->\nI sit down."),
      assistant("The figure nods."), // the active version, not version 1
    ]);
    assert.deepEqual(
      { ...body, messages: undefined },
      {
        model: "deepseek-v4-1-flash",
        messages: undefined,
        stream: true,
        stream_options: { include_usage: true },
        venice_parameters: { include_venice_system_prompt: false, enable_web_search: "off", enable_web_scraping: false },
        reasoning_effort: "none", // new brains have reasoning off (T02 QA-1)
      },
    );
  });

  test("another brain: the default brain is framed, its own line is assistant, its reminder goes last", () => {
    const { conv, dice } = table();
    assert.deepEqual(buildRequest(conv, dice.id, { model: DEEPSEEK }).messages, [
      { role: "system", content: "You roll dice." },
      BIBLE,
      user("<!-- from: Game Master -->\nA hooded figure waits."),
      user("<!-- from: the user -->\nI approach."),
      assistant("Roll: 17."),
      PAINTED,
      user("<!-- from: the user -->\nI sit down."),
      user("<!-- from: Game Master -->\nThe figure nods."),
      user("<!-- System reminder --> Only roll."),
    ]);
  });

  test("image brain: its own images are tool calls plus the tool result, and the tool is forced", () => {
    const { conv, painter, img } = table();
    const body = buildRequest(conv, painter.id, { model: DEEPSEEK });
    assert.deepEqual(body.messages.slice(4, 7), [
      user("<!-- from: Dice Master -->\nRoll: 17."),
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: `call_${img.id}`, type: "function", function: { name: "generate_image", arguments: '{"prompt":"A hooded figure in a candle-lit tavern"}' } },
        ],
      },
      { role: "tool", tool_call_id: `call_${img.id}`, content: "It is on screen." },
    ]);
    assert.equal(body.messages.length, 9, "reminder is on by default for a non-default brain, but blank, so it is skipped");
    assert.deepEqual(body.tool_choice, { type: "function", function: { name: "generate_image" } });
    assert.deepEqual(body.tools?.[0]?.function, {
      name: "generate_image",
      description: "Paint it.",
      parameters: { type: "object", properties: { prompt: { type: "string", description: "The prompt." } }, required: ["prompt"] },
    });
  });

  test("regenerate: excludeFromMessageId stops before the message, and the steer goes last, after the reminder", () => {
    const { conv, gm, dice, last } = table();
    let body = buildRequest(conv, gm.id, { model: DEEPSEEK, excludeFromMessageId: last.id, steer: "say it's blue" });
    assert.deepEqual(body.messages.slice(-2), [
      user("<!-- from: the user -->\nI sit down."),
      user(
        "<!-- Behind-the-scenes direction from the user. This is not part of the conversation. Write your previous response again, following this direction: -->\nsay it's blue",
      ),
    ]);
    body = buildRequest(conv, dice.id, { model: DEEPSEEK, steer: "roll a 3" });
    assert.deepEqual(body.messages.slice(-2).map((m) => m.content.split("\n")[0]), [
      "<!-- System reminder --> Only roll.",
      "<!-- Behind-the-scenes direction from the user. This is not part of the conversation. Write your previous response again, following this direction: -->",
    ]);
    assert.throws(() => buildRequest(conv, gm.id, { model: DEEPSEEK, excludeFromMessageId: "m_nope" }), /No message m_nope/);
    // A blank steer is a caller bug, not "no steer": dropping it would leave the brain's own reply last (T02 QA-5).
    assert.throws(() => buildRequest(conv, gm.id, { model: DEEPSEEK, steer: "  \n" }), /steer can't be blank/);
  });

  test("reasoning text, steers and inactive versions are never sent (hard rule 4)", () => {
    const { conv } = table();
    const all = JSON.stringify(conv.brains.map((b) => buildRequest(conv, b.id, { model: DEEPSEEK })));
    for (const secret of ["SECRET-REASONING", "SECRET-STEER", "OLD-VERSION"]) assert.ok(!all.includes(secret), secret);
  });

  test("templates are the user's: edits change the framing, and a bare {{content}} player template sends the message unframed", () => {
    const { conv, dice } = table();
    conv.templates.player = "{{content}}";
    conv.templates.otherBrainText = "[{{brain}}] {{content}}";
    const msgs = buildRequest(conv, dice.id, { model: DEEPSEEK }).messages;
    assert.deepEqual(msgs.slice(2, 4), [user("[Game Master] A hooded figure waits."), user("I approach.")]);
  });

  test("reasoning params follow the brain's toggle and what the model supports", () => {
    const { conv, gm } = table();
    const params = (model: ModelCaps) => {
      const b = buildRequest(conv, gm.id, { model });
      return { effort: b.reasoning_effort, disable: b.venice_parameters.disable_thinking };
    };
    assert.equal(gm.reasoning.enabled, false, "off by default (T02 QA-1)");
    assert.deepEqual(params(DEEPSEEK), { effort: "none", disable: undefined });
    assert.deepEqual(params({ reasoning: { supported: true, effortOptions: ["low", "high"] } }), { effort: undefined, disable: true });
    assert.deepEqual(params({ reasoning: { supported: true, effortOptions: null } }), { effort: undefined, disable: true });
    gm.reasoning.enabled = true;
    assert.deepEqual(params(DEEPSEEK), { effort: "low", disable: undefined });
    assert.deepEqual(params(null), { effort: undefined, disable: undefined });
    assert.deepEqual(params({ reasoning: { supported: false, effortOptions: null } }), { effort: undefined, disable: undefined });
    assert.deepEqual(params({ reasoning: { supported: true, effortOptions: null } }), { effort: undefined, disable: undefined });
    conv.settings.maxTokens = 300;
    conv.settings.temperature = 0;
    const b = buildRequest(conv, gm.id, { model: DEEPSEEK });
    assert.equal(b.max_tokens, 300);
    assert.equal(b.temperature, 0);
  });

  test("hard rule 1: no request without a non-empty system message", () => {
    const { conv, gm } = table();
    gm.systemPrompt = "  \n ";
    assert.throws(() => buildRequest(conv, gm.id, { model: DEEPSEEK }), { code: "empty_system_prompt" });
    const vp = { include_venice_system_prompt: false as const, enable_web_search: "off" as const, enable_web_scraping: false as const };
    assert.throws(() => assertSendable({ messages: [user("hi") as never], venice_parameters: vp }), { code: "empty_system_prompt" });
    assert.throws(() => assertSendable({ messages: [], venice_parameters: vp }), { code: "empty_system_prompt" });
    assert.throws(
      () => assertSendable({ messages: [{ role: "system", content: "x" }], venice_parameters: { ...vp, include_venice_system_prompt: true } as never }),
      /include_venice_system_prompt/,
    );
  });
});

describe("planTurn and helpers", () => {
  test("planTurn: the would-be player message is in the body; blank content means the brain just responds", () => {
    const conv: Conversation = newConversation({ title: "t", systemPrompt: "Be brief." });
    let plan = planTurn(conv, { content: "Hello" }, DEEPSEEK);
    assert.equal(plan.player?.versions[0]?.content, "Hello");
    assert.deepEqual(plan.body.messages, [{ role: "system", content: "Be brief." }, user("<!-- from: the user -->\nHello")]);
    assert.equal(conv.messages.length, 0, "planning changes nothing");
    plan = planTurn(conv, { content: "  " }, DEEPSEEK);
    assert.equal(plan.player, null);
    assert.equal(plan.body.messages.length, 1);
  });

  test("nothing to answer: a body must end with a user or tool message, in every plan and on the send path (T02 QA-3, QA-5)", () => {
    const fresh = newConversation({ title: "t", systemPrompt: "Open a tavern scene." });
    // Only the system prompt: live, the model just continues it as text.
    let plan = planTurn(fresh, {}, DEEPSEEK);
    assert.match(plan.refusal ?? "", /nothing for Assistant to answer yet: the request would hold only its system prompt/);
    assert.throws(() => assertAnswerable(plan.body), { code: "nothing_to_answer" });
    assert.equal(planTurn(fresh, { content: "Hi" }, DEEPSEEK).refusal, undefined);

    const { conv, gm, dice, painter } = table();
    plan = planTurn(conv, { brain: gm.id }, DEEPSEEK); // its own reply is last
    assert.match(plan.refusal ?? "", /last message is Game Master's own reply/);
    assert.throws(() => assertAnswerable(plan.body), { code: "nothing_to_answer" });
    assert.equal(planTurn(conv, { brain: dice.id }, DEEPSEEK).refusal, undefined, "another brain's line is a framed user message");
    // An image brain's own image ends in role: tool, which is answerable (it paints again).
    conv.messages.splice(4);
    assert.equal(nothingToAnswer(buildRequest(conv, painter.id, { model: DEEPSEEK })), null);
  });

  test("reviewBody: the payload view notes reasoning only when the request really turns it on (T02 QA-1)", () => {
    const { conv, gm } = table();
    assert.deepEqual(planTurn(conv, { content: "x" }, DEEPSEEK).notes, []);
    gm.reasoning.enabled = true;
    assert.deepEqual(planTurn(conv, { content: "x" }, DEEPSEEK).notes, [REASONING_NOTE]);
    assert.deepEqual(reviewBody(gm, planTurn(conv, { content: "x" }, null).body, { reasoning: { supported: false, effortOptions: null } }).notes, []);
    assert.equal(REASONING_NOTE, "Reasoning on: the provider adds a small hidden instruction we can't see or edit.");
  });

  test("resolveBrain: id, then case-insensitive name, else the default; unknown names list the brains", () => {
    const { conv, gm, dice } = table();
    assert.equal(resolveBrain(conv).id, gm.id);
    assert.equal(resolveBrain(conv, dice.id).id, dice.id);
    assert.equal(resolveBrain(conv, "dice master").id, dice.id);
    assert.throws(() => resolveBrain(conv, "Bard"), /No brain "Bard".*Game Master, Dice Master, Scene Painter/);
  });

  test("planRegenerate: a steer keeps the active version in, before the reminder and the steer; a re-roll leaves it out", () => {
    const { conv, gm, dice, last } = table();
    const STEER_HEAD = "<!-- Behind-the-scenes direction from the user. This is not part of the conversation. Write your previous response again, following this direction: -->";
    // The GM's last reply has two versions; version 2 (index 1) is active and is what the steer revises.
    let plan = planRegenerate(conv, { steer: "  say it's green \n" }, DEEPSEEK);
    assert.equal(plan.brain.id, gm.id, "the message's own brain answers");
    assert.equal(plan.message.id, last.id, "default: the last message");
    assert.deepEqual([plan.steer, plan.steeredFrom, plan.refusal], ["say it's green", 1, undefined]);
    assert.deepEqual(plan.body.messages.slice(-3), [
      user("<!-- from: the user -->\nI sit down."),
      assistant("The figure nods."),
      user(`${STEER_HEAD}\nsay it's green`),
    ]);
    assert.ok(!JSON.stringify(plan.body).includes("OLD-VERSION") && !JSON.stringify(plan.body).includes("SECRET-STEER"), "only the active version, no earlier steer");

    // A blank steer is a plain re-roll: the message is left out, and the brain answers what came before it.
    for (const steer of [undefined, "", "  \n"]) {
      plan = planRegenerate(conv, { message: last.id, steer }, DEEPSEEK);
      assert.equal(plan.steer, undefined);
      assert.deepEqual(plan.body.messages.at(-1), user("<!-- from: the user -->\nI sit down."));
      assert.ok(!JSON.stringify(plan.body).includes("The figure nods."));
    }

    // Another brain's reply: its reminder goes before the steer.
    const roll = newMessage({ type: "brain", brainId: dice.id }, "text", { content: "Roll: 4.", source: "generated", createdAt: AT });
    conv.messages.push(roll);
    plan = planRegenerate(conv, { steer: "roll a 20" }, DEEPSEEK);
    assert.equal(plan.brain.id, dice.id);
    assert.deepEqual(plan.body.messages.slice(-3).map((m) => m.content.split("\n")[0]), ["Roll: 4.", "<!-- System reminder --> Only roll.", STEER_HEAD]);
    assert.equal(conv.messages.at(-1), roll, "planning changes nothing");
  });

  test("planRegenerate: only the last message, only a brain's, and a re-roll that would end on the brain's own reply is refused", () => {
    const { conv, gm, last } = table();
    assert.throws(() => planRegenerate(conv, { message: conv.messages[0]!.id }, DEEPSEEK), { code: "not_last_message", message: /Only the last message can be regenerated.*edit it/ });
    assert.throws(() => planRegenerate(conv, { message: "m_nosuchmsg" }, DEEPSEEK), { code: "not_found" });
    conv.messages.push(newMessage({ type: "player" }, "text", { content: "Hi", source: "authored", createdAt: AT }));
    assert.throws(() => planRegenerate(conv, {}, DEEPSEEK), { code: "not_a_brain_message" });
    assert.throws(() => planRegenerate(newConversation({ title: "t", systemPrompt: "x" }), {}, DEEPSEEK), { code: "nothing_to_regenerate" });

    // Two GM replies in a row (the player line between them was deleted): a re-roll would end on the GM's own reply.
    conv.messages.pop();
    conv.messages.splice(conv.messages.indexOf(last) - 1, 1);
    conv.messages.splice(conv.messages.indexOf(last), 0, newMessage({ type: "brain", brainId: gm.id }, "text", { content: "Earlier.", source: "generated", createdAt: AT }));
    const plan = planRegenerate(conv, {}, DEEPSEEK);
    assert.match(plan.refusal ?? "", /a plain re-roll has nothing to answer\. Give it a steer, or edit the message instead/);
    assert.throws(() => assertAnswerable(plan.body), { code: "nothing_to_answer" }, "the send path refuses it too");
    assert.equal(planRegenerate(conv, { steer: "again" }, DEEPSEEK).refusal, undefined, "a steer always ends with a user message");
  });

  test("planRegenerate: a re-roll of a lone reply says there is only the system prompt, not 'its own earlier reply' (T03 QA-4)", () => {
    const conv = newConversation({ title: "t", systemPrompt: "Be brief." });
    const brainId = conv.brains[0]!.id;
    conv.messages.push(newMessage({ type: "brain", brainId }, "text", { content: "Alone.", source: "generated", createdAt: AT }));
    const plan = planRegenerate(conv, {}, DEEPSEEK);
    assert.deepEqual(plan.body.messages.map((m) => m.role), ["system"]);
    assert.match(plan.refusal ?? "", /would hold only its system prompt/);
    assert.doesNotMatch(plan.refusal ?? "", /earlier reply/);
  });

  test("a template without its placeholder is refused where it's used, so no text is silently left out (T03 QA-3)", () => {
    const { conv, gm } = table();
    const steered = () => planRegenerate(conv, { steer: "Say it's blue." }, DEEPSEEK);
    for (const broken of ["", "   ", "Rewrite it."]) {
      conv.templates.steer = broken;
      assert.throws(steered, { code: "bad_template", message: /steer template has no \{\{instruction\}\}, so your steer would be left out/ });
    }
    conv.templates.steer = "{{instruction}}";
    assert.equal(steered().body.messages.at(-1)?.content, "Say it's blue.");
    assert.ok(planRegenerate(conv, {}, DEEPSEEK), "a plain re-roll doesn't use the steer template");

    conv.templates.player = "<!-- from: the user -->";
    assert.throws(() => buildRequest(conv, gm.id, { model: DEEPSEEK }), { code: "bad_template", message: /player template has no \{\{content\}\}, so your messages/ });
    conv.templates.player = "{{content}}";
    conv.templates.otherBrainText = "[{{brain}}]";
    assert.throws(() => buildRequest(conv, gm.id, { model: DEEPSEEK }), { code: "bad_template", message: /other-brain text template has no \{\{content\}\}/ });
  });

  test("render: one literal pass, so placeholders or $ patterns inside values are never expanded", () => {
    assert.equal(render("{{brain}}: {{content}}", { brain: "GM", content: "x {{brain}} $& $1 $$" }), "GM: x {{brain}} $& $1 $$");
    assert.equal(render("{{prompt}} {{other}} {{content}}", { content: "c" }), "{{prompt}} {{other}} c");
  });
});
