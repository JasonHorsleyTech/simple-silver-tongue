# T09 triage: dice rolls

**Result:** fixed 3, deferred 0, dismissed 0. No DESIGN CONCERN.

The most important fix is QA-1. An edited roll no longer shows the die's number as if it were the roll, and the browser has a firm rule for how to show one. All three fixes are small: two server strings, one shared label, and the browser recipe in design.md and TICKETS.md.

## Decisions

| Finding | Decision | What changed / why |
|---|---|---|
| **QA-1** (minor): an edited roll still carries the die's original number, and the frontend recipe would show it as the roll | **FIX** | **The rule:** once a roll's line is edited, the line *is* the roll, because it is what every brain was told. The die's own number is only history.<br>**Shared label:** `rollLabel(roll, edited)` in `wording.ts` (shared by both clients) now says `🎲 d20 said 12` for an edited roll and `🎲 d20: 12` for an unedited one. The CLI header (`conversation.get`, `message.get`) now reads `── you · m_… · 🎲 d20 said 12 · edited ──` above `🎲 I rolled a d20: **3**`.<br>**Browser recipe** (design.md "Dice rolls", TICKETS.md "From T09 triage"): an edited roll's `content` is its face, `roll.result` never appears as the roll (not on the die, not as its label), and the die's number shows only as quiet history beside the "edited" mark.<br>**No data change:** `message.edit` still keeps `roll` on the version. Dropping it would also work, but it would lose the history, and the label already makes the truth easy to show.<br>**Why not parse the number back out of the edited text:** that's fragile, and the brains read the text, not a number. |
| **QA-2** (nit): a stopped roll-and-send doesn't say "no new roll", so the up arrow rolls a second die | **FIX** | `turn`'s `Say` gains a `resend` line. It is used only when a stop before any reply text kept something (`stoppedEarly` in `chat.ts`, which covers both `collectReply` and `paintReply`'s stopped branch). The stop now says "…Your roll is saved; the reply isn't. To get a reply, send again to Game Master with no new message and no new roll: turn --brain b_… without --content or --roll."<br>A typed message gets the "no new message" half, which closes the same gap from before T09. A stop that kept nothing still says only "No reply was saved." The line leaves out "or Retry in the browser", because a stop has no Retry button. |
| **QA-3** (nit): the preview note says the number goes "where {{roll}} is", but a `{{roll}}` anywhere else stays as typed | **FIX** | `ROLL_PREVIEW_NOTE` now reads: "…puts the number (1 to 20) where {{roll}} is in your roll's line, the newest player message (a {{roll}} anywhere else is sent as written). The rest of this body is exactly what is sent."<br>It says "newest player message", not "last message", because with a final reminder the roll's line is second to last.<br>`test/dice.test.ts`'s acceptance test now types a `{{roll}}` in the player's text and puts the number only in the roll's message. Before, a first-occurrence `replace` would have hit the typed one. |

## Tests

- `test/dice.test.ts` has 3 changes:
  - **QA-1:** checks `rollLabel(…, true)`, and that the edited header reads `🎲 d20 said N · edited`.
  - **QA-2:** a stop at the first `reasoning` event of a `MOCK_SLOW {{roll}}` roll-and-send gives the exact "no new roll" line, and the roll stays.
  - **QA-3:** a typed `{{roll}}` survives, and preview equals send with only the roll's line filled in.
- `test/regenerate.test.ts`: the stop-before-text assertion now expects the "no new message" line.
- `npm run typecheck` is clean, and `npm test` passes 176/176.

## Re-verification (mock, user `dev-t09-tri`, deleted afterwards; server stopped)

QA's commands, after the fix:

```
## QA-1
$ ./sst turn --brain "Game Master" --roll                         # 🎲 d20: 8
$ ./sst conversation.get | grep -A1 m_zzh2cghe5s
── you · m_zzh2cghe5s · 🎲 d20: 8 ──
🎲 I rolled a d20: **8**
$ ./sst message.edit --message m_zzh2cghe5s --content '🎲 I rolled a d20: **3**'
$ ./sst conversation.get | grep -A1 m_zzh2cghe5s
── you · m_zzh2cghe5s · 🎲 d20 said 8 · edited ──
🎲 I rolled a d20: **3**
$ ./sst message.get --message m_zzh2cghe5s
── version 1/1 (active) · authored · 🎲 d20 said 8 · edited ──

## QA-3
$ ./sst prompt.preview --content 'I carve "{{roll}}" into the table.' --roll | grep "^Note: The d20"
Note: The d20 isn't rolled yet. When you send, the server rolls it and puts the number (1 to 20) where {{roll}} is in your roll's line, the newest player message (a {{roll}} anywhere else is sent as written). The rest of this body is exactly what is sent.

## QA-2 (scratch NDJSON client: post turn, generation.stop on `start`; GM reminder off, roll template "MOCK_SLOW {{roll}}")
roll:      Stopped before any reply text arrived. Your roll is saved; the reply isn't. To get a reply, send again to Game Master with no new message and no new roll: turn --brain b_upur3jkbew without --content or --roll.
typed:     Stopped before any reply text arrived. Your message is saved; the reply isn't. To get a reply, send again to Game Master with no new message: turn --brain b_upur3jkbew without --content.
bare turn: Stopped before any reply text arrived. No reply was saved.
```

Acceptance, re-run on a fresh Gilded Goat (`--without-messages`):

```
$ ./sst turn --brain "Game Master" --roll
🎲 d20: 18
[Game Master · in "The Gilded Goat (D&D 5e)"]
MOCK reply to brain "You are the Game Master of a r"; saw 4 messages; …
$ ./sst prompt.preview --brain "Dice Master" --json | jq …        (last six messages)
["user","<!-- from: the player --> | 🎲 I rolled a d20: **18**"]
["user","<!-- from: Game Master --> | MOCK reply to brain …"]
["user","<!-- from: the player --> | I carve \"{{roll}}\" into the tabl"]
["user","<!-- from: the player --> | 🎲 I rolled a d20: **20**"]
["user","<!-- from: Game Master --> | MOCK reply to brain …"]
["user","<!-- System reminder --> | You are the Dice Master: answer o"]
```

Preview equals send, with a typed `{{roll}}`. I saved the `prompt.preview --content 'I carve "{{roll}}" into the table.' --roll --json` body, then ran `turn` with the same flags, which rolled 20. In the preview I filled in `{{roll}}` in the roll's message only (`messages[-2]`, since the GM's reminder is last), and `cmp` matched it with the mock's newest `/chat/completions` body: **IDENTICAL**. The body sent still holds `I carve "{{roll}}" into the table.` as typed.

## Live spend

None.
