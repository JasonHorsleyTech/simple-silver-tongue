# T09 QA: Dice rolls

**Verdict:** Acceptance passes. 0 blockers, 0 majors, 1 minor (an edited roll still carries the die's original number, and the frontend recipe would show it as the roll), 2 nits. No DESIGN CONCERN.

The die is fair, and every path I tried treats the roll as an ordinary player message. Over 2,000,000 direct rolls, chi² was 8.4 on 19 degrees of freedom, and the repeat rate was 0.04994. Over 1,000 rolls through `message.roll`, chi² was 19.5, and every saved line matched its number. Hard rule 1 holds:
- The roll's text is the template's.
- No `roll` field reaches a request.
- `prompt.preview --roll`, with `{{roll}}` replaced by the number rolled, was byte-identical to the body the mock received, and to the live request too (checked through the regenerate preview).

The three findings are about wording and display, not plumbing.

## How I ran it

- `npm run typecheck` is clean, and `npm test` passes 176/176 before I started.
- `npm run up:mock` with a plaintext user `qa-t09-plain` and an encrypted user `qa-t09-enc`. Both are now deleted, and the server is stopped.
- I wrote scratch scripts outside the repo:
  - a fairness run over `rollD20()`, and another through the `message.roll` API;
  - a stop-at-event NDJSON client;
  - a race of `message.roll` against `turn`;
  - a script that rewrote an **encrypted** conversation back to schema 2 through the vault.
- **Live: 4 text calls, no images.** The balance went from $7.76155107 to $7.76068486, a drop of $0.00087, which matches the conversation's recorded `spentUsd`. One of the 4 calls was wasted: a shell slip (`tac` isn't on macOS) left the ledger uncleaned before a Dice Master turn.

## Acceptance checklist

| Bullet | Result | Evidence |
|---|---|---|
| Mock: `turn --brain "Game Master" --roll` prints the roll, then the reply | **pass** | Stderr was `🎲 d20: 12`, `[Game Master]`, then the usage line. Stdout held only the reply. The ledger is text, then the roll (`── you · m_… · 🎲 d20: 12 ──`), then the GM's reply. |
| Afterwards `prompt.preview --brain "Dice Master"` shows the roll framed as a player line | **pass** | `[4] user: <!-- from: the player -->\n🎲 I rolled a d20: **12**`. It is the same in the previews of the Joke Teller, the Scene Painter and the Character Portraitist (image brains). |
| Live, on a clone of the Gilded Goat (encrypted user): the GM names a check | **pass** | The player bluffed being a royal courier, and the GM ended with "That's a Deception check." |
| … the Dice Master gives the target | **pass** | "**Deception check:** roll 1d20 + 5, DC 12. Make it, and she buys the courier story." |
| … a roll-and-send to the GM gets an outcome that matches the roll | **pass** | It rolled 3, and 3 + 5 = 8 < 12. The GM narrated a failure ("Royal couriers don't come to Millbrook… I think you're a bard who wants to know what's in my letter."). The `prompt.preview --roll --json` taken before the send, with `{{roll}}`→`3`, equals `prompt.preview --regenerate --json` taken after it, which is the body that reply answered. |

The live run also had a roll-and-send to the **Dice Master**: it rolled 12, and the Dice Master answered "12 + 5 = **17** vs DC 13: success". So a second brain reads the bare roll correctly too.

## What else I checked, all passing

- **Preview equals send** (mock): I took the `prompt.preview --content … --roll --json` body, replaced `{{roll}}` with the number rolled, and `cmp` matched it with the mock's `/_mock/requests` body. `ROLL_PREVIEW_NOTE` is the first note. The image-brain preview shows the note, the `{{roll}}` line and the `/image/generate` request.
- **Failures:**
  - **An up-front error** (`MOCK_ERROR` in the roll template): exit 1, and the ledger is unchanged (6 → 6). The text isn't saved and the roll isn't saved.
  - **A mid-stream break** (`MOCK_MIDSTREAM_ERROR`):
    - The text and the roll are both kept.
    - The error says "Your message and your roll are saved … no new message and no new roll: turn --brain b_… without --content or --roll".
    - The roll-only case says "Your roll is saved".
    - `details.retry` is `{command: "turn", args: {conversation, brain}}`, with no `roll`.
  - **An image brain that wrote no tool call** (`MOCK_NO_TOOL_CALL`): the same "Your roll is saved … no new roll" wording.
  - **Retry:** a `turn` with no `--roll` afterwards answers the saved roll.
- **Stops:**
  - **On `start`:** "Stopped before any reply text arrived. Your roll is saved; the reply isn't." The roll is in the ledger.
  - **Before Venice answered** (`kill -STOP` the mock): "Stopped before the reply started. Nothing was saved." No text, no roll.
- **Server killed mid-reply** (`kill -9` after the roll event, then `up:mock` again): the text and the roll are both on disk, and there is no reply, as with a typed message.
- **The 409 lock:**
  - **During a `MOCK_SLOW` turn:** `message.roll` gets "busy … then change the messages", and `turn --roll` gets "busy … a reply is still being generated". Both exit 1.
  - **While an image paints:** `message.roll` and `turn --roll` both go through, since images don't hold the lock.
  - **The race:** I raced `message.roll` against `turn` in 90 rounds, in random order, 0–3 ms apart: 46 rolls landed and 44 got a 409. Every brain reply still answered every message before it (`saw N` = its index + 1 in all 90).
- **`generation.follow`** from a second terminal mid-reply replays `🎲 d20: 17` before `[Assistant]`, as the original client printed it.
- **Regenerate:** a steered regenerate of the GM's reply still sends the roll, and nothing rolls again. Regenerating the roll message itself is refused, because it isn't the last message and it is the player's. `prompt.preview --regenerate --roll` is a 400, and `message.regenerate --roll` is a usage error.
- **Edit and delete:** editing a roll to `**3**` changes what the next brain reads (the Dice Master's preview shows `**3**`). The version is marked `edited` and keeps `roll.result: 12` (see QA-1). After deleting a roll, it is gone from the preview.
- **Image brains:** `turn --brain "Scene Painter" --roll` printed `🎲 d20: 13`, then the prompt, then the finished image. The image message comes after the roll.
- **The template:**
  - **Refused by `conversation.update`:** an empty template, `{{ roll }}`, `{{ROLL}}` and `{roll}`, each with a clear message.
  - **Accepted:** a bare `{{roll}}` (the line is `10`).
  - **Two `{{roll}}`** both get the number.
  - **`{{content}}` and `{{brain}}`** in the roll template stay as typed, and the preview shows them.
  - **A template without `{{roll}}` written into the file by hand:** `message.roll`, `turn --roll` and `prompt.preview --roll` all give a 400 and save nothing. A plain `turn` still works.
- **Clone and import:**
  - **`conversation.clone`** keeps every roll (including an edited one's `edited: true`) and a custom `templates.roll`. `--without-messages` keeps the template.
  - **A `conversation.get --json` round trip** keeps the rolls.
  - **A campaign with `templates.roll` lacking `{{roll}}`** is refused with its path. A roll with a bad `die` or `result` is refused with its path.
  - **A `roll` on a brain message** is dropped.
  - **A campaign with no templates**, or with a schema-2 export and no `roll` template, gets the default.
- **Schema 3 upgrade on load:**
  - **Plaintext:** a file rewritten as schema 2, with no `templates.roll` and no `stop`, loads as 3 with the default template and stop. It stays 2 on disk until the next write (`message.roll`), then it is 3.
  - **Encrypted:** I decrypted a conversation through `unlockUser` + `readJson`, removed its roll template, wrote it back as schema 2 (still `SSENC1` on disk), and loaded it. `conversation.get` shows schema 3 with the default, `prompt.preview --roll` shows the `{{roll}}` line, and `turn --roll` works. Cloning a schema-2 source gives a schema-3 clone.
- **Encryption on disk:** I used a unique phrase in the roll template and the typed text (`ZEBRAPHRASE … QUOKKA`, `PANGOLINWORD`), plus "rolled a d20". None of them appear in `data/users/qa-t09-enc/` or `.run/`. `.run/server.log` holds no message text and no stack traces. The 409s are logged as `message.roll failed: 409 conflict` only.
- **CLI:**
  - `SS_CONVERSATION` fills in `message.roll`'s `--conversation`.
  - `message.roll --content` is a usage error (exit 2).
  - `--no-roll` and `--roll=false` preview no roll.
  - `help turn`, `help message.roll` and the command list all describe the roll.
  - An unknown conversation is a clean 404.

## Findings

### QA-1 · minor · An edited roll still carries the die's original number, and the frontend recipe would show that number as the roll

**Repro (mock):**
```
./ss turn --conversation c_… --brain "Game Master" --roll          # 🎲 d20: 12
./ss message.edit --conversation c_… --message m_<roll> --content '🎲 I rolled a d20: **3**'
./ss conversation.get --id c_…
  ── you · m_<roll> · 🎲 d20: 12 · edited ──
  🎲 I rolled a d20: **3**
```

**Expected:** the edit becomes what the history "always was" (AGENTS.md, feature 2). Every brain now reads 3, and the engineer's own live check depended on that: the GM narrated a failure for the edited 3. So the display should lead with what the brains read.

**Actual:**
- The terminal is acceptable: the header still says `🎲 d20: 12`, but it adds `· edited`, and the 3 sits right under it.
- The trouble is the browser recipe for the Frontend pass (design.md, "Dice rolls", *For the browser*; and TICKETS.md's "For Frontend"): "A version with `roll` is a roll: show `rollLabel(roll)` ("🎲 d20: 14") and the die, set apart from typed lines; its `content` is what the brains read (show it, or at least when `edited`)." Followed literally, the scrollback would show a big die reading 12 next to a GM narrating a 3. This is the honor-system edit the ticket invites ("edit it, delete it").

**Recommendation:** no server change. For an `edited` roll, the frontend should make the content the face of the message, and show the die's own number only as a quiet aside ("the die said 12"), or not at all. In the CLI, `🎲 d20: 12 · edited` could become `🎲 d20 said 12 · edited`. Update the design.md recipe so the frontend pass builds it that way.

**Cause:** `src/commands/messages.ts` (`message.edit` keeps `roll` on the version, by design) and the design.md recipe.

### QA-2 · nit · A stopped roll-and-send doesn't say "no new roll", so re-running the command from shell history rolls a second die

**Repro (mock):** put `MOCK_SLOW {{roll}}` in the roll template, run `turn --roll`, and post `generation.stop` on the `start` event.

**Actual:** "Stopped before any reply text arrived. Your roll is saved; the reply isn't." The break and no-prompt errors say "To retry, send again … with no new message and no new roll: turn --brain b_… without --content or --roll". The stop message has no such line. A terminal user's natural next step is the up arrow, which re-sends `--roll`. The ledger then holds two rolls in a row, and the brain reads both.

**Expected:** the same retry hint as the break errors. The texts are built in `collectReply` (`src/commands/chat.ts`, `throw stopped(\`Stopped before any reply text arrived. ${say.kept}\`)`) and in `paintReply`'s stopped branch. Appending `say.retry` there would do it.

This is a nit because the duplicate is visible (the CLI prints the second `🎲 d20: N`), it is the honor system's business, and a stop is deliberate. Typed text has the same gap, which predates T09.

### QA-3 · nit · The preview note says the number goes "where {{roll}} is", but a `{{roll}}` anywhere else in the body stays as typed

**Repro (mock):**
```
./ss prompt.preview --conversation c_… --content 'I carve "{{roll}}" into the table.' --roll
  Note: The d20 isn't rolled yet. When you send, the server rolls it and puts the number (1 to 20) where {{roll}} is; ...
  I carve "{{roll}}" into the table.
  🎲 I rolled a d20: **{{roll}}**
./ss turn --conversation c_… --content 'I carve "{{roll}}" into the table.' --roll
  sent: I carve "{{roll}}" into the table.  /  🎲 I rolled a d20: **8**
```

**Expected:** the note should be exact, since the preview's promise is that `{{roll}}` is "the only difference" (hard rule 1's payload view). The same applies to a `{{roll}}` in a system prompt, a setup message or an earlier reply. That case is plausible once T10 presets explain the roll line to their brains.

**Actual:** the body shows two `{{roll}}`, and only the roll's own line gets a number.

**Suggested fix:** word the note as "…puts the number where {{roll}} is in the roll's line (your last message)…". `test/dice.test.ts` replaces every `{{roll}}` in the body, so it would make the same mistake if a fixture ever had one elsewhere.

**Cause:** `src/conversations/wording.ts`, `ROLL_PREVIEW_NOTE`.

## Notes for the next passes

- **Frontend:** the existing UI has no roll control yet, and its `TemplatesEditor` lists four templates. The `turn`/`message` NDJSON shape is as the engineer described: the roll's `message` event comes before `start`, after the text's. A browser follower would get the same events, since `generation.follow` replays them.
- **T10:** the Gilded Goat's Dice Master still offers to "roll fairly" for the player. Live it never did, but a preset's odds brain should say the player rolls with the app (the engineer noted this too).
