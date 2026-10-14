# T04 frontend report: multiple brains, setup messages and templates (CP3)

No design concern. The T04 commands covered everything the browser needed; no command was added. Two dependency-free values moved so the browser shows the server's own words (below).

## What I built

Jason can now set up and run a campaign entirely in the browser, 50+ messages deep, with the configuration beside the play rather than in its way.

- **Settings in four tabs** (`features/settings/`). The panel is docked beside the chat at 1180 px and up, and a drawer when narrower, as before. The tab is remembered.
  - **Brains**: one quiet card per brain. Each card shows the badge, tags (default, image, reasoning, reminder), the message count, the first line of its prompt, and braces `{ }` for its exact payload. Cards open one at a time into the full editor:
    - name (explicit save; the hint shows `<!-- from: Name -->`);
    - color (the server's palette, or any color);
    - kind (Text/Image, locked once the brain has spoken, with the reason shown);
    - system prompt, reasoning with effort and the provider warning, and the final reminder;
    - for an image brain, safe mode and all four tool texts.

    The card ends with **Exact payload**, **Make default**, and **Delete**. Delete shows only for a brain that has never spoken and isn't the default; otherwise a quiet "Has spoken, so it stays" explains why. **Add a brain** asks for name, kind and system prompt. The new card opens with its reminder on and pre-filled.
  - **Setup**: the World Bible and other setup messages in order, as cards with ↑/↓ arrows. Open one to edit its label and text; delete has an inline confirm. **Add a setup message** takes a label; the server pre-fills `<!-- This is the World Bible. -->` and the caret lands after it.
  - **Templates**: the four framing templates. A missing placeholder warns as you type, and the server's refusal shows inline.
  - **Conversation**: title, plus the **text and image model pickers fed from `models.list`**, each with price, privacy, context and reasoning levels. Also `max_tokens` and `temperature` (blank means not sent), and delete.
- **Play** (`features/chat/Composer.tsx`):
  - A big **Send to <default brain>** button (Enter). Beside it, a **chip per other brain** in its own color, with shortcuts ⌥1…⌥9.
  - With nothing typed, a chip or Enter asks that brain to just respond.
  - The label shortens to "Send" when the composer is narrow, and chips wrap rather than overflow.
  - While a reply runs, the chips give way to "Dice Master is replying · Stopping saves waiting, not money" and Stop.
  - Image brains' chips are shown but off until T05.
- **Words in a brain's mouth**:
  - The pen ("Write as…") picks a text brain, or you with no reply. The composer then shows "Writing as [● Game Master] · nothing is generated" in that brain's tint, and Enter or **Add as Game Master** calls `message.add`. After that it goes back to sending.
  - A fresh conversation's empty state shows "set the table" rows: Brains (+ Add a brain), Setup (+ Add a World Bible) and Opening (**Write as Game Master**). Each opens where the work is done.
- **Scrollback**: every brain message has its colored badge and a thin rail in its color beside the text, so the speaker stays clear deep in a long reply. Lines you wrote for a brain say "✎ written by you".
- **Exact payload for any brain** (`PayloadDialog`):
  - The header's Payload opens on the default brain. A row of brain badges (arrow keys work) switches whose request it shows, with the unsent composer text framed for that brain.
  - Each brain card's braces open it on that brain.
  - Parameters are compacted to one line per field, so the messages are above the fold; Raw JSON is still the literal body.
  - A regenerate's payload stays on the message's own brain.
- **Retry keeps the brain** (T04 triage): `useChat` keeps the error's `details.retry` on a failed live reply. `chat.retry()` replays it: a turn goes back to the brain whose reply broke, and a regenerate keeps its message and steer.

### Fixed along the way

- **Chrome's `scrollIntoView()` now returns a Promise.**
  - An arrow effect or React 19 ref callback that returned it handed React a non-function "cleanup". The page went blank when the Add-brain form closed: `TypeError: l is not a function`.
  - The old Delete conversation confirm (T02) had the same latent bug in a ref callback.
  - Every effect and ref body is now braced (`AppShell`, `SteerBox`, `ChatView`, settings). The AGENTS.md lesson says why.

## Commands added or changed

No new commands. Two dependency-free moves, so the browser shows the server's own values, as it already did for `STOP_BILL_NOTE`:

| Change | Why |
|---|---|
| `REASONING_NOTE` moved from `prompt.ts` to `src/conversations/wording.ts` (`prompt.ts` re-exports it). | The brain editor had a hand-copied sentence. |
| `BRAIN_COLORS` moved from `defaults.ts` to `wording.ts` (`defaults.ts` re-exports it). | The color picker offers the palette `brain.add` hands out. |

`web/src/api/types.ts` gains:
- `brain.add`, `.delete` and `.set-default`;
- `setup.add`, `.update`, `.move` and `.delete` (`SetupListing`);
- `message.add`;
- `BrainFields` (kind, safe mode and tool on `brain.update`).

## Flows verified in Chrome (DevTools MCP)

Run against `npm run up:mock` as `dev-t04-fe`, at 1440×900. Widths 1280 (docked panel) and 900 (drawer) were checked too.

| Flow | Result |
|---|---|
| **D&D table from scratch** ("The Gilded Goat") | New conversation, then in the Brains tab:<br>• renamed "Assistant" to **Game Master** and set its GM prompt;<br>• **Add a brain** for the Dice Master (its pre-filled reminder edited to "only roll dice, in one line…") and the Joke Teller;<br>• Setup tab: **Add a setup message** "World Bible", written on from its pre-fill;<br>• the GM opener via the pen, **Write as → Game Master**, then Enter. It shows as Game Master with "written by you". |
| **Play across brains** | Player → GM (Enter); a check → **Dice Master chip** ("saw 7 messages", reminder last); player → GM; **⌥2 with an empty composer** → the Joke Teller just responded ("saw 10", nothing typed, no "¡"); player → GM. |
| **Each brain's payload** | Header Payload, switching GM / Dice Master / Joke Teller:<br>• **GM**: its own lines (opener included) are `assistant`, everyone else's are framed user lines, and there is no reminder;<br>• **Dice Master**: system, World Bible, the GM as `<!-- from: Game Master -->`, its own roll as `assistant`, reminder last;<br>• **Joke Teller**: likewise.<br>All three match design.md. |
| **Edit a GM line, then the Dice Master's payload** | Edited the GM's first reply in place to "She smiles without warmth. **Moonpetal oil**…". The Dice Master's braces showed `[4] user <!-- from: Game Master -->` with the new text (screenshot). |
| **Preview == send, from the browser** | The Dice Master's Raw JSON with a draft typed, saved, then sent with its chip. It was **identical** to the mock's received body (70 messages). |
| **50 messages deep** | Grew the campaign to 62 messages with the CLI, picked up in the tab on focus. At 62–70 messages:<br>• **added "Old Brannoc"** (barkeep) mid-game; asked via its chip, it saw all 66;<br>• **edited the GM's system prompt** to "GRIM GM: …"; the next GM reply echoed "GRIM GM";<br>• the composer, chips and settings stayed responsive. |
| **Mid-reply** | During a slow GM reply I changed the Joke Teller's color (allowed). The composer showed "Game Master is replying · Stopping saves waiting, not money" and Stop. |
| **Retry keeps the brain** | A throwaway "Test Bard" (reminder off) with `MOCK_MIDSTREAM_ERROR`: partial text, the error naming Test Bard, then **Retry**. The mock's newest two requests were both Test Bard's system prompt (71 messages each, no duplicate player line), not the GM's. Then I deleted the trigger message and the unused brain (inline confirms). |
| **Image brain** | Added "Scene Painter" as Image, turned safe mode off, and edited the tool description. Its braces showed `tools` with the new description and the forced `tool_choice`. Its chip and "Write as" entry are off (T05). |
| **Default** | Make default on the Dice Master: the big button became "Send to Dice Master", the placeholder followed, and the GM became a chip. Then back. |
| **Setup reorder/delete** | Added "House rules", moved it ↑ above the World Bible (the Joke Teller's preview showed House rules at [1]), then deleted it. |
| **Conversation tab** | Picked Venice Uncensored and Nano Banana 2 and set `max_tokens` 300: saved, in the header, and in the preview body. Reverted all three; clearing `max_tokens` removed it. |
| **Templates** | Player template without `{{content}}`: the warning as typed, the server's 400 inline on Save, and Revert restored it. |
| **Unsaved text across cards** | Typed into the GM's prompt, opened the Dice Master, then reopened the GM. The draft was still there with "Unsaved changes"; Revert restored it. |
| **Kind lock, delete rules** | A brain with messages shows "Locked: … has 12 messages" and no Delete. The default shows no Delete (its tooltip says to make another default first). |

- **Console:** no app errors. The only one is Chrome's log of the deliberate 400 from the bad template.
- **Network:** every call was `POST /api/<command>`:
  - `brain.add`, `.update`, `.delete` and `.set-default`;
  - `setup.add`, `.update`, `.move` and `.delete`;
  - `message.add`, `message.edit` and `message.delete`;
  - `turn` and `prompt.preview`;
  - `conversation.*`, `models.list` and `generation.follow`.

### Live smoke (`npm run up`, `deepseek-v4-1-flash`, `max_tokens` 150, conversation "Live smoke T04")

I built it in the browser: GM renamed and prompted, a Dice Master with a one-line-roll reminder, a World Bible from the empty state, and the GM opener via "Write as".

1. Player → GM: "Silk from the southern isles — the kind that never passed a customs house." (140 in · 41 out)
2. A check → **Dice Master chip**: "Insight check: DC 14 — d20 (11) + WIS mod (2) = 13 — fail." (230 in · 28 out)
3. The GM's payload showed the roll as `<!-- from: Dice Master -->`. Then Enter with an **empty composer** gave a GM reply narrating the failed read. (235 in · 55 out)

**Spend:** 3 live text calls, no images. Balance **$8.00306882 → $8.00274144** (−$0.00032738). The conversation recorded $0.000327375, so recorded equals billed.

## Screenshots

- `reports/screens/T04-campaign-brains.png`: the campaign 70 messages deep, with five brains (GM, Dice Master, Joke Teller, Old Brannoc added mid-game, Scene Painter). It shows:
  - the Brains tab as quiet cards with tags, counts and payload braces;
  - the scrollback's colored badges and rails, and the GM's "GRIM GM" prompt edited mid-game;
  - the composer's chips plus "Send to Game Master", with the image brain's chip dimmed.
- `reports/screens/T04-payload-dice-master.png`: the Dice Master's exact payload, after the GM line was edited in the scrollback. The brain switcher is on top; `[4] user <!-- from: Game Master -->` carries the edited "Moonpetal oil" line, with the Dice Master's own roll as `assistant` below.
- `reports/screens/T04-write-as-opener.png`: a fresh campaign's "set the table" empty state (Brains, Setup: World Bible, Opening), with the composer in "Writing as ● Game Master · nothing is generated" and **Add as Game Master**.
- `reports/screens/T04-live-two-brains.png`: **live**. GM, then the Dice Master's one-line roll, then the GM narrating the failure, each with its badge and rail.

## Known UI gaps

- **Brain order is creation order** (no reordering command). The chips and ⌥ numbers follow it.
- **With four or more other brains at ~1280 px** (docked panel), the chips wrap to a second row. That is tidy but taller. The dimmed image-brain chip is the usual wrapper until T05.
- **The New conversation form still names the first brain "Assistant"** (`conversation.create` has no brain name). Renaming it is one field in the Brains tab, and the empty state's "Edit in settings" opens it.
- **Unsaved edits survive opening another card, not closing the panel or switching tabs.** Closed cards stay mounted (hidden), so a half-typed prompt is still there, with "Unsaved changes", when you reopen its card. Closing the panel or changing tabs unmounts it, as in T02. A collapsed card doesn't show that it holds unsaved text.
- **The payload view doesn't label which ledger message each request message came from.** The framing (`<!-- from: … -->`) and the order make it readable, but there is no link back to the scrollback.
- Regenerate is still last-message-only (Jason's spec). Image brains can be configured but not sent to (T05).

## Tests

`npm test`: **92 pass** (91 before). `npm run typecheck` is clean (server, CLI, tests, web), and the web build succeeds.

New in `test/web-api.test.ts`: the web client's T04 shapes against the real server (strict schemas, so a wrong key is a 400). It covers:
- the setup list round trip (add with pre-fill, move, update, delete);
- `brain.add` getting the next palette color with its reminder on;
- image `safeMode` and `tool` on `brain.update`;
- `message.add` as a brain id (`source: "authored"`) and an empty `turn` to another brain (`start.brainId`);
- the framed opener in that brain's preview;
- set-default, plus `brain_in_use` and delete;
- `retryOf` on a broken non-default turn;
- the browser's `REASONING_NOTE` and `BRAIN_COLORS` equal to the server's.

## Docs changed

- **design.md:**
  - Web app: the settings tabs and their editors, and a new "Several brains at the table (T04)" bullet (sending, write-as, scrollback rails, per-brain payload, retry).
  - `REASONING_NOTE`'s new home.
- **AGENTS.md:** three lessons:
  - `scrollIntoView` returns a Promise, so brace effect and ref bodies;
  - the settings and composer seams;
  - driving T04 in Chrome MCP (`fill` on textareas, no snapshots of long chats, `initScript` helpers, a throwaway brain for Retry).
- **TICKETS.md:** T04 → `done`. A "From T04 frontend" bullet on T05 lists what is switched off until image replies exist.

## Housekeeping

The server is left freshly started on current code against the mock (`npm run up:mock`). Test user: `dev-t04-fe` (`dev-*`, free to wipe), with "The Gilded Goat" (mock, 70 messages) and "Live smoke T04".
