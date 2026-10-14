# T08 QA: Hidden notes

**Verdict:** Acceptance passes. 0 blockers, 0 majors, 2 minors (the scanner shows a note in a few Markdown shapes), 3 nits. No DESIGN CONCERN.

The core works. Every streamed path folded the note, with the fence split across deltas, when a follower joined mid-note, when the reply was stopped mid-note, when the stream broke mid-note, on a TTY, and on a regenerate, steered or not. A fuzzer found no leak and no mismatch in 23,000 random texts streamed under random splits. Every brain gets the note verbatim, and `prompt.preview` matches the request body that was sent byte for byte. Both findings are shapes of model output that the line scanner reads as "not a note" or "note over", so the secret shows. They are unusual shapes, and deepseek wrote clean top-level fences in both of my live calls, so neither one is major.

## How I ran it

- `npm run up:mock`, with a plaintext user `qa-t08-plain` and an encrypted user `qa-t08-enc`. Both are now deleted.
- `npm run typecheck` is clean, and `npm test` passes 161/161.
- I wrote scratch scripts outside the repo:
  - **A fuzzer over the rule and the stream folder.** It generated 23,000 random texts from fences (```` ``` ````, `~~~`, `````` ```` ``````, short fences), labels, other languages, quote and list prefixes, tabs, blank lines and CRLF. Each text was streamed through `createHiddenFolder` one character at a time and on random cuts.
  - **A Markdown oracle.** It parsed the same texts with the web's own `mdast-util-from-markdown` and GFM, then compared the result with `foldHidden`.
  - **A browser-recipe fuzzer.** It re-split every prefix of a text with `splitHidden`, as the frontend will do each frame.
- **Live: 2 text calls, no images.** The balance went from $7.76424335 to $7.76324315, so $0.0010. Both calls tested a Character Creator with reasoning on (QA-3).

## Acceptance checklist

| Bullet | Result | Evidence |
|---|---|---|
| Mock: `conversation.get` shows the marker | **pass** | The `MOCK_HIDDEN` reply shows the echo line, `[Hidden · 5 lines]` and then the visible line, followed by `(1 hidden note folded: ./ss conversation.get --id c_… --reveal shows it; --json has the raw text.)`. No `Mara`, `MOCK_SECRET` or `character sheet` appears. |
| `--reveal` and `--json` show the text | **pass** | `conversation.get --reveal`, `--reveal` placed before the command name, and `get --json` all show the full ```` ```hidden character sheet ```` block. |
| A streaming `turn` never prints it | **pass** | Stdout and stderr captured from `turn` contain 0 secret words. The same holds for `generation.follow` joining 14 s into a `MOCK_SLOW MOCK_HIDDEN` reply, and for `generation.stop` 16 s in (`[Hidden · 2 lines]`, exit 0, with the reveal hint). It also holds when `MOCK_MIDSTREAM_ERROR` breaks the stream mid-note (`[Hidden · 2 lines]`, then the error, exit 1), and for `message.regenerate`, plain and steered. It held for an image brain that answered in text (`MOCK_NO_TOOL_CALL MOCK_HIDDEN`). On a pseudo-TTY (`script -q`), the raw bytes are only the counting lines `[Hidden · 1 line so far]` … `[Hidden · 6 lines so far]` and then `[Hidden · 6 lines]`, with 0 secret bytes. `message.get` and `message.select-version` fold, and the reveal hint names the right message, also when `SS_CONVERSATION` fills in `--conversation`. |
| `prompt.preview --brain <another brain>` has the text verbatim, framed | **pass** | Character Actor's preview message `[2]` is `<!-- from: Assistant -->` followed by the stored content, character for character (`diff` with `get --json`). The preview body `cmp`s equal to the body the mock then received. |
| Unit tests cover the edge cases | **pass** | `test/hidden.test.ts` covers unclosed notes, notes in a list, in a quote and in a list inside a quote, two and three notes, a whole-message note, nested code, CRLF, what isn't a note, and streaming at every cut. |

Other checks that passed:
- **What isn't a note.** Ordinary code blocks, a bare "hidden" in prose, ```` ```hidden-notes ````, a mid-line fence and an example inside a ```` ````md ```` block are all left alone. (QA-2 covers the opposite: shapes that *should* fold and don't.)
- **No other output path prints notes.** I checked every command's `format`. `message.add`, `message.edit`, `generation.stop`, `conversation.import`/`clone` and `image.follow`/`image.retry` on a text message print no content. `prompt.preview`, `brain.list` and `setup.list` are raw by design (hard rule 1).
- **Disk and logs.** An encrypted user's files and `.run/server.log` and `.run/mock.log` contain no note text.
- **`--content --reveal`.** This is a usage error, as `--json` already is, and `--content=--reveal` works.
- **Restarts.** Notes still fold after a restart.
- **Speed.** The stream folder is quadratic, but a 128 KB note in 4-character deltas costs 4 s of CPU in total, so it doesn't matter.

**For the frontend:** the browser recipe (re-split the live text every frame, with no hold-back) is safe. Over 8,000 random texts, I checked every prefix, and no prefix's text parts ever held a word that the full text hides.

## Findings

### QA-1 · minor · The scanner shows a note in a few shapes that Markdown hides; the engineer's report says these gaps only over-hide

**Repro:**
```bash
node --input-type=module -e '
import { foldHidden } from "./src/conversations/hidden.ts";
for (const t of ["- ```hidden\n\tSECRET\n\t```", "    ```\n\n```hidden\nSECRET\n```",
  "Text[^1]\n\n[^1]: ```hidden\n    SECRET\n    ```", "```hidden\rSECRET\r```"])
  console.log(JSON.stringify(foldHidden(t).text));'
```
Through the CLI, `message.add --as player --content @tab.md` with `- ```hidden` / `\tSECRET the figure is Sera` / `` \t``` `` gives this in `conversation.get`:
```
- [Hidden · empty]
	SECRET-TAB the figure is Sera
```
The same happens with `@indent.md` (`    ```` an indented code line, then a normal ```` ```hidden ```` note): the note shows in full.

**Expected:** every case folds. The engineer's report and design.md say that tabs, 4-space indents and footnotes "over-hide, never under-hide".

**Actual:** the secret is printed in all four cases:
1. **A tab-indented body in a list item.** CommonMark counts a tab as up to 4 columns, so Markdown keeps `\tSECRET` inside the item's code block. The scanner counts only spaces, so the item ends and the note ends with it.
2. **A non-hidden fence indented 4+ spaces (or a tab) before a note.** Markdown reads it as an indented code line. The scanner opens a code block with it, and that block swallows the real ```` ```hidden ```` opener after it.
3. **A footnote definition.** `[^1]: ```hidden` is not a container to the scanner. remark-gfm parses it as a footnote with a `hidden` code block.
4. **Lone `\r` line endings.** The scanner splits only on `\n`.

**Why it matters beyond the terminal:** in cases 2 and 3, the browser's recommended backstop (fold any code node whose `lang` passes `isHiddenInfo`) would fold the note, because the whole message is one text part that remark parses. So the two clients would disagree, and the terminal would be the one that shows the secret. None of these shapes is likely from a model. The first two are the plausible ones.

**Cause:**
- `continueLine` counts spaces only (`/^ */…length < c`, `src/conversations/hidden.ts:332`), and `stripContainers` does the same.
- `FENCE` (`:282`) accepts any indentation for a non-hidden opener.
- `findHidden` splits only on `\n` (`:84`).
- No footnote container exists.

**Suggestion:**
- Expand tabs to the next multiple of 4 columns before counting.
- Don't treat a fence indented 4+ columns past its container as a *non-hidden* opener. Keeping the hidden opener there over-hides, which is safe.
- Treat a lone `\r` as a line ending.
- Optionally treat `[^x]: ` as a container prefix.
- Add the four cases to the test corpus.

### QA-2 · minor · Two "Markdown-faithful" rules spill a carelessly written note: a container that ends mid-note, and a backtick in the label

**Repro:**
```bash
node --input-type=module -e '
import { foldHidden } from "./src/conversations/hidden.ts";
for (const t of ["Plans:\n- ```hidden\nSECRET\n```\n- The tavern is loud.", "> ```hidden\nSECRET\n```",
  "> ```hidden\n\n> SECRET\n> ```", "```hidden sheet for `Sera`\nSECRET\n```\nThe figure waits."])
  console.log(JSON.stringify(foldHidden(t).text));'
```
The CLI gives the same result (`message.add … @lazy.md` / `@tick.md`, then `conversation.get`):
```
Plans:
- [Hidden · empty]
SECRET-LAZY the figure is Sera
```

**Expected:** the model clearly meant a note, so the secret folds.

**Actual:** the secret is shown in all four cases:
- **A fence on a list-marker or quote line with an unindented or unquoted body.** The note ends at its first line, as `[Hidden · empty]`, and the body prints. Then the note's own closing fence opens a code block that runs to the end of the message.
- **A blank unquoted line inside a quoted note.** This does the same.
- **A backtick in the label** (```` ```hidden sheet for `Sera` ````). CommonMark refuses this as a backtick fence, so the scanner sees no note at all.

**Cause:**
- When `continueLine` returns null, `findHidden` ends the note with its quote or list item (`hidden.ts:114`), as Markdown does.
- `fenceIn` returns null for a backtick fence with a backtick in its info string (`:310`), and `couldOpenHidden` does the same (`:254`).

Markdown agrees with the scanner in every one of these cases, so the browser's backstop won't catch them either: both clients would show the secret.

**Recommendation (a policy call for triage, not a spec error):**
- **Let containers not end a note.** Once a hidden opener is seen, the note should run to its closing fence or to the end of the message, whatever happens to the quote or list it opened in.
- **Let the backtick rule not apply to a hidden opener.** A backtick in the label shouldn't stop a note opening.

The cost is over-hiding an unclosed note's container followed by more text, which one click undoes. A spilled secret can't be unread. The rest of the scanner is already safety-first: nested code, and an unclosed note that runs to the end. And since both clients take their segments from `splitHidden`, nothing needs it to match CommonMark at the edges. The stream folder needs no change: its hold-back logic doesn't depend on containers.

### QA-3 · nit · A reasoning-on note writer's reasoning streams in full to stderr; the browser collapses it

`printStream` writes every `reasoning` delta to stderr (`src/cli/main.ts:326`). The browser shows reasoning collapsed (`Reasoning.tsx`), and `conversation.get` shows only `reasoning N chars (--json)`. So a brain that drafts its secret sheet while reasoning would spill it in the terminal alone. The reasoning is a second channel that carries the note's contents.

**Not observed live.** I made 2 calls with a Character Creator whose reasoning was on, one at effort `low` and one at `high` (as a `message.regenerate`). deepseek-v4-1-flash reasoned for 3-5 lines ("So I create a character sheet for her") and named nothing that was in the note. Both notes were single, closed and folded (`[Hidden · 7 lines]`). Reasoning is off by default.

**Suggestion:** T10's note-writing presets should keep reasoning off. Alternatively, the CLI could print reasoning as a one-line counter unless `--reveal`, to match the browser.

### QA-4 · nit · Per-command help doesn't mention the fold, and the `turn … > reply.md` example now saves a folded reply

`./ss help turn` still lists `./ss turn --conversation c_… --content @message.md > reply.md`. With a note in the reply, `reply.md` gets `[Hidden · 5 lines]` instead of the note. The stderr hint does say how to get the raw text. `./ss help conversation.get` and `help message.get` say nothing about folding: only the global-flags footer of `./ss help` mentions `--reveal`.

**Suggestion:** add one line to the descriptions of `turn`, `conversation.get` and `message.get` ("hidden notes fold to one line; --reveal shows them"), or add `--reveal` to the reply-to-file example.

### QA-5 · nit · The frontend recipe never shows the label, even when the note is opened

design.md says that the label "still helps the brains, and anyone who opens the note sees it", and the terminal's `--reveal` prints the opening line, label included. But the recipe for the frontend pass, in TICKETS.md and design.md, is `<Markdown text={block.body}>`, and `body` excludes the label. So in the browser, an opened note would never show its label (```` ```hidden GM plans ```` would open to the plans without "GM plans").

**Suggestion:** the frontend pass should render `block.label` as a caption inside the opened note, or design.md should say that the label shows only in the editor.

## Checked and not filed

- **The four leak-hunting invariants all held:**
  - streamed output joined equals `foldHidden` (23,000 texts, random and per-character splits);
  - no hidden token is printed at any step;
  - the counting line never carries a label;
  - a stop, an error or a lost connection mid-note still prints the marker.
- **Hard rules didn't regress.** `buildRequest` is untouched, the preview equals what was sent, `--json` is raw, `include_venice_system_prompt: false` is still sent, and the payload view is raw.
- **The mock.** `MOCK_HIDDEN` and `MOCK_HIDDEN_ONLY` work as documented. In 3-character pieces, `max_tokens` counts pieces rather than words. That is harmless, and the engineer's test relies on it.
