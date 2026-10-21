# T09 engineer: dice rolls

**Result:** the server rolls a real d20 and sends it to any brain in one command: `turn --brain "Game Master" --roll`. The roll goes into the ledger as an ordinary player message ("🎲 I rolled a d20: **14**"). Every brain reads it like anything else the player says, and you can edit or delete it like any message. The CLI prints `🎲 d20: 14` before the reply. `prompt.preview --roll` shows the request with `{{roll}}` where the number will go, plus a note saying so. `message.roll` just rolls, without asking any brain. The wording is a fifth template, `templates.roll`. Nothing in `buildRequest` changed.

Live, on a clone of the Gilded Goat with its prompts unchanged:
1. The GM named a Deception check.
2. The Dice Master gave "1d20 + 5, DC 14".
3. A roll-and-send of 18 got a success.
4. I edited the roll to 3 and regenerated the GM's reply, and got a failure.

`npm run typecheck` is clean, and `npm test` passes 176/176 (8 new tests in `test/dice.test.ts`, one new phrase in the leak test).

No DESIGN CONCERN. Below are the ticket's open calls and the one place where I took a different shape than the spec suggested.

## What I built

- **The die, `src/conversations/dice.ts`.** `rollD20()` is `crypto.randomInt(1, 21)`, which draws from the OS's random number generator and uses rejection sampling, so every face is equally likely. It is d20 only, and `Roll.die` leaves room for other dice.
- **A roll is a player message.** `rollMessage(conv, roll)` (in `turn.ts`) renders `templates.roll` with the number and returns a player text message:
  - its `content` is that line, which is exactly what every brain is sent, framed by the player template;
  - its version keeps `roll: {die: "d20", result}`, for display only, never sent.
  - Edit or delete it like any message. An edited roll is marked `edited` and keeps the die's own result, so `conversation.get` shows `── you · m_… · 🎲 d20: 18 · edited ──` above "🎲 I rolled a d20: **3**". That line is information, not a guard: it's the honor system.
- **Roll-and-send.** `planTurn(conv, {brain, content, roll})` puts your text first (if any), then the roll as a second player message, and the brain answers both.
  - In `turn`, the server rolls after taking the lock and before planning. Both messages are saved in one write once Venice accepts the request, and each gets its own `message` event before `start`. A client therefore shows the roll before the reply streams.
  - A refusal up front saves no roll and never shows one, the same as for typed text.
  - If the reply breaks, the roll stays, and the error says "Your roll is saved; the reply isn't. To retry, send again to Game Master with no new message and no new roll: turn --brain b_… without --content or --roll". `details.retry` never rolls.
  - Image brains work like any other: the painter paints from the roll.
- **Preview.** `planTurn(..., {roll: "unrolled"})` leaves `{{roll}}` as the template has it, and puts `ROLL_PREVIEW_NOTE` first in `notes`. It is the same function `turn` uses, so the placeholder is the only difference. The test replaces `{{roll}}` with the rolled number and `deepEqual`s the result with what the mock received.
- **The template.** `templates.roll` defaults to `🎲 I rolled a d20: **{{roll}}**`.
  - `conversation.update --templates.roll` edits it. A template without `{{roll}}` is refused there, and `rollMessage` refuses it too, for files written before the check.
  - Schema 3: `upgradeConversation` gives older files the default on load. Campaign files without it get the default too.
  - A version's `roll` survives import. It is dropped from a brain's message, since only the player rolls.
- **CLI.**
  - `printStream` prints `🎲 d20: N` on stderr when a roll's `message` event arrives, so `turn > reply.md` still captures only the reply. `generation.follow` replays it too.
  - `conversation.get` and `message.get` put `🎲 d20: N` in the message's header line.
  - `rollLabel` (in `wording.ts`) holds those words for both clients.
- **Web plumbing only (no UI).** `web/src/api/types.ts` now has `turn`'s `roll`, `prompt.preview`'s `roll`, `message.roll`, `Roll`, `rollLabel` and `ROLL_PREVIEW_NOTE`, so the Frontend pass starts with typed calls.

## Commands added or changed

| Command | Change |
|---|---|
| `turn --roll` | Rolls a d20 and adds it after `--content` (if any), then the brain answers. Prints `🎲 d20: N` on stderr. |
| `message.roll --conversation` | **New.** Rolls and adds the roll as your message; no brain is asked. Gets a 409 while a reply is being generated. |
| `prompt.preview --roll` | The roll-and-send's request with `{{roll}}` in place, plus `ROLL_PREVIEW_NOTE`. Using it with `--regenerate` is a 400. |
| `conversation.update --templates.roll` | The roll's wording. It must contain `{{roll}}`. |
| `conversation.get`, `message.get` | The header of a roll message shows `🎲 d20: N`. |

## Engineer's calls

| Question | Call | Why |
|---|---|---|
| When is the roll template applied? | **Once, when the server rolls.** The message holds the line it made, so a changed template shows in later rolls, and earlier rolls keep their text. | The spec's "new conversation template with a placeholder" was a guess about where the wording lives. The other option was to store the number and render the template inside `buildRequest`, as the framing templates are. Then a roll's text would only become words at send time, editing a roll would mean editing a number rather than the line the brains read, and both clients plus the builder would need to know the rule. This way a roll's `content` is exactly what is sent, and nothing in prompt assembly changed. |
| Text and a roll in one action? | **Two messages, text first.** | The action, then its roll, each editable or deletable on its own. The browser's reducer already upserts every `message` event. |
| What does the preview show for the number? | **`{{roll}}`, plus a note**, not a sample number. | A sample number looks like a roll that has already happened. The placeholder plainly isn't one, and it is the only byte that differs. |
| Other dice? | **d20 only.** | Jason asked for d20 only. `Roll.die` is a field, so adding more dice later is a widening, not a migration. |
| Where does the "just roll" ability live? | **`message.roll`.** | It mirrors `message.add` the way `turn --roll` mirrors `turn --content`. |
| `source` of a roll? | **`authored`.** | A roll is the player's own action. The `roll` field says how its text came about. |

## Transcript (trimmed)

Mock (`npm run up:mock`, user `dev-t09-mock`, `conversation.import --example dnd-tavern`, `SST_CONVERSATION` set):

```
$ ./sst prompt.preview --brain "Game Master" --content "I tell him the letter is for my sister." --roll
Exact request for brain "Game Master" (b_unplag6fun): POST /chat/completions
Note: The d20 isn't rolled yet. When you send, the server rolls it and puts the number (1 to 20) where {{roll}} is; the rest of this body is exactly what is sent.
Note: Stop sequences: "<!-- from:". ...
── [4] user ──
<!-- from: the player -->
🎲 I rolled a d20: **{{roll}}**

$ ./sst turn --brain "Game Master" --content "I tell him the letter is for my sister." --roll
🎲 d20: 1
[Game Master · in "The Gilded Goat (D&D 5e)"]
MOCK reply to brain "You are the Game Master of a r"; saw 6 messages; last: "<!-- System reminder --> You a… no <!-- from: ... --> lines."
[Game Master · 1641 in / 35 out · $0.00053]

$ ./sst prompt.preview --brain "Dice Master"          (the last messages)
── [3] user ──
<!-- from: the player -->
I tell him the letter is for my sister.

── [4] user ──
<!-- from: the player -->
🎲 I rolled a d20: **1**

── [5] user ──
<!-- from: Game Master -->
MOCK reply to brain ...

$ ./sst conversation.get                              (tail)
── you · m_1ltg01gsla ──
I tell him the letter is for my sister.

── you · m_h800n04g9u · 🎲 d20: 1 ──
🎲 I rolled a d20: **1**

── Game Master · m_o2ckwugind · $0.00053 ──
MOCK reply to brain ...

$ ./sst message.roll
🎲 d20: 6
Added m_vfjg0onoxd (your roll). Every brain sees it from the next request. Have a brain answer it: ./sst turn --conversation c_2qyuc10n1w --brain <name>
(mock /_mock/requests still lists 1 chat request: message.roll asked no brain)

$ ./sst turn --brain "Scene Painter" --roll
🎲 d20: 4
[Scene Painter · in "The Gilded Goat (D&D 5e)"]
MOCK image prompt after 9 messages; last: "<!-- System reminder --> Call generate_image with one prompt"
(making image img_c7c6ox02yc with z-image-turbo... the conversation is free meanwhile)
(image ready: ./sst image.get --id img_c7c6ox02yc --open)
[Scene Painter · 1086 in / 30 out · $0.00036 · image img_c7c6ox02yc done (z-image-turbo, png, $0.01)]
```

Live (`npm run up`, encrypted user `dev-t09-live`, `conversation.import --example dnd-tavern` then `conversation.clone --title "Gilded Goat, T09 dice"`):

```
$ ./sst turn --content "I slide into the hooded figure's booth and tell her, with a straight face, that I'm a royal courier and can carry her letter anywhere in the kingdom for free."
[Game Master · in "Gilded Goat, T09 dice"]
You slide onto the bench opposite the hooded figure. Up close you can see freckles, and a wisp of red hair escaping the hood. ...
Moss the cat chooses this moment to abandon the fireside and settle, heavily, on the end of your bench.

That's a Deception check.
[Game Master · 1636 in / 144 out · $0.00066]

$ ./sst turn --brain "Dice Master" --content "What do I roll?"
**Deception check:** roll 1d20 + 5, DC 14. Make it, and she believes you're a royal courier.
[Dice Master · 1265 in / 32 out · $0.00042]

$ ./sst turn --brain "Game Master" --roll
🎲 d20: 18
[Game Master · in "Gilded Goat, T09 dice"]
The freckled face goes still, then brightens in a way that is almost painful to watch. "A royal courier. Here. Of course—of *course*. ..."
The letter slides across the table ... "I'd have five gold."
[Game Master · 1848 in / 167 out · $0.00036]

$ ./sst message.edit --message m_5qdv6y3sca --content '🎲 I rolled a d20: **3**'      # the honor system, as a check
$ ./sst message.regenerate
"A royal courier," she repeats slowly. "In a travel-stained blue coat. In Millbrook. In the rain." ...
"No," she says. "No, you're not." But she doesn't get up, and she doesn't put the letter away. ...
[Game Master · version 2/2 · 1848 in / 132 out · $0.00025]

$ ./sst conversation.get | grep -A1 m_5qdv6y3sca
── you · m_5qdv6y3sca · 🎲 d20: 18 · edited ──
🎲 I rolled a d20: **3**
```

The outcomes match the rolls: 18 + 5 = 23 against DC 14 is a success, and 3 + 5 = 8 is a failure, played "awkwardly but never disastrously" as the GM's prompt asks. The GM added the Dice Master's modifier itself.

## Live spend

4 text calls, no images. The balance went from **$7.76324315** to **$7.76155107**, a drop of $0.00169. That matches the conversation's recorded total ($0.0017). Both `dev-t09-*` users were deleted afterwards, and the server is stopped.

## Tests (`test/dice.test.ts`, 8 tests)

- 4000 rolls: all are whole numbers from 1 to 20, every face turns up, and no face is more than ~7 standard deviations from 200.
- `planTurn`: the text comes first and the roll after it, framed as the player's. The preview keeps `{{roll}}`, carries the note and has no `roll` field. A template without `{{roll}}` is refused.
- Acceptance, end to end:
  - `turn --brain "Game Master" --content … --roll` prints `🎲 d20: N` before `[Game Master]` and puts only the reply on stdout.
  - The ledger is text, roll, reply.
  - The preview with `{{roll}}` replaced equals the body the mock received.
  - All three brains' previews contain the roll as a framed player line, the image brain's included.
- A roll-and-send to an image brain paints, and the prompt quotes the roll.
- The honor system:
  - `message.roll` makes no upstream call.
  - Editing the roll changes what the next brain reads, and the old number is gone from the request.
  - The header shows `🎲 d20: N · edited`, and delete works.
- The template:
  - A template without `{{roll}}` is refused.
  - A new wording shows in the preview and in the next roll, while earlier rolls keep their text.
  - A schema-2 file with no roll template loads at schema 3 with the default.
- Failures:
  - `MOCK_ERROR` in the roll template is refused up front, and the ledger stays empty.
  - `MOCK_MIDSTREAM_ERROR` keeps the roll, and the retry text says "no new roll … without --content or --roll".
- `--regenerate --roll` is a 400, and a `conversation.get --json` round trip through `conversation.import` keeps the roll.
- `test/encryption.test.ts`: a roll-template phrase, which lands in the template and in the roll's message, is ciphertext for the encrypted user and is found on disk for the plaintext control.
- Updated three existing assertions:
  - `campaigns.test.ts`: the imported templates are the defaults plus the file's.
  - `stop.test.ts`: `SCHEMA_VERSION` instead of a literal 2.
  - `regenerate.test.ts`: the new wording "takes no content, roll or brain".

## Known gaps

- **Browser:** there is no roll control yet; that is the Frontend pass. README's browser paragraphs (the example campaign's loop, and Play) still say to tell the Dice Master your roll. I added only the terminal lines, so the Frontend pass should update the browser paragraphs.
- **The Gilded Goat's Dice Master** still offers to "roll fairly" for the player if asked, which means a model rolling. Its prompts worked unchanged with a real roll, so I left the tuned example alone. For T10, a preset's Show Me the Odds should say the player rolls and should never roll itself (TICKETS.md, "For T10").
- **Modifiers** are the brains' arithmetic. The die is a bare d20, and the GM (or T10's odds sentence, which folds them into the target) does the rest. Live, the GM added +5 correctly both times.
- **A roll refused up front** (no balance, an unknown model) is discarded unseen, so sending again rolls again. That is the honor system's business, and it matches how typed text behaves.
- **`message.roll` takes no text.** Use `message.add --as player` first, or `turn --content … --roll`.

## design.md changes

- New section **"Dice rolls (T09)"** covering:
  - the loop;
  - the server's die;
  - a roll as an ordinary player message;
  - the honor system;
  - the template, and why it is applied once, at roll time;
  - roll-and-send order and failure;
  - `message.roll`;
  - the honest preview;
  - the terminal;
  - a recipe for the browser;
  - the live check.
- Conversation document: `schemaVersion: 3`, `templates.roll`, and `MessageVersion.roll`.
- Placeholders: five now, with `roll` needing `{{roll}}`.
- Vocabulary: a new **Roll** entry.
- **turn** takes `roll`.
- The stream `message` event can come twice.
- The command list now includes `message.roll`.
- New "Implemented in T09" notes.
- AGENTS.md: two "Running it" lines and a lesson on testing rolls (placeholder replacement, triggers in the roll template, and rolling the same number twice).
