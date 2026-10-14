# T09 frontend: dice rolls in the browser

**Result:** the roll is now a one-click part of the play loop. The die sits beside the pen in the composer. Click it (or press ⌥R) and the next send rolls a d20, whichever button sends it: Send becomes **Roll & send**, and every brain's chip wears the die, image brains included. The roll appears in the scrollback at once, as a die showing its number beside the line every brain reads. Then the brain's reply streams in, and the die goes back down.

Live, in the browser, on a copy of the Gilded Goat:
1. I sent the Dice Master "…talk Tobin down to half price… What do I roll?"
2. It answered "**Persuasion check:** roll 1d20 + 5, DC 12".
3. I armed the die and pressed Roll & send. "Rolling a d20…" tumbled for about 0.9 s while Venice accepted the request. Then the die showed **2**, and the GM narrated the failure: "Full price," he says.

No new commands. No DESIGN CONCERN. `npm run typecheck` is clean, `npm test` passes 177/177, and the web build succeeds.

## What I built

**The composer** (`features/chat/Composer.tsx`, `ChatView.tsx`)
- **The die toggle** sits beside the pen: a d20 drawn face-on (`components/D20.tsx`; the icon set only has d6s). Click or ⌥R arms it, and the button stays visibly pressed.
- **While it is armed:**
  - Send reads **Roll & send** (plus "to Game Master" at full width) with the die icon.
  - Each chip has a die in front of its name; an image brain's chip keeps its picture icon too.
  - Tooltips and aria-labels say "Roll a d20 and send to X".
  - The placeholder is "What you try, if anything; the roll goes after it…".
  - A one-chat-brain conversation shows the hint "Enter rolls and sends · Esc no roll".
- **The bar above the text** reads "Rolling a d20 · with your next send, then that brain answers" (or "after your words…" when you have typed). It also offers:
  - **Just roll** (`message.roll`): no brain is asked, and your typed words stay in the box.
  - **×**, or Esc, to disarm.
  - At phone width it shortens to "Rolling a d20 · Just roll ×".
- **One send, then down.** Any send passes `turn`'s `roll: true` and disarms the die.
- **Give-back.** `useChat.send(text, brain, {roll})` now resolves to `Unsent {text, roll}` when nothing was saved, either because Venice refused up front or because you stopped before it answered. Both your text and the armed die come back.
- **Once the roll is saved, the die stays down.** That is the triage rule (QA-2): after a stop, the resend is just that brain's chip with nothing typed.
- **Writing as someone has no roll.** While you write as someone (the pen), the die steps aside. Choosing to write as someone disarms it.

**The scrollback** (`features/chat/RollCard.tsx`, `MessageItem.tsx`, `Scrollback.tsx`)
- **A roll** sits on your side of the scrollback, with the player bubble's shape and a faint silver tint. The die shows its number, and beside it is the roll's line as Markdown (muted, with the number in bold). The die's tooltip says the server rolled it and that every brain reads the line beside it.
- **A new roll** settles in with a short spin (motion-safe only, and only for rolls under 8 s old).
- **A pending roll** (`pendingRoll` in `useChat`) is a tumbling die with "Rolling a d20…". It never shows a number until the real one arrives. It appears for a roll-and-send while Venice accepts, and briefly for Just roll.
- **An edited roll** (the honor system, triage QA-1):
  - the die is blank and dim;
  - the line is the face, at full size and color;
  - the footer reads `edited · 🎲 d20 said 15`, using `rollLabel(roll, true)`, with a tooltip explaining it.
- `roll.result` is never shown as the roll once the line is edited. The one place that decides this is `rollView(version)` in `web/src/lib/rolls.ts`.
- **Editing a roll** opens the usual raw-Markdown editor, captioned "Your roll's line: every brain reads what you save". Its footer actions say "Edit the roll's line" and "Delete the roll".

**The payload view** (`features/payload/PayloadDialog.tsx`)
- **An armed die** makes the next-send preview `prompt.preview --roll`. "With a roll" in the dialog's footer flips it, without touching the composer.
- **The subtitle** says where the roll goes.
- **`ROLL_PREVIEW_NOTE`** shows as information, not a warning.
- **The roll's own line** is tagged "your roll, rolled when you send", with its `{{roll}}` marked. `rollLineIndex` finds that line: the last message, or the one before a final reminder. A `{{roll}}` you typed elsewhere is not marked, because it is sent as written (QA-3).

**The templates editor** (`features/settings/TemplatesEditor.tsx`)
- **A fifth row, "Your dice rolls."** Its description says that every brain reads the line, that `{{roll}}` is the number, and that the template is used from the next roll on.
- **Without `{{roll}}`** it shows a warning while you type and refuses to save, matching the server.
- The Templates tab's intro now mentions dice rolls.

**Small polish, both serving the loop**
- **Notices keep the server's words, minus the terminal command.** Stop notices and broken-reply errors drop only the trailing terminal command (`: turn --brain b_… without --content or --roll`; `forBrowser` in `lib/format.ts`). What remains reads "…To get a reply, send again to Assistant with no new message and no new roll."
- **Chips get a little wider while the die is armed** (13rem rather than 11rem), so "Character Portraitist" isn't truncated by the extra icon.

## Verified in Chrome (DevTools MCP)

Mock (`SS_DATA_DIR=<scratchpad>/data npm run up:mock`, user `dev-t09-fe`):
- **The loop, Gilded Goat.**
  - I sent the action to the Dice Master, then pressed ⌥R and Enter. The recorded order: at 1 ms the composer is armed; at 27 ms the roll card "🎲 d20: 5" is in the ledger and Stop is showing; then the GM streams in; finally the die is off and the composer is empty.
  - A second roll-and-send with text: the text, then a 15, then the GM.
- **The pending die.** With the mock paused (`kill -STOP`), I saw the dimmed text, then "Rolling a d20…" tumbling, then the GM's dots.
  - **Stop at that point:** nothing was saved, and both the text and the armed die came back. The notice was "Stopped before the reply started. Nothing was saved." I resumed the mock and sent; it saved the text, the roll and the reply.
- **Edit to 3.** The die went blank, the line became the face, and the footer showed "edited · 🎲 d20 said 15". The GM's payload shows the line as `**3**`.
- **Payload.** With the die armed, the view showed the note and `{{roll}}` marked in [11], before the reminder in [12]. "With a roll" off removed the note and the mark. Switching to the Scene Painter, the image brain, kept the mark on the right line.
- **Image brain.** A roll-and-send to the Scene Painter's chip saved the text, then 16, then the prompt and the painted picture.
- **Just roll** (plain conversation, one brain): the roll was added with no `turn` call, "I check the lock." stayed in the composer, and the die went down.
- **Esc** disarmed the die. Esc inside the payload dialog closed only the dialog, and the die stayed armed.
- **Stop after the roll was saved** (`MOCK_SLOW` in the roll template, a brain with no reminder): the text and roll were kept, the composer was empty, and the die was off. The notice read "…Your message and your roll are saved; the reply isn't. To get a reply, send again to Assistant with no new message and no new roll." Send with nothing typed got the reply with no second roll.
- **Up-front refusal** (`MOCK_ERROR` in the roll template): nothing was added, "Venice 500 … MOCK_ERROR" showed, and both the text and the armed die came back.
- **Templates.** A value without `{{roll}}` showed the warning, and Save refused it ("Needs {{roll}}, where the number goes."). A valid one saved, and later rolls used it.
- **A second tab** opened mid-reply (`generation.follow`) showed the roll as a roll and followed the reply.
- **Width 500 px:** the bar shortens, the chips wrap, and there is no sideways scroll.
- **Network:** only `/api/<command>` calls (`turn`, `message.roll`, `generation.stop`, `conversation.update`, `prompt.preview`, …).
- **Console:** one expected 499, from the stop before Venice answered. Chrome logs every 4xx.

Live (`npm run up`, scratch data dir, user `dev-t09-live`): the loop above. **2 text calls, no images.** The balance went from $7.76068486 to $7.76025952, a drop of $0.00042534, exactly the conversation's `spentUsd`. No console messages.

Screenshots:
- `reports/screens/T09-armed.png`: the Dice Master's live odds sentence, with the die armed below it ("Rolling a d20" bar, dice on the chips, **Roll & send to Game Master**).
- `reports/screens/T09-loop.png`: the live loop: the action, the odds, the die showing 2, and the GM's reply.
- `reports/screens/T09-rolls-edited.png`: an unedited roll (5) and an edited one (blank die, "I rolled a d20: **3**", footer "edited · 🎲 d20 said 15").
- `reports/screens/T09-payload.png`: the payload view with "With a roll" on. [8] is the edited roll as the GM will read it, and [11] has `{{roll}}` marked.

## Tests

`test/web-api.test.ts` has a new T09 test of the web client against the real server:
- **Roll-and-send:** the events arrive as `message`, `message`, `start`, and the roll's version carries its die and line.
- **Display:** `rollView` for an unedited roll, an edited one and a typed line.
- **Just roll:** `message.roll` makes no upstream call.
- **Preview:** the note comes first, and `rollLineIndex` finds the roll's line (also with a final reminder after it), not a typed `{{roll}}`.
- **Template:** saving one is accepted, and one without `{{roll}}` is a 400.
- **A broken roll-and-send:** `forBrowser` against the server's real error text, and a `retryOf` that never rolls.

One flake caught and fixed before committing: the edit is now to a number other than the die's. An edit that changes nothing isn't marked edited, so when the die rolled 3 (1 run in 20), editing to "**3**" was a no-op. The "no brain asked" check now compares the mock's newest request, not the count, because the mock keeps only 20 requests.

## Known gaps

- **The pending die rarely shows on the mock.** The mock accepts in about 25 ms, so you only see it there by pausing the mock (AGENTS.md lesson). Live it shows for about a second.
- **The roll card's look is calm silver, with no special treatment for a natural 1 or 20.** What a roll means is the brains' business.
- **`message.roll` takes no text.** Just roll leaves your words in the composer rather than adding them first.
- **An edited roll's "d20 said N" footer shows on hover or focus only,** like every player message's footer.
