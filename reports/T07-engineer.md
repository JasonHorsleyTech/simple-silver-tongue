# T07 engineer: the example campaign, import and clone, and a live playthrough

## What I built

- **`examples/dnd-tavern.json`, "The Gilded Goat (D&D 5e)"**, the campaign Jason starts from. It has five brains, all with reasoning off:
  - **Game Master** is the default brain. Its system prompt holds the secrets (who the hooded figure is, what the letter is), so the other brains can't spoil them. It says who is talking at the table, and it tells the GM to name a check and stop, never rolling or writing anyone else's lines. Its final reminder is on.
  - **Dice Master** says the check, the dice, Wren's modifier and the DC, then turns a roll into "13 + 5 = 18 vs DC 12: success." in three lines at most.
  - **Joke Teller** tells one short joke about the latest moment, out of character.
  - **Scene Painter** (image) paints the latest moment as Wren sees it, consistent with earlier prompts.
  - **Character Portraitist** (image) paints whoever the player names, or else the character introduced most recently.
  - Each added brain has its own final reminder. The image brains have their own tool text.
  - The **World Bible** setup message is what every brain reads: the room, the people, the prices, and a pre-made player character (Wren Ashdown, a half-elf bard, with stats) whose numbers the Dice Master uses.
  - A hand-written GM opener.
  - The campaign's own templates say "the player" and tell every brain that the player sees the pictures.
  - Images are 1024×768 with no watermark.
  - Every word is in the conversation document, so it can be seen and edited in the app.
- **`examples.list`** (no login needed), **`conversation.import (--example <name> | --campaign @file.json | -) [--title] [--without-messages]`**, and **`conversation.clone --id [--title] [--without-messages]`**.
  - A campaign file uses the conversation document's shape. Any `conversation.get --json` output is one.
  - Import checks the file the way `brain.add` and `conversation.update` do. It gives everything fresh ids and sets `spentUsd: 0`. An imported image message keeps its prompt, and its image becomes an error that you retry to paint.
  - Clone copies image files through the vault under new ids. `--without-messages` is the "we're doing Pathfinder" option.
  - The code is in `src/commands/campaigns.ts` (schema, checks, commands) and `src/conversations/campaign.ts` (`rebuild`: re-ids everything and handles images).
- **The orchestrator's notes:**
  - The default `otherBrainImage` is now `<!-- from: {{brain}}. It called generate_image with this exact prompt: -->`.
  - `DEFAULT_TOOL.resultContent` was also inaccurate after T05 triage, so it now reads "The prompt was sent to the image model. The player sees the image once it is made."
  - `hideWatermark` defaults to `true` for new conversations and imports.
- **Polish from the playthrough:**
  - `SST_CONVERSATION=c_...` makes the CLI fill in `--conversation` wherever a command takes one. A flag still wins. Without it, every line of terminal play needed the id pasted in. `./sst help` mentions it.
  - Import and clone print where to play next.
- **`README.md` for Jason** covers start and stop, his own account (with what encryption means and that there's no reset), importing the example, playing, cloning for Pathfinder, terminal play, and privacy in short.
- **Tests:** `test/campaigns.test.ts` has 8 tests:
  - `examples.list`.
  - Importing the committed example field by field and then playing it: GM view, Dice Master framing, painter, and the image request has no watermark at 1024×768.
  - Round trip `conversation.get --json` → import, including versions, steers, images as errors, and retry painting them.
  - Clone with images (same bytes, new id, neutral `.bin` name), deleting a clone leaves the original's image, `--without-messages`, and a missing file becomes an error.
  - An encrypted import is ciphertext.
  - Bad files are refused with their path, and nothing is created.
  - `SST_CONVERSATION`.
  - The new defaults.
  - Three existing tests changed with the new wording and the watermark default.

## Commands added or changed

| Command | |
|---|---|
| `examples.list` | new, `auth: false` |
| `conversation.import` | new |
| `conversation.clone` | new |
| `conversation.create` | new conversations: `hideWatermark: true`, new `otherBrainImage` wording |
| `brain.add --kind image` | new image brains: new `tool.resultContent` wording |
| CLI | `SST_CONVERSATION` fills in `--conversation`; help footer line |

## The playthrough, live, as an encrypted `dev-` user (trimmed transcript)

This was Jason's paragraph, end to end, with `deepseek-v4-1-flash` and `z-image-turbo`. User `dev-t07-play` was encrypted with a made-up password.

```
$ ./sst venice.balance
Venice balance: $7.88493917 USD · DIEM 0 · tier paid        (after prompt tuning; $7.89027371 at the start of the pass)
$ printf 'goat-and-crown-7\ngoat-and-crown-7\n' | ./sst user.create --username dev-t07-play
Created dev-t07-play (encrypted). Log in with: ./sst auth.login --username dev-t07-play
$ ./sst conversation.import --example dnd-tavern
Imported c_oxoe1avbnm "The Gilded Goat (D&D 5e)" · deepseek-v4-1-flash · images z-image-turbo
Brains: Game Master (default), Dice Master, Joke Teller, Scene Painter (image), Character Portraitist (image)
Setup: World Bible · 1 message

# 1. Walk up to the hooded figure
$ ./sst turn --conversation $C --content 'I shake the rain off my coat, buy a cider from Tobin, and walk over to the hooded figure in the corner booth. "Evening. Mind if I sit? Every other seat in here smells of turnip."'
[Game Master]
Tobin pours the cider without being asked twice and slides it down the bar. "Three coppers. And it's onion soup you can smell, not turnips. Pell and Garrick just *talk* turnips." ...
At the corner booth, the hooded head jerks up. Gloved fingers go still on the letter, then tuck it flat under both hands. "Oh — I — yes. Fine. Sit." The voice is young, female, and about as steady as a shutter in this wind. ...
[Game Master · 1366 in / 180 out · $0.00029]

# 2. Regenerate it with a slight steer (prompt.preview --regenerate first: the steer is the last message, after the GM's reply and reminder)
$ ./sst message.regenerate --conversation $C --steer "Same scene, but she's so flustered that she knocks her cider over."
[Game Master]
... As she reaches to shift her cup out of your way, her gloved hand catches the rim instead. Cider goes across the table in a brown tide.
She snatches the letter up an instant before the wave reaches it, holding it to her chest, dripping. "Sorry. Sorry. I'm — sorry." ...
Moss the cat opens one eye.
[Game Master · version 2/2 · steered · 1596 in / 206 out · $0.00038]

# 3. A second agent with its own instructions: what dice do I roll? Then roll.
$ ./sst turn --conversation $C --brain "Dice Master" --content "I help mop up the cider with my sleeve and try to put her at ease. What do I roll?"
[Dice Master]
**Persuasion check:** roll 1d20 + 5, DC 12. Make it, and she starts to relax.
$ ./sst turn --conversation $C --brain "Dice Master" --content "I rolled a 13."
[Dice Master]
**13 + 5 = 18 vs DC 12: success.**
$ ./sst turn --conversation $C                       # the GM continues from the roll
[Game Master]
She watches you ruin a perfectly good sleeve on her spilled cider, and something in her shoulders gives way. A small laugh escapes, mostly nerves. "You didn't have to do that." ...

# 4. Another agent: a funny joke about this situation
$ ./sst turn --conversation $C --brain "Joke Teller" --content "Tell me a funny joke about this situation."
[Joke Teller]
A bard walks into a tavern, ruins his sleeve on a stranger's cider, and she says, "You didn't have to do that." Ma'am, he's a level 1 bard — that sleeve was the plan.

# 5. An agent whose text goes straight to the image generator
$ ./sst turn --conversation $C --brain "Scene Painter"
[Scene Painter]
A low timber-framed tavern common room at night, seen from beside a corner booth. A young woman in a deep green hooded cloak, freckles and a red curl loose on her cheek, has pushed her hood back a little and sits with gloved hands resting on a sealed letter laid face-down on the wet table; a spilled cup of cider spreads between her and a ruined wet sleeve ... an enormous grey cat watches from the stool nearest the fire with one eye open, a bald broad barkeep in a leather apron wipes a mug behind a scarred oak bar, and two farmers bend over knucklebones by the rain-streaked window. ... Painterly fantasy illustration, warm candlelight, rich colour, detailed.
(making image img_mfw7a72zsq with z-image-turbo... the conversation is free meanwhile)
[Scene Painter · 1918 in / 212 out · $0.00049 · image img_mfw7a72zsq done (z-image-turbo, webp, $0.01)]
   → a real 1024×768 WebP: the green hood, the red curl, the spilled cider, the cat, Tobin, the farmers; no watermark.

# 6. Edit the image prompt, which repaints (adds "a sprig of white heather pinned at its clasp")
$ ./sst message.edit --conversation $C --message m_zd2gtfickf --content @prompt2.txt
Edited m_zd2gtfickf (Scene Painter, version 1/1). Every brain sees the new prompt from the next request. Making its image img_xdhvkdram3 ...
$ ./sst image.follow --conversation $C --message m_zd2gtfickf
[image img_xdhvkdram3 done (z-image-turbo, webp, $0.01)]      → the same scene, now with white heather at her cloak clasp

# 7. The GM knows what the picture shows: the player says only "the little sprig"
$ ./sst turn --conversation $C --content 'I smile and nod at the little sprig pinned to her cloak. "I do carry letters, sometimes. Is that for luck? ..."'
[Game Master]
Odessa's hand jumps to the white sprig at her cloak clasp, and for a moment she looks caught out. "It's heather. My aunt says it's for luck. It's — just a weed, really." ...
"There's a place. Hollowmere. ... It's grain tariffs. Very boring. Extremely official." Her ears are going pink. "I'd pay you five gold."

# 8. Tweak a system prompt mid-game, and keep playing
$ ./sst brain.update --conversation $C --brain "Joke Teller" --system-prompt @jokes.md   # appended: "Tonight, every joke is a limerick"
$ ./sst turn --conversation $C --brain "Joke Teller"
[Joke Teller]
A girl with a letter and a heather sprig swore
It was grain tariffs, boring and sure. ...

# 9. Add a new brain mid-game, and keep playing
$ ./sst brain.add --conversation $C --name "Bard's Muse" --system-prompt "You are the Muse of Wren Ashdown, ... write one short verse Wren could sing right now ..."
$ ./sst turn --conversation $C --brain "Bard's Muse"
[Bard's Muse]
The rain drums down on Millbrook town,
The fire burns warm and low;
A hooded lass sets her cider down,
And spills what she won't show.
$ ./sst turn --conversation $C --content 'I hum the Muse'"'"'s verse under my breath ... "Five gold and a song about it afterwards. Deal. Who do I ask for in Hollowmere?"'
[Game Master]
Odessa's hand closes over the letter — then, slowly, she slides it across the table, face-down, as if it might bite. "Tam. Tam Miller. ..."
$ ./sst turn --conversation $C --brain "Character Portraitist"
[Character Portraitist]
A head-and-shoulders portrait of Odessa, a young woman in her early twenties ... a small sprig of white heather is pinned at the cloak's clasp. ...
[... image img_tye7ng04ir done (z-image-turbo, webp, $0.01)]   → the same face, hood, cloak and heather as the scene

# 10. "We're doing Pathfinder", from this campaign's setup
$ ./sst conversation.clone --id $C --title "Pathfinder at the Goat" --without-messages
Cloned into c_f4ddr3p9ed "Pathfinder at the Goat" · ... Brains: Game Master (default), Dice Master, Joke Teller, Scene Painter (image), Character Portraitist (image), Bard's Muse
$ ./sst setup.update ... ; ./sst brain.update ... --brain "Game Master" ... ; ./sst brain.update ... --brain "Dice Master" ...   # "Pathfinder Second Edition"
$ ./sst turn --conversation c_f4ddr3p9ed --content "Open the scene: I come in out of the rain, lute on my back."
[Game Master]
Rain drums on the shutters as you shoulder the door open. The Gilded Goat's warmth hits you all at once: woodsmoke, wet wool, onion soup. ...

# 11. Unreadable on disk
$ ls -R data/users/dev-t07-play
conversations: c_f4ddr3p9ed.json  c_oxoe1avbnm.json
images:        img_tye7ng04ir.bin  img_xdhvkdram3.bin        (the replaced first image was deleted once its edit landed)
$ grep -rlaiE "Odessa|Gilded Goat|heather|hooded|cider|Dice Master|Bard.s Muse|flustered|Pathfinder|limerick|Tam Miller|WEBP|RIFF" data/users/dev-t07-play
exit 1 (1 = no matches)
$ grep -rlaiE "Odessa|Gilded Goat|hooded|Dice Master" data/users/dev-t07-tune      # plaintext control user, same campaign
data/users/dev-t07-tune/conversations/c_n858ygj8v3.json
$ head -c 6 of every file:  SSENC1 SSENC1 SSENC1 SSENC1
$ jq -c keys data/users/dev-t07-play/user.json
["createdAt","encrypted","kdf","username","version","wrappedKey"]
```

**What went wrong live, and the fix.** After step 6, "I lean in a little and look at her properly" got this reply from the GM:

```
[Game Master]
<!-- from: Dice Master -->
**Insight check:** roll 1d20 + 3, DC 10, to read her.

<!-- from: the player -->
I got an 11.

<!-- from: Dice Master -->
**11 + 3 = 14 vs DC 10: success.**
```

The model continued the framing pattern and played the whole table itself. I fixed it the way Jason would, mid-game. I used `brain.update` on the GM's prompt and reminder to say "never write `<!-- from: ... -->` comments yourself", then made a plain `message.regenerate`. Version 2 was good GM narration, and nothing like it happened in the 7 GM replies after that. The committed example has the fix. A final check of the committed example on a fresh import also held: an uncertain action → "That's an Insight check" and a stop → Dice Master "Rolling for you: **11 + 3 = 14 vs DC 12: success.**" → the GM narrated the success. That was 4 calls. AGENTS.md has a lesson on it.

**Terminal flow against the mock (README steps, fresh data dir).** I ran these: `user.create` (encrypted) → `auth.login` → `conversation.import --example dnd-tavern` → `export SST_CONVERSATION=...` → `turn` → `turn --brain "Dice Master"` → `message.regenerate --steer` → `turn --brain "Scene Painter"` (image done). All exit 0.

## Prompt tuning (live, before the playthrough)

All tuning was on a plaintext `dev-` user.

- The first drafts of the GM, Dice Master and Joke Teller each took 1 to 2 turns.
- The two painters were probed without painting. The scratch script POSTs `prompt.preview --brain ... --json | jq .body` once with `stream: false`, so it is a text call only, with no image and no message saved.
- Changes from tuning:
  - The Dice Master no longer explains what a result means. It still sometimes adds "She's lying." after a success, which is harmless.
  - The Joke Teller asks for a real punchline. "...even Moss the cat has filed a missing-person report" was the re-rolled joke.
  - The Scene Painter frames the picture around what Wren is looking at, instead of a generic view of the whole room.
- After the playthrough:
  - The anti-impersonation lines above.
  - The GM's "who is talking" section now covers `<!-- from: the player -->` explicitly.
  - Wren got pronouns (he/him) in the World Bible, because the Joke Teller had guessed.

## Live spend

- Balance: **$7.89027371 → $7.84644391, so $0.0438 spent.**
- **30 live text calls** (cap ~40): 10 tuning (6 turns or re-rolls, 4 probes), 16 in the playthrough (the Pathfinder turn included), and 4 for the final check.
- **3 live images** (cap 5): the scene, its edit, and the portrait. Each was $0.01, as listed.
- The playthrough conversation recorded $0.04 for 22 messages.

## Known gaps

- **The browser can't start the example or clone yet.** That is Frontend scope (notes added to the T07 ticket). Until then, README.md says to import from the terminal (`./sst auth.login` + `./sst conversation.import --example dnd-tavern`) and then play in the browser.
- **Image size is per conversation.** The Character Portraitist paints at the Scene Painter's 1024×768 landscape size. A per-brain size would need a new field and UI.
- **Odd behaviour seen:**
  - A model can still impersonate the table. Only prompts guard against it, and the app doesn't flag a reply that contains a `<!-- from:` line it wrote itself.
  - The Dice Master "rolls" for you, but an LLM's dice aren't fair. Its prompt says to roll fairly; real dice are better.
  - Pell and Garrick's game, and similar details, are the model's to improvise.
- **Existing conversations keep the old image wording.** The new defaults apply only to new conversations and imports, and it is the user's text to edit.
- **About 30 `dev-*`/`qa-*` users from earlier passes are still in `data/users/`**, and Jason's login picker will list them all. I deleted my own three. The ticket notes the one-line cleanup for whichever pass hands the app over.
- There is no `conversation.export`. `conversation.get --id c_... --json > file.json` already makes a campaign file. For an encrypted user that file is plaintext, the user's own choice.

## design.md changes

- Conversation document: the defaults for `hideWatermark` (true) and `otherBrainImage` (accurate wording), with why.
- "What other brains see doesn't depend on the image" now records the reworded template and tool result.
- A new "Implemented in T07" block covers:
  - the campaign file format and its checks;
  - `examples.list`, `conversation.import`, `conversation.clone`, and how images are handled in each;
  - the example campaign's design (secrets in the GM's own prompt, reminders on everywhere, templates that say "the player");
  - `SST_CONVERSATION`.
- The command list includes `examples.list`.
