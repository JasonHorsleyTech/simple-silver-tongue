# simple-silver

Your local scratch pad for [Venice AI](https://venice.ai): a streaming chat with several AI "brains" at one table, steered regeneration, image brains, and per-user encryption. It runs only on this Mac (`127.0.0.1`), and nothing is ever pushed anywhere.

Every word sent to a model is yours to see and edit: system prompts, the World Bible, the `<!-- from: ... -->` framing, reminders, tool text. The **Payload** button (or `./ss prompt.preview`) shows the exact request.

Each text brain also has a **stop sequence**, `<!-- from:`, so it can't write lines for you or for another brain: Venice ends its reply just before such a line. It isn't text the model reads, but it is in the request, so the Payload view shows it. Change it under Settings → Brains → the brain → **Stop sequences** (or `./ss brain.update --brain "Game Master" --stop ...`; `--stop '[]'` removes it).

## Start and stop

```bash
npm run up       # builds the web app and starts the server in the background → http://localhost:4747
npm run down     # stops it (replies and images in flight finish first, up to a minute)
npm run logs     # the server's log (requests and timings only, never your text)
```

The Venice key lives in `.env` (`VENICE_ADMIN_KEY=...`). `npm run up:mock` starts the same app against a fake, free Venice, for trying things out. A restart logs everyone out.

## Make your account (once)

Accounts are made in the terminal, never in the browser:

```bash
./ss user.create --username jason
```

It asks for a password twice, hidden. **With a password, every conversation and image you make is encrypted on disk**, and there is no reset: forget the password and the data is gone for good. (An empty password makes an unencrypted account, for debugging only.) You can change the password later from the browser's user menu (click your name, bottom left) or with `./ss user.change-password --username jason`.

A login ends after 60 minutes without activity, and the server wipes your key from memory. Log in again to carry on.

## Start the example campaign

The app comes with a ready-made campaign: **The Gilded Goat**, a deliberately quiet D&D 5e evening in a village tavern, with five brains (Game Master, Dice Master, Joke Teller, Scene Painter, Character Portraitist), a World Bible and an opening scene. A hooded figure sits in the corner booth.

Open http://localhost:4747, pick your name and type your password. The start page has three ways in: **Ready to play**, **From a preset** and **From scratch**. Under **Ready to play**, **The Gilded Goat**: press **Start this campaign**. You get your own copy, encrypted like the rest of your data, and it opens on the Game Master's opening scene. Start it again any time for a fresh evening (**New conversation** in the sidebar brings you back to that page).

From the terminal instead: `./ss auth.login --username jason`, then `./ss conversation.import --example dnd-tavern` (`./ss examples.list` lists the examples).

The Game Master's system prompt holds the evening's secrets, so the Payload view and the GM's settings will spoil them. When you try something uncertain (a lie, a sneak, a song), the GM names the check and stops. Ask the Dice Master what to roll ("Persuasion check: roll 1d20 + 5, DC 12"), then press the **die** beside the pen (or ⌥R) and **Roll & send**: the server rolls a real d20, the roll lands in the scrollback as a die showing its number, and the GM tells you how it goes. From the terminal, `./ss turn --roll` does the same in one go.

## Start from a preset

A **preset** is a kit of brains with good instructions and no world: no World Bible and no story. The first one, **Tabletop RPG**, is six genre-free brains for one player, and a brain of their own for every character you meet:

- **Game Master** (the default): narrates in the second person ("You step into the rain") up to your next choice, then stops. When you try something uncertain, it stops just before the outcome with *(That's a roll.)*.
- **Co-GM**: answers your questions about the scene ("How far is the drop?") without moving the story.
- **Show Me the Odds**: one sentence for your latest action: no chance, no roll needed, or a d20 target ("Roll a d20: 14 or higher succeeds, …"). You roll with the die, then send the roll to the Game Master, who narrates what it earned.
- **Character Creator**: writes the full sheet of the one your note names or, with nothing typed, the newest person who has none yet (never a second sheet for someone who has one), as a hidden note, folded on your screen. Every brain reads it. **Each sheet makes that person a brain of their own**, named **Character 1**, **Character 2**, …, with the sheet pinned at the top of everything it reads.
- **Character 1, 2, …** (made by the Creator): each one is one person, speaking in the first person, from their own sheet. Talk to the hooded figure with her brain, the barkeep with his: each keeps its own lines and its own sheet, so going back to someone fifty messages later still works. They think before they speak (reasoning on, which adds a small hidden instruction from the provider; switch it off in a brain's settings, or in the Creator's blueprint for the ones to come). Rename one once you know who they are ("Character 1" → "Hooded Figure"): every brain sees the new name from then on.
- **Scene Painter** and **Character Portraitist**: paint the moment, or the newest character, from the sheets. The prompt is the picture's caption, so they keep the sheets' secrets out of it.

Every brain reads every sheet, so a secret can slip out now and then; the prompts are written to keep that rare.

In the browser: **New conversation** → **From a preset**. The Tabletop RPG card shows its six brains (**What each brain does** lists their jobs). Type a title ("Chinatown") and press **Start from this preset**. The new conversation opens on **Write the World Bible first**: press **Write the World Bible**, and the Setup tab opens on it with the cursor ready. Say what kind of story it is, who you play and where tonight begins (three lines is plenty), then **Save** (⌘ Enter). Then play: type "I approach the hooded figure" and press Enter for the Game Master, or press **Send** with nothing typed and the Game Master opens the scene. The other brains are the chips beside Send (see **Play** below).

From the terminal:

```bash
./ss presets.list                                                   # the presets, and what each brain does
./ss conversation.import --preset tabletop-rpg --title "Chinatown"  # six brains, no World Bible, no story
export SS_CONVERSATION=c_...
./ss setup.add --content @world.md                                  # your World Bible: the world, the tone, who you play
./ss turn --content "I approach the hooded figure."
./ss turn --brain "Character Creator"                               # the figure's sheet, as a hidden note: it makes "Character 1"
./ss turn --brain "Character 1" --content "\"Seen this woman?\" I slide the photograph across."
./ss brain.update --brain "Character 1" --name "Hooded Figure"      # once you know who she is
./ss turn --brain "Show Me the Odds" --content "I try to talk him down to half price."
./ss turn --brain "Game Master" --roll                              # rolls a real d20 and sends it: the GM narrates what it earned
./ss turn --brain "Co-GM" --content "How far is the drop?"
./ss turn --brain "Character Portraitist"
```

**A character's own brain, in the browser.** Ask the **Character Creator** (its chip, nothing typed, or your note: "the barkeep") and the moment its sheet lands, a new chip appears beside Send, glowing: **Character 1**. Under the sheet (a folded hidden note) it says **Made a new brain, Character 1, from this message**, with its name field already open: type who she is once you know ("Hooded Figure", or her name once the story says it) and press Enter, or **Later**, and rename her any time with **Rename** there or in her card (Settings → Brains). Then talk to her with her chip, like any brain. With a dozen characters the chips stay on one row: the ones who spoke (or were made) most recently keep their place, and **+N** at the end lists the rest, one click each. Settings → Brains lists them under **Made by Character Creator**, with a filter once there are many. Each one's card shows its **Pinned messages** (its sheet; Jump to it; how it is sent), and the Creator's card has the setting itself: **Each new message makes a new brain**, the name pattern, and the **Blueprint** every new character starts from (its prompt, reminder and reasoning, all editable; a change shapes only the characters still to come). To give any brain a message at the top of what it reads (the Game Master the hooded figure's sheet, say), use the pin under the message: **Pin to a brain**.

**A character's own brain.** Every sheet the Character Creator writes (or one you write in its mouth with `message.add --as "Character Creator"`) makes a new brain in the same moment: a copy of the Creator's **blueprint** (its prompt, reminder and reasoning, all editable: `./ss brain.list` shows them), named from its pattern, with that sheet **pinned**. A pinned message is sent to that brain right after the World Bible instead of where it sits in the story, and it is a live link: edit the sheet, or regenerate it and pick a version, and the brain plays the new one. Regenerating a sheet makes no new brain. Deleting a sheet deletes its brain too, if that brain never spoke (and if it was the newest, the next one gets its number back), which is how you undo a sheet you didn't want. `./ss prompt.preview --brain "Character 1"` shows exactly what it reads. Nothing here is special to characters: any brain can make brains (`brain.update --makes.name "Place {{n}}" --makes.blueprint.system-prompt @place.md`), and you can pin any message to any brain (`brain.pin --brain "Game Master" --message m_…`).

**An older campaign** (one Character Actor playing everyone, its sheets written before the Creator made brains): give its Character Creator the preset's setting, make a brain from each old sheet, and move the Actor's lines onto the right brains.

In the browser, all of it:
1. Settings → Brains → **Add a brain** → **From a preset** → **Character Creator**. It suggests the name "Character Creator 2" and comes with the setting, its blueprint and the prompt that knows each sheet makes a brain.
2. Under each old sheet, the person icon, **Said by…** → **Character Creator 2**. Then **Make a brain** appears under it: type her name (or leave it blank for "Character 1") and press **Make brain**.
3. On each of the old Actor's lines, **Said by…** picks whose line it was.
4. Once the old Creator and the Actor have no lines left, delete them from their cards, and rename "Character Creator 2" to "Character Creator".

(Or keep your own Creator and give it a setting by hand: its card → **Makes brains: Set up…**, a pattern such as `Character {{n}}` and the new brains' prompt.)

From the terminal:

```bash
jq '.brains[] | select(.name == "Character Creator").makes' presets/tabletop-rpg.json > /tmp/makes.json
./ss brain.update --brain "Character Creator" --makes @/tmp/makes.json   # its blueprint, "Character {{n}}", from 1
jq -r '.brains[] | select(.name == "Character Creator").systemPrompt' presets/tabletop-rpg.json > /tmp/creator.md
jq -r '.brains[] | select(.name == "Character Creator").finalReminder.content' presets/tabletop-rpg.json > /tmp/creator-reminder.md
./ss brain.update --brain "Character Creator" --system-prompt @/tmp/creator.md --final-reminder.content @/tmp/creator-reminder.md   # the prompt that knows each sheet makes a brain (skip if you've rewritten yours)
./ss brain.make --message m_…                                       # a brain from an old sheet (its author's blueprint): Character 1
./ss brain.update --brain "Character 1" --name "Alice"
./ss message.set-author --message m_… --as "Alice"                  # each of the Actor's lines that was hers
```

Once the Actor has no lines left, `brain.delete --brain "Character Actor"` removes it.

**Add one brain from a preset** to a conversation you already have (the Gilded Goat could use a Character Creator). In the browser: **Settings** → **Brains** → **Add a brain** → **From a preset**. Every preset's brains are listed with their jobs, and below them the example campaigns' brains. Click one, keep its name or change it (it suggests "Character Creator 2" if one by that name is already there), and press **Add brain**. Its card opens, with a note on what stayed behind (the conversation's own templates, for instance). From the terminal:

```bash
./ss brain.import --preset tabletop-rpg --brain "Character Creator"
./ss brain.import --preset tabletop-rpg --brain "Character Creator" --name "Sheet Writer"   # if one by that name is already there
./ss brain.import --example dnd-tavern --brain "Dice Master"                             # an example campaign's brains work too
```

The whole brain comes over (its prompt, reminder, reasoning, stop sequence, and an image brain's tool text and safe mode), and nothing else: the conversation keeps its own World Bible and templates, and the command says when the templates differ.

A preset brain learns what you haven't seen from hidden notes (the sheets), and no brain reads another brain's system prompt. The Gilded Goat keeps the hooded figure's secrets in its Game Master's prompt, so a sheet an imported Character Creator writes for her comes from what the story shows, and her brain may play her differently from the GM. To share her secrets, copy them into a hidden note in a setup message (Setup tab, or `setup.add`). Every brain reads it then, the Goat's Joke Teller and painters included, and they weren't written to keep secrets.

## Play

In the browser:

- **Talk to the Game Master:** type what you do and press Enter.
- **Ask another brain:** each one has a colored chip beside Send (⌥1, ⌥2, …). With text, your text goes to that brain ("What do I roll?", "Tell me a joke about this"). With nothing typed, it just responds to the scene. The Scene Painter and the Character Portraitist write an image prompt, and the picture is painted while you keep playing. When there are more brains than fit (a character each), the row keeps the ones who spoke or were made most recently, and **+N** lists the others.
- **Roll a d20:** the die beside the pen (⌥R) arms a roll for your next send, whichever button sends it: Send, or any brain's chip, the painters' included. The server rolls it (never a model), it appears in the scrollback as a die with its number, "🎲 I rolled a d20: **14**" beside it, and then that brain answers. Type something first and your words go in before the roll. **Just roll**, in the bar that appears, adds a roll without asking anyone; Esc or × puts the die down. It's the honor system: a roll is your message, so edit or delete it like any other. Once edited, the edited line is the roll every brain reads, and the die's own number is only a footnote ("🎲 d20 said 12"). The wording is the **Your dice rolls** template (Settings → Templates).
- **Regenerate with a steer:** on the last reply, Regenerate, and type a direction ("make her more nervous"), or leave it empty for a plain re-roll (the **Revise** tab). The steer is used once and never sent again. The `‹ 1/2 ›` pager goes back to an earlier version.
- **Regenerate as a fresh take:** the **Fresh take** tab gives the brain an idea for its reply ("The hooded stranger is always an old man. Tired trope. Subvert it: three goblins in a trench coat…"). Your idea goes in as a hidden **note from the Muse**, right before the reply: every brain reads it, the player doesn't, and the brain answers it without ever seeing the reply you didn't like. The box starts as that note with the caret inside (its starting text is Settings → Templates → **Fresh take: the Muse's note**); ⌘ Enter sends it, word for word, and **Payload** shows the exact request first. In the scrollback the note sits just above the new reply, marked ✦ **Muse's note for Game Master**, folded; the reply's header says "fresh take". Edit or delete the note like any message, or page through its versions: another fresh take on the same reply gives that note a new version (the box says so, and **Start from the note above** puts its words back in the box, to change the idea rather than retype it). The first fresh take adds a brain called Muse to the conversation: that's who the note is from. Works for any brain, the painters too. Ask the Muse itself (its ✦ chip) and it writes a twist of its own, as a hidden note for whoever answers next ("its own idea"); it leaves a roll that's still waiting to the die, and a fresh take after it puts your note below its own. The Muse is the brain *called* Muse: rename it and it's just another brain (Settings says so before you save), and the next fresh take adds a new one.
  - *Campaigns started before 2026-10-15* have brains whose prompts don't say what the Muse is. A fresh take mostly works anyway, but if one comes back empty or talks about the note, paste the presets' Muse sentence into that brain's prompt (Settings → Brains), after its line about hidden blocks: "Sometimes, right before your turn, the Muse (a helper who thinks up twists) leaves you a hidden note with an idea for your next reply. The player never sees it. Your next reply then carries that idea out, in your own voice and at your own pace, without reciting it. A note the Muse left for another helper is background: stay consistent with it, but it isn't yours to carry out."
- **Edit or delete anything**, at any depth. Editing an image prompt paints a new picture. Under any message: **Pin to a brain** (that brain gets it right after the World Bible, as it stands now) and **Said by…** (who said it, as if they always had). Deleting a character's sheet deletes their brain too if it never spoke.
- **Hidden notes:** a brain's secret notes (a character sheet, the GM's plans), written in a ```` ```hidden ```` block, show as a folded bar, `Hidden · 11 lines`, never a word of them. Click it to read the note, click again to fold it; every reload starts folded. Every brain reads the note, and you can write one too. Edit shows it as written.
- **Look at the pictures:** click one to open it large; ‹ › (or ← →) steps through every picture in the campaign. If one finishes while its card is out of sight, a "picture is ready" button at the bottom takes you to it.
- **Change the table mid-game:** **Settings** (top right) has Brains (edit any system prompt, reminder or stop sequence, or **Add a brain**: blank, or from a preset), Setup (the World Bible), Templates (the `<!-- from: ... -->` framing, your rolls' wording and the fresh take's Muse note) and Conversation (models, with each image model's price per picture, resolution, watermark, clone). Each image brain has its own shape (Portrait, Square or Landscape) on its card in Brains. The next message uses the change; nothing restarts.

**A new campaign from this one's setup** (say, Pathfinder from the D&D one): Settings → Conversation → **Clone this campaign**. Give it a title, keep **Setup only** (the brains, World Bible, templates and settings, with no story), and press **Clone and open it**. Then edit the World Bible and the prompts to suit. **With the story** copies everything instead, images included: a branch to try something else. The original stays as it was.

From the terminal: `./ss conversation.clone --id c_... --title "Pathfinder" --without-messages` (`./ss conversation.list` shows the ids).

**Compare models at one point of the story:** under any message, **Clone from here** (the branch icon) makes a new conversation with the story up to and including that message, images and all. The title is filled in as "Tavern - " with the cursor after it: type the rest (or nothing, and it's named after the model), pick the text model, press Enter, and the copy opens, ready for the next turn. Cloning from the last message brings your unsent text along, so you can type the next action once, then clone, clone, clone and send it under each model. The copies and the original never touch each other. Characters made from later messages stay behind. From the terminal: `./ss conversation.clone --id c_... --through m_... --title "Tavern - GLM" --text-model z-ai-glm-5-3` (`./ss conversation.get --id c_... --json` shows the message ids).

## From the terminal

Everything the browser does is a `./ss` command (`./ss help` lists them all). To play a campaign from the terminal, set it once:

```bash
export SS_CONVERSATION=c_...
./ss turn --content "I walk over to the hooded figure."
./ss turn --brain "Dice Master" --content "What do I roll?"
./ss turn --brain "Game Master" --roll   # rolls a real d20 (the server rolls it) and sends it: "🎲 d20: 14", then the GM's reply
./ss message.regenerate --steer "Make her more nervous."
./ss message.regenerate --thought "Tired trope. Subvert it: three goblins in a trench coat." --wrap   # a fresh take: a note from the Muse before the reply (--wrap: in the Fresh take template)
./ss turn --brain "Scene Painter"
./ss image.get --id img_... --open       # look at the picture (the turn prints this line for you)
```

A brain can keep notes you only see on purpose (a character sheet with its secrets, the GM's plans) in a ```` ```hidden ```` block: every brain reads it, but the terminal folds it to one line, `[Hidden · 11 lines]`. Add `--reveal` to see it (`./ss conversation.get --reveal`, or the `message.get ... --reveal` line a reply prints after it). A brain's reasoning, when you switch it on, folds the same way as it streams: `--reveal` shows it. Any brain whose system prompt asks for it can write one, and so can you.

**Rolling dice.** `--roll` on any `turn` rolls a d20 (the server's random number generator, never a model), adds it to the conversation as your message, "🎲 I rolled a d20: **14**", after your text if you typed some, and then that brain answers. Every brain reads the roll. `./ss message.roll` just rolls, without asking anyone. It's the honor system: a roll is a normal message you can edit or delete. Its wording is a template like the others (`./ss conversation.update --templates.roll "..."`, with `{{roll}}` where the number goes).

Each reply's header names the campaign (`[Game Master · in "The Gilded Goat (D&D 5e)"]`), so after a clone you can see whether `SS_CONVERSATION` still points at the old one.

`image.get --open` decrypts the picture into your own private temp folder and opens it in your image viewer (Preview). That copy, like anything saved with `--out`, is a normal file that anyone at this Mac's account can read without your password: delete it when you're done (the command prints where it is).

To tweak a system prompt mid-game, or add a brain:

```bash
./ss brain.list --json | jq -r '.brains[] | select(.name=="Game Master") | .systemPrompt' > "$TMPDIR/gm.md"
open -e "$TMPDIR/gm.md"                  # edit it in TextEdit and save
./ss brain.update --brain "Game Master" --system-prompt @"$TMPDIR/gm.md" && rm "$TMPDIR/gm.md"
./ss brain.add --name "Wren's Muse" --system-prompt "You are Wren's muse. Write one short verse Wren could sing right now."
./ss turn --brain "Wren's Muse"
```

(`--final-reminder.content @file` does the same for a brain's reminder; `./ss brain.list` shows every brain's prompts in full.)

One caution: whatever you type on a command line is saved in plain text in your shell history (`~/.zsh_history`). For anything private, use the browser, or `--content -` and type or paste the text (Ctrl-D ends it).

## Privacy, in short

- An encrypted account's conversations, images, titles and prompts are ciphertext on disk (`data/users/<name>/`). Usernames, file sizes and dates are not hidden.
- What you take out is plain: a picture opened or saved with `image.get`, a prompt exported with `jq` as above, a `conversation.get --json` file. Keep those out of this project folder, and delete them when you're done.
- Venice sees your prompts, by nature. The default models (`deepseek-v4-1-flash`, `z-image-turbo`) are Venice's private ones.
- If you ever ask Claude Code to look into one of your campaigns, what it reads lands in its transcripts in plain text. Debug with a throwaway `dev-` account instead.
- The full list of where text can and can't end up is in [docs/design.md](docs/design.md), "Where plaintext can still appear".

For how the app is built, see [AGENTS.md](AGENTS.md) and [docs/design.md](docs/design.md).
