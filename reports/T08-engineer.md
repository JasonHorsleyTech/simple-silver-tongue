# T08 engineer: hidden notes

**Result:** brains (and the player) can keep notes in a ```` ```hidden ```` block. Every brain reads the note verbatim. The terminal folds it to one line, `[Hidden · 11 lines]`, in `conversation.get`, `message.get`, `message.select-version` and every streamed reply. A fence split across deltas never flashes a word. `--reveal` shows everything, and `--json` is always raw. Live, `deepseek-v4-1-flash` used the convention on the first try, for a GM's plans and for a Character Creator's whole reply. `npm run typecheck` is clean, and `npm test` passes 161/161: 17 of those are new in `test/hidden.test.ts`, and `test/cli-args.test.ts` has one new assertion.

No DESIGN CONCERN. I made three of the ticket's open calls, listed below. One of them, not showing the label, was decided by live evidence.

## What I built

- **The rule, `src/conversations/hidden.ts`.** It is dependency-free, and `web/src/api/types.ts` re-exports it, so the web typecheck already compiles it. It is a line scanner for Markdown's fenced code blocks, plus one forgiving extra:
  - **Opens** on a fence of three or more backticks or tildes followed by the word `hidden`, in any case. Quote markers, list markers and indentation may come before the fence.
  - **Doesn't open** inside another code block, so an example of the convention in a ```` ````md ```` block stays an example. `hidden-notes` and a fence that starts mid-line don't count either.
  - **Closes** on the same fence character, at least as many of them, with nothing else on the line.
  - **Unclosed:** it runs to the end of the message, or to the end of the quote or list item it opened in, as Markdown does. A reply still streaming into a note looks exactly like this.
  - **The extra:** a fence with a language after it (```` ```js ````) *inside* a note nests, so the note's own closing fence counts only after that inner block has closed. Plain Markdown would end the note at the inner block's bare closing fence and show the rest, which would spill the note.
  - **API:** `splitHidden`, `findHidden`, `foldHidden`, `isAllHidden`, `isHiddenInfo`, `hiddenSummary` (the fold's words, shared by both clients), `createHiddenFolder` (for streams) and `couldOpenHidden`.
- **Folding in the CLI's text views.** A JSON command's `format` now gets `(result, {reveal})`. `./sst --reveal` sends the header `x-sst-reveal: 1`, and the HTTP adapter passes it on to `format`. `shown()` in `format.ts` folds one text message; image prompts are plain captions, so they are never folded. Each view ends with a line saying how to see what it folded: `(2 hidden notes folded: ./sst conversation.get --id c_… --reveal shows them; --json has the raw text.)`.
- **Folding in streams.** `printStream` (`src/cli/main.ts`) runs every `delta` through `createHiddenFolder`:
  - Text prints as it arrives.
  - An unfinished line that could still become an opening fence is held back until its next character or its newline. Examples are `"``"`, `"> ```hid"` and a bare `"- "`.
  - From an opening fence on, nothing prints until the note closes and its marker prints.
  - On a terminal, a dim `[Hidden · 3 lines so far]` line counts up meanwhile, and the marker replaces it.
  - Once the reply is done, stderr names the `message.get … --reveal` that shows the note.
  - A broken stream or a stop still prints the marker.
  - `--reveal` streams the reply as it comes.
- **Mock triggers.**
  - `MOCK_HIDDEN`: the echo line, then a made-up character sheet in a ```` ```hidden character sheet ```` block with `MOCK_SECRET` in it, then a visible line.
  - `MOCK_HIDDEN_ONLY`: one note and nothing else, with the echo line inside it. This is the Character Creator's shape.
  - Both stream in 3-character pieces, so the fences really do arrive split.
- **Docs.** design.md has a new "Hidden notes (T08)" section covering the convention, why the note is folded rather than hidden, that every brain sees it, the rule, the terminal, a recipe for the browser, and the live check. It also has notes under "Writing a command", the HTTP contract and "Mock Venice". README has a terminal paragraph. AGENTS.md has a "Running it" line and a lesson. TICKETS.md has the status `qa` and notes for Frontend and T10.

## Commands added or changed

No new commands.
- **Global CLI flag `--reveal`:** shows hidden notes. It applies to the text views and to streams, and `./sst help` lists it.
- **`conversation.get`, `message.get` and `message.select-version`:** their text views fold notes.
- **`turn`, `message.regenerate` and `generation.follow`:** fold notes as they stream.
- **Registry:** `format(result, opts: FormatOpts)`.
- **Reserved arg names:** `reveal` and `open` are now on the list in design.md.

## Engineer's calls (the ticket left these open)

| Question | Call | Why |
|---|---|---|
| Does `~~~hidden` count? | **Yes.** So do longer fences and any case. | It is Markdown's other fence, and a model may well write it. Nothing is gained by refusing it. |
| Is the label after the word shown on the fold? | **No.** The fold says only `Hidden · N lines`. The label stays part of the note, so the brains read it and opening the note shows it. | I tested it live. I told the Character Creator: "The label is shown to the player, so never put a secret in it." It labelled its sheet `Sheet: Sera Vane`, a name the player hadn't learned yet (the GM's own note had just invented it). A model can't be trusted to judge what the player knows, and a fold that never shows a word can't spoil anything. |
| What does a note that needs a code fence do? | **A fence with a language just works inside it (it nests).** A bare ```` ``` ```` closes the note, so for one of those use ```` ````hidden ```` or `~~~hidden`, as in Markdown. | A model writing code inside a note will almost always put a language on it. Plain Markdown would end the note at that block's closing fence and show the rest. A bare fence can't be told apart from a closing fence, so it closes the note. |
| Inside a list or a quote? | **It is still a note.** It is folded in place (`> [Hidden · 1 line]`, `- [Hidden · 1 line]`), and an unclosed one ends with its quote or list item, as in Markdown. | A GM's plan list is a likely place for a note. The marker keeps its prefix, so the terminal output still reads as the same list or quote. |
| How big is "how big"? | **Lines, blank lines included** (`Hidden · 11 lines`, `Hidden · empty`). While a reply is still writing the note: `Hidden · 3 lines so far`, or `Hidden · being written` before its first line. | These match the raw text and the editor. They are shared words (`hiddenSummary`), so the browser's bar will say the same. |

**For the browser** (also in TICKETS.md and design.md): render each message from `splitHidden(content)`. Text parts are Markdown, and each note is the bar, with its body rendered only once opened. The note's words then never reach the renderer, mid-stream included, and the browser folds exactly what the terminal folds. A code node that `isHiddenInfo` recognises makes a cheap backstop. The other approach, folding remark's `code` nodes with `lang === "hidden"`, would place the bar more neatly inside lists. It would also disagree with the terminal in edge cases (nested fences, unclosed notes in lists), so I don't recommend it.

## Tests (`test/hidden.test.ts`, 17 tests)

- **The rule's edge cases:**
  - a note in the middle, whose label never shows;
  - a note that is the whole message, and `isAllHidden`;
  - unclosed at the end, and just the opening fence;
  - two or three notes in one message, with backticks, tildes, longer fences and mixed case;
  - inside a list (continuation lines, and a marker on the fence line), inside a quote, a list inside a quote, and unclosed in both;
  - code nested inside a note, plus longer and tilde outer fences;
  - what isn't a note: another word, inside a code block, mid-line, a backtick in the info string, a fence that is too short;
  - CRLF line endings, indentation, and a closing fence indented too far;
  - `isHiddenInfo` and the summary's words.
- **Streaming:** each of 7 replies in a corpus goes through the folder in three ways: one character at a time, at every single cut, and on 200 random splits each. At every step no secret may have been printed. At the end, the joined output must equal `foldHidden(the whole reply)`. A step-by-step test checks what is printed when, and every prefix of an opening line must be held.
- **End to end against the mock:**
  - A streamed `turn` prints the marker and the reveal hint.
  - `turn --reveal` streams the note.
  - `conversation.get` folds the note, `--reveal` shows it, and `--json` is raw.
  - `message.get` folds it.
  - Another brain's `prompt.preview` has the note verbatim, framed (`<!-- from: … -->`), and equals what the mock then received.
  - `MOCK_HIDDEN_ONLY` gives exactly `[Hidden · 6 lines]`.
  - A note cut off by `max_tokens` is folded.
  - `message.regenerate` and `message.select-version` fold.
  - `generation.follow` joining mid-note folds.
  - On a TTY, the count line appears, and the marker replaces it.

## Terminal transcript (trimmed)

### Mock (`npm run up:mock`, user `dev-t08-mock`, plaintext, now deleted)

```
$ ./sst brain.add --conversation $C --name "Character Creator" --system-prompt "You write character sheets as hidden notes." --no-final-reminder.enabled
Added brain Character Creator (b_1k7l6rgzw8) · text · reasoning off · final reminder off · stops at "<!-- from:"

$ ./sst turn --conversation $C --content "Who is the hooded figure? MOCK_HIDDEN"        # streams in 3-char pieces
[Assistant]
MOCK reply to brain "You are the Game Master."; saw 2 messages; last: "<!-- from: the user --> Who is…he hooded figure? MOCK_HIDDEN"

[Hidden · character sheet · 5 lines]          ← (label shown here at the time; the fold no longer shows labels: see below)

The hooded figure slides a folded map across the table.
[Assistant · 23 in / 126 out · $0.00016]
(1 hidden note folded: ./sst message.get --conversation c_7vs6xx88fz --message m_evi9mz5b35 --reveal shows it; --json has the raw text.)

$ ./sst turn --conversation $C --brain "Character Creator" --content "MOCK_HIDDEN_ONLY"
[Character Creator]
[Hidden · character sheet · 6 lines]
[Character Creator · 170 in / 108 out · $0.00018]
(1 hidden note folded: ./sst message.get --conversation c_7vs6xx88fz --message m_tb4cb3rd5v --reveal shows it; --json has the raw text.)

$ ./sst conversation.get --id $C
── Assistant · m_evi9mz5b35 · $0.00016 ──
MOCK reply to brain "You are the Game Master."; ...

[Hidden · character sheet · 5 lines]

The hooded figure slides a folded map across the table.
...
── Character Creator · m_tb4cb3rd5v · $0.00018 ──
[Hidden · character sheet · 6 lines]

(2 hidden notes folded: ./sst conversation.get --id c_7vs6xx88fz --reveal shows them; --json has the raw text.)

$ ./sst conversation.get --id $C --reveal
...
```hidden character sheet
Name: Mara Vell, a mapmaker
...
Secret: MOCK_SECRET the map is a forgery, and she drew it herself
...
$ ./sst conversation.get --id $C --json | grep -c MOCK_SECRET
2

$ ./sst prompt.preview --conversation $C --brain Assistant --content "What does she want?"
── [4] user ──
<!-- from: Character Creator -->
```hidden character sheet
MOCK reply to brain "You write character sheets as "; saw 4 messages; ...
Name: Mara Vell, a mapmaker
...
Secret: MOCK_SECRET the map is a forgery, and she drew it herself
...

$ (./sst turn --conversation $C --content "MOCK_SLOW MOCK_HIDDEN" > /dev/null &); sleep 14; ./sst generation.follow --conversation $C
(following a reply in progress: what has streamed so far, then the rest live)
[Assistant]
MOCK reply to brain "You are the Game Master."; saw 8 messages; last: "<!-- from: the user --> MOCK_SLOW MOCK_HIDDEN"

[Hidden · character sheet · 5 lines]

The hooded figure slides a folded map across the table.
[Assistant · 420 in / 123 out · $0.00027]
(1 hidden note folded: ./sst message.get --conversation c_7vs6xx88fz --message m_nmurybq4ur --reveal shows it; --json has the raw text.)
```

### Live (`npm run up`, user `dev-t08-live`, plaintext, made-up content, now deleted)

The GM's system prompt (made up) asked for its private plans "in a hidden note, a fenced code block whose info string is the word hidden and a short label", and said the player's screen folds notes and every brain reads them. The Character Creator was told to "answer with nothing but one hidden note… with a short label naming who the sheet is about… The label is shown to the player, so never put a secret in it."

```
$ ./sst turn --conversation $C --content "I walk up to the hooded figure in the corner booth."
[Assistant]
[Hidden · GM plans · 1 line]
The hooded figure doesn't look up when you slide into the booth, but the hand beneath the cloak has already found
something with an edge. "You're not him," she says, low enough that the lute by the hearth drowns it out. ...
[Assistant · 157 in / 203 out · $0.00029]
(1 hidden note folded: ./sst message.get --conversation c_hibwiiu6k8 --message m_912jiuv1ax --reveal shows it; ...)

# raw: "```hidden GM plans\nThe hooded figure is Sera Vane, a courier for the Ashgrove smugglers; ...\n```\n\nThe hooded figure doesn't look up..."

$ ./sst turn --conversation $C --brain "Character Creator"
[Character Creator]
[Hidden · Sheet: Sera Vane · 11 lines]          ← the label spoils a name the player hasn't heard: hence no labels on the fold
[Character Creator · 356 in / 370 out · $0.00055]

# raw: one closed note and nothing else: "```hidden Sheet: Sera Vane\nName: Sera Vane, 34, courier ...\n\nLooks: ...\n\nWants: ...
#       \n\nKnows: ...\n\nSecret: ...\n\nFears: ...\n```"

# After the change (server restarted on current code, no API call):
$ ./sst conversation.get --id $C
── Assistant · m_912jiuv1ax · $0.00029 ──
[Hidden · 1 line]

The hooded figure doesn't look up when you slide into the booth, ...

── Character Creator · m_hdpl9o31kh · $0.00055 ──
[Hidden · 11 lines]

(2 hidden notes folded: ./sst conversation.get --id c_hibwiiu6k8 --reveal shows them; --json has the raw text.)

$ ./sst prompt.preview --conversation $C --content "What does she say next?" --json | jq -c '[.body.messages[]|[.role,(.content|split("\n")[0:2]|join(" ⏎ ")|.[0:90])]]'
[["system","You are the Game Master of a short fantasy scene in a village tavern. Narrate in the secon"],
 ["user","<!-- from: the user --> ⏎ I walk up to the hooded figure in the corner booth."],
 ["assistant","```hidden GM plans ⏎ The hooded figure is Sera Vane, a courier for the Ashgrove smugglers;"],
 ["user","<!-- from: Character Creator --> ⏎ ```hidden Sheet: Sera Vane"],
 ["user","<!-- from: the user --> ⏎ What does she say next?"]]
```

## Live spend

- Balance **$7.76508485 → $7.76424335**: **$0.00084** for **2 text calls**, no images.

## Known gaps

- **The browser doesn't fold yet.** Until the frontend pass, the scrollback shows a note as a code block labelled "hidden".
- **The scanner is Markdown-faithful only where it matters.** All of the cases below over-hide, never under-hide:
  - A fence indented on a list item's continuation line (`1. Plans` / `   ```hidden`) is treated as top-level, so an *unclosed* one runs to the end of the message rather than the end of the item.
  - `    ```hidden` indented four spaces at the top level is an indented code block in Markdown, but a note here.
  - Fences inside HTML blocks and footnote definitions aren't modelled.
  - Tabs as list indentation aren't modelled.
- **A bare ```` ``` ```` inside a note closes it.** That is unavoidable, since it is a closing fence. Prompts that teach the convention (T10) could say "use `~~~hidden` if the note has code in it", but models rarely put code in a sheet.
- **`setup.list` and `brain.list` never fold.** They show configuration as it is sent, so a secret Jason writes into the World Bible inside a hidden block shows there. This is by design.
- **The note is folded, not secret.** Every brain reads every note (accepted in T10), and `prompt.preview` and the payload view show it raw.
- **The terminal's counting line uses `\r`.** It is drawn only when stdout is a TTY. With stdout piped, the marker alone is printed when the note closes.

## design.md changes

- New section **"Hidden notes (T08)"**: the convention, folded vs hidden, every brain sees it, the rule (with the label and nested-code calls and why), the API, the terminal, the browser recipe, and the live check.
- **"Writing a command":** `format(result, {reveal})`, and `open`/`reveal` added to the reserved arg names.
- **HTTP contract:** `x-sst-reveal: 1`.
- **"Mock Venice":** `MOCK_HIDDEN` and `MOCK_HIDDEN_ONLY`.
