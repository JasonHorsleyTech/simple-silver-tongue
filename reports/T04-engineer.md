# T04 engineer report: multiple brains, setup messages and templates (CP3)

No design concern. The T02 prompt builder already did what design.md says for several brains. I checked it end to end with three brains, on the mock and live, before trusting it, and it needed no change. T04 is the commands, the validation and one piece of lock plumbing on top of it.

## What I built

- **Brains, mid-campaign included.**
  - `brain.add` adds a named persona that shares the ledger. From its first request it sees everything said so far: everyone else's lines framed, and its own replies (none yet) as `assistant`.
  - Its final reminder is **on and pre-filled** with an editable example, `REMINDER_EXAMPLE`: "`<!-- System reminder -->` Stay in your role: do only the job your system prompt describes, and reply only as yourself." It names no brain, so a rename can't make it wrong. The conversation's first brain gets the same text, switched off.
  - A new brain gets the first unused badge color.
  - `brain.update` now also takes `--kind`, `--safe-mode` and `--tool.<field>`. `brain.set-default` changes which brain `turn` talks to without `--brain`. `brain.list` shows every brain's system prompt, reminder and tool text in full.
- **The rules design.md asks for, enforced inside the conversation's write queue:**
  - A brain that has spoken can't be deleted (`brain_in_use`, 409): every other brain still sees its lines under its name.
  - The default brain can't be deleted (`default_brain`, 409).
  - Kind is locked once a brain has messages (`kind_locked`, 409).
  - Names are unique (case-insensitive) and never look like an id. **`player` is reserved**, because `message.add --as player` means you.
  - Safe mode and tool text are refused on a text brain. Switching a brain to image kind fills in `DEFAULT_TOOL` and `safeMode: true`.
- **"Not while it is writing" (the T03 QA-1 lesson).**
  - Each generation now records which brain is answering, right after planning (`gen.forBrain`). `assertBrainIdle` runs inside `mutateConversation`, as `assertLedgerIdle` does, and refuses to delete a brain or change its kind while that brain's reply is in flight.
  - Without this, a brain's *first* reply isn't in the ledger yet, so the "has it spoken?" check would pass. The save would then add a message by a brain that no longer exists, and every later request would crash on it.
  - In the moment between the lock and the plan, the brain isn't known yet, so every brain counts as busy.
  - Other brains can still be added, edited and deleted mid-reply, and so can setup messages.
- **Setup messages** (World Bible etc.): `setup.add`, `.update`, `.move`, `.delete` and `.list`.
  - Without content, `setup.add` pre-fills `<!-- This is the <label>. -->`. The label defaults to "World Bible", so the default is exactly `<!-- This is the World Bible. -->`.
  - `--setup` takes an id or a label.
  - Every setup command returns the whole ordered list.
- **`message.add --as player|<brain>`** appends hand-written words with `source: "authored"`, e.g. the GM's opener. That brain sees them as its own `assistant` message; everyone else sees them framed with its name. Refused (409) while a reply is being generated.
- **`turn --brain` / `prompt.preview --brain`** were already there (T02). The help text now says that any brain can take any turn and that an empty message makes it just respond.
- **Help lists nested fields.** `./ss help brain.update` now lists each field of an object argument as its own flag (`--final-reminder.content`, `--tool.description`, `--reasoning.effort none|...`), instead of a bare `<json>`. That makes the tool text and reminder discoverable from the terminal. `conversation.update`'s settings and templates benefit too.
- **The pre-fill text** (`REMINDER_EXAMPLE`, `DEFAULT_TOOL`, `setupPrefill`) lives in the dependency-free `src/conversations/wording.ts`, so the browser can show the server's own words, as it does for `STOP_BILL_NOTE`.
- **The `conversation.get` text view** marks hand-written brain lines "written by you", flags brains whose reminder is on, and shows setup ids.

## Commands added or changed

| Command | What it does |
|---|---|
| `brain.list --conversation` | Every brain in full, plus its message count (so a UI knows what is deletable). |
| `brain.add --conversation --name --system-prompt [--color --kind --reasoning.* --final-reminder.* --safe-mode --tool.*]` | Adds a brain and returns it. |
| `brain.update` (+ `--kind --safe-mode --tool.*`) | Edits any field, any time. Kind is locked once the brain has messages. |
| `brain.delete --conversation --brain` | Only a brain that has never spoken, isn't the default and isn't writing. Returns `{deleted, name, brains}`. |
| `brain.set-default --conversation --brain` | Returns the brain. |
| `setup.list / .add [--label --content --position] / .update --setup / .move --setup --position / .delete --setup` | Positions are 1-based. Each returns `{conversationId, setup, changed? \| deleted?}`. |
| `message.add --conversation --as player\|<brain> --content` | Authored message, no generation. |
| `turn`, `prompt.preview` | Help text only. `turn` and `message.regenerate` call `gen.forBrain`. |
| `help <command>` | Lists an object argument's fields one by one. |

`--brain` takes a name (case-insensitive) or an id everywhere, through `resolveBrain`, and so does `message.add --as`.

## Terminal transcript (mock, `npm run up:mock`, user `dev-t04-mock`)

**The D&D table:**
```
$ C=$(./ss conversation.create --title "Gilded Goat (mock)" --system-prompt "You are the GM of a D&D one-shot in a tavern. ..." --json | jq -r .id)
$ ./ss brain.update --conversation $C --name "Game Master"
Updated brain Game Master (b_3bvhmjagm5) · text · reasoning off · final reminder off · system prompt 101 chars
$ ./ss setup.add --conversation $C
── 1. World Bible (s_vgcmfiryba) · 33 chars · changed ──
<!-- This is the World Bible. -->
$ ./ss setup.update --conversation $C --setup "world bible" --content $'<!-- This is the World Bible. -->\nThe Gilded Goat is a smoky tavern in Saltmarsh. ...'
$ ./ss message.add --conversation $C --as "Game Master" --content "Rain hammers the shutters of the Gilded Goat. ..."
Added m_9eqs2lfbkg (in Game Master's mouth). Every brain sees it from the next request.
$ ./ss brain.add --conversation $C --name "Dice Master" --system-prompt "You are the Dice Master. ..."
Added brain Dice Master (b_k3vtveni4d) · text · reasoning off · final reminder on
$ ./ss brain.list --conversation $C        (excerpt)
── Dice Master (b_k3vtveni4d) · text · reasoning off · final reminder on · #f59e0b · 0 messages ──
Final reminder (on: sent last):
<!-- System reminder -->
Stay in your role: do only the job your system prompt describes, and reply only as yourself.
$ ./ss brain.update --conversation $C --brain "dice master" --final-reminder.content $'<!-- System reminder -->\nYou are the Dice Master: only call for checks and roll dice. Never narrate the story.'
```

**Player → GM → player → Dice Master → player → GM:**
```
$ ./ss turn --conversation $C --content "I walk over and sit across from the hooded figure."
[Game Master] MOCK reply to brain "You are the GM of a D&D one-sh"; saw 4 messages; ...
$ ./ss turn --conversation $C --brain "Dice Master" --content "I try to read the stranger's intentions."
[Dice Master] MOCK reply to brain "You are the Dice Master. When "; saw 7 messages; last: "<!-- System reminder --> You a…ice. Never narrate the story."
$ ./ss turn --conversation $C --content "I nod and order two ales."
[Game Master] MOCK reply to brain "You are the GM of a D&D one-sh"; saw 8 messages; ...
```

**`prompt.preview --brain "Dice Master"` vs `--brain "Game Master"`** (roles and each message's first line):
```
--- Dice Master                                      --- Game Master
[0] system    You are the Dice Master. ...           [0] system    You are the GM of a D&D one-shot ...
[1] user      <!-- This is the World Bible. -->      [1] user      <!-- This is the World Bible. -->
[2] user      <!-- from: Game Master --> (opener)    [2] assistant Rain hammers the shutters ... (opener)
[3] user      <!-- from: the user -->                [3] user      <!-- from: the user -->
[4] user      <!-- from: Game Master -->             [4] assistant MOCK reply to brain "You are the GM ...
[5] user      <!-- from: the user -->                [5] user      <!-- from: the user -->
[6] assistant MOCK reply to brain "You are the Dice… [6] user      <!-- from: Dice Master -->
[7] user      <!-- from: the user -->                [7] user      <!-- from: the user -->
[8] user      <!-- from: Game Master -->             [8] assistant MOCK reply to brain "You are the GM ...
[9] user      <!-- System reminder --> ...           Note: turn would not send this as it stands. The last message is
                                                     Game Master's own reply, so there is nothing new for it to answer.
```
The Dice Master gets its own system prompt, then the World Bible. GM lines and player lines are framed, its own reply is `assistant`, and the reminder comes last. The GM sees the Dice Master's line framed and gets no reminder.

**Preview == send** (a Dice Master turn), then **an edit**, **a third brain**, **a new GM prompt**:
```
$ ./ss prompt.preview --conversation $C --brain "Dice Master" --content "I attack the figure!" --json | jq -S .body > pv.json
$ ./ss turn --conversation $C --brain "Dice Master" --content "I attack the figure!"
$ curl -s localhost:4748/_mock/requests | jq -S '[.requests[]|select(.path=="/chat/completions")][0].body' > sent.json
$ cmp pv.json sent.json && echo IDENTICAL
IDENTICAL
$ ./ss message.edit --conversation $C --message m_9eqs2lfbkg --content "EDITED: Thunder rolls. The hooded figure slides a silver coin across the table."
$ ./ss prompt.preview --conversation $C --brain "Dice Master" --json | jq -r '.body.messages[2].content'
<!-- from: Game Master -->
EDITED: Thunder rolls. The hooded figure slides a silver coin across the table.
$ ./ss brain.add --conversation $C --name "Joke Teller" --system-prompt "You are the Joke Teller, a halfling bard. ..."
$ ./ss turn --conversation $C --brain "Joke Teller"                      # empty message: it just responds
[Joke Teller] MOCK reply to brain "You are the Joke Teller, a hal"; saw 10 messages; last: "<!-- System reminder --> Stay …, and reply only as yourself."
$ ./ss brain.update --conversation $C --brain "Game Master" --system-prompt "You are the GM. EDITED PROMPT: keep it grim."
$ ./ss turn --conversation $C --content "I pocket the coin."
[Game Master] MOCK reply to brain "You are the GM. EDITED PROMPT:"; saw 11 messages; ...
```

**50 messages deep** (17 rounds of player → GM → Dice Master, then a new brain and a new GM prompt):
```
Deep campaign (c_aep8db198o) · deepseek-v4-1-flash · 51 messages · $0.0076
Added brain Joke Teller (b_92zjwm3yae) · text · reasoning off · final reminder on
Updated brain Game Master (b_67e2puf6x1) · ... · system prompt 25 chars
[Joke Teller] MOCK reply to brain "You tell jokes."; saw 54 messages; ...
Deep campaign (c_aep8db198o) · deepseek-v4-1-flash · 53 messages · $0.008
```

**Regenerate stays in the message's brain**, with its reminder before the steer:
```
$ ./ss message.regenerate --conversation $C --steer "Roll a natural 1."   # the Dice Master's reply is last
... last three messages: [assistant (its reply), user "<!-- System reminder -->...", user "<!-- Behind-the-scenes direction ..."]
[Dice Master · version 2/2 · steered · 456 in / 35 out · $0.00018]
```

**Refusals:**
```
$ ./ss brain.delete --conversation $C --brain "Dice Master"
error: Dice Master has 1 message in this conversation, so it can't be deleted: the other brains still see it under its name. Rename it or change its system prompt instead.
$ ./ss brain.delete --conversation $C --brain "Game Master"
error: Game Master is the default brain. Make another brain the default first (brain.set-default), then delete it.
$ ./ss brain.update --conversation $C --brain "Joke Teller" --kind image
error: Joke Teller has 1 message, so it stays a text brain. Add a new image brain instead.
$ ./ss brain.add --conversation $C --name "dice master" --system-prompt x
error: Another brain is already called "Dice Master".
$ ./ss brain.add --conversation $C --name "Player" --system-prompt x
error: "Player" is reserved: message.add --as player means you.
$ ./ss turn --conversation $C --brain "Bard" --content x
error: No brain "Bard" in this conversation. Brains: Game Master, Dice Master, Joke Teller.
$ ./ss turn --conversation $C --brain "Scene Painter"           # an image brain, created and previewable already
error: "Scene Painter" is an image brain; image replies arrive in T05.
$ ./ss brain.update --conversation $C --brain "Scene Painter" --kind text; ./ss brain.update ... --safe-mode
error: Safe mode and tool text are for image brains, and Scene Painter is a text brain. Pass --kind image too.
$ ./ss message.add --conversation $C --as player --content "  "
error: Invalid arguments for message.add: content: The message can't be empty
```

**Mid-reply** (`Bard` with its reminder off, so the mock sees `MOCK_SLOW`; `Spare` unused):
```
$ ./ss turn --conversation $C --brain Bard --content "MOCK_SLOW sing us a song" &
$ ./ss brain.delete --conversation $C --brain Bard
error: Can't delete Bard: Bard is writing a reply right now. Wait for it to finish, or stop it, then try again.
$ ./ss brain.update --conversation $C --brain Bard --kind image
error: Can't change the kind of Bard: Bard is writing a reply right now. ...
$ ./ss message.add --conversation $C --as player --content "hi"
error: Conversation c_4np0e9z756 is busy: a reply is being generated from the messages as they are now. ...
$ ./ss brain.delete --conversation $C --brain Spare
Deleted brain Spare (b_i0nuoqw8j7). Brains left: Game Master, Dice Master, Joke Teller, Bard.
$ ./ss brain.update --conversation $C --brain Bard --system-prompt "You sing badly."     → ok
$ ./ss setup.add --conversation $C --label "House rules" --content "Keep replies short." --position 1   → ok
$ ./ss generation.stop --conversation $C
Stopped. What had arrived is saved: m_0wiepqnqqe, version 1/1.
$ ./ss brain.delete --conversation $C --brain Bard
error: Bard has 1 message in this conversation, so it can't be deleted: ...
$ ./ss setup.move --conversation $C --setup "house rules" --position 3
error: Position 3 is past the end: there are 2 places.
```

## Live check (`npm run up`, encrypted user `dev-t04-live`, `deepseek-v4-1-flash`, reasoning off, `max_tokens` 300)

Eight calls in total, across three brains. The table was a GM with a "leave rolls to the Dice Master" prompt, a World Bible naming the smuggler Vessa, a hand-written GM opener, and a Dice Master with a one-line-roll reminder.

```
=== 1. player -> GM         "I take my ale and sit down across from the hooded figure."
You set your tankard down and slide onto the bench opposite the hooded figure. ... "You're late," Vessa murmurs, ...
[Game Master · 167 in / 66 out · $0.00013]
=== 2. player -> Dice Master "I try to read her intentions. Is she lying about the buyer?"
Insight check (DC 14): rolled 9 + 1 = 10, failure.
[Dice Master · 289 in / 21 out · $0.00011]
=== 3. player -> GM         "I lean in and ask quietly what she's selling."
You study her shadowed face for a lie, but the flicker of firelight gives you nothing ... Whatever she's hiding, it stays hidden. ...
[Game Master · 299 in / 103 out · $0.0002]
(prompt.preview --brain "Dice Master" / "Game Master": the same shapes as on the mock, above)
(message.edit of the opener → the Dice Master's [2] is "<!-- from: Game Master -->\nThunder rolls over Saltmarsh. ...")
=== 4. Joke Teller, added now, empty message
Vessa's so mysterious I tried to read her mind—turns out the only thing I read was the menu, twice.
[Joke Teller · 399 in / 27 out · $0.00015]
=== 5. player -> GM, after brain.update of the GM's system prompt
[Game Master · 448 in / 110 out · $0.00027]
=== 6. message.regenerate --steer "Shorter, one paragraph."   (preview: brain Game Master, its reply, then the steer)
[Game Master · version 2/2 · steered · 596 in / 80 out · $0.00018]
=== 7-8. player -> Dice Master "I follow her, trying to move silently.", then a plain re-roll
Stealth check (DC 13): rolled 12 + 2 = 14, success.   [Dice Master · 587 in / 21 out]
Stealth check (DC 13): rolled 17 + 2 = 19, success.   [Dice Master · version 2/2 · 587 in / 21 out]
```

- The Dice Master stayed in its role.
- The GM saw the roll as `<!-- from: Dice Master -->` and narrated the failure.
- The newcomer answered an empty turn in role.
- `prompt_tokens` tracks our own text (167 for ~650 characters on the first call), with no sign of Venice's ~550-token prompt.
- The re-roll had the same 587 prompt tokens as the turn it re-rolled, which is right: it is the same request.
- The file is `SSENC1` ciphertext. `grep -a -c` finds 0 hits for "Vessa", "Gilded Goat", "Dice Master", "World Bible", "System reminder" and "Joke Teller", in the file and in `.run/server.log`.

**Live spend:** balance **$8.00477057 → $8.00345825**, a drop of **$0.00131232** for 8 text calls. The conversation's `spentUsd` recorded $0.001312305, so recorded matches billed.

## Tests

`npm test`: **89 pass** (84 before). `npm run typecheck` (server, CLI, tests, web) passes.
- `test/brains.test.ts` (new, CLI end to end against the mock):
  - The acceptance run, with exact `deepEqual`s of both brains' previews, and preview == sent for an empty-content Dice Master turn and for its steered regenerate.
  - An edited GM line, a third brain, a new GM prompt and setup add/move/delete, each checked in the request.
  - Every brain rule: has spoken, default, kind lock, names, image-only fields, set-default, `message.add`.
  - Mid-reply: a writing brain can't be deleted or change kind, and `message.add` is refused, while another brain can go. Without the `assertBrainIdle` call this test fails (checked by removing it).
- `test/store.test.ts`: `assertBrainIdle` before and after `forBrain`.
- `test/prompt.test.ts`: a non-default brain's pre-filled reminder goes last, and a blank one is skipped.
- `startTestServer({ mock })` now takes mock options. A `MOCK_SLOW` echo is ~15 words, so the mid-reply test uses `slowDelayMs: 100` to leave itself ~1.5 s.

## Known gaps

- **Image brains** can be created, edited and previewed (their forced tool call shows). But `turn`, `message.add` and regenerate refuse them (`not_supported`) until T05.
- **Regenerate is still last-message-only** (T03's rule). With several brains this bites more often: to re-roll the GM's narration after the Dice Master has already rolled, delete the roll first.
- `message.add` only appends; there is no "insert at position".
- There is no brain reordering. The order is creation order, which is the order the composer's per-brain buttons will show.
- Renaming a brain renames it in every brain's framing of past lines too. That is by design (edits are what history "always was"), and documented.
- Setup labels needn't be unique. With duplicates, `--setup <label>` asks for the id.
- `conversation.create` still names the first brain "Assistant". Rename it with `brain.update --name`.
- Mock quirk (documented in design.md and AGENTS.md): triggers are read from the last message, which for a brain with a reminder is the reminder.

## Changes to design.md

- The Brain and setup fields note the T04 pre-fills (`REMINDER_EXAMPLE`, `DEFAULT_TOOL`, in `wording.ts`) and that setup labels are never sent.
- New: "Which brain is writing (T04)", about `forBrain` and `assertBrainIdle` (next to "The lock and the read must agree").
- "Turns, regeneration and edits" spells out **add**, **Brains** and **Setup messages**:
  - name rules, with `player` reserved;
  - delete, kind lock and their error codes;
  - rename semantics;
  - the reminder pre-fill, and why an added brain can always "just respond".
- "Implemented in T04" lists the new commands and their result shapes. The command list adds `brain.list` and `setup.list`.
- A "Verified live in T04" block, and a note that the T02 builder needed no change.
- Mock: triggers vs final reminders.
