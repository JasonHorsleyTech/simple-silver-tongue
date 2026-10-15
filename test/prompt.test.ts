import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newBrain, newConversation, REMINDER_EXAMPLE } from "../src/conversations/defaults.ts";
import {
  assembleRequest,
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
    { id: "s_1", label: "World Bible", role: "user", content: "<!-- This is the World Bible. -->\nThe Gilded Goat is a tavern." },
    { id: "s_2", label: "Blank", role: "user", content: "   " },
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
  "<!-- from: Scene Painter. It called generate_image with this exact prompt: -->\nA hooded figure in a candle-lit tavern",
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
        stop: ["<!-- from:"], // and a text brain stops before a framing line it would write for someone else (T07 triage)
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
    assert.deepEqual(body.messages.at(-1), user(REMINDER_EXAMPLE), "a non-default brain's reminder is on and pre-filled (T04), and goes last");
    painter.finalReminder.content = "  \n";
    assert.equal(buildRequest(conv, painter.id, { model: DEEPSEEK }).messages.length, body.messages.length - 1, "a blank reminder is skipped, not sent empty");
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
    gm.stop = [];
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

  test("fresh take (T17): the Muse's note right before the message, framed like any helper's; the body ends on a user message, reminder or not", () => {
    const { conv, gm, dice } = table();
    const NOTE = "```hidden\nAn idea for the Dice Master's next reply, which the player won't see:\n\nSubvert it: a natural 1.\n```\n";
    const framed = (text: string) => user(`<!-- from: Muse -->\n${text}`);
    // The Dice Master has a reminder: re-roll its line, with a thought.
    conv.messages.splice(-1); // the GM's last reply goes, so the Dice Master's...
    conv.messages.splice(-2); // ...line is last
    const roll = conv.messages.at(-1)!;
    assert.equal(roll.author.type === "brain" && roll.author.brainId, dice.id);
    const reroll = planRegenerate(conv, {}, DEEPSEEK);
    let plan = planRegenerate(conv, { thought: NOTE }, DEEPSEEK);
    assert.equal(plan.thought, NOTE, "sent exactly as given, never trimmed");
    assert.deepEqual(plan.body.messages, [...reroll.body.messages.slice(0, -1), framed(NOTE), reroll.body.messages.at(-1)], "the re-roll's body, the note before the reminder");
    assert.deepEqual(plan.body.messages.at(-1), user("<!-- System reminder --> Only roll."));
    assert.deepEqual([plan.refusal, plan.steer], [undefined, undefined]);
    assert.ok(!JSON.stringify(plan.body).includes("Roll: 17."), "the reply being replaced is left out");
    // No Muse yet: the plan makes one (saved only by the send), and the note is a new message by it.
    assert.deepEqual([plan.note!.isNew, plan.note!.museCreated, plan.note!.muse.name, plan.note!.muse.kind], [true, true, "Muse", "text"]);
    assert.deepEqual(plan.note!.message.author, { type: "brain", brainId: plan.note!.muse.id });
    assert.equal(conv.brains.length, 3, "nothing changed in the conversation");
    assert.match(plan.notes[0]!, /^A fresh take: the Muse's note goes in as a new message, right before .* no brain called Muse yet, so one is added when you send/);

    // The GM has no reminder: the body ends on the note, a user message (T15 ended on its own words, a prefill).
    const t2 = table();
    plan = planRegenerate(t2.conv, { thought: NOTE }, DEEPSEEK);
    assert.equal(plan.message.id, t2.last.id);
    assert.deepEqual(plan.body.messages.slice(-2), [user("<!-- from: the user -->\nI sit down."), framed(NOTE)]);
    assert.equal(plan.refusal, undefined);
    assert.doesNotThrow(() => assertAnswerable(plan.body));
    assert.ok(!JSON.stringify(plan.body).includes("The figure nods.") && !JSON.stringify(plan.body).includes("OLD-VERSION"));

    // With a Muse note right before the message, a second fresh take is a new version of it (the same text: as it is).
    const muse = plan.note!.muse;
    t2.conv.brains.push(muse);
    t2.conv.messages.splice(-1, 0, plan.note!.message);
    plan = planRegenerate(t2.conv, { thought: "Second idea." }, DEEPSEEK);
    assert.deepEqual([plan.note!.isNew, plan.note!.museCreated, plan.note!.version, plan.note!.message.id], [false, false, 1, t2.conv.messages.at(-2)!.id]);
    assert.deepEqual(plan.body.messages.at(-1), framed("Second idea."), "the note's new version, in its place");
    assert.equal(plan.body.messages.filter((m) => m.content.includes("<!-- from: Muse -->")).length, 1, "one note, not two");
    assert.equal(t2.conv.messages.at(-2)!.versions.length, 1, "the plan changes nothing");
    plan = planRegenerate(t2.conv, { thought: NOTE }, DEEPSEEK);
    assert.deepEqual([plan.note!.same, plan.note!.version], [true, 0]);
    // Every other brain reads the note framed, at its place, after the next turn too.
    assert.deepEqual(buildRequest(t2.conv, t2.dice.id, { model: DEEPSEEK }).messages.at(-3), framed(NOTE));
    // The Muse's own note can't be taken afresh; an image brain called Muse is refused with what to do.
    t2.conv.messages.push(newMessage({ type: "brain", brainId: muse.id }, "text", { content: "A note.", source: "authored", createdAt: AT }));
    assert.throws(() => planRegenerate(t2.conv, { thought: "x" }, DEEPSEEK), { code: "bad_request", message: /Muse's own note/ });
    t2.conv.messages.pop();
    muse.kind = "image";
    assert.throws(() => planRegenerate(t2.conv, { thought: "x" }, DEEPSEEK), { code: "bad_brain", message: /Muse here is an image brain. Rename it/ });
    muse.kind = "text";

    // --wrap puts it in the thought template, {{brain}} the brain it is for; blank, or with a steer, is refused.
    assert.equal(
      planRegenerate(t2.conv, { thought: "Goblins.", wrap: true }, DEEPSEEK).thought,
      "```hidden\nAn idea for Game Master's next reply, which the player won't see:\n\nGoblins.\n```",
    );
    assert.throws(() => planRegenerate(t2.conv, { thought: " \n " }, DEEPSEEK), { code: "bad_request", message: /thought can't be blank/ });
    assert.throws(() => planRegenerate(t2.conv, { thought: "x", steer: "y" }, DEEPSEEK), { code: "bad_request", message: /not both/ });
    assert.throws(() => planRegenerate(t2.conv, { wrap: true }, DEEPSEEK), { code: "bad_request" });
    t2.conv.templates.thought = "no marker";
    assert.throws(() => planRegenerate(t2.conv, { thought: "x", wrap: true }, DEEPSEEK), { code: "bad_template", message: /thought template has no \{\{thought\}\}/ });
    assert.ok(planRegenerate(t2.conv, { thought: "x" }, DEEPSEEK), "without --wrap the template isn't used");
    void gm;
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

describe("pinned messages (T16): a live link, sent right after the setup to the brain it is pinned to", () => {
  test("ledger (the default): exactly as at its place, moved up, and not sent twice; every other brain sees it where it is", () => {
    const { conv, gm, dice, img } = table();
    const sheet = conv.messages[2]!; // the Dice Master's "Roll: 17."
    gm.pins = [
      { messageId: img.id, as: "ledger" },
      { messageId: sheet.id, as: "ledger" }, // pinned second, sent first: ledger order
    ];
    const { body, pinned } = assembleRequest(conv, gm.id, { model: DEEPSEEK });
    assert.deepEqual(body.messages, [
      { role: "system", content: "You are the GM." },
      BIBLE,
      user("<!-- from: Dice Master -->\nRoll: 17."),
      PAINTED,
      assistant("A hooded figure waits."),
      user("<!-- from: the user -->\nI approach."),
      user("<!-- from: the user -->\nI sit down."),
      assistant("The figure nods."),
    ]);
    assert.deepEqual(pinned, [
      { index: 2, messageId: sheet.id, as: "ledger" },
      { index: 3, messageId: img.id, as: "ledger" },
    ]);
    assert.deepEqual(buildRequest(conv, gm.id, { model: DEEPSEEK }), body, "buildRequest is the same body");
    // The Dice Master has no pins: its own line is its own assistant words, at its place.
    const theirs = buildRequest(conv, dice.id, { model: DEEPSEEK }).messages;
    assert.deepEqual(theirs[4], assistant("Roll: 17."));
    assert.equal(theirs.filter((m) => m.content === "Roll: 17.").length, 1);
  });

  test("system and assistant send the text verbatim with that role; the brain's own image call stays a call", () => {
    const { conv, gm, painter, img } = table();
    const opener = conv.messages[0]!;
    painter.pins = [
      { messageId: opener.id, as: "system" },
      { messageId: conv.messages[1]!.id, as: "assistant" },
      { messageId: img.id, as: "assistant" }, // its own image: sent as the call it made, whatever `as` says
    ];
    const m = buildRequest(conv, painter.id, { model: DEEPSEEK }).messages;
    assert.deepEqual(m.slice(0, 6), [
      { role: "system", content: "You paint scenes." },
      BIBLE,
      { role: "system", content: "A hooded figure waits." }, // no framing: the text as it is
      assistant("I approach."),
      { role: "assistant", content: "", tool_calls: [{ id: `call_${img.id}`, type: "function", function: { name: "generate_image", arguments: JSON.stringify({ prompt: "A hooded figure in a candle-lit tavern" }) } }] },
      { role: "tool", tool_call_id: `call_${img.id}`, content: "It is on screen." },
    ]);
    assert.equal(m.filter((x) => x.content === "A hooded figure waits." || x.content === "I approach.").length, 2, "not again at their place");
  });

  test("a live link: the active version as it stands, an edit, another version; a regenerate leaves its message out here too", () => {
    const { conv, dice, last } = table();
    dice.pins = [{ messageId: last.id, as: "ledger" }];
    const pinnedText = () => buildRequest(conv, dice.id, { model: DEEPSEEK }).messages[2]!.content;
    assert.equal(pinnedText(), "<!-- from: Game Master -->\nThe figure nods.");
    last.activeVersion = 0;
    assert.equal(pinnedText(), "<!-- from: Game Master -->\nOLD-VERSION");
    last.versions[0]!.content = "EDITED";
    assert.equal(pinnedText(), "<!-- from: Game Master -->\nEDITED");
    // The Game Master re-rolls its last message: pinned to it, it is left out of its own re-roll entirely.
    const gm = conv.brains[0]!;
    gm.pins = [{ messageId: last.id, as: "ledger" }];
    const reroll = planRegenerate(conv, {}, DEEPSEEK);
    assert.ok(!reroll.body.messages.some((m) => m.content === "EDITED"));
    assert.deepEqual(reroll.pinned, []);
    // A steer revises it in place, right before the steer, even though it is pinned to its own brain.
    const steered = planRegenerate(conv, { steer: "Shorter." }, DEEPSEEK).body.messages;
    assert.deepEqual(steered.at(-2), assistant("EDITED"));
    assert.equal(steered.filter((m) => m.content === "EDITED").length, 1);
  });

  test("a blank text pinned as system or assistant is skipped, as a blank setup message is; the payload view says what is pinned", () => {
    const { conv, gm } = table();
    const empty = newMessage({ type: "brain", brainId: conv.brains[1]!.id }, "text", { content: "  ", source: "generated", createdAt: AT });
    conv.messages.splice(1, 0, empty);
    gm.pins = [{ messageId: empty.id, as: "system" }, { messageId: conv.messages[3]!.id, as: "ledger" }];
    const plan = planTurn(conv, { content: "Hello" }, DEEPSEEK);
    assert.equal(plan.body.messages.filter((m) => m.role === "system").length, 1);
    assert.deepEqual(plan.pinned.map((p) => p.messageId), [conv.messages[3]!.id]);
    assert.ok(plan.notes.some((n) => n.startsWith(`Pinned to Game Master: ${conv.messages[3]!.id} (Dice Master's), as it appears in the ledger`)), plan.notes.join("\n"));
  });
});
