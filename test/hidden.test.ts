import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { run } from "../src/cli/main.ts";
import {
  couldOpenHidden,
  createHiddenFolder,
  findHidden,
  foldHidden,
  hiddenSummary,
  isAllHidden,
  isHiddenInfo,
  splitHidden,
} from "../src/conversations/hidden.ts";
import type { ChatRequest, Conversation } from "../src/conversations/types.ts";
import { createUser } from "../src/storage/users.ts";
import { startTestServer } from "./helpers.ts";

/**
 * T08: hidden notes. A ```hidden fenced block is ordinary ledger text that every brain reads, folded to one line
 * in the CLI's human output (and, in the frontend pass, the scrollback). src/conversations/hidden.ts is the one
 * rule both clients use.
 */

const fold = (s: string) => foldHidden(s).text;
const bodies = (s: string) => findHidden(s).map((b) => b.body);

describe("the hidden-note rule", () => {
  test("a note in the middle: folded to one line that says how big it is, never a word of it (its label included)", () => {
    const text = "The figure nods.\n\n```hidden character sheet\nName: Mara\nSecret: a forger\n```\n\nShe waits.";
    assert.equal(fold(text), "The figure nods.\n\n[Hidden · 2 lines]\n\nShe waits.");
    assert.deepEqual(findHidden(text).map(({ label, body, lines, closed, open, prefix }) => ({ label, body, lines, closed, open, prefix })), [
      { label: "character sheet", body: "Name: Mara\nSecret: a forger", lines: 2, closed: true, open: false, prefix: "" },
    ]);
    // Live, a model labelled a sheet with a name the player hadn't learned yet: the fold never shows the label.
    assert.equal(fold("```hidden Sheet: Sera Vane\nSecret: a smuggler\n```"), "[Hidden · 1 line]");
    // The segments put the text back together exactly.
    assert.equal(splitHidden(text).map((s) => (s.type === "text" ? s.text : text.slice(s.block.start, s.block.end))).join(""), text);
  });

  test("a note that is the whole message", () => {
    const text = "```hidden\nName: Mara\nWants: the map\nFears: her brother\n```";
    assert.equal(fold(text), "[Hidden · 3 lines]");
    assert.equal(isAllHidden(text), true);
    assert.equal(isAllHidden(`${text}\n\n`), true, "blank lines around it don't count as text");
    assert.equal(isAllHidden(`Hi.\n${text}`), false);
    assert.equal(isAllHidden("Hi."), false);
  });

  test("unclosed: it runs to the end of the message (a reply still streaming looks like this)", () => {
    assert.equal(fold("Before.\n```hidden\nline 1\nline 2\n\n"), "Before.\n[Hidden · 2 lines]\n\n");
    const [b] = findHidden("Before.\n```hidden\nline 1\nline 2");
    assert.equal(b!.closed, false);
    assert.equal(b!.open, true);
    assert.equal(fold("```hidden"), "[Hidden · empty]", "just the opening fence");
    assert.equal(fold("```hidden\n```js\ncode"), "[Hidden · 2 lines]", "an unclosed code block inside an unclosed note");
  });

  test("two notes in one message, any fence: backticks, tildes, longer fences, any case", () => {
    const text = "```hidden\na\n```\nbetween\n~~~HIDDEN plans\nb1\nb2\n~~~\nand\n````Hidden\nc\n````";
    assert.equal(fold(text), "[Hidden · 1 line]\nbetween\n[Hidden · 2 lines]\nand\n[Hidden · 1 line]");
    assert.deepEqual(bodies(text), ["a", "b1\nb2", "c"]);
  });

  test("inside a list or a quote: folded in place, and it ends with its list item or quote, as in Markdown", () => {
    assert.equal(fold("1. Plans\n   ```hidden\n   secret\n   ```\n2. Next"), "1. Plans\n   [Hidden · 1 line]\n2. Next");
    assert.equal(fold("- ```hidden\n  secret\n\n  more\n  ```\n- next"), "- [Hidden · 3 lines]\n- next");
    assert.deepEqual(bodies("- ```hidden\n  secret\n\n  more\n  ```"), ["secret\n\nmore"], "the list indentation isn't part of the note");
    assert.equal(fold("> She says:\n> ```hidden\n> secret\n> ```\n> And leaves."), "> She says:\n> [Hidden · 1 line]\n> And leaves.");
    assert.deepEqual(bodies("> ```hidden\n> secret\n>\n> more\n> ```"), ["secret\n\nmore"]);
    // Unclosed, it ends where its quote or list item does; what follows is shown.
    assert.equal(fold("> ```hidden\n> secret\nOutside the quote."), "> [Hidden · 1 line]\nOutside the quote.");
    assert.equal(fold("- ```hidden\n  secret\nNot in the item."), "- [Hidden · 1 line]\nNot in the item.");
    assert.equal(fold("> - ```hidden\n>   deep\n> - next"), "> - [Hidden · 1 line]\n> - next", "a list in a quote");
  });

  test("code inside a note: a fence with a language nests; a longer or tilde outer fence works as in Markdown", () => {
    const nested = "```hidden\nName: Mara\n```js\nforge()\n```\nSecret: Y\n```\nafter";
    assert.equal(fold(nested), "[Hidden · 5 lines]\nafter", "the note doesn't end at the inner block's closing fence");
    assert.equal(fold("````hidden\n```\nraw\n```\n````\nafter"), "[Hidden · 3 lines]\nafter");
    assert.equal(fold("~~~hidden\n```\nraw\n```\n~~~\nafter"), "[Hidden · 3 lines]\nafter");
    // A bare ``` closes the note, as in Markdown (it can't be told from a closing fence).
    assert.equal(fold("```hidden\nsecret\n```\nshown"), "[Hidden · 1 line]\nshown");
  });

  test("what isn't a note: another word, inside another code block, mid-line, backticks in the info, too short", () => {
    for (const text of [
      "```hidden-notes\nshown\n```",
      "```hiddenx\nshown\n```",
      "```js hidden\nshown\n```",
      "````md\n```hidden\nan example of the convention\n```\n````",
      "~~~\n```hidden\nshown\n~~~",
      "Write ```hidden blocks for notes.",
      "```hidden`\nshown",
      "``hidden\nshown\n``",
    ]) {
      assert.deepEqual(findHidden(text), [], text);
      assert.equal(fold(text), text);
    }
    assert.equal(fold("````md\n```hidden\nexample\n```\n````\n```hidden\nreal\n```"), "````md\n```hidden\nexample\n```\n````\n[Hidden · 1 line]");
  });

  test("Windows line endings, indentation, and a closing fence indented too far", () => {
    assert.equal(fold("```hidden\r\nsecret\r\n```\r\nshown"), "[Hidden · 1 line]\r\nshown");
    assert.equal(fold("   ```hidden\n   secret\n   ```"), "   [Hidden · 1 line]");
    assert.equal(fold("```hidden\nsecret\n    ```\nstill hidden"), "[Hidden · 3 lines]", "4 spaces in is note text, not a fence");
  });

  test("isHiddenInfo (a Markdown code node's lang) and the summary's words", () => {
    assert.equal(isHiddenInfo("hidden"), true);
    assert.equal(isHiddenInfo("HIDDEN"), true);
    assert.equal(isHiddenInfo(" Hidden character sheet"), true);
    assert.equal(isHiddenInfo("hidden-notes"), false);
    assert.equal(isHiddenInfo(null), false);
    assert.equal(hiddenSummary({ lines: 1 }), "Hidden · 1 line");
    assert.equal(hiddenSummary({ lines: 14 }), "Hidden · 14 lines");
    assert.equal(hiddenSummary({ lines: 0 }), "Hidden · empty");
    assert.equal(hiddenSummary({ lines: 3 }, { writing: true }), "Hidden · 3 lines so far");
    assert.equal(hiddenSummary({ lines: 0 }, { writing: true }), "Hidden · being written");
  });
});

describe("folding a reply as it streams", () => {
  const corpus = [
    "MOCK reply\n\n```hidden character sheet\nName: Mara\nSecret: SECRET1\n```\n\nThe figure leans back.",
    "```hidden\nSECRET2 all of it\n```",
    "Before.\n```hidden\nSECRET3 still being written",
    "1. Plans\n   ```hidden\n   SECRET4\n   ```\n2. Next\n> ```hidden\n> SECRET5\nOutside.",
    "```js\nconst x = 1;\n```\n~~~hidden\n```py\nSECRET6\n```\n~~~\nAfter ``` and ~~~ and `code`.",
    "- ```hidden\n  SECRET7\nNot in the item.\n``\n```\nplain code\n```",
    "Text with no notes at all, and a ```hidden mid-line.\n12 apples\n1. item\n``` \n",
  ];
  const secrets = /SECRET\d/;

  /** Feed `pieces` through a folder and check every step: no secret ever printed, and the whole equals foldHidden. */
  const check = (text: string, pieces: string[]) => {
    const f = createHiddenFolder();
    let out = "";
    for (const p of pieces) {
      out += f.push(p);
      assert.doesNotMatch(out, secrets, `printed a secret mid-stream: ${JSON.stringify(pieces)}`);
    }
    out += f.end();
    assert.equal(out, fold(text), `split ${JSON.stringify(pieces)}`);
    assert.equal(f.folded, findHidden(text).length);
  };

  test("every split of each reply, one character at a time and at every single cut, prints exactly the fold", () => {
    for (const text of corpus) {
      check(text, [...text]);
      for (let i = 0; i <= text.length; i++) check(text, [text.slice(0, i), text.slice(i)]);
    }
  });

  test("random splits", () => {
    let seed = 8;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n) + 1;
    for (const text of corpus) {
      for (let round = 0; round < 200; round++) {
        const pieces: string[] = [];
        for (let i = 0; i < text.length; ) {
          const n = rand(7);
          pieces.push(text.slice(i, i + n));
          i += n;
        }
        check(text, pieces);
      }
    }
  });

  test("ordinary text streams as it arrives; only a line that could still open a note is held", () => {
    const f = createHiddenFolder();
    assert.equal(f.push("The fig"), "The fig");
    assert.equal(f.push("ure.\n``"), "ure.\n");
    assert.equal(f.push("`hid"), "");
    assert.equal(f.push("den\n"), "");
    assert.equal(f.writing?.lines, 0, "the opening line is complete, so a note is being written");
    assert.equal(f.push("Name"), "");
    assert.equal(f.writing?.lines, 1, "a line on its way counts");
    assert.equal(f.push(": Mara\n"), "");
    assert.equal(f.writing?.lines, 1);
    assert.equal(f.push("```\nSo"), "[Hidden · 1 line]\nSo");
    assert.equal(f.writing, null);
    assert.equal(f.push("```js"), "```js", "can't become a note any more, so it prints");
    assert.equal(f.end(), "");
  });

  test("couldOpenHidden holds every beginning of an opening line, and lets the rest go", () => {
    for (const opener of ["```hidden", "~~~~HIDDEN character sheet", "> ```hidden", "  - ```hidden x", "12) ```hidden", ">> ~~~hidden"]) {
      for (let i = 0; i <= opener.length; i++) assert.equal(couldOpenHidden(opener.slice(0, i)), true, JSON.stringify(opener.slice(0, i)));
    }
    for (const no of ["The", "``x", "```js", "```hiddenx", "- item", "12 apples", "**bold", "~~strike", "```hidden`"]) {
      assert.equal(couldOpenHidden(no), false, no);
    }
  });
});

describe("hidden notes end to end, against the mock (T08)", () => {
  let t: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    t = await startTestServer();
    await createUser(t.config.dataDir, "dev-t08", "", { N: 2 ** 10, r: 8, p: 1 });
  });
  after(() => t.close());

  const ok = async (argv: string[]) => {
    const r = await t.cli(argv);
    assert.equal(r.code, 0, `${argv.join(" ")}\n${r.stderr}`);
    return r;
  };
  const json = async (argv: string[]) => JSON.parse((await ok([...argv, "--json"])).stdout);
  const SECRET = /MOCK_SECRET/;

  test("a streamed reply, conversation.get and message.get fold the note; --reveal and --json show it; every brain gets it verbatim", async () => {
    await ok(["auth.login", "--username", "dev-t08", "--password", ""]);
    const conv = (await json(["conversation.create", "--system-prompt", "You are the GM."])) as Conversation;
    const c = ["--conversation", conv.id];
    await ok(["brain.add", ...c, "--name", "Character Creator", "--system-prompt", "You write character sheets.", "--no-final-reminder.enabled"]);

    // The streaming turn prints the marker, never the note, though its fences arrive in 3-character pieces.
    const turn = await ok(["turn", ...c, "--content", "Who is the hooded figure? MOCK_HIDDEN"]);
    assert.doesNotMatch(turn.stdout, SECRET);
    assert.match(turn.stdout, /^MOCK reply[^\n]*\n\n\[Hidden · 5 lines\]\n\nThe hooded figure slides a folded map across the table\.\n$/);
    const saved = (await json(["conversation.get", "--id", conv.id])) as Conversation;
    const reply = saved.messages[1]!;
    assert.match(reply.versions[0]!.content, /```hidden character sheet\n[^]*MOCK_SECRET[^]*\n```/, "the ledger has the raw text");
    assert.match(turn.stderr, new RegExp(`1 hidden note folded: \\./ss message\\.get --conversation ${conv.id} --message ${reply.id} --reveal shows it`));
    assert.match((await ok(["turn", ...c, "--content", "MOCK_HIDDEN", "--reveal"])).stdout, SECRET, "turn --reveal streams it as it comes");

    // conversation.get: folded, with how to see it. --reveal shows it, --json is the raw text.
    const get = await ok(["conversation.get", "--id", conv.id]);
    assert.doesNotMatch(get.stdout, SECRET);
    assert.match(get.stdout, /\[Hidden · 5 lines\]/);
    assert.match(get.stdout, /2 hidden notes folded: \.\/ss conversation\.get --id c_\w+ --reveal shows them/);
    const revealed = await ok(["conversation.get", "--id", conv.id, "--reveal"]);
    assert.match(revealed.stdout, /```hidden character sheet\n[^]*MOCK_SECRET/);
    assert.doesNotMatch(revealed.stdout, /hidden notes? folded/);
    assert.match((await ok(["conversation.get", "--id", conv.id, "--json"])).stdout, SECRET);

    // message.get likewise, for every version.
    const one = await ok(["message.get", ...c, "--message", reply.id]);
    assert.doesNotMatch(one.stdout, SECRET);
    assert.match(one.stdout, /\[Hidden · 5 lines\]/);
    assert.match((await ok(["message.get", ...c, "--message", reply.id, "--reveal"])).stdout, SECRET);

    // Every brain reads it word for word, framed as usual; the payload view is never folded.
    const preview = await json(["prompt.preview", ...c, "--brain", "Character Creator"]);
    const framed = (preview.body as ChatRequest).messages.find((m) => m.content.includes("MOCK_SECRET"));
    assert.equal(framed?.role, "user");
    assert.equal(framed?.content, `<!-- from: ${saved.brains[0]!.name} -->\n${reply.versions[0]!.content}`);
    assert.match((await ok(["prompt.preview", ...c, "--brain", "Character Creator"])).stdout, SECRET);
    // And what the brain was sent is exactly that.
    await ok(["turn", ...c, "--brain", "Character Creator"]);
    const sent = t.mock.state.requests.find((r) => r.path === "/chat/completions")!.body as ChatRequest;
    assert.deepEqual(sent, preview.body);
  });

  test("a reply that is all hidden, and a note cut off by max_tokens", async () => {
    await ok(["auth.login", "--username", "dev-t08", "--password", ""]);
    const conv = (await json(["conversation.create", "--system-prompt", "You write character sheets."])) as Conversation;
    const c = ["--conversation", conv.id];
    const only = await ok(["turn", ...c, "--content", "MOCK_HIDDEN_ONLY"]);
    assert.equal(only.stdout, "[Hidden · 6 lines]\n");
    const content = ((await json(["conversation.get", "--id", conv.id])) as Conversation).messages[1]!.versions[0]!.content;
    assert.equal(isAllHidden(content), true);
    assert.match(content, /^```hidden character sheet\nMOCK reply to brain/, "the echo line is inside the note");

    // Cut mid-note: the reply ends inside an unclosed note, which runs to the end of the message.
    await ok(["conversation.update", "--id", conv.id, "--settings.max-tokens", "60"]);
    const cut = await ok(["turn", ...c, "--content", "MOCK_HIDDEN"]);
    assert.doesNotMatch(cut.stdout, SECRET);
    assert.match(cut.stdout, /\[Hidden · \d lines?\]\n$/);
    assert.match(cut.stderr, /cut off by max_tokens/);
  });

  test("message.regenerate and generation.follow fold too; select-version's text view folds", async () => {
    await ok(["auth.login", "--username", "dev-t08", "--password", ""]);
    const conv = (await json(["conversation.create", "--system-prompt", "You are the GM."])) as Conversation;
    const c = ["--conversation", conv.id];
    await ok(["turn", ...c, "--content", "plain"]);
    // A steer that names a trigger: the mock reads the last message, which is the rendered steer.
    const regen = await ok(["message.regenerate", ...c, "--steer", "MOCK_HIDDEN"]);
    assert.doesNotMatch(regen.stdout, SECRET);
    assert.match(regen.stdout, /\[Hidden · 5 lines\]/);
    const id = ((await json(["conversation.get", "--id", conv.id])) as Conversation).messages[1]!.id;
    const sel = await ok(["message.select-version", ...c, "--message", id, "--version", "2"]);
    assert.doesNotMatch(sel.stdout, SECRET);
    assert.match(sel.stdout, /1 hidden note folded/);

    // A follower that joins mid-note gets the merged text so far (fences and all) in one delta: still folded.
    const cookie = `ss_session=${JSON.parse(await (await import("node:fs/promises")).readFile(`${t.config.runDir}/cli-session.json`, "utf8")).token}`;
    const res = await t.app.fetch(
      new Request("http://localhost/api/turn", {
        method: "POST",
        headers: { host: "localhost", "content-type": "application/json", cookie },
        body: JSON.stringify({ conversation: conv.id, content: "MOCK_SLOW MOCK_HIDDEN" }),
      }),
    );
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let seen = "";
    const replied = () => [...seen.matchAll(/"type":"delta","delta":("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]!)).join("");
    while (!replied().includes("Looks")) seen += (await reader.read()).value ?? ""; // well inside the note
    const followed = await ok(["generation.follow", ...c]);
    while (!(await reader.read()).done);
    assert.match(followed.stderr, /following a reply in progress/);
    assert.doesNotMatch(followed.stdout, SECRET);
    assert.match(followed.stdout, /\[Hidden · 5 lines\]\n\nThe hooded figure/);
  });

  test("on a terminal, a line counts the note's lines while it is written, then the marker takes its place", async () => {
    await ok(["auth.login", "--username", "dev-t08", "--password", ""]);
    const conv = (await json(["conversation.create", "--system-prompt", "You write character sheets."])) as Conversation;
    let stdout = "";
    let stderr = "";
    const code = await run(["turn", "--conversation", conv.id, "--content", "MOCK_HIDDEN_ONLY"], {
      env: { SS_URL: t.url, SS_RUN_DIR: t.config.runDir },
      cwd: t.tmp,
      stdout: { write: (s) => void (stdout += String(s)), isTTY: true },
      stderr: { write: (s) => void (stderr += s), isTTY: false },
      stdinIsTTY: false,
      readStdin: async () => "",
      promptSecret: async () => "",
    });
    assert.equal(code, 0, stderr);
    assert.doesNotMatch(stdout, SECRET);
    assert.match(stdout, /\[Hidden · 3 lines so far\]/);
    const shown = stdout.split("\r\x1b[K").at(-1)!; // what stays on screen after the last wipe
    assert.equal(shown, "\x1b[2m[Hidden · 6 lines]\x1b[0m\n");
  });
});
