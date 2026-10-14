# T08 frontend: hidden notes in the browser

**Result:** in the scrollback, every ```` ```hidden ```` note in any message (a brain's or the player's, saved or streaming) is a quiet folded bar, `Hidden · 13 lines`. It shows no word of the note and not its label. A click (or Enter or Space) opens it in place, with its label as a small caption above the note rendered as Markdown, and another click folds it. In Chrome, a `MutationObserver` watched every DOM change on every load, stream, reload mid-note, regenerate, stop, failure and send. It never once saw a note's words outside a note I had opened. Every page load starts folded. A message that is all note is its badge plus the bar. The editor, Copy and the payload view stay raw.

`npm run typecheck` is clean, the web build succeeds, and `npm test` passes 168/168, including 5 new tests in `test/web-hidden.test.ts`. No new commands. No live calls.

No DESIGN CONCERN. The engineer's and triage's recipe worked as written. I added one thing it didn't cover, holding back a half-arrived fence while a reply streams (below).

## What I built

- **`web/src/lib/hiddenParts.ts`:** DOM-free, so `node:test` imports it.
  - `messageParts(text, {writing})` is `splitHidden` without the blank gaps around a note.
  - **While a reply is still writing,** its unfinished last line is held back if `couldOpenHidden` says it may still become a note's opening fence. Without this, ```` ``` ```` and ```` ```hid ```` each flashed for a frame as an empty code block with a "hid" header, before the bar replaced them. That flash showed no secret, but it was ugly. If the text already ends inside a note, nothing is held back, because the bar shows from ```` ```hidden ```` onward.
  - `containersOf(prefix)` gives the quote and list containers a note opened in. `couldOpenHidden` is now re-exported from `web/src/api/types.ts`.
- **`web/src/components/HiddenNote.tsx`:** the fold.
  - **Folded:** a dashed border with very faint diagonal hatching (`.ss-hatch`), an eye-off icon, `hiddenSummary` (the terminal's own words), and a quiet "Show ⌄" on the right.
  - **Open:** a solid panel in the panel color, with the label as a caption, then the note's body as Markdown. The body is a React child rendered only while the note is open, so a folded note's words are not in the DOM at all, not even hidden.
  - **The header is sticky:** while you read a long sheet, the "Hide" bar stays at the top of the scrollback.
  - **Accessibility:** it is a real `<button>`, so Tab, Enter and Space work. It carries `aria-expanded` and `aria-controls` and opens a `region` labelled "Hidden note". Its accessible name is just `Hidden · 13 lines`, because the Show/Hide hint is `aria-hidden`.
  - **While a reply is still being written,** its notes are `locked` (disabled, with a tooltip saying they open once the reply is finished). The note being written counts up with the shimmer used by "Thinking…": `Hidden · being written`, then `Hidden · 3 lines so far`.
- **`web/src/features/chat/MessageText.tsx`:** the body of every text message.
  - It renders Markdown parts and folds in a `flex-col` (`.md-flow`).
  - A note opened inside a list or quote keeps its marker (`2.`, `•`) or the quote's left bar, as the terminal keeps its prefix.
  - It is used in four places: saved brain messages (`BrainBody`), player bubbles, the pending player bubble, and `LiveReply`, which covers new turns, regenerates in their message's slot, and replies re-attached by `generation.follow`.
  - Saved bodies are keyed by the active version, so another version's notes start folded.
- **The caret** (`.ss-caret`) now goes only at the end of the last Markdown part. While a note is being written, there is no caret, because the bar counts up instead.
- **The all-note reply** (the Character Creator's) shows its badge and the bar, not "No reply text". The same holds for a reply stopped or broken mid-note: the bar shows its final count and can be opened.
- **Opening a note at the bottom of the scrollback** (small polish, `web/src/lib/scrollPin.ts`). The scrollback keeps you pinned to the bottom, so opening the last message's sheet used to re-pin to the new bottom and scroll the note's own top out of view. Now the note tells the scrollback first, through a small context:
  - The pin lets go.
  - The box scrolls just enough to show as much of the note as fits, never past its top.
  - "Latest" appears if the bottom is now out of view.
  - Folding a note from its sticky header deep inside it brings the bar back into view.
- **Backstop:** `Markdown`'s code-block renderer folds a block whose language passes `isHiddenInfo`, using the same `HiddenNote`. Per triage's guarantee it should never fire.
- **Not changed, on purpose:**
  - The message editor (raw Markdown) and Copy (raw).
  - The payload view (raw).
  - Image prompts: plain captions, never folded.
  - The settings panel: setup messages and system prompts are configuration, as with `setup.list` and `brain.list`.
  - Reasoning, which was already collapsed by default, mid-stream too.

## Verified in Chrome (`SS_DATA_DIR=<scratchpad>/data npm run up:mock`, user `dev-t08-fe`, plaintext)

**Setup.** I imported the example campaign into a scratch data dir. On this throwaway copy I added a Character Creator (reminder off) and turned the GM's reminder off. Then I hand-wrote, with `message.add`:
- a GM reply with a ```` ```hidden GM plans ```` note before its narration;
- a 13-line Character Creator sheet that is all note;
- a player message with a note as item 2 of a numbered list.

**A leak watcher on every page load.** `navigate_page`'s `initScript` installed a `MutationObserver` on `document`. On every mutation it walked the text nodes, skipping opened notes, textareas, the settings aside and dialogs. It recorded any of a dozen secret words: `Sera`, `forgery`, `MOCK_SECRET`, `Mara Vell`, `pocket`, `GM plans`, `Sheet:`, `character sheet`, and others. It sees every intermediate frame, which polling and screenshots can't. **Across every flow below it recorded 0 leaks.** After a reload, `document.body.textContent` didn't contain `Sera` anywhere.

| Flow | What happened |
|---|---|
| Load | Every note was folded: `Hidden · 3 lines`, `Hidden · 13 lines`, and `2. Hidden · 1 line` inside the player's list, with the list's `2.` in the gutter. The a11y tree shows `button "Hidden · 13 lines" expandable`. |
| Open / fold by click | The sheet opened in place, with "Sheet: the hooded figure" as its caption and the sheet as Markdown. Scrolling down kept the "Hide" header stuck at the top of the scrollback (`top: 0`). Clicking it folded the note and brought the bar back to 16 px from the top (it was 200 px above the view). |
| Keyboard | Enter on the focused bar opened it (`aria-expanded=true`, `region "Hidden note"`), and Space folded it. |
| Streaming turn, `MOCK_SLOW MOCK_HIDDEN` to the GM | Timeline, sampled every 50 ms:<ul><li>dots</li><li>the echo text with a caret</li><li>12.6 s: `Hidden · being written`</li><li>14.1 s: `1 line so far`, then `2 lines so far` …</li><li>`Hidden · 5 lines` while the visible line streamed after it</li><li>saved: `Hidden · 5 lines` with Show</li></ul>The note was locked until the reply was saved. **No `.md-code` element ever appeared**, so no half-fence flashed. |
| Reload mid-note | `generation.follow` replayed the reply. The first sample, 62 ms after load, was already `Hidden · 4 lines so far`, and the count continued to the saved reply. |
| Regenerate into a note, steer `MOCK_SLOW MOCK_HIDDEN_ONLY` | The message's slot went through dots (while ```` ```hid ```` arrived), then `Hidden · being written`, then `1/2/3 lines so far`. No Markdown part ever rendered: an all-note reply is the bar from its first character. |
| Stop mid-note | The stopped version 2 reads `Hidden · 4 lines`, Show, `2/2`, "stopped · cost pending". It isn't "No reply text". |
| Version pager | I opened v2's note and pressed ‹. v1's note was folded. I pressed › and v2's note was folded again. |
| All-note turn, `MOCK_HIDDEN_ONLY` via the Character Creator chip | The saved message is the badge, the time, `Hidden · 6 lines`, Show, Regenerate and the cost. |
| Failed mid-note, `MOCK_HIDDEN MOCK_MIDSTREAM_ERROR` | The partial reply (not saved) shows the echo, `Hidden · 2 lines` (openable), the error, Retry and Dismiss. |
| The player's own note, pending | With the mock paused (`kill -STOP`), I sent a message containing a `~~~hidden` note. The pending bubble was already folded. After `kill -CONT` the saved bubble is folded too. |
| Edit | Edit on the GM message showed the raw ```` ```hidden GM plans ```` source in the textarea, 9 lines. After Cancel the note was folded again. |
| Payload | The dialog has the raw note and the raw sheet, with 0 folds in it. |
| Opening at the bottom | With the view pinned to the bottom, I opened the last message's 6-line note. Its bar stayed at 532 px, and the box then scrolled smoothly to show it all (re-pinned, no "Latest"). Opening the 13-line sheet near the bottom of the view moved it up just enough to fit, with 16 px to spare. In a short window, it stopped with the note's top 16 px from the top and showed "Latest". |
| Narrow window (700 px) | No horizontal overflow. The list fold sits inside the bubble with its `2.`. |
| Console / network | No console messages. Every call went to `POST /api/<command>`: `turn`, `message.regenerate`, `generation.stop`, `generation.follow`, `message.select-version`, `prompt.preview`, and the usual `conversation.*`, `auth.whoami` and `health`. |

### Screenshots

- `reports/screens/T08-folded-notes.png`: the GM's note folded above its narration, the Character Creator's all-note sheet as badge plus bar, and the player's note as item 2 of a list.
- `reports/screens/T08-note-open.png`: the GM's note opened, with the "GM plans" caption, the plans, and the Hide header. The sheet below is still folded.
- `reports/screens/T08-note-streaming.png`: after a reload mid-reply, the closed `Hidden · 5 lines` bar in the live reply while the visible line after it streams in.
- `reports/screens/T08-regenerate-into-note.png`: a steered regenerate writing an all-note version 2 into its message's slot, `Hidden · 3 lines so far`.

## Tests

`test/web-hidden.test.ts` (5 tests) covers the browser's use of the rule:
- **Never shown mid-stream:** for every prefix of three replies (MOCK_HIDDEN's shape, the all-note shape, and a list/quote/tilde mix after an ordinary ```` ```js ```` block), the visible parts never contain a secret word or the beginning of a note's fence.
- **All-note reply:** it is the fold alone from its first character.
- **The fold counts up:** it shows from ```` ```hidden ```` on and counts its lines.
- **Saved replies hold nothing back:** only a streaming reply holds its last line.
- **Containers:** the parser for a note's quote and list prefix.

**Mutation check:** with the hold-back disabled, 3 of the 5 fail.

## Known gaps

- **A reply's notes can't be opened until it is saved.** That is deliberate: the ticket says that while a reply streams into a note, the player sees the bar growing, never the text. Notes that closed earlier in the same reply stay locked too, because the live reply is replaced by the saved message, and a note opened mid-stream would fold itself at that moment.
- **The split still cuts a ```` ````md ```` example in two** (triage's "rendering wrinkle"). It is rare, and it shows only text that was visible anyway.
- **`isAllHidden` isn't used by the browser.** An all-note message falls out naturally: blank text parts are dropped, and the bar is all that's left.
- **The settings panel's setup list** shows each setup message's first line as its summary. A World Bible that starts with ```` ```hidden label ```` would show that line, label included. This is configuration that Jason writes himself, shown raw by design, as in the terminal.
