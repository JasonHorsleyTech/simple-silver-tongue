# T03 frontend report: steered regeneration, versions, edit and delete (CP2)

## What I built

Checkpoint 2 now works in the browser: Jason can edit or delete any message, regenerate the latest reply with an optional steer, step through versions and keep playing from any of them, and stop a reply. The page stays calm: actions show on hover or keyboard focus, and only the last message keeps its row visible.

- **Message actions** (`features/chat/MessageItem.tsx`, `MessageFooter.tsx`, `MessageFrame.tsx`):
  - **Every message:** copy, edit and delete. For your own messages they float under the bubble; for a brain's they sit in the footer next to `in · out · $cost`.
  - **Brain messages with versions:** a `‹ 2/3 ›` pager, which is always shown because it is state, not an action.
  - **The steer behind the version on screen** sits in the header, next to the time: `↳ steered “Say it's blue.” on v1`, or `↳ re-roll`. It changes as you page. It is display only, as everywhere.
- **Edit in place** (`MessageEditor.tsx`):
  - The rendered body becomes a textarea of the raw Markdown, in monospace so `**` and `-` read as source.
  - ⌘ Enter or Save saves it, and Escape or Cancel closes it. The result renders as Markdown again, marked "edited".
  - A blank edit can't be saved; the hint says to delete the message instead.
  - With several versions it says "Editing version 2 of 3".
- **Delete** asks inline, in the footer row: "Delete this message?", or "…and all 3 versions?". It promises nothing about cost; the total keeps it.
- **Regenerate** (the last brain message only):
  - A small steer box opens under the message. Empty means a plain **Re-roll**; typed text means **Regenerate** with a steer.
  - It says which version it will write. When you have paged back, it says it is "revising version 2, the one shown".
  - Its own **Payload** button shows `prompt.preview --regenerate` with the steer as typed.
  - Enter regenerates and Escape closes.
- **The new version streams in place**, in the message's own slot, not at the bottom.
  - The header reads "writing version 4…" with the steer beside it.
  - This holds after a reload mid-regenerate: `generation.follow`'s `start.regenerate` puts it back in the slot.
  - A refusal up front (502, 409, a re-roll with nothing to answer) keeps the steer box open, with your steer and the server's message.
  - A break mid-stream leaves the partial version dimmed in place, with "version N wasn't saved", **Retry** (same steer) and **Show the saved version**.
- **Stop.** While any reply runs (sent here, regenerated, or followed from the CLI or another tab), the composer's Send becomes **Stop**.
  - The caption reads "Assistant is replying · Stopping saves waiting, not money". For a regenerate it reads "Assistant is writing version 3 · …". The tooltip is the whole `STOP_BILL_NOTE` sentence.
  - After a stop, a calm notice shows "Stopped. What had arrived is kept.", or the server's "Stopped before the reply started. Nothing was saved.", followed by the same sentence. A turn stopped before Venice answered puts your text back in the composer.
  - The stopped version reads **"stopped · cost pending"** until the server's drain records the cost. The view re-reads the conversation on a short back-off (1.5 s to 20 s), then shows the real `in · out · $` and the new header total.
- **During a reply, never a raw 409.**
  - Delete and the pager answer with a short inline hint ("A reply is being written. Change messages once it's done, or stop it.") and send nothing.
  - An open editor keeps your text and holds Save, with a calm explanation; Save comes back by itself when the reply ends.
  - A reply the browser didn't know about (started from the CLI) gets the same words when the server answers 409. The view then follows that reply live, Stop included.
- **Smaller fixes along the way:**
  - The header total was stuck after every reply. Since T03 triage it reads `spentUsd`, which no stream event updated. See the command change below.
  - Closing a dialog now returns focus to where you were (the steer box, the composer).
  - The player footer's tab order now matches what you see.
  - The new textareas have `name`s (Chrome flagged form issues).
  - An old stop notice clears when the next reply starts.

## Commands added or changed

No new commands. Two small server changes, so the CLI benefits too:

| Change | Why |
|---|---|
| `turn` and `message.regenerate`: `done` now carries **`spentUsd`**, the conversation's running total after this reply's cost was added. | Since T03 triage the header reads `spentUsd`, which nothing updated during a session. The browser would otherwise re-derive the server's `addSpend` or re-read the whole conversation after every reply. Documented in design.md (stream events). |
| `STOP_BILL_NOTE` moved to **`src/conversations/wording.ts`** (dependency-free); `commands/chat.ts` re-exports it. | The browser imports the server's own sentence for the Stop caption and tooltip, so the wording can't drift. `web/vite.config.ts` lets the dev server read `..` for it. |

`web/src/api/types.ts` gains `message.edit`, `message.delete`, `message.select-version`, `generation.stop`, the `message.regenerate` stream, the regenerate options of `prompt.preview` (with `Preview.regenerate`), and `start.regenerate`/`start.steer` and `done.spentUsd` on the events.

## Flows verified in Chrome (DevTools MCP)

Against `npm run up:mock` as `dev-t03-fe`, at 1440×900, plus 500 px wide, Chrome's narrowest window:

| Flow | Result |
|---|---|
| **Green, blue, green** ("Lime colors") | Turn "What color is a lime?". Regenerate with "Say it's blue." gave version 2/2, "steered “Say it's blue.” on v1", in place. "No, say it's green." gave 3/3 "on v2". The steer box's Payload showed `[system, question, version on screen, steer]` before sending. |
| **No steer in the next request (Payload view)** | With "Why?" in the composer, the header Payload showed `[system, question, version 3's text, "Why?"]` and no steer message. I sent it: the body the mock received was **byte-identical** to the browser's preview (`cmp`). |
| **Edit 3 turns back** ("Four turns") | Edited the player's "Turn **two**" list (raw `**two**` and `- apples` in the editor), saved with the button, and it rendered as bold plus a list, marked "edited". Edited the assistant reply 2 turns back with ⌘ Enter, to bold plus a block quote. The next Payload showed both edits at [3] and [6]. |
| **Delete** | Inline confirm, then removed. The header total kept the deleted reply's cost. Deleting the "Why?" pair made the 3-version message last again. |
| **Version switching** | ‹ 3/3 → 2/3 → 1/3 and back. The header steer followed each version (none on v1). |
| **Keep playing from a picked version** | On v2 (blue), steered "Make it iambic pentameter.". The box said "revising version 2, the one shown". It became 4/4 "on v2", and the mock received `[system, question, **blue version**, steer]`. |
| **Plain re-roll** | Empty steer, so the button read "Re-roll". It gave v2 "re-roll"; the mock saw 7 messages, with the message left out. |
| **Stop a turn mid-reply** (`MOCK_SLOW`) | Stop with the caption and tooltip, then the partial text, "stopped · cost pending", and the notice with the server's sentence. The cost landed after about 0.5 s past the first poll; header $0.00064 → $0.00086. |
| **Stop a regenerate mid-stream, in place** | It streamed in the slot ("writing version 3…"). Stop gave 3/3 "stopped · cost pending", and the cost arrived 5.5 s later. |
| **Stop before Venice answers** (mock `kill -STOP`) | "Stopped before the reply started. Nothing was saved." plus the sentence, and "I order a plum wine." was back in the composer. After `kill -CONT`, the drained cost reached the header ($0.0013 → $0.0015). |
| **Edit during a CLI reply** (the 409) | Editor open, then `./ss turn … MOCK_SLOW` in the background, then Save. The server's 409 became: "A reply is being written from the messages as they are now, so they can't change until it's done. Wait for it to finish, or stop it." Text kept, Save held, and the view followed the CLI reply live with Stop. When it ended, Save worked and the list rendered. |
| **Delete and pager during this tab's reply** | Inline hint, no confirm opened, no request sent (checked in the network list). |
| **Regenerate failures** | `MOCK_ERROR` in the steer: the box stayed open with the steer and "Venice 500 … (MOCK_ERROR)". `MOCK_MIDSTREAM_ERROR`: a dimmed partial in the slot, "version 2 wasn't saved", Retry and "Show the saved version", which brought the saved message back. |
| **Reload mid-regenerate** | After the reload, `generation.follow` re-attached in the same slot (`li#m_ku6dvs7gqi`, no extra row), with "writing version 2…" and the steer, then saved 2/2. |
| **Header total** | After a turn, $0.00029 → $0.00034; after a steered regenerate, $0.00042. The server said 0.0004188. |
| 500 px wide | The footer (pager, Regenerate, icons, meta) and the steer box fit; no horizontal scroll. |

- **Console:** only Chrome's own logs of the expected 499 (stop before start) and 409 (CLI reply). No app errors or warnings.
- **Network:** every call was `POST /api/<command>`: `turn`, `message.regenerate`, `message.edit`, `message.delete`, `message.select-version`, `generation.stop`, `generation.follow`, `prompt.preview` and `conversation.*`.

### Live smoke (`npm run up`, `deepseek-v4-1-flash`, `max_tokens` 150, conversation "Live smoke T03")

1. "What color is a fresh lime?" → **Green**, 24 in · 2 out.
2. Regenerate with the steer "Say it's blue." → **Blue**, streamed in place as 2/2 "steered … on v1", 63 in · 2 out. I paged to 1/2 (Green) and back.
3. The header Payload with "Why that color?" showed `[system, question, "Blue", "Why that color?"]` and no steer (screenshot below).
4. "Ignore the one-word rule: count from 1 to 100 in words", stopped after "six". It read "stopped · cost pending", then **56 in · 150 out · $0.0002** 1.5 s later. **Venice billed all 150 tokens for six words**, which confirms the Stop wording.

**Spend:** 3 live text calls, no images. Balance **$8.00499827 → $8.00477057** (−$0.00023). The conversation's recorded total was $0.00023, so recorded equals billed.

## Screenshots

- `reports/screens/T03-versions-steer.png`: version 2/3 on screen, with its steer ("steered “Say it's blue.” on v1"), the pager and the Regenerate row, and the steer box open: "Regenerate as version 4 · revising version 2, the one shown", Payload, Cancel, Regenerate.
- `reports/screens/T03-regenerate-in-place.png`: a steered regenerate streaming **in the message's own slot** ("writing version 2…", the steer, the caret). The composer shows Stop and "Assistant is writing version 2 · Stopping saves waiting, not money".
- `reports/screens/T03-edit-during-reply.png`: a player message being edited as raw Markdown (`**two**`, `- **figs**, ripe`) while a CLI reply runs. A calm warning instead of the 409, Save held, Stop in the composer.
- `reports/screens/T03-live-payload-no-steer.png`: **live**. The exact payload of the next Send after the steer: system, question, "Blue", the new message. No steer.

## Known UI gaps

- **Drafts in an open editor or steer box are lost on navigating away.** They live in the component, deliberately not in browser storage (an encrypted user's words must not land on disk).
- **Some server messages name message ids** ("m_ku6dvs7gqi keeps its current version"). They are accurate and shared with the CLI, so I show them as they are.
- **The steer of other versions** shows only when you page to them; there is no list of all versions with their steers. `message.get` has it if that's ever wanted.
- **No deleting a single version** (by design, T03 triage).
- **A brain message keeps a footer-high gap below it** even when the footer is hidden. That is T02's design, so nothing jumps on hover; it reads a little airy between turns.
- **Typing an edit while pinned to the bottom** can scroll the editor up as a followed reply grows. That is T02's stick-to-bottom; scroll up first and it leaves you alone.

## Tests

`npm test`: **84 pass** (83 before). `npm run typecheck` is clean (server, CLI, tests, web), and the web build succeeds. New in `test/web-api.test.ts`: the web client's T03 shapes against the real server (the schemas are strict, so a wrong key would be a 400):
- `prompt.preview` with `regenerate`, `message` and `steer`, including its `regenerate` field;
- `message.regenerate`'s `start.regenerate` and `start.steer`;
- `done.message` with the new version, and `done.spentUsd` matching `conversation.get`;
- the 1-based `message.select-version`, `message.edit`, an idle `generation.stop` and `message.delete`;
- the browser's `STOP_BILL_NOTE` matching the server's.

## Docs changed

- **design.md:** stream events (`done.spentUsd`); Web app → a "Message actions (T03)" bullet covering edit, delete, regenerate in place, the steer note, the 409 handling, Stop and its wording source, and the cost re-reads.
- **AGENTS.md:** two lessons: the message seams and `wording.ts`, and driving edits and steers in Chrome MCP (Meta+a, the native value setter, which mock trigger to use for Stop, `li[id]`, newest-first `/_mock/requests`).
- **TICKETS.md:** T03 → `done`; "From T03 frontend" pointers on T04 (per-brain payload/Stop) and T05 (image card in `BrainBody`, image events in the reducer, the in-slot live reply).

## Housekeeping

The server is left freshly started on current code against the mock (`npm run up:mock`). Test user: `dev-t03-fe` (`dev-*`, free to wipe).
