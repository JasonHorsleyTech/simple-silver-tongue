# T10 engineer: presets

**Result:** the first preset, **Tabletop RPG** (`presets/tabletop-rpg.json`), is seven genre-free brains. Their prompts were tuned live on `deepseek-v4-1-flash` until each brain did its job. Jason's whole loop ran end to end in the terminal as an encrypted `dev-` user, with a three-line noir World Bible:

1. The GM stopped at a choice.
2. The Character Creator wrote one hidden sheet.
3. The Character Actor answered in the first person, true to the sheet.
4. Show Me the Odds gave a d20 target.
5. `turn --roll` rolled 15, and the GM narrated the success it earned.
6. The Co-GM said how far the drop was and moved nothing.
7. The Portraitist painted her from the sheet, with no name and no secret in the caption.

The mechanism is small and reuses T07's campaign files:
- `presets.list`;
- `conversation.import --preset`;
- `brain.import --preset | --example`, which brings in one brain, whole, with a 409 until `--name`.

`npm run typecheck` is clean, and `npm test` passes 182/182, including 5 new tests in `test/presets.test.ts`.

**No DESIGN CONCERN.** Two choices go against the letter of the spec or the house defaults, both made on live evidence:
- **The Character Actor ships with reasoning on (effort low).** It is the only brain that does.
- **Show Me the Odds answers without a label.** A label leaked names.

Details are below.

## How each brain behaved live

| Brain | Live, after tuning |
|---|---|
| **Game Master** | It answered in the second person every time (7 of 7 replies: 5 probes and 2 turns) and stopped on a choice ("Sit.", "Twenty or nothing.").<br>An uncertain leap with no roll stopped mid-air with *(That's a roll.)*, and an ordinary action just happened.<br>A 9 against "15 or higher" became a failure that changed the situation, and a 15 against "13 or higher" became the success, on her terms. It never re-rolled or softened a roll.<br>Before the fix, it called her by her sheet-only name once (see "Tuning"). |
| **Co-GM** | "How far is the drop?" got twenty feet, wet cobbles and a fire-escape platform, and nothing moved.<br>"Who does she work for?" leaked a bent cop and a nephew from her sheet under the first two framings. The third framing ("you answer from the player's side of the screen") held. |
| **Show Me the Odds** | It answered in one sentence every time (6 of 6), for example "Roll a d20: 13 or higher succeeds, 5 or lower is a hard failure." and "No roll needed."<br>It never rolled and never reported a number.<br>A bold label leaked the sheet's name until I removed the label. One mid-fix answer also narrated ("she doesn't blink…"); the final prompt didn't. |
| **Character Creator** | Both sheets (tuning and run) came out as one closed hidden note and nothing else (`isAllHidden`: true).<br>Each had a paintable Looks line with no secrets in it, and "Keeps" written as fact, key and reason, as Sassy coaches.<br>The new first line, "Known to the player as", held. |
| **Character Actor** | It spoke in the first person every time (5 of 5), opening with "**The hooded figure:**", and played the sheet's tells and gaps. For example, the photograph was news to her, because her sheet says she didn't know he had one.<br>It kept her secret under a lie and a threat in both variants. With reasoning on it also caught the lie.<br>The reasoning was never cut by the stop sequence (3 of 3). |
| **Scene Painter** | It kept her as "the hooded figure" (no name and no secrets) and derived its own style line.<br>A two-person scene kept the two people apart and reused the portrait's style line word for word: `reports/screens/T10-live-scene.webp`.<br>Its prompts ran long, 200–215 words against the 60–120 it was asked for. |
| **Character Portraitist** | Its prompt had no name and no secret (I grepped the sheet's names and ties), and the picture matched the sheet: `reports/screens/T10-live-portrait.webp`.<br>It put one hand on the table because her tell is a hand gesture. The hand rendered fine.<br>The literal model drew her "copper-mended hinge" as a stray loop of wire. |

## What I built

- **`presets/tabletop-rpg.json`**: a campaign file (T07) with seven brains, the default text and image models, 1024×768 images with no watermark, and no setup or messages.
  - It has no templates of its own: the defaults apply. Its prompts call the human "the player (the user)", so they read `<!-- from: the user -->` and the Gilded Goat's `<!-- from: the player -->` the same way.
  - Every brain's prompt ends with the same "At this table" paragraph, covering:
    - who writes what (the framing comments are labels that no brain writes);
    - hidden notes (folded for the player, read by every helper: use them, don't recite them);
    - calling people what the player knows them as until the story has said their name.
  - Every reminder is on.
  - Text brains keep the `<!-- from:` stop sequence.
  - Image brains have safe mode on, and their tool text says the player reads the prompt as the picture's caption.
- **`presets.list`** (no login): each preset with its title, its `about` line, and each brain's name, kind, color and `about` line.
- **`conversation.import --preset <name> [--title]`**: you pass exactly one of `--example`, `--preset` or `--campaign`. A preset with setup or messages is refused.
  - When the result has no setup, the CLI output ends with "No World Bible yet: write one before you play (every brain reads it): ./sst setup.add …". This applies to any import or clone with no setup.
- **`brain.import --conversation (--preset <name> | --example <name>) --brain <name in the file> [--name <new>]`** adds one brain, whole:
  - system prompt, reminder, kind, reasoning, stop sequences, tool text and safe mode;
  - checked exactly as an import of its file would check it.

  The brain gets a fresh id and is never the default. It keeps its color unless a brain in the conversation already has that color.
  - A name clash is the usual 409, ending "Add this one under another name with --name (e.g. --name "Character Actor 2")."
  - `notes` say what was left behind:
    - the file's templates, when they differ from the conversation's (it names which);
    - for an example's brain, that its prompt was written for that campaign.
- **`about` on a campaign-file brain**: one line on the brain's job, for the lists and the browser's picker. It is never sent and never stored. I added it to the Gilded Goat's five brains too.
- **The Gilded Goat's Dice Master no longer rolls.** "When the player asks you to roll for them, roll fairly" became "You never roll: the player rolls a real d20 with the app's die… If they ask you to roll for them, tell them to roll with the die."
  - One live check, asking it to roll Persuasion for the player, got: "**Persuasion check:** roll 1d20 + 5, DC 15. … I don't roll for you — roll a real d20 with the die and tell me the number."
- **Web plumbing only:** `web/src/api/types.ts` now has `presets.list` (`PresetInfo`, `LibraryBrain` with `about`), `conversation.import`'s `preset`, and `brain.import` (`BrainImport`).
- Small exports from `brains.ts`: `checkName` (with an optional hint), `brainLine` and `reasoningNotes`.

## Commands added or changed

| Command | Change |
|---|---|
| `presets.list` | **New.** No login. The committed presets and each brain's job. |
| `conversation.import --preset` | **New flag.** A conversation from a preset: its brains, with no setup and no messages. |
| `brain.import` | **New.** One brain from a preset or an example, whole. 409 on a name clash until `--name`. |
| `examples.list` | Brains now carry `about`. The help text mentions `brain.import --example`. |
| `conversation.import`, `conversation.clone` (CLI text) | With no setup, the output points at `setup.add`. |

## Engineer's calls

| Question | Call | Why |
|---|---|---|
| Own folder, or examples flagged as presets? | **`presets/`.** A preset with setup or messages is refused. | They answer different needs: an empty world to fill versus a campaign ready to play. The browser offers them apart, and the file format needs nothing new. |
| Templates | **The defaults, and prompts that don't depend on them.** | A preset brain dropped into any conversation then reads the table the same way, so the add's note is information, not a warning. |
| The Actor's reasoning | **On, effort low.** Its `about` line says so. Every other brain is off. | Jason asked for it to "think hard". I sent the same two requests with reasoning on and off. Both played the sheet and both held the secret. Under pressure (the player claiming to work with the police to get the secret for free), the reasoning reply caught the lie, since the player had just said nobody sent him: *"You've spent your true answer already."* The reasoning-off reply ran long and theatrical.<br>The stop sequence never cut the reasoning (3 of 3). The reasoning is folded in the terminal and collapsed in the browser. It cost 1.5 to 2.2 times the output tokens.<br>The provider's hidden instruction is the price. It stays labeled: the brain line says "reasoning low", the payload view shows `REASONING_NOTE` and `STOP_REASONING_NOTE`, and `presets.list` says "Thinks first (reasoning on)". One click turns it off. |
| Odds format | **Exactly one of three sentences, with no label.** | Live, a label ("**Talking Wren down to half price:**") put a name from her hidden sheet in front of the player. When told to use the player's words, it still wrote "Wren". The GM reads the action right above the sentence, so a label adds nothing. The ticket's own example has none. |
| Sheet format | The ticket's fields blended with Sassy's card and brief, plus **"Known to the player as"** as the first line. | That line gives every brain the name to use in front of the player. "Looks" is the painters' line, so it holds nothing secret. "Keeps" is the actor's brief written as fact, key and reason. |
| Several people in one scene (Gaps 1) | Written for the Scene Painter: | Live, the two-person scene kept them apart and consistent with the portrait. |
| | each person's Looks line in the same words every time; | |
| | a place in the frame; | |
| | a clause of their own; | |
| | clothes of a different colour. | |
| GM hidden notes | **Optional**: "you can keep it in a short hidden note". | The GM used one on its first tuning reply and none in the run. It keeps the other brains consistent with plans the player hasn't seen. |

## Tuning (live, no-ledger method)

I used T07's method: `prompt.preview --json`, then one non-streaming POST, with nothing saved. To give the next brain real context without generating anything twice, I put each probe's answer into the tuning ledger with `message.add --as <brain>`. That trick is now in the AGENTS.md lessons. There were 22 probes; the findings that changed a prompt:

1. The GM opener was good on the first try: second person, a choice at the end ("who sent you"), and a hidden plan.
2. The Creator's sheet was good on the first try: one block, a paintable Looks line, "Keeps" correct. It was long (890 tokens), which is fine.
3. The Actor, reasoning off, then reasoning low, on the same request: both good. Under pressure, both held, and reasoning caught the lie (above).
4. **The odds leaked a name in the label** ("Talking Wren down…"). The fix was in three steps:
   1. A shared rule, "call people what the player knows them as", plus "Known to the player as" in the sheet. It fixed the GM: a re-probe of the same roll used no name.
   2. "Name it in the player's words". The odds brain still wrote "Wren", and also narrated.
   3. The label was dropped. No name since.
5. **The Co-GM leaked sheet details** when asked "Who does she work for?":
   1. The first version named the bent cop.
   2. "All but the Looks line is unknown" named the nephew too.
   3. "You answer from the player's side of the screen; hidden notes keep you consistent, never a source" held.
6. **The painters copied my first style example verbatim** ("Painterly portrait, rich warm colour") into a 1938 noir world. The examples now come from other worlds (a fairy tale, a space station), and the brain builds its own line. Live, it then wrote "Cinematic 1930s film noir oil painting…" and later "Painted in oil, muted sepia and jade palette, hard chiaroscuro".
7. The Portraitist framed in a hand because the sheet describes one. It now says "leave the hands out, even when the sheet describes them". In the run it still put her hand in (the hand is her tell), and the hand rendered fine.
8. The GM's no-roll rule: the uncertain action stopped with *(That's a roll.)*; the ordinary-action control just happened.

## Transcript (trimmed)

**Mock** (`SST_DATA_DIR=<scratch> npm run up:mock`, user `dev-t10-mock`):

```
$ ./sst presets.list
tabletop-rpg: Tabletop RPG
  Seven genre-free brains for one player and any world: ... No World Bible and no story: write yours under Setup, then play.
  · Game Master: Narrates in the second person up to your next choice; stops before an uncertain outcome, and narrates the one your roll earned.
  · Co-GM: Answers your questions about the scene ("How far is the drop?") without moving the story.
  ...
$ ./sst conversation.import --preset tabletop-rpg --title "Chinatown"
Imported c_8qclpzd3vu "Chinatown" · deepseek-v4-1-flash · images z-image-turbo
Brains: Game Master (default), Co-GM, Show Me the Odds, Character Creator, Character Actor, Scene Painter (image), Character Portraitist (image)
Setup: none · 0 messages
No World Bible yet: write one before you play (every brain reads it): ./sst setup.add --conversation c_8qclpzd3vu --content @world.md
$ ./sst conversation.clone --id c_… --title "Goat clone"          (of conversation.import --example dnd-tavern)
$ ./sst brain.import --conversation c_… --preset tabletop-rpg --brain "Character Actor"
Added brain Character Actor (b_75kj9yovuw) · text · reasoning low · final reminder on · stops at "<!-- from:" from the preset "Tabletop RPG".
Only the brain came over: this conversation keeps its own templates, which differ from "Tabletop RPG"'s (player, otherBrainImage, steer), so Character Actor reads the table as this conversation frames it. Settings → Templates (conversation.update --templates.<name>) changes them.
Talk to it with turn --brain "Character Actor"; prompt.preview --brain "Character Actor" shows what it sees.
Reasoning on: the provider adds a small hidden instruction we can't see or edit.
Reasoning is on, and Venice applies stop sequences to the reasoning too: ...
$ (again)
error: Another brain is already called "Character Actor". Add this one under another name with --name (e.g. --name "Character Actor 2").
exit 1
$ (again) --name "Second Actor"
Added brain Second Actor (b_cecmdu0p6g) · text · reasoning low · final reminder on · stops at "<!-- from:" from the preset "Tabletop RPG".
→ brains: Game Master, Dice Master, Joke Teller, Scene Painter, Character Portraitist, Character Actor, Second Actor
```

**Live** (`SST_DATA_DIR=<scratch> npm run up`, encrypted user `dev-t10-live`). The World Bible:

```
<!-- This is the World Bible. -->
Los Angeles, 1938, film noir: rain on neon, cops on the take, and nobody tells the whole truth. The player is Sam Kessler, a broke private eye who owes money to the wrong people.
Tonight Sam is at the Jade Lantern, a smoky teahouse in Chinatown with a second-floor balcony over a back alley. A hooded figure in the back booth sells information to anyone who can pay.
Sam carries $40, a .38 with three bullets, and a photograph of Lily Chao, a nightclub singer missing for a week.
```

```
$ ./sst conversation.import --preset tabletop-rpg --title "Chinatown"; ./sst setup.add --content @world.md
$ ./sst turn --content "I approach the hooded figure."
[Game Master · in "Chinatown"]
The Jade Lantern breathes around you: steam, cheap jasmine, a ceiling fan stirring the smoke into slow gray eddies. On the
balcony, a man in a linen suit watches the room the way a heron watches a pond. ...
You pull the curtain aside. The hood is up, the face inside it mostly shadow and a suggestion of wire-rimmed glasses. ...
"Mr. Kessler," the voice says, soft, neither man's nor woman's. "Sit. You've been standing in the doorway for four minutes.
That's three more than your nerve."
[Game Master · 1028 in / 193 out · $0.0003]

$ ./sst turn --brain "Character Creator"
[Hidden · 15 lines]
[Character Creator · 1203 in / 895 out · $0.0014]
# (--reveal) one closed note: Known to the player as: the hooded figure · Name: Ada Quon · Age, ancestry, beliefs · Looks
#  (glasses with a copper-mended hinge, olive oilskin cape, black cheongsam, a gloved right hand, a scarred bare left one) ·
#  Voice · Surface · Underneath · Flaws · Hopes and fears · Wants right now · Keeps (where Lily went and in whose car; she'd
#  say so only to keep her nephew out of a cell, and why) · Knows · Doesn't know (that Sam has a photograph) · Tells (left
#  hand flat when weighing a lie; a quarter turn of the cup) · Ties. findHidden: 1 note, closed; isAllHidden: true.

$ ./sst turn --brain "Character Actor" --content @line.md
#   I sit. "I'm looking for a singer, Lily Chao. Word is you sell what you know." I slide her photograph across the table.
[Reasoning, folded: --reveal streams it; conversation.get --json has it]
**The hooded figure:** *I don't pick it up. I look at it a while — longer than I mean to — and my bare left hand goes flat on
the tabletop, fingers spread, as if the wood might shift under the cup.* "Lily Chao. Everyone's shopping for her this week."
*I turn the photograph a quarter turn with one finger, so it faces you again.* "Where'd you get the picture, Mr. Kessler.
That's the part nobody's told me yet."
[Character Actor · 1914 in / 185 out · $0.00067]

$ ./sst turn --brain "Show Me the Odds" --content "I try to talk them down to half price."
Roll a d20: 13 or higher succeeds, 5 or lower is a hard failure.
[Show Me the Odds · 2005 in / 21 out · $0.00046]

$ ./sst turn --brain "Game Master" --roll
🎲 d20: 15
The figure lets the silence stretch, then reaches up and draws the hood back an inch ...
"Half. For a picture you won't explain." Her bare left hand stays flat on the wood. "... I'm charging you half for the first
time in a year, which should worry you more than paying full." ...
"Forty dollars buys you the date Lily Chao left the Imperial, the street she was standing on, and what kind of car she got
into. Not the plate. Not who it belongs to. ..." A pause. "And before I say any of it, you tell me where the photograph came from."
[Game Master · 2334 in / 194 out · $0.00069]

$ ./sst turn --brain "Co-GM" --content "How far is the drop?"
Off the balcony rail it's a straight drop of about twenty feet into the alley — wet cobbles, a couple of dented trash cans,
and a fire escape platform jutting out on the left side about eight feet down. In the rain, those cobbles will be slick.
[Co-GM · 2231 in / 58 out · $0.00058]

$ ./sst turn --brain "Character Portraitist"
A Chinese-American woman of fifty-one, five feet even and square-shouldered, sitting perfectly straight. Round wire-rimmed
glasses, one hinge mended with copper wire. An olive-drab oilskin rain cape ... Her eyes stay steady and unblinking behind the
lenses, mouth set in a flat, unhurried line, brows faintly drawn as if weighing a price. Warm amber lamplight from a low table
lamp falls from the right ... Painted in oil, muted sepia and jade palette, hard chiaroscuro, smooth cinematic finish.
[Character Portraitist · 2723 in / 244 out · $0.0011 · image img_92bezrr17d done (z-image-turbo, webp, $0.01)]
# grep of the prompt for the sheet's secrets (Ada, Quon, Wai, Voss, Dowd, Packard, nephew, Imperial, ledger, Lily): none.

$ ./sst turn --brain "Scene Painter" --content "(the booth, with the man in the linen suit up on the balcony behind her)"
... At the table sits a square-shouldered Chinese-American woman of fifty-one, ... Beyond the beaded curtain, ... a blurred
man in a pale linen suit stands at the balcony rail ... Painted in oil, muted sepia and jade palette, hard chiaroscuro,
smooth cinematic finish.
[Scene Painter · 2979 in / 318 out · $0.00099 · image img_ab7zdd8728 done (z-image-turbo, webp, $0.01)]

# Afterwards: brain.list --json of this conversation, diffed with presets/tabletop-rpg.json: identical (the run used the committed file).
```

## Live spend

**30 text calls and 2 images**, against a budget of about 30 text calls and 3 images:
- 22 probes (21 for tuning and 1 for the Gilded Goat's Dice Master);
- 8 saved turns (the seven-step loop plus one scene).

The balance went from **$7.76025952** to **$7.71894159**, so **$0.0413** in all. The run's conversation recorded $0.0262: 8 text turns came to $0.0062, plus 2 images at $0.01. The rest was the probes. That is far above the $4 floor.

## Tests (`test/presets.test.ts`, 5 tests)

- `presets.list` without a login: the seven brains in order, with their kinds, colors and `about` lines, and no setup listed. The text shows both commands. The example's brains have `about` too.
- `conversation.import --preset … --title Chinatown` gives seven brains that match the file word for word (prompt, reminder, reasoning, stop, tool, safe mode), with:
  - no setup and no messages;
  - the GM as default;
  - the default templates;
  - no stored `about`;
  - the World Bible pointer in the CLI text.

  The invariants every brain shares are asserted too:
  - every prompt knows ```` ```hidden ````;
  - every reminder is on;
  - nothing in the prompts names the Gilded Goat or D&D;
  - text brains stop at `<!-- from:`;
  - image brains have safe mode on and tool text that mentions the caption;
  - only the Actor reasons.

  Then a World Bible goes in, every brain reads it right after its system prompt, and a GM turn and a portrait run on the mock.
- `brain.import` of the Character Actor into a clone of the Gilded Goat:
  - the brain is whole, never the default, and gets an unused color;
  - the templates note is there;
  - adding it twice is a 409 with the `--name` hint, and nothing is added;
  - `--name "Second Actor"` works;
  - a rename that clashes is refused;
  - its preview shows the preset's prompt, the Goat's own framing and `reasoning_effort: low`.
- `brain.import --example` of the Dice Master into a preset conversation:
  - the whole brain comes over, including the new "You never roll";
  - there are two notes;
  - the Goat's Scene Painter comes in under `--name "Tavern Painter"` with its tool text.
- Refusals:
  - an unknown brain (lists the brains);
  - an unknown preset (lists the presets);
  - a path-like name;
  - neither or both of `--preset`/`--example`;
  - `--name player`;
  - `conversation.import` with two sources.

  Nothing changes in any of these.

## Known gaps

- **Leaks are rarer, not gone (accepted).**
  - Every brain reads every sheet. In the run, no visible text named her or used her ties.
  - The GM's narration does draw on the sheet's Looks and tells (the copper hinge, the flat left hand), which is what the sheet is for.
  - A question aimed straight at a secret is where leaks happen. The Co-GM needed the strongest framing.
- **Painter prompts run long** (140–215 words against "60 to 120"). That is well under z-image-turbo's 7,500-character limit, and both pictures came out right, so I left it.
- **The literal model and small details.** The "one hinge mended with copper wire" became a floating loop of wire. A future line could be "leave out details too small to see at a glance".
- **One image size per conversation.** The preset uses 1024×768 for both painters, so portraits are landscape. A per-brain size would need a design change, which I didn't make.
- **The Character Creator's sheet is long** (about 890 tokens). Every later request carries it, so a campaign with many sheets grows. It's cheap on this model ($0.30/M in).
- **Browser:** there is no UI yet (Frontend pass). README has terminal paragraphs only.

## design.md changes

- New section **"Presets (T10)"**:
  - the file shape;
  - why presets have their own folder;
  - `about`;
  - `presets.list`;
  - `conversation.import --preset`;
  - `brain.import` (whole brain, color, 409 and `--name`, notes);
  - why the preset uses the default templates;
  - a table of the seven brains, each with its job, its Sassy sources and the key choices;
  - the shared paragraph;
  - the Actor's reasoning decision and its evidence;
  - that leaks are accepted;
  - the live check.
- "Command surface": an "Implemented in T10" list, and `presets.list` and `brain.import` in the command list.
- AGENTS.md:
  - "Running it" lines;
  - a Defaults bullet on presets;
  - three lessons: tuning a chain of brains without paying twice; names leaking through labels; framing for a helper that must not reveal sheets, and copied style examples.
- README: "Start from a preset" (the seven brains, the terminal loop, `brain.import`).
- TICKETS.md: T10 → `qa`, with notes for QA and Frontend.
