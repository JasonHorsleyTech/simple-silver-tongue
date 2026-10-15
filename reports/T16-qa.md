# T16 QA: Brains that make brains

**Verdict:** Acceptance passes. 0 blockers, 1 major, 4 minors, 4 nits. No DESIGN CONCERN.

The plumbing is solid wherever I pushed it:
- **The pin rule.** Preview equals send for a turn, a steered regenerate and a fresh take, each with pins (`cmp` against the mock's received body). A pinned message is sent once. The pin follows an edit, a re-roll, a steer, a fresh take and `select-version`.
- **The maker.** Exactly one brain per new message on every path: turn, stopped turn, image turn, stopped image prompt, `message.add` text and image, and six concurrent adds (Place 13 to 18, no clash). It made none for a re-roll, steer, fresh take, edit, `image.retry`, a mid-stream failure or an up-front error.
- **The rest.** The delete cascade, `brain_made` reaching a `generation.follow` follower, encryption, clone and export/import remapping, schema-5 upgrade, and the README's migration all behave as design.md says.

**The major is the preset, not the code.** Asked with no note, the Character Creator rewrote the sheet of someone who already had one, 3 times in 3. That made a second brain for the same person, which is the confusion T16 exists to remove (QA-1). The minors and nits are:
- a 500 on one `--makes` path;
- a name pattern that breaks its maker;
- what `--without-messages` keeps;
- one Co-GM name leak;
- some wording.

## How I ran it

- **Tests:** `npm run typecheck` is clean, and `npm test` passes 209/209 (before I started; I changed no code).
- **Mock: a scratch server by hand, never `npm run up:mock`.** Jason was using 4747, so I followed the 2026-10-15 lesson:
  - The mock ran on **4778** and the server on **4777**, both with `SS_DATA_DIR` and `SS_RUN_DIR` in my scratchpad.
  - Each CLI had its own `SS_SESSION_FILE`.
  - Users were `qa-t16-plain` (plaintext) and `qa-t16-enc` (encrypted).
- **Live: a scratch live server on 4787** (`SS_MODE=live`, scratch data and run dirs), as encrypted user `qa-t16-live`, with the preset as committed. The World Bible was mine, a world unlike the engineer's harbor:

  ```
  Dry Creek, a whistle-stop on a desert railway, 1890s; dusty and quiet, no magic. The player is Ines Vara, a young land surveyor sent by the railroad to settle a water-rights dispute, carrying a sealed survey map in her satchel.
  Tonight Ines waits out a sandstorm in the depot café: a woman in a grey duster sits alone by the window with a cold cup of coffee, and the station agent, a stooped old man with ink-stained cuffs, sorts telegrams behind the counter.
  ```

- **Probes:** T07's method (`prompt.preview --json`, then one `stream: false` POST from a scratch script, key never printed, nothing saved).
- **Spend: 13 live text calls (11 saved turns, 2 probes) and 2 images.** The balance went from **$7.29336674** to **$7.25797734**, so **$0.0354**.
- **Clean-up:** my three processes (mock 4778, servers 4777 and 4787) are killed. The scratch data dirs are deleted. 4747 was never touched, and nothing under `data/` or `.run/` was read or written.

## Acceptance checklist

| Bullet | Result | Evidence |
|---|---|---|
| Preset: the Creator writes the hooded figure's sheet, and "Character 1" exists with no other click | **Pass** | Mock, and live: `turn --brain "Character Creator" --content "(the woman in the grey duster)"` → "Made a new brain, Character 1". |
| `prompt.preview --brain "Character 1"` shows its sheet right after the setup, not at its place, and its own lines as `assistant` | **Pass** | `pinned: [{index: 2, as: ledger}]`. Live, the order was `system, World Bible, <!-- from: Character Creator --> (sheet), GM, …, assistant (its own line), …`. The sheet appears once. |
| A second character works the same; back to the first, its own sheet is at the top and the second's lines are framed | **Pass** | Live: the station agent's sheet made Character 2, which answered in character. Back to Character 1, its view was `…, user <!-- from: Character Creator --> (agent's sheet, in place), …, user <!-- from: Character 2 -->, …` with its own sheet at index 2. It answered from its own sheet: it knew Cheevers by name, as its sheet says, and said nothing of his envelope or the backdated notarization. |
| Editing the sheet changes what the pinned brain gets next | **Pass** | Mock: after `message.edit` of the Place Creator's note, Place 1's preview showed `EDITED PLACE NOTE`. The same held after a re-roll, a steer, a fresh take (the merged thought shows in the pin) and `select-version --version 3`. |
| Re-rolling the Creator's reply makes no new brain | **Pass** | Plain re-roll, steer and fresh take of a maker's last message: brain count unchanged, 4 versions. Image maker: `image.retry`, an image prompt `message.edit` and `message.regenerate`: 14 brains before and after. |
| Renaming the brain changes the framing every other brain sees | **Pass** | Live: `brain.update --brain "Character 1" --name "Miss Crandall"`. The GM's preview then framed her lines `<!-- from: Miss Crandall -->`, and the GM's reply called her "Miss Crandall". |
| `message.add --as "Character Creator"` with a hand-written sheet makes a brain | **Pass** | Mock, plaintext and encrypted users: "It made a new brain, Character 1 (b_…)". JSON has `made`. |
| Make-a-brain-by-hand on an old sheet works | **Pass** | I imported the pre-T16 preset (`git show e3c178d:presets/tabletop-rpg.json`) as a campaign. I wrote two old sheets and three Actor lines, then downgraded the file to schema 5 with no `pins`; it loaded. Then I followed README "An older campaign" word for word: `--makes @makes.json`, `brain.make` ×2, renamed both to Alice and Bob, `set-author` ×3, and `brain.delete --brain "Character Actor"` succeeded. Alice's view: her sheet at index 2, her two lines as `assistant`, Bob's framed. |
| Change-author moves a line into the new brain's own `assistant` history | **Pass** | Same run. Also refused, with clear words: a 4-version message to the player, a roll to a brain, an unknown brain, and any move mid-reply (409). |
| A generic, non-character case works from the CLI | **Pass** | `brain.add --name "Place Creator" … --makes.name "Place {{n}}"` made Place 1, 2, 3…, and an image "Painter" made text `Scene {{n}}` brains. Unicode pattern `🧙 Wizard №{{n}}` → "🧙 Wizard №1". |
| Every word sent stays visible in `prompt.preview` and editable | **Pass, with QA-2** | Pins use the ledger text and the templates, or the message verbatim. `brain.list` prints the whole blueprint and `brain.update --makes.blueprint.*` edits it. Exception: a *new* image blueprint stores no tool text, so `brain.list` can't show the tool text its brains will get (QA-2). |
| `npm test`, `npm run typecheck` | **Pass** | 209/209, clean. |

### Also checked (passes)

- **`brain_made` reaches followers.**
  - A `MOCK_SLOW` maker turn with a second terminal on `generation.follow --json`: both streams had `message, start, brain_made, done`.
  - Image maker: `brain_made` comes before `image_pending`.
  - `generation.stop` mid-reply saved the partial reply and made one brain ("It made a new brain, Place 11 …"). The stream has `brain_made`, and `made` is in the stop result.
- **Mid-reply.**
  - `brain.pin` and `brain.update --makes.next 10` are allowed while a reply streams; the reply then made "Place 10".
  - `message.set-author` and `message.delete` get 409.
  - A second `brain.make` of the same message gets 409.
- **Delete cascade.**
  - A never-spoken made brain is deleted with its message, and another brain's pin of that message goes too ("Assistant … had it pinned; the pin is gone").
  - A made brain that has spoken stays and loses the pin.
  - So does a made brain that is the default.
  - Live, deleting the duplicate sheet (QA-1) deleted its Character 3 too.
- **`brain.make` errors.** A player message gets 400. A non-maker's message gets 400, with the command to fix it. An already-made message gets 409, pointing to `brain.pin`. A `--name` clash, case-insensitive, gets 409. A disabled maker still makes brains by hand.
- **Encryption.**
  - Seven unique phrases went into world, opener, sheet, rename, blueprint, pattern and a moved line for `qa-t16-enc`. None was in its folder or the run dir, all seven came back through `conversation.get` (control), and the server log has only command names.
  - Live user: no story words on disk or in the log.
- **Clone and import.**
  - `conversation.clone` and `conversation.get --json` → `conversation.import --campaign` re-pointed every pin and `madeFrom` to a message in the new ledger.
  - Each one points at the same content: Chapel's pins are "The chapel." and Place 1's reply in all three copies.
  - Counters were kept.
- **Restart.** Killing and restarting my scratch server left every brain's pins and `madeFrom` byte-identical.
- **Many brains.** One conversation reached 22 brains. Preview is 0.13 s, and `brain.list` and `conversation.get` are fine. Only 8 distinct colors, as the engineer said (frontend).
- **Live jobs.**
  - Character 1 and 2 each spoke only as themselves: first person, the bold "Known to the player as", their own tells.
  - Neither used the other's secrets. Character 2 gave "Miss Crandall", which his own sheet knows.
  - All 3 character turns (reasoning low) were whole replies. The stop sequence never cut the reasoning, even with their own sheet framed `<!-- from: Character Creator -->` in the view.
  - Show Me the Odds gave one clean line ("Roll a d20: 12 or higher succeeds, …").
  - The Portraitist painted the station agent from his Looks line: no name, no secret.
  - The Scene Painter reused that style line word for word, and read the characters' lines as people in the scene.
  - The GM wove both characters' lines in.

## Findings

### QA-1 (major): the preset's Creator writes a second sheet for someone who already has one, and so a second brain for them

**Repro** (live, the conversation above, after the player has spoken to both characters; the latest player message was "I go back to the counter and lean on the station agent…", to Show Me the Odds):

```
./ss turn --brain "Character Creator"        # no note
```

**Expected:** the newest person with no sheet, as the prompt says ("Each sheet makes a new helper, so write one only for someone who has none yet").

**Actual:** a fresh sheet for **the station agent**, who already had a sheet and a brain (Character 2). It made **Character 3**: a second brain for the same man, with a second sheet every brain now reads. It happened 3 times in 3:
1. The saved turn: the station agent.
2. The same body as a probe: the station agent again.
3. A probe after a player message that names nobody ("I sip my coffee and wait out the storm."): a new sheet for **Miss Crandall**, who already had one and her own brain.

Before T16 this cost only a redundant sheet; now it splits one person across two brains, which is exactly what T16 removes. The likely path is common: the player clicks the Creator's chip with nothing typed (the browser's "Ask Character Creator to respond").

**Cause (prompt, `presets/tabletop-rpg.json`, Character Creator):**
- The reminder says "of whoever **the player's latest message** names, or else of the newest person in the story who has no sheet yet". On an empty turn, the latest player message is an earlier action, and it usually names someone who already has a sheet.
- When everyone in the scene has a sheet, nothing tells it what to do. A maker can't decline either: any reply it writes, even "nobody new here", makes a brain.

**Suggestion for triage:** probe, fix against control, as in T10:
- Tie "names" to the note sent with *this* turn.
- Say outright never to write one for someone who already has a sheet, even if the latest action is about them.
- When nobody in the scene lacks one, take the newest person the story or a sheet has mentioned (the GM's narration, someone's Ties line: Dell, Buckner, the father) who has none.

The control is a turn whose note names a new person, which must still sheet that person. Undoing a slip already works: `message.delete` of the sheet deletes its never-spoken brain.

### QA-2 (minor): a new image maker with tool text is a 500; a new image blueprint stores no tool text, so `brain.list` can't show it

**Repro (mock):**

```
./ss brain.add --name ImgMaker --system-prompt x --makes.name "Pic {{n}}" --makes.blueprint.system-prompt y --makes.blueprint.kind image --makes.blueprint.tool.name paint_it
error: Internal server error (see .run/server.log)
# log: TypeError: Cannot convert undefined or null to object at applyMakes (src/commands/brains.ts:169)

./ss brain.add --name ImgMaker --system-prompt x --makes.name "Pic {{n}}" --makes.blueprint.system-prompt y --makes.blueprint.kind image
./ss brain.list        # "Each one: image · … · safe mode on · landscape", and no "Its tool …" lines
```

**Expected:** a new image blueprint is filled like a new image brain (tool text, safe mode, shape), so `--makes.blueprint.tool.*` edits it and `brain.list` shows every word the made brains will be sent.

**Actual:**
- `applyMakes` builds a new blueprint (`brains.ts:145`) and calls `fillImageBlueprint` only when the kind *changes* (`bp.kind !== b.kind`). A new blueprint created as `image` therefore has no `tool`, and `Object.assign(b.tool!, bp.tool)` (`:169`) throws.
- Without `--makes.blueprint.tool.*` it saves, and the made brains get `DEFAULT_TOOL` from `makeImageBrain` in `makeBrain`. That text is visible on each made brain, but not in the blueprint the user is reading and editing.
- An existing text maker switched to `--makes.blueprint.kind image` does get filled.

### QA-3 (minor): a name pattern whose every name is "taken" is accepted, then breaks its maker and `brain.list`

**Repro (mock):**

```
./ss brain.add --name IdMaker --system-prompt x --makes.name "b_{{n}}" --makes.blueprint.system-prompt y   # accepted
./ss prompt.preview --brain IdMaker          # error: Every name the pattern "b_{{n}}" makes is taken. Give it {{n}} where the number goes.
./ss message.add --as IdMaker --content hi   # same error
./ss brain.list                              # same error, for the whole conversation (--json works)
```

**Expected:** refused when set, like a pattern without `{{n}}`. `b_1` looks like a brain id, which `checkName` refuses for any name.

**Actual:**
- The maker can't take a turn, since `planTurn` computes `makesNote` → `nextMadeName` throws a 409.
- `message.add` in its mouth fails the same way.
- The text `brain.list` fails for every brain, since `pinAndMakerLines` calls `nextMadeName`.
- The message is wrong: the pattern has `{{n}}`.

**Cause:** `makesName` (`brains.ts:88`) doesn't apply `checkName`'s id-shape rule to `madeName(pattern, 1)`, and `nextMadeName`'s throw (`makers.ts:38`) assumes the only way to get there is a missing `{{n}}`. Unlikely by hand; fix the validator and the wording.

### QA-4 (minor): `--without-messages` keeps the made brains, sheetless, and the counter

**Repro (mock, the migrated campaign with Alice and Bob):**

```
./ss conversation.clone --id c_… --title "Fresh start" --without-messages
./ss brain.list --conversation <new>          # … Alice, Bob: 0 pins, no madeFrom; Character Creator next 3
./ss prompt.preview --conversation <new> --brain Alice --content hi   # system, World Bible, hi, reminder: no sheet anywhere
```

**Expected (my reading of "a fresh start on the same setup"):** the kit, not last campaign's cast. Brains made from messages that aren't coming would be left out, or at least the answer would say they came without their sheets.

**Actual:**
- Alice and Bob come along with prompts that say "the person whose character sheet comes first … right after the World Bible", and there is no sheet.
- The Creator's next brain is "Character 3".
- The same applies to `conversation.import --campaign --without-messages` of an export.

**Cause:** `rebuild` (`campaign.ts`) drops `pins` and `madeFrom` but keeps the brains. A design call for triage: drop brains with a `madeFrom` when the ledger isn't copied (and perhaps reset each maker's `next`), or say what came over.

### QA-5 (minor): the Co-GM named someone by a first name only his sheet had

**Repro (live, after Miss Crandall had said "Cheevers" aloud):**

```
./ss turn --brain "Co-GM" --content "(out of character) What's the station agent's name, and who's he been wiring?"
→ "Cheevers is the name — Hollis Cheevers, station agent here, and Miss Crandall called him by it. As for who he's been wiring, … you can't tell …"
```

**Expected:** "Cheevers", which the player had heard. The design.md shared rule: "call people what the player knows them as until the story has told the player their name".

**Actual:** "Hollis", which is only on Character 2's sheet. 1 call in 1. It kept the real secret (the wire, the envelope) and answered from the player's side. Leaks are accepted (Jason, T10); I list it because the engineer didn't test the Co-GM live after its T16 sentence, and this is the leak T10 tuned for. Worth one probe pair in triage, or dismiss as the accepted rate.

### QA-6 (nit): the payload note says "(your's)"

```
./ss brain.pin --brain Assistant --message <a player message> --as assistant
./ss prompt.preview --brain Assistant --content hi
Note: Pinned to Assistant: m_ovb2o0hz6h (your's), as the brain's own words, …
```

`reviewBody`'s `author()` returns `"your"` (`turn.ts:188`) and `pinnedNote` appends `'s` (`wording.ts`). `brain.list` correctly says "(yours)". The browser will show the same sentence.

### QA-7 (nit): an image maker's "Made a new brain" line is glued to the streamed prompt

```
./ss turn --brain Painter --content "paint the docks"
MOCK image prompt after 17 messages; last: "<!-- from: the user --> paint the docks"Made a new brain, Scene 2 (b_…), …
```

`printStream` calls `sayMade()` at `image_pending` (`src/cli/main.ts:369`) before that event's leading `\n`, and the prompt on stdout has no newline of its own. Print the newline first.

### QA-8 (nit): after a slip is deleted, the numbers have a gap

Live, after QA-1's duplicate was deleted (its Character 3 with it), the table has Miss Crandall (1) and Character 2. The Creator's payload note says the next is **Character 4**. The engineer decided the counter never goes back, and the ticket's reason (renaming "Character 1" must not free "1") still holds. But when the cascade deletes the brain that holds the newest number (`next - 1`), winding the counter back would give that name, now free, to the next brain. With QA-1 as it is, these gaps will be common. Triage's call.

### QA-9 (nit): `nothing_to_answer` blames the brain's "own reply" when the body ends on a pin

```
# a maker with --makes.pin-as assistant and a blueprint with no reminder; message.add --as Maker "A note." → Thing 1
./ss turn --brain "Thing 1"
error: The last message is Thing 1's own reply, so there is nothing new for it to answer. Write a message for it first.
```

Thing 1 has never spoken. The body ends on Maker's note, pinned as Thing 1's own words. The refusal is right, but the wording (`prompt.ts:293`) doesn't know about pins. The payload note beside it does explain the pin.

## Observations (not findings)

- **The blueprint names its context in words.** It says "right after the World Bible" and "a hidden note from the Character Creator". Both stop being literally true if Jason has more than one setup message or renames the Creator; the model will probably still cope. The pins also come in ledger order, so a brain with another character's earlier sheet pinned would read that sheet "first".
- **The GM still voices characters who have their own brain.** Live, it wrote a line for Miss Crandall. That is its T10 job ("Play the world and everyone in it"), unchanged, and Jason chooses whom to send to.
- **A made brain's prompt is a copy.** As the engineer says, editing the blueprint later changes only future brains. The brain card should say so (frontend).
