# T20 frontend: compaction and a token counter, in the browser

**Result:** the Frontend scope is built and checked in Chrome on the mock. "Compact through here" is in every message's footer. The scrollback folds what a compaction left out of requests, and a compaction has a look of its own. The chat header has a token counter. No server change and no new command were needed.

**No live calls.** The balance is $1.58, under the $4 floor. The live acceptance bullet and the Chronicler's prompt tuning are still open, so T20's status is `live tuning`.

`npm run typecheck` is clean and `npm test` passes 253/253. The web build succeeds; I built it into my scratch dir only.

## Jason's server was left alone

- I never ran `npm run up`, `up:mock` or `down`.
- I didn't build into `web/dist` (still dated 08:50) and didn't touch `.run/`.
- I used my own mock on :4982 and server on :4981, started by hand. Their data dir, run dir and `SST_WEB_DIST` were under the scratchpad (`t20-frontend/`), with `SST_MODELS_FILE=models.example.ini`.
- The only user was `dev-t20-fe` (unencrypted), in that scratch data dir.
- I killed both pids at the end.

## What I built

### "Compact through here" (`features/chat/CompactMenu.tsx`)

It sits in every message's footer as a scroll icon, beside Clone from here. It opens a small dialog, like Clone's.

**The plain line on what happens:**

> Chronicler sums up the story up to and including this message (13 messages), and its summary goes in right after it. From then on every brain reads the summary instead of them; the 8 messages after it stay as they are.
>
> Nothing is deleted: they fold away here, and deleting the compaction brings them back.

On your own last message, one more line (QA's wording note): "Your message here is then only in the summary: the next reply reads it there, not word for word."

**What happens this time** comes from `compactOffer` in `web/src/lib/compaction.ts`. It mirrors `planCompact`'s rule and is tested against it.

| Case | What the dialog does |
|---|---|
| Plain case | A new compaction right after the message. |
| The message right before its own newest compaction | "Chronicler writes the compaction right below again… as its version 2. The pager keeps the one it has now." The button reads **Write version 2**. |
| Above the newest compaction | Refused, in words: the newest compaction already covers this message. Compact a later message, or delete that compaction first. |
| Several compaction brains | "Written by" badges, with the author of the newest compaction preselected. |
| No compaction brain | It says what a compaction brain does, then offers **Add the Tabletop RPG preset's Chronicler** (`brain.import`). It offers any preset brain with `compacts`, so the browser names no preset itself. It also says you can switch the setting on for one of your own brains. After the add, the dialog turns into the plain case in place. |

**At the bottom of the dialog:**
- A **size line**: "Chronicler reads about 1,545 tokens (an estimate)". It is `prompt.preview --compact`'s own estimate, fetched when the dialog opens.
- **Payload** opens the "Compaction payload" view (`prompt.preview --compact --message --brain`).
- **Compact** streams `message.compact`.

**Where else it shows:**
- A compaction has no "Compact through here".
- The newest compaction, when it isn't the last message, has **Compact again**: the same dialog, as a new version through the message before it. This is the one way to re-roll a compaction at depth.
- While it is the last message, Regenerate works as for any reply (steer, fresh take).

### The live compaction

- It streams **right after the message it compacts through**, from the first moment. The new `LiveReply.compact` is set by `compact()` and by `start.compact`.
- So a turn to the Chronicler's chip, a `generation.follow` after a reload and a compaction from the CLI all look the same.
- It streams in the compaction's frame: "summing up the story to here…".
- The saved message goes in at that same place (`upsertMessage`'s new `after`), not at the end. Before this, `done` would have appended a middle compaction to the bottom of the browser's copy.
- A re-version streams in the compaction's own slot.
- A broken compaction keeps its partial text there, with Retry. `retry()` now replays `message.compact`. `forBrowser` drops the server's "To retry, compact again (the same command)."
- A stopped compaction is saved and cuts, as on the server.

### The scrollback after a cut (`Scrollback`)

- **The fold.** The messages above the newest compaction fold under one band: "**13 earlier messages** · left out of every request since the compaction below (2 are pinned to brains, which still get them)", with Show / Fold.
  - The fold state is kept per cut, so a new compaction folds again.
  - Opened, the messages are dimmed to 70% (full on hover or focus) and keep every action.
  - A line right above the compaction reads **Every request starts here · Fold the 13 above**.
- **Jump to it.** A pin's Jump to it, in a brain's card, opens the fold first (`revealMessage`).
- **Keeping your place.** When the fold changes under you, Scrollback keeps your place by hand, before paint. This covers a compaction landing, a delete that brings the messages back, and Said by….
  - The message at the top of the view stays where it was.
  - A compaction that was streaming in view keeps its own place.
  - The browser's scroll anchoring can't do this when its anchor is the message that folds away.
  - This is not a scroll that follows content. Nothing moves while you read, only when the fold itself changes.
- **A compaction's look** (`MessageFrame`'s `compaction`):
  - no speaker's badge, but a scroll in its brain's color;
  - "**Chronicler's compaction** · the story so far, 13 messages" (`storyCount`, the number its `{{count}}` was sent as);
  - a double rail;
  - its body folds like any hidden note.
  - An older compaction sits in the fold with a fainter rail.

### The token counter (`features/chat/TokenCounter.tsx`)

- **The header gauge** shows the default brain's last real count ("1.7k").
  - It reads it with `lastCount` from the ledger, so there is no call.
  - Once a compaction was written after that count, the number is hidden, because it no longer says how big the next request is.
- **Prompt sizes.** The gauge opens this panel, built from `prompt.size` and read again while it is open as the ledger changes. For each brain:
  - its last reply as Venice counted it, cached tokens beside it ("1,671 · 1,540 cached"), and "before the cut" when stale;
  - **Now ≈**, the estimate of its next request.
- **The panel's footer** says where requests start, or "No compaction yet… use Compact through here on any message". It also carries `ESTIMATE_NOTE`.
- On a phone the panel hangs from the header's right edge.
- **The Size line in every payload view**: "about 1,606 prompt tokens · an estimate, from its 7,074 characters · the model takes 1,000,000". The brain's last real count sits under it.
- The T20 notes now show as information rather than warnings: `cutNote`, `countNote`, `compactNote`, `compactsNote`.

### Elsewhere

- **The settings switch.** A text brain's card in Settings has **Its messages are compactions** (`brain.update --compacts`).
  - It says what it does, and what turning it on does to a brain that has already spoken.
  - Once switched, it says where requests start now: "Every brain's request now starts at Character 1's compaction: the 14 messages before it are left out of requests (still here, folded above it). Not what you meant? Switch it off again to undo it."
  - `brain.update`'s `cutMoved` is stripped before the brain is stored, in BrainEditor and in useChat's rename and safe-mode calls.
- **Cut moves are said everywhere.** Every `cutMoved` (delete, Said by…, words in a compaction brain's mouth) is a calm notice above the composer. It uses the browser's words (`cutMovedWords`) rather than `cutMovedLine`, because message ids mean nothing in the browser and the fold shows where the cut is.
- **Tags.**
  - The compaction brain's chip has a scroll for its dot: "Ask Chronicler to compact the story so far…".
  - Write as… tags it "a compaction".
  - Brain cards, the empty conversation and the library casts tag "compacts".
- **QA-5.** `compacts` is now in `BrainFields` and on `LibraryBrain`, and `cutMoved` is on the results of `message.delete`, `message.set-author`, `message.add` (`ImageMessageView`) and `brain.update`.
- **README.** One sentence on the browser route in "Compact a long campaign".
- **design.md.** A "Compaction (T20 frontend)" bullet in "Web app".
- **AGENTS.md.** A lesson: the seams, mock tips, scroll anchoring, a keyed Fragment, and the `Button` nowrap trap.

## UI choices worth knowing

- **One fold band, not a band per message**, and a "story so far, N messages" label on the compaction.
  - The ticket's "42 messages compacted below" is the band's job.
  - The band sits right above the compaction. When everything above the cut is folded, the band and the compaction together read as the cut.
- **The dialog asks the server for its size** (`prompt.preview --compact`) instead of estimating in the browser. That estimate is the same request `message.compact` sends. What the dialog *says* comes from `compactOffer`, so it shows at once, and it is tested against the server.
- **The header number is the default brain's last real count**, not a fresh estimate. That costs no call per render. The panel has both numbers.

## Verified in Chrome (Chrome DevTools MCP, isolated context, scratch server :4981, mock)

**Test data:** a "Harbor" ledger of 20 messages, built with `message.add`. Two sheets in the Creator's mouth made Character 1 and Character 2. The Chronicler's reminder had `MOCK_HIDDEN_ONLY`, so mock compactions are hidden notes like the preset's, and `MOCK_SLOW` / `MOCK_MIDSTREAM_ERROR` when needed.

- **Compact through a middle message (13 of 20):**
  - the dialog text and its size;
  - Payload: the Compaction payload, its Size line, and the T20 notes as information;
  - Compact: the live compaction appeared right after message 13, with "summing up the story to here…" and "Hidden · N lines so far".
  - When it landed, the band read "13 earlier messages… (2 are pinned to brains…)", the compaction read "the story so far, 13 messages", and the 7 later messages stayed below it.
  - A compaction streaming in view kept its place, up to where the fold allows. It moved from 326 px to 121 px when the box ran out of room above it.
- **The fold:** Show / Fold; dimmed messages with their actions; the "Every request starts here · Fold the 13 above" line.
  - Compact through here on a folded message: right before the compaction it offers "version 2"; further up it gives the "above" refusal.
  - Compact again on the compaction wrote version 2 in its own slot, with the pager at 2/2 and a "re-roll" label.
- **The Chronicler's chip** with nothing typed compacted through the last message. Afterwards the band read 22 earlier messages and the compaction read "the story so far, 21 messages" (the older compaction is not counted).
- **Deleting the newest compaction** brought 9 messages back. The notice read "Every brain's request now starts at Chronicler's compaction: the 13 messages before it are left out…" and the header number came back.
- **No compaction brain** (a plain chat): "Add the Tabletop RPG preset's Chronicler" added it, and the dialog became the plain case in place. The Ch chip appeared.
- **Several compaction brains** (Character 1 switched on in Settings): the "Written by" badges switch the brain and its size. The switch's note named the new cut. Switching it off said the cut went back to the Chronicler's compaction.
- **A pin's Jump to it** (Character 2's sheet, inside the fold) opened the fold, scrolled to the sheet and flashed it.
- **A broken compaction** (`MOCK_MIDSTREAM_ERROR`) kept its partial text after the message, with Retry. Retry with `MOCK_SLOW` re-ran it. **Stop** saved the partial compaction, which cut ("16 earlier messages"), with the stop notice.
- **A compaction started from the CLI**, then a reload: `generation.follow` put the live compaction right after its message. It landed between that message and the next one.
- **Phone width** (390×844, touch):
  - the Compact dialog fits inside the scrollback;
  - the Prompt sizes panel fits too (20–378 px; it ran off the left edge before I hung it from the header);
  - no horizontal scroll.
- **Console:** no errors or warnings.
- **Network:** every call was `POST /api/<command>`: `prompt.preview`, `message.compact`, `prompt.size`, `brain.import`, `brain.update`, `message.delete`, `generation.stop`, `conversation.get`, `generation.follow`.

## Screenshots (dev user, mock content only)

- `reports/screens/T20-compact-menu.png`: Compact through here on message 13, with its line, size, Payload and Compact.
- `reports/screens/T20-folded.png`: after the compaction: the band, the Chronicler's compaction (folded hidden note), then the later messages.
- `reports/screens/T20-prompt-sizes.png`: the header gauge (1.7k) and the Prompt sizes panel: GM "1,671 · 1,540 cached", the odds "before the cut", Now ≈ for every brain, and the cut and estimate lines.

## Tests

`test/web-api.test.ts` has one new test: Compact through here's rule against the server's planner on the same ledgers.

- **Cases:** no compaction brain; several; a compaction itself; above the newest; a re-version (and its `{{count}}`); another brain's compaction right below; counts after the cut, compactions not counted.
- **Also checked:** `storyCount`, `cutView` (pinned messages above the cut), and `cutMovedWords`.
- **Mutation-checked:** dropping the author check from `compactOffer` fails it.

## Known gaps

- **Not tuned live.** That is the open live bullet; the browser needs nothing more for it.
- **An older compaction's own Compact menu** isn't there. Like any message above the cut it is in the fold, and the server refuses it there anyway.
- **The live compaction doesn't show "the story so far, N messages"** until it is saved.
- **The header gauge shows only the default brain.** The panel has every brain.
- **The fold band is always one band.** Older compactions sit in it like any message; there is no nested fold.
