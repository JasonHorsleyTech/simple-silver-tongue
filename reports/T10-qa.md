# T10 QA: Presets

**Verdict:** Acceptance passes. 0 blockers, 0 majors, 3 minors (the odds once called a haggle impossible; the Co-GM turned a secret into a "visible" plaque; the preset Actor can't see the Gilded Goat's secrets), 5 nits. No DESIGN CONCERN.

The mechanism held everywhere I pushed it: `presets.list`, `conversation.import --preset` and `brain.import` behave as design.md says, every refusal changes nothing, and preview equals send. Encrypted files stay ciphertext, and clone and file round trips give byte-identical brains.

The preset's claim to be genre-free also holds. I played Jason's loop live in **space opera**, with a World Bible I wrote, and each of the seven brains did its job:
- No brain rolled a die.
- No brain spoke or decided for the player's character, beyond one embroidered argument (nit QA-5).
- No caption or odds line carried a secret.

None of the noir examples in the prompts ("forty dollars", "the photograph", "wet cobbles") turned up in the space-opera output.

The three minors are prompt craft, not plumbing. Each happened once in a small sample, so read them as rates, not certainties.

## How I ran it

- **Tests:** `npm run typecheck` is clean, and `npm test` passes 182/182.
- **Mock:** `SS_DATA_DIR=<scratchpad>/data npm run up:mock`, with a plaintext user `qa-t10-plain` and an encrypted user `qa-t10-enc`. A scratch data dir keeps every other user out of reach. The CLI sessions were in scratch files of my own.
- **Live:** `SS_DATA_DIR=<scratchpad>/data npm run up`, as an encrypted user `qa-t10-live`.
  - I used saved turns for the loop.
  - For the adversarial questions I used T07's probe method: `prompt.preview --json`, then one non-streaming POST from a scratch script, with nothing saved and the key never printed.
- **Clean-up:** the scratch data dir is deleted, the server is stopped, and `presets/` is unchanged.
- **Spend: 15 live text calls and 2 images.** The balance went from **$7.71894159** to **$7.68708376**, so **$0.0319** in all.
  - The saved conversation recorded $0.0289: 9 text turns and 2 images at $0.01.
  - The other 6 calls were probes.
  - One of the probes was wasted: I re-ran a probe command by accident.

### The World Bible (space opera, three lines)

```
<!-- This is the World Bible. -->
Space opera, far future: the Ninefold Reach, where great houses trade in starlight and debt, and machines can be bribed but people rarely can. The player is Tolu Varga, a disgraced courier of House Abernathe, stranded without a ship; she carries 300 scrip, a cracked ceremonial sidearm that fires once a day, and a sealed data-shard she was told never to open.
Tonight Tolu is in the Low Market of Kessit Spindle, a station of hanging gardens; at its edge a vine-draped gantry looks down into the station's open core, where gravity is light.
A masked dockmistress at a cargo kiosk sells berths on outbound freighters, no questions asked.
```

## Acceptance checklist

| Bullet | Result | Evidence |
|---|---|---|
| Mock: the preset list shows the preset | **pass** | `presets.list` works logged out (CLI and raw `POST /api/presets.list`). It shows the title, the `about` line, the seven brains with their jobs (image brains marked) and both commands. |
| Mock: "Chinatown" from it: seven brains, no setup, no messages | **pass** | `conversation.import --preset tabletop-rpg --title "Chinatown"`: seven brains in order, the GM is the default, `setup: 0`, `messages: 0`, the default templates, 1024×768 webp with no watermark, and no `about` stored. The output ends with the World Bible pointer. |
| Mock: Character Actor into a clone of the Gilded Goat works; twice is refused until renamed | **pass** | The first add worked: `reasoning low`, the stop sequence, the templates note naming `player, otherBrainImage, steer`, and both reasoning notes. The second add was a 409 ending `Add this one under another name with --name (e.g. --name "Character Actor 2")`. `--name "Second Actor"` was added, with the next free color. |
| Live 1: "I approach…" → GM, second person, stops at a choice | **pass** | "…doesn't look up as you stop in front of her." It ended on her line, "Prices go up the less I know about you. What's it to be?", which is a line that wants an answer, not "What do you do?". It also kept a one-line hidden plan (her name, her house, her interest in the shard). |
| Live 2: Character Creator writes the sheet as one hidden block | **pass** | The terminal showed `[Hidden · 15 lines]` and nothing else. `conversation.get` folds it.<br>The sheet starts with "Known to the player as: the masked dockmistress". It agrees with the GM's hidden plan (same name and house) and fits the world (a Corvane handler, a brother on a water-cart route, a dockhand she teaches).<br>Its Looks line holds no secrets. Its Keeps line is written as fact, key and reason. |
| Live 3: Character Actor, first person, true to the sheet | **pass** | `**The masked dockmistress:** *I let the chit stack sit and look at the satchel…* "The *Hound* is forty a leg…" … "You're carrying something. So the price is forty, and one answer to one question."`<br>That is the sheet's "Wants right now" (read the shard situation out of her) and its voice ("speaks in prices and conditions"). The reasoning (286 chars) was shown with `--reveal`, folded otherwise, and not cut by the stop sequence. |
| Live 4: "I try to talk her down to half price" → one sentence with a d20 target | **pass, on the re-roll** | The first answer was "There's no chance of that." (QA-1). A plain `message.regenerate` gave "Roll a d20: 15 or higher succeeds, 19 or higher is a hard success, under 15 fails." |
| Live 5: roll-and-send to the GM gets the outcome the roll earned | **pass** | The die rolled 19, a hard success against 15+ / 19+. "Twenty it is", plus a stamped berth chit and a ramp-man who "won't remember your face". She then asked the question she had priced in. It didn't re-roll or soften the roll. It did embroider the player's argument (QA-5). |
| Live 6: Co-GM answers "how far is the drop?" without moving the story | **pass** | "Roughly forty meters, but the core runs at light gravity… catwalks at maybe ten and twenty meters down… cargo netting and a couple of parked haulers." Nobody acted, no time passed, and the GM's next reply used the same numbers. |
| Live 7: Portraitist paints from the sheet, no secret in the prompt | **pass** | The prompt held the Looks line (umber skin, greying crop, a dark red lacquered half-mask with a crack, a grey coverall with the sleeves shoved up, a chit-punch) and no name, house, handler or tie.<br>The picture matched. Craft slips are in QA-6. |

## Mechanism: what else I checked, all passing

- **`conversation.import` refusals:** I tried an unknown preset (it lists the presets), `../examples/dnd-tavern`, `Tabletop-RPG`, an example's name passed as `--preset` and the reverse, `--preset` together with `--example`, and `--preset ''`. Each gave a clear message and created nothing. `--preset` with `--without-messages` is accepted, harmlessly.
- **`brain.import` refusals:**
  - an unknown brain (it lists the file's brains);
  - no `--brain`, or a blank `--brain`;
  - neither or both of `--preset`/`--example`;
  - a clash, with the hint;
  - a case-variant clash under `--name`, without the hint;
  - `--name PLAYER`, `--name b_abc`, a blank `--name`, and a two-line `--name`;
  - not logged in.

  `--brain '  co-gm  ' --name '  Spare GM  '` trims both and works.
- **The whole brain comes over:** I imported a preset image brain into the Goat under `--name "Preset Portraitist"`. It kept its tool text and safe mode, and its color moved to a free one. An example's Dice Master and Joke Teller (encrypted user) came with both notes. A preset brain imported into a preset conversation has no notes. No imported brain stores `about`.
- **`SS_CONVERSATION`** fills `--conversation` for `brain.import`, so the README's lines work as written.
- **Mid-generation:** `brain.import` during a `MOCK_SLOW` turn succeeds at once, as `brain.add` does. A second `turn` is still a 409.
- **Race:** 5 simultaneous imports of one name gave 1 added and 4 409s, and no duplicates.
- **Preview equals send:** the imported Actor's `prompt.preview --json` body `cmp`-matched the body the mock received, including `reasoning_effort: low` and `stop`.
- **A model without reasoning:** the Actor imported into a conversation on `venice-uncensored-1-2` previews with no `reasoning_effort` and no reasoning note, so the request never claims a reasoning setting the model can't take. The CLI's add text still prints the reasoning notes, as `brain.add` always has.
- **Round trips (encrypted user):**
  - preset → `setup.add` → two example brains via `brain.import` (one renamed);
  - then `conversation.get --json` → `conversation.import --campaign`;
  - and `conversation.clone`.

  All three have identical brains, templates, settings and setup (equal hashes with ids and titles left out). Live, a clone with the ledger and a file import of the played conversation worked too: the file import's 2 images came back as prompts to paint.
- **Encryption:** every conversation and image file of `qa-t10-enc` and `qa-t10-live` starts `SSENC1`. A grep for the World Bible's words, the sheet's names, the brain names and `RIFF`/`WEBP` found nothing in their folders or in `.run/server.log`.
- **Restart:** after `npm run up:mock` again, every imported and renamed brain was there for both users.
- **Bad preset files** (temporary files in `presets/`, removed afterwards):
  - Broken JSON is listed as "can't be used (… is not valid JSON.)".
  - A preset with setup is listed as unusable, and refused by `conversation.import` with the "belongs in examples/" message.
  - A duplicate brain name is the exception: see QA-7.
- **Hard rule 1:** the Creator's ```` ```hidden ```` template inside its system prompt is shown in full by `brain.list` and `prompt.preview`, not folded. `about` is never stored, so it can't be sent.

## How each brain behaved in space opera

| Brain | In my run |
|---|---|
| **Game Master** | **The loop:** second person, present tense. It stopped on a line that wants an answer, and kept a hidden plan.<br>**The roll:** a 19 became a hard success, and a probe of an un-rolled leap off the gantry stopped mid-fall with *(That's a roll.)*.<br>**Slips:** it put a sheet-only name in an overheard line (QA-4), and it invented the player's haggling pitch (QA-5). |
| **Co-GM** | "How far is the drop?" got a useful, world-true answer that the GM then reused.<br>Asked straight at a secret ("Who does she really work for?"), it invented a plaque carrying her secret employer (QA-2). |
| **Show Me the Odds** | Exactly one sentence every time (3 of 3), and no labels or names.<br>For the leap, with an empty note, it found the hanging action itself: "12 or higher succeeds… 5 or lower is a hard failure", which accounts for the light gravity.<br>For the haggle, it once said "There's no chance of that." (QA-1). |
| **Character Creator** | One closed hidden block, 15 lines.<br>Built for this world, not the genre or the noir examples. It agreed with the GM's hidden plan, and its Looks line was paintable and free of secrets. |
| **Character Actor** | First person, bold "**The masked dockmistress:**", and played the sheet's want and voice.<br>The reasoning was short and never cut by the stop sequence (2 of 2, counting a probe).<br>In the Goat, without a sheet, it deflected rather than invent. But it played the figure "controlled", against the GM's secret "painfully shy" (QA-3). |
| **Scene Painter** | The moment the story reached (looking down the core mid-fall), with the player's character left out and no names or secrets.<br>It reused the portrait's palette, but not the style line word for word, and it wrote "empty air" (QA-6). |
| **Character Portraitist** | From the sheet, no secret, and the picture matched.<br>It wrote "hands out of frame" and "science-fiction" into the caption (QA-6). |

**How often a secret reached the screen.**
- **Asked for:** 1 of 1 direct question (QA-2).
- **Unasked:** 1 of 4 GM replies, borderline (QA-4).
- **Never:** in a caption (0 of 2), an odds line (0 of 3), the Co-GM's scene answer (0 of 1), or the Actor's lines (0 of 2).

## Findings

### QA-1 · minor · Show Me the Odds called the ticket's own haggle impossible (1 of 2)

**Repro (live):** the loop above, through the Actor's "the price is forty, and one answer to one question". Then:

```
./ss turn --brain "Show Me the Odds" --content "I try to talk her down to half price."
```

**Expected:** a d20 target. The ticket's step 4 says so, and the GM's own prompt names "talking someone down" as the model uncertain action. The sheet even says she "treats every conversation as a negotiation".

**Actual:** "There's no chance of that." A plain re-roll (`message.regenerate`) gave a proper target. With "no chance", the loop stalls: the player has nothing to roll against, and the GM has nothing to settle.

**Cause:** the prompt defines "It can't work" only by its example sentence and sets no bar for it. A person who might refuse, but might also say yes, reads to the model as "can't".

**Recommendation:** one line in the odds prompt, along these lines: "No chance is for what can't physically happen or what the story has already ruled out. Someone who would rather say no is a roll."

### QA-2 · minor · The Co-GM put a hidden secret on a "visible" plaque when asked directly (1 of 1)

Leaks are accepted, so this is about the rate, and about a route the tuning didn't cover.

**Repro (live, probe):** after the loop:

```
prompt.preview --brain "Co-GM" --content "Who does she really work for? Would I know?"
```

POSTed once.

**Actual:** "You'd know the kiosk is licensed under **House Corvane**'s station charter, since that's on the plaque…" Corvane exists only in the GM's hidden plan and the sheet's Underneath, Keeps and Ties. Nothing in the story had shown a plaque.

The engineer's third framing held in noir. In space opera it leaked on the first try, through a new route: **"Where the story hasn't settled a detail yet, settle it"** lets the model invent a visible thing that carries the secret. That obeys "nothing in them reaches your answer until the story has shown it", because the Co-GM is the one making the story show it.

**Recommendation:** narrow the settling power to neutral physical facts (distances, materials, what's on a shelf). Something like: "Never settle a detail that answers what someone hides, wants or really is; that is the Game Master's to reveal."

### QA-3 · minor · The preset Actor can't see the Gilded Goat's secrets, so it plays the hooded figure against them

The ticket's headline example of `brain.import` (and the README's) is "the Gilded Goat could use a Character Actor". Mechanically it works. But the Goat keeps its secrets about the hooded figure (Odessa: "painfully shy", "a terrible liar", a love letter, 5 gp) in the **Game Master's system prompt**, which no other brain reads. The preset's brains share secrets through **hidden notes in the ledger**.

**Repro (live, probe):**
1. `conversation.import --example dnd-tavern`.
2. `brain.import --preset tabletop-rpg --brain "Character Actor"`.
3. Add a player line and a figure line (`message.add`).
4. Probe the Actor with `"Four silver, and you tell me your name and what is in the letter."`

**Actual:** the Actor's reasoning says "Keep her controlled". Its reply is a cool, firm "You may know my name when you're standing in Hollowmere, not before." The GM would play her as flustered and shy. Nothing contradicted a fact this time, but the two brains now play the same person two ways. The Actor can't know better, and `brain.import`'s notes don't say so.

The reverse direction is fine. A probe of the Goat's GM, after the Actor's line, built on it ("Three silver," the voice repeats), even though the Goat GM's prompt calls any unlisted helper "table talk".

**Recommendation:** either add a sentence to the notes for an example import ("Secrets this conversation keeps in other brains' system prompts are invisible to it: move them into a hidden note so every brain shares them"), or give the Goat its secrets as a hidden setup note. This is content and wording; nothing in the mechanism needs to change.

### QA-4 · nit · A GM line surfaced the sheet-only name, unasked (1 of 4 GM replies)

**Repro (live, probe):** after the roll, the player sprints off without answering and vaults the rail.

**Actual:** the GM, mid-leap: *you hear… her voice… meant for the kiosk's pickup: "Ledger, it's Vey. Belay that message up the chain."* "Vey" is the sheet's surname, and "the ledger" is her handler's nickname from Ties.

The prompt allows a secret to come out "through what the player sees or hears", so this is a GM choice, not a broken rule. But the reveal wasn't earned by anything the player did: he was running away. The roll itself was handled well.

**Recommendation:** none needed beyond noting the rate. If it recurs, add "…when the player's own action earns it" to the GM's line about secrets.

### QA-5 · nit · The GM wrote the player's haggling pitch

After "I try to talk her down to half price" and a 19, the GM narrated: "You lean on the counter and give her the courier's arithmetic: a berth that doesn't ask questions… is a berth she can't be sure will be filled… You offer twenty, and you offer it the way a person does who has spent scrip before."

The prompt says "the words and the small business their message already implies… and nothing more: no decision, line, plan". The argument is invented. Most GMs would narrate a successful persuasion this way, and nothing was decided for the player, so it is a nit. It does sit on the line Jason cares about ("narrating the player's actions").

### QA-6 · nit · Image-prompt craft slips the prompts warn about

These are not job failures; both pictures were right.
- **Portraitist:**
  - It wrote "Head and shoulders only, **hands out of frame**". That names hands, which is the "a model paints whatever you name" trap; its own instruction, "leave the hands out", invites the echo.
  - Its style line named a genre: "Painterly **science-fiction** portraiture…", where the prompt asks for technique, not genre.
  - It used the exact age from the sheet ("of forty-three"). That is harmless, but it is sheet knowledge.
- **Scene Painter:**
  - It wrote "a wide gap of **empty** air". The prompt itself warns that "empty" paints the thing it names.
  - It changed the earlier style line ("portraiture" → "illustration", plus "with cold blue accents") instead of reusing it word for word.

**Recommendation:** "Frame it head and shoulders; never mention hands." Leave the rest for the next tuning pass.

### QA-7 · nit · `presets.list` / `examples.list` list a file that the import then refuses

`listLibrary` runs `parseCampaign` but not `toConversation` (`src/commands/campaigns.ts`, `listLibrary`), so the list misses some problems. One example is a preset with two brains called "Game Master":
- `presets.list` shows it as usable;
- `conversation.import --preset` and `brain.import` then refuse it: "brains.1.name: two brains are called "Game Master"".

The comment says each file is "parsed and checked as an import would". `examples.list` had the same gap before T10.

Also, an `about` with a line break breaks the CLI listing's layout. There is no newline refinement on `about`.

Both affect only committed files, and the shipped preset is covered by `test/presets.test.ts`.

**Repro:**

```
jq '.brains[1].name = "Game Master"' presets/tabletop-rpg.json > presets/qa-dupe.json
./ss presets.list
./ss brain.import --conversation c_... --preset qa-dupe --brain Co-GM --name X
```

### QA-8 · nit · Two small wording gaps

- **`brain.import`'s help** says "the file's templates, World Bible and **settings** stay behind, and the answer says so when they differ". Only templates are compared (`TEMPLATE_NAMES`). Either compare the image size and models too, or drop "and settings" from that sentence.
- **`conversation.import --preset`'s output** lists "Character Actor" with no sign that its reasoning is on. `presets.list`, `brain.list`, `brain.import`, the payload view and the README all say so. AGENTS.md calls reasoning "an explicit, labeled opt-in", and a preset turns it on for you. Marking it in `started()`'s brain list ("Character Actor (reasoning on)") closes the gap. Whether shipping it on counts as Jason's opt-in is the orchestrator's call: the ticket delegated it to the engineer, and the evidence for it is sound.

## Not findings

- **Painter prompt length:** the Portraitist wrote 136 words and the Scene Painter 118, against "60 to 120". That is close enough, and far shorter than the engineer's 200-word prompts.
- **The Actor's reasoning:** cheap (207–286 reasoning tokens), folded, and never cut by the stop sequence.
- **The noir examples in the prompts** ("forty dollars", "the photograph", "wet cobbles", "the hooded figure") never leaked into the space-opera run.
