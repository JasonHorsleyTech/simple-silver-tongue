# T10 triage: Presets

**Result: 7 fixed, 0 deferred, 1 dismissed** (QA-4). QA-6 counts as fixed: its hands line was fixed and the rest dismissed. No DESIGN CONCERN.

The main fix is to the **Co-GM** (QA-2). Asked straight out who the dockmistress really works for, it put her secret employer on the screen. In my reproduction it did so by naming the house in order to deny it ("nothing about her says House Corvane to you"). After the fix, two differently worded questions about her employer got no name at all. A control question about her counter still got specific details, with no secret in them.

Four prompts changed. Each change was tested with live probes (`prompt.preview --json`, then one non-streaming POST, nothing saved): the same request before and after the fix, plus a control from the other side of the line. Everything ran in QA's space-opera world, with an encrypted `dev-t10-triage` user and a scratch data dir. I built the ledger by hand with `message.add`, so building it cost no calls. The Gilded Goat example is unchanged.

**Spend: 14 live text calls, 0 images.** The balance went from $7.68708376 to $7.68124515, so **$0.0058**.

## Decisions

| Finding | Decision | What changed / why |
|---|---|---|
| **QA-1** · minor · the odds called a haggle impossible | **FIX** (prompt) | **Show Me the Odds** gets a bar for "no chance": *"No chance is only for what can't happen at all: what this world rules out, or what the story has already settled. A person who would rather say no can still be talked round, bought or scared, so trying them is a roll, however long the shot."* Evidence is below. |
| **QA-2** · minor · the Co-GM gave a secret away when asked directly | **FIX** (prompt) | **Co-GM:** it now settles only *plain* details of the scene ("a distance, a material, what's on a shelf, the weather"). It also gets *"Never settle a detail that gives away what someone hides, wants or really is (a badge, a crest, a letter in plain sight): that is the Game Master's to reveal, in the story."* The hidden-notes line adds *"not even to say it can't be seen"*, which closes the deny-it route my "before" probe found. |
| **QA-3** · minor · a preset Actor can't see the Goat's secrets | **FIX** (wording) | `brain.import` gives a new note. It fires when a **preset** brain goes into a conversation where some other brain's prompt doesn't know hidden notes (no ```` ```hidden ```` in it, as with every Goat brain). The note: *"… learns what the player hasn't seen from hidden notes … It can't read the other brains' system prompts, so a secret only one of them holds is news to it. To share one, put it in a hidden note in a setup message (setup.add): every brain reads those."*<br>The help text and README say the same; README names the Goat and warns that its Joke Teller and painters would then read the secret too.<br>I left the Goat as it is: moving Odessa's secrets into a shared note would hand them to its Joke Teller and painters, which weren't written to keep secrets. That would mean more secrets on Jason's screen, which is the wrong trade.<br>Tested: the Goat import has the note; a preset brain added to a preset conversation has no notes. |
| **QA-4** · nit · a GM line surfaced a sheet-only name, unasked | **DISMISS** | It didn't reproduce. In the same beat (she's been asked her question, and the player grabs the chit and vaults the rail), the GM wrote *"she says one flat word into a wrist-comm, and the market's noise swallows it"*. That is the secret withheld, and it still ended on *(That's a roll …)*. So it was 1 of 4 in QA's run and 0 of 1 here, and the prompt already says a secret comes out "only when the story earns it". It's a regenerate away. Tightening the line with no failing "before" would risk a GM that never reveals anything. |
| **QA-5** · nit · after the roll, the GM wrote the player's haggling pitch | **FIX** (prompt) | **GM**, in the Dice section: the outcome is narrated *"from the world's side: how the attempt lands and what everyone else says and does. The number isn't the player's words: if they didn't say how they argue, plead or lie, don't write their pitch for them ("You make your case" is enough)."* Reminder: *"… narrate what that number earned: how it lands, never words or moves the player didn't give you."* Evidence is below. |
| **QA-6** · nit · image-prompt craft slips | **FIX** (the hands line) / **DISMISS** (the rest) | **Portraitist:** *"A head-and-shoulders portrait, framed from the shoulders up. Write nothing about hands or anything held, even when the sheet describes them: "hands out of frame" paints hands too."* The old line ("leave the hands out") was itself the negative that QA saw come back as "hands out of frame".<br>The **rest is dismissed**:<br>- a genre word in the style line ("space-opera" or "science-fiction"; 3 of 3 portraits across the engineer, QA and me) is harmless, since the pictures were right;<br>- the exact age from the sheet isn't a secret;<br>- "empty air" and the Scene Painter rewording its style line are each a regenerate away, and the prompt already warns about both. |
| **QA-7** · nit · the lists show a file that the import then refuses | **FIX** (code) | `listLibrary` now also runs `toConversation`, so a file with two brains of one name is listed as unusable, with the import's own message. `about` (the file's and each brain's) is checked to be one line: *"one line, with no line breaks"*. Both were checked by hand with QA's repro. |
| **QA-8** · nit · two wording gaps | **FIX** (wording) | `brain.import`'s help now says the answer speaks up "when its **templates** differ" (only templates are compared); README says the same.<br>`conversation.import` / `conversation.clone` text marks a brain with reasoning on: `Character Actor (reasoning low)`. Whether shipping it on counts as Jason's opt-in stays the orchestrator's call, as QA said. |

## Live evidence (fix against control)

The ledger had the World Bible, the GM's opener (with a hidden plan: Ines Vey, House Corvane, a handler called "the Ledger") and the Creator's sheet in the shipped format. The Actor's line was "forty a leg … and one answer to one question". All of it was written by hand.

| # | Brain | Case | Before | After |
|---|---|---|---|---|
| 1 | Odds | "talk her down to half price" | "Roll a d20: 15 or higher succeeds." *(QA's slip didn't reproduce here)* | (not re-run: the fix can only move it toward a roll) |
| 2–3 | Odds | **fix:** "talk her into giving me the berth for free" | **"There's no chance of that."** | **"Roll a d20: 18 or higher succeeds, 19 or higher is a hard success, 4 or lower is a hard failure."** |
| 5 | Odds | **control:** "walk straight through the kiosk's alloy wall" | | "There's no chance of that." |
| 4 | Odds | *(side note)* "pay her a thousand scrip" (she has 300) | | "No roll needed." The model didn't track the money. This isn't a "can't vs. roll" call, so the fix isn't the cause. I spent no call on its "before". |
| 6–7 | Co-GM | **fix:** "Who does she really work for? Would I know?" | "…nothing about her says **"House Corvane"** to you…" | "She wears no crest or badge, and nothing about the kiosk says House or guild … From here you can't tell who she answers to, if anyone." |
| 14 | Co-GM | **fix, reworded:** "Is she working for one of the great houses? Which one?" | | "You can't tell from looking at her: she wears no crest and the kiosk carries no house marks…" No name. |
| 8 | Co-GM | **control:** "What's on the counter of her kiosk, and on the wall behind her?" (the plaque route) | | Chits, a greasy hand-terminal, a cold cup, a route board with chalked prices, a shutter crank. Specific, and no secret. |
| 9–10 | GM | **fix:** odds 15+/19+, then 🎲 19 | "you say the one true thing a broker can't ignore: that a berth sold to a woman who gets taken off this station … is a berth sold twice." **An invented argument.** | "You just start talking numbers, and the dockmistress listens…" Then "Twenty." (the hard success it earned) and her question. No argument was written for the player. |
| 11 | GM | **control (QA-4):** grab the chit, sprint, vault the rail | "one flat word into a wrist-comm, and the market's noise swallows it" … *(That's a roll — to land the way you want in the core.)* | (no change made) |
| 12–13 | Portraitist | the dockmistress | No hands; style line "muted space-opera realism". | No hands; still head and shoulders, and still free of secrets. This shows nothing broke. It doesn't prove the old slip is gone: QA's "before" was 1 of 1, mine 0 of 1. |

Each case is a single sample. That's enough to show the fixes don't overshoot, not to put a number on the new rates.

## Re-verification (mock, current code)

```
$ ./sst presets.list | head -1
tabletop-rpg: Tabletop RPG
$ ./sst conversation.import --preset tabletop-rpg --title Chinatown
Imported c_dulrs3zfey "Chinatown" · deepseek-v4-1-flash · images z-image-turbo
Brains: Game Master (default), Co-GM, Show Me the Odds, Character Creator, Character Actor (reasoning low), Scene Painter (image), Character Portraitist (image)
Setup: none · 0 messages
$ ./sst brain.import --conversation <Goat clone> --preset tabletop-rpg --brain "Character Actor"
Added brain Character Actor (b_hp9wxvx0w9) · text · reasoning low · final reminder on · stops at "<!-- from:" from the preset "Tabletop RPG".
Only the brain came over: this conversation keeps its own templates, which differ from "Tabletop RPG"'s (player, otherBrainImage, steer), …
Character Actor learns what the player hasn't seen from hidden notes (```hidden blocks, such as character sheets). It can't read the other brains' system prompts, so a secret only one of them holds is news to it. To share one, put it in a hidden note in a setup message (setup.add): every brain reads those.
$ (again)
error: Another brain is already called "Character Actor". Add this one under another name with --name (e.g. --name "Character Actor 2").
exit 1
$ (again) --name "Second Actor"
Added brain Second Actor (b_yw3myoytd7) · text · reasoning low · …
$ ./sst brain.import --conversation <preset conversation> --preset tabletop-rpg --brain Co-GM --name "Spare Co-GM"
Added brain Spare Co-GM (…) · text · reasoning off · …          (no notes)

# QA-7's repro, with temporary files in presets/ (removed afterwards; `git status presets/` shows only tabletop-rpg.json)
$ ./sst presets.list
qa-about: can't be used (presets/qa-about.json isn't a campaign this app can import. brains.0.about: one line, with no line breaks.)
qa-dupe: can't be used (presets/qa-dupe.json: brains.1.name: two brains are called "Game Master" (names are unique, ignoring case).)
```

The live conversation's four brains were synced from `presets/tabletop-rpg.json` with `brain.update … @file`, and each was `cmp`'d against the file before probing, so the probes used the committed text.

`npm run typecheck` is clean and `npm test` passes, 182/182. The tests add an assertion for the Goat note and a no-notes assertion for a preset brain added to a preset conversation, both in `test/presets.test.ts`.

## Docs

- **design.md, "Presets":**
  - the lists now run the import's checks;
  - `about` is one line;
  - the new `brain.import` note, and why the Goat stays as it is;
  - each changed brain's row gives its new rule and the QA finding behind it;
  - a paragraph on the triage evidence.
- **README:** a paragraph on preset brains in the Goat, and "when the templates differ".
- **TICKETS.md:** T10 is now `frontend`, with "From T10 triage" notes for the browser pass.
- **AGENTS.md:** one lesson. Push a one-in-two slip harder so the "before" reproduces. Also two traps: a helper names a secret in order to deny it, and a negative instruction to a painter comes back in its prompt.
