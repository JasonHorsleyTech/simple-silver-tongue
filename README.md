# Simple Silver Tongue

An experimental side project: a local chat app for playing a tabletop RPG with a table of AI "brains", built almost entirely by Claude Code agents working through a ticket loop. It runs on your own machine, talks to the [Venice AI](https://venice.ai) API, and has exactly one deployment: `npm run up` on `127.0.0.1`.

It began as a slightly better scratch pad than Venice's own chat and grew into a place to run a one-player game: a Game Master, a Dice Master, a painter for the scene and a brain for each character you meet, all reading the same story. It's a personal tool, shared as it is. There's no hosting, no sign-up (accounts are made in your terminal) and no roadmap.

## What it does

**Start with the tavern.** The app ships with a ready-made campaign, *The Gilded Goat*: a quiet D&D 5e evening in a village tavern, with a World Bible, an opening scene and five brains (Game Master, Dice Master, Joke Teller, Scene Painter, Character Portraitist). A hooded figure sits in the corner booth. One click (or `./sst conversation.import --example dnd-tavern`) and you're playing.

- **Several brains, one story.** A conversation holds any number of named AI personas. Each has its own system prompt, reminder and model, and they all read one shared ledger: a brain sees its own past replies as its own and everyone else's framed as `<!-- from: Dice Master -->`. You can add or edit brains mid-game. The *Tabletop RPG* preset gives you six genre-free brains, among them a Character Creator: every character sheet it writes becomes a new brain that plays that person.
- **Steered regeneration.** Regenerate the last reply with a one-off direction ("make her more nervous"). The direction is sent once and never again. Or take a *fresh take*: your idea goes in as a hidden note from a helper brain called the Muse, and the brain answers it without ever seeing the reply you didn't like. Every version is kept, with a pager.
- **Edit or delete anything**, at any depth, yours or a brain's. An edit becomes what the history always was.
- **Image brains.** An image brain answers with a forced `generate_image(prompt)` tool call. The prompt goes to the conversation's image model and the picture appears in the chat. Every other brain reads the exact prompt, so the story stays consistent with the picture. **Image brains start with Venice's safe mode on**, which blurs adult content.
- **Dice and hidden notes.** The server rolls real d20s (never a model). Brains can keep secrets, such as character sheets or the GM's plans, in hidden notes: every brain reads them, and you see them folded.
- **The payload view.** Every word sent to a model is visible and editable: system prompts, the World Bible, the framing templates, reminders, tool descriptions, steer text. The **Payload** button (and `./sst prompt.preview`) shows the literal request body, built by the same function as the real send.

## How it was built

This repo is as much an experiment in building software with AI agents as it is a game. Claude Code subagents wrote nearly all of the code. Jason, the human in charge, set the goals, made the calls and played the game.

- **Tickets.** [TICKETS.md](TICKETS.md) is both the backlog and the history. It has every feature, from T01 (the foundation) to T19 (this cleanup), with its intent, scope and acceptance bar, plus what each pass reported back.
- **An orchestrator and a four-pass loop.** The main Claude Code session acts as CTO. It writes no product code: it writes tickets, delegates and reviews. Each ticket goes through four fresh subagents in turn, and each one reads its role skill first:
  - **Engineer** builds the terminal and backend scope and proves it through the CLI.
  - **QA** hunts for bugs through the terminal and changes no code.
  - **Triage** fixes, defers or dismisses each finding, giving a reason for each.
  - **Frontend** builds the browser UI on top of those commands and checks it in Chrome through the DevTools MCP.

  The skills are in [`.claude/skills/`](.claude/skills/). Every pass makes one commit and leaves a report in [`reports/`](reports/). Smaller tickets were sometimes done in one pass or directly by a single agent, at Jason's request (T11 to T15, and T19); TICKETS.md says which.
- **Auftragstaktik.** Agents get the goal and the deliverable, not the method. Where tickets and the design doc name a library, a field or an algorithm, it's a suggestion; an agent that sees a better way takes it and updates the docs. If the design is actually wrong, there's an escape valve: the agent does what's sensible, then opens its report with **DESIGN CONCERN** and a recommendation. That counts as a success, not a failure.
- **The handbook.** [AGENTS.md](AGENTS.md) is what every agent reads first. It holds the hard requirements, the stack, the work loop, a budget for live API calls, and an append-only *Lessons learned* list that each pass adds to: traps it hit, test tricks, anything that would have saved the next agent an hour. [docs/design.md](docs/design.md) is the living design spec: the data model, prompt assembly, and the measurements behind each decision.
- **Terminal first, with the web as a skin.** Every action is a command in one registry, with a zod schema. Each command is exposed as `POST /api/<name>` and through the `./sst` CLI, a thin HTTP client to the same endpoints. Features are built and proven as commands first, and the React UI only ever calls commands. So a passing CLI check proves the browser's plumbing, and anything you can click, you can script.
- **Every word sent is visible.** This rule overrides everything else: no hidden prompts, wrappers or injected instructions, and Venice's own system prompt is always off. `prompt.preview` returns the exact request body, and tests assert that it equals what was really sent. When a model was measured adding hidden tokens of its own (Grok 4.7, about 1,240 per request), it came out of the pickers.
- **Light tests, no live API.** `npm test` runs `node:test` against an in-process mock Venice. The mock speaks the real wire format and echoes what each brain saw (which brain, how many messages), so multi-brain routing can be checked for free.

Stack: Node 26 running TypeScript natively (no build step for the server or CLI), Hono, zod, React 19 + Vite + Tailwind v4, flat JSON files and `node:crypto`.

## Set up

You need Node 26 and a Venice API key. The app was built and used on macOS. Other systems should work, but nobody has tried them.

```bash
npm install
cp .env.example .env                # then put your Venice key in it: VENICE_ADMIN_KEY=...
cp models.example.ini models.ini    # optional: choose which models the pickers offer (see Models below)
npm run up                          # builds the web app and starts the server in the background → http://localhost:4747
./sst user.create --username alice  # make an account; asks for a password, hidden (see Privacy)
```

Then open http://localhost:4747, pick your name and type your password.

No key yet? `npm run up:mock` runs the whole app against a local fake Venice. It's free and deterministic, and its replies just echo what the brain saw.

## Models

Venice is used because one key gives access to many open-weight models, and Venice keeps no data for the models it marks *private*. Venice also hosts uncensored models, which this repo leaves off by default.

The model pickers (and `./sst models.list`) offer the models listed in a file: `models.ini` if you made one (it's gitignored), and otherwise the committed `models.example.ini`. The example enables two text models and two image models:
- text: DeepSeek V4.1 Flash (the default) and Gemma 4 31B;
- images: Z-Image Turbo (the default, $0.01 a picture) and Hunyuan Image 3.0 ($0.09).

Every other model the app has been used with is in the file too, commented out, with a line on what we know about it. The uncensored models have a section of their own at the end.

We've spot-checked these models, but we can't have checked them all. The enabled ones are the ones we lean on. The commented-out ones are known to work: uncomment them at your own risk. The file has one model id per line, `#` comments a line out, and a page reload picks up an edit. `./sst models.list --all` lists every model Venice has, and you can still set any of them by id from the terminal.

## Privacy

- **Local only.** The server binds to `127.0.0.1`. Your conversations, images and key stay on your machine (`data/` and `.env` are gitignored).
- **Per-user encryption at rest.** Several people may share one machine, so an account with a password has all its data encrypted on disk, conversations and images alike (scrypt for the key, AES-256-GCM for each file). There is no reset: forget the password and the data is gone for good. An account with an empty password stays plaintext, for debugging.
- The encryption covers an account's conversations, images, titles and prompts (`data/users/<name>/`). It doesn't hide usernames, file sizes or dates.
- Anything you take out is a plain file: a picture opened or saved with `image.get`, a prompt exported with `jq`, a `conversation.get --json` file. Keep those out of this project folder, and delete them when you're done.
- Venice sees your prompts, by nature. The default models are Venice's private ones.
- If you ask a coding agent (Claude Code, say) to look into one of your campaigns, what it reads lands in its transcripts in plain text. Debug with a throwaway `dev-` account instead.
- The full list of where text can and can't end up is in [docs/design.md](docs/design.md), "Where plaintext can still appear".

## Playing

### Start and stop

```bash
npm run up        # builds the web app and starts the server in the background → http://localhost:4747
npm run up:mock   # the same app against a fake, free Venice, for trying things out
npm run down      # stops it (replies and images in flight finish first, up to a minute)
npm run logs      # the server's log (requests and timings only, never your text)
```

A restart logs everyone out.

### Your account

Accounts are made in the terminal, never in the browser:

```bash
./sst user.create --username alice
```

It asks for a password twice, hidden. **With a password, every conversation and image you make is encrypted on disk**, and there is no reset. (An empty password makes an unencrypted account, for debugging only.) You can change the password later from the browser's user menu (click your name, bottom left) or with `./sst user.change-password --username alice`.

A login ends after 60 minutes without activity, and the server wipes your key from memory. Log in again to carry on.

### The example campaign

Open http://localhost:4747, pick your name and type your password. The start page has three ways in: **Ready to play**, **From a preset** and **From scratch**. Under **Ready to play**, find **The Gilded Goat** and press **Start this campaign**. You get your own copy, encrypted like the rest of your data, and it opens on the Game Master's opening scene. Start it again any time for a fresh evening (**New conversation** in the sidebar brings you back to that page).

From the terminal instead: `./sst auth.login --username alice`, then `./sst conversation.import --example dnd-tavern` (`./sst examples.list` lists the examples).

The Game Master's system prompt holds the evening's secrets, so the Payload view and the GM's settings will spoil them. When you try something uncertain (a lie, a sneak, a song), the GM names the check and stops. Ask the Dice Master what to roll ("Persuasion check: roll 1d20 + 5, DC 12"). Then press the **die** beside the pen (or ⌥R) and **Roll & send**: the server rolls a real d20, the roll lands in the scrollback as a die showing its number, and the GM tells you how it goes. From the terminal, `./sst turn --roll` does the same in one go.

### Start from a preset

A **preset** is a kit of brains with good instructions and no world: no World Bible and no story. The first one, **Tabletop RPG**, is six genre-free brains for one player, plus a brain of their own for every character you meet:

- **Game Master** (the default): narrates in the second person ("You step into the rain") up to your next choice, then stops. When you try something uncertain, it stops just before the outcome with *(That's a roll.)*.
- **Co-GM**: answers your questions about the scene ("How far is the drop?") without moving the story.
- **Show Me the Odds**: one sentence for your latest action: no chance, no roll needed, or a d20 target ("Roll a d20: 14 or higher succeeds, …"). You roll with the die, then send the roll to the Game Master, who narrates what it earned.
- **Character Creator**: writes the full sheet of the person your note names or, with nothing typed, the newest person who has none yet (never a second sheet for someone who has one), as a hidden note, folded on your screen. Every brain reads it. **Each sheet makes that person a brain of their own**, named **Character 1**, **Character 2**, …, with the sheet pinned at the top of everything it reads.
- **Character 1, 2, …** (made by the Creator): each one is one person, speaking in the first person, from their own sheet. Talk to the hooded figure with her brain, the barkeep with his: each keeps its own lines and its own sheet, so going back to someone fifty messages later still works. They think before they speak (reasoning on, which adds a small hidden instruction from the provider; switch it off in a brain's settings, or in the Creator's blueprint for the ones to come). Rename one once you know who they are ("Character 1" → "Hooded Figure"): every brain sees the new name from then on.
- **Scene Painter** and **Character Portraitist**: paint the moment, or the newest character, from the sheets. The prompt is the picture's caption, so they keep the sheets' secrets out of it.

Every brain reads every sheet, so a secret can slip out now and then; the prompts are written to keep that rare.

In the browser: **New conversation** → **From a preset**. The Tabletop RPG card shows its six brains (**What each brain does** lists their jobs). Type a title ("Chinatown") and press **Start from this preset**. The new conversation opens on **Write the World Bible first**: press **Write the World Bible**, and the Setup tab opens on it with the cursor ready. Say what kind of story it is, who you play and where tonight begins (three lines is plenty), then **Save** (⌘ Enter). Then play: type "I approach the hooded figure" and press Enter for the Game Master, or press **Send** with nothing typed and the Game Master opens the scene. The other brains are the chips beside Send (see **Play** below).

From the terminal:

```bash
./sst presets.list                                                   # the presets, and what each brain does
./sst conversation.import --preset tabletop-rpg --title "Chinatown"  # six brains, no World Bible, no story
export SST_CONVERSATION=c_...
./sst setup.add --content @world.md                                  # your World Bible: the world, the tone, who you play
./sst turn --content "I approach the hooded figure."
./sst turn --brain "Character Creator"                               # the figure's sheet, as a hidden note: it makes "Character 1"
./sst turn --brain "Character 1" --content "\"Seen this woman?\" I slide the photograph across."
./sst brain.update --brain "Character 1" --name "Hooded Figure"      # once you know who she is
./sst turn --brain "Show Me the Odds" --content "I try to talk him down to half price."
./sst turn --brain "Game Master" --roll                              # rolls a real d20 and sends it: the GM narrates what it earned
./sst turn --brain "Co-GM" --content "How far is the drop?"
./sst turn --brain "Character Portraitist"
```

**A character's own brain, in the browser.** Ask the **Character Creator** (its chip with nothing typed, or a note: "the barkeep"), and the moment its sheet lands, a new chip appears beside Send, glowing: **Character 1**. Under the sheet (a folded hidden note) it says **Made a new brain, Character 1, from this message**, with its name field already open. Type who she is once you know ("Hooded Figure", or her name once the story says it) and press Enter, or press **Later**; you can rename her any time with **Rename** there or in her card (Settings → Brains). Then talk to her with her chip, like any brain. With a dozen characters the chips stay on one row: the ones who spoke (or were made) most recently keep their place, and **+N** at the end lists the rest, one click each. Settings → Brains lists them under **Made by Character Creator**, with a filter once there are many. Each one's card shows its **Pinned messages** (its sheet; Jump to it; how it is sent). The Creator's card has the setting itself: **Each new message makes a new brain**, the name pattern, and the **Blueprint** every new character starts from (its prompt, reminder and reasoning, all editable; a change shapes only the characters still to come). To give any brain a message at the top of what it reads (the Game Master the hooded figure's sheet, say), use the pin under the message: **Pin to a brain**.

**How a character's brain works.** Every sheet the Character Creator writes (or one you write in its mouth with `message.add --as "Character Creator"`) makes a new brain in the same moment: a copy of the Creator's **blueprint** (its prompt, reminder and reasoning, all editable: `./sst brain.list` shows them), named from its pattern, with that sheet **pinned**. A pinned message is sent to that brain right after the World Bible instead of where it sits in the story, and it is a live link: edit the sheet, or regenerate it and pick a version, and the brain plays the new one. Regenerating a sheet makes no new brain. Deleting a sheet deletes its brain too, if that brain never spoke (and if it was the newest, the next one gets its number back), which is how you undo a sheet you didn't want. `./sst prompt.preview --brain "Character 1"` shows exactly what it reads. Nothing here is special to characters: any brain can make brains (`brain.update --makes.name "Place {{n}}" --makes.blueprint.system-prompt @place.md`), and you can pin any message to any brain (`brain.pin --brain "Game Master" --message m_…`).

**Add one brain from a preset** to a conversation you already have (the Gilded Goat could use a Character Creator). In the browser: **Settings** → **Brains** → **Add a brain** → **From a preset**. Every preset's brains are listed with their jobs, and below them the example campaigns' brains. Click one, keep its name or change it (it suggests "Character Creator 2" if one by that name is already there), and press **Add brain**. Its card opens, with a note on what stayed behind (the conversation's own templates, for instance). From the terminal:

```bash
./sst brain.import --preset tabletop-rpg --brain "Character Creator"
./sst brain.import --preset tabletop-rpg --brain "Character Creator" --name "Sheet Writer"   # if one by that name is already there
./sst brain.import --example dnd-tavern --brain "Dice Master"                             # an example campaign's brains work too
```

The whole brain comes over (its prompt, reminder, reasoning, stop sequence, and an image brain's tool text and safe mode), and nothing else: the conversation keeps its own World Bible and templates, and the command says when the templates differ.

A preset brain learns what you haven't seen from hidden notes (the sheets), and no brain reads another brain's system prompt. The Gilded Goat keeps the hooded figure's secrets in its Game Master's prompt, so a sheet an imported Character Creator writes for her comes from what the story shows, and her brain may play her differently from the GM. To share her secrets, copy them into a hidden note in a setup message (Setup tab, or `setup.add`). Every brain reads it then, the Goat's Joke Teller and painters included, and they weren't written to keep secrets.

### Play

In the browser:

- **Talk to the Game Master:** type what you do and press Enter.
- **Ask another brain:** each one has a colored chip beside Send (⌥1, ⌥2, …). With text, your text goes to that brain ("What do I roll?", "Tell me a joke about this"). With nothing typed, it just responds to the scene. The Scene Painter and the Character Portraitist write an image prompt, and the picture is painted while you keep playing. When there are more brains than fit (a character each), the row keeps the ones who spoke or were made most recently, and **+N** lists the others.
- **Roll a d20:** the die beside the pen (⌥R) arms a roll for your next send, whichever button sends it: Send, or any brain's chip, the painters' included. The server rolls it (never a model), it appears in the scrollback as a die with its number, "🎲 I rolled a d20: **14**" beside it, and then that brain answers. Type something first and your words go in before the roll. **Just roll**, in the bar that appears, adds a roll without asking anyone; Esc or × puts the die down. It's the honor system: a roll is your message, so edit or delete it like any other. Once edited, the edited line is the roll every brain reads, and the die's own number is only a footnote ("🎲 d20 said 12"). The wording is the **Your dice rolls** template (Settings → Templates).
- **Regenerate with a steer:** on the last reply, press Regenerate and type a direction ("make her more nervous"), or leave it empty for a plain re-roll (the **Revise** tab). The steer is used once and never sent again. The `‹ 1/2 ›` pager goes back to an earlier version.
- **Regenerate as a fresh take:** the **Fresh take** tab gives the brain an idea for its reply ("The hooded stranger is always an old man. Tired trope. Subvert it: three goblins in a trench coat…"). Your idea goes in as a hidden **note from the Muse**, right before the reply: every brain reads it, you see it folded, and the brain answers it without ever seeing the reply you didn't like. The box starts as that note with the caret inside (its starting text is Settings → Templates → **Fresh take: the Muse's note**); ⌘ Enter sends it, word for word, and **Payload** shows the exact request first. In the scrollback the note sits just above the new reply, marked ✦ **Muse's note for Game Master**, folded; the reply's header says "fresh take". Edit or delete the note like any message, or page through its versions: another fresh take on the same reply gives that note a new version (the box says so, and **Start from the note above** puts its words back in the box, to change the idea rather than retype it). The first fresh take adds a brain called Muse to the conversation: that's who the note is from. It works for any brain, the painters too. Ask the Muse itself (its ✦ chip) and it writes a twist of its own, as a hidden note for whoever answers next ("its own idea"); it leaves a roll that's still waiting to the die, and a fresh take after it puts your note below its own. The Muse is the brain *called* Muse: rename it and it's just another brain (Settings says so before you save), and the next fresh take adds a new one.
- **Edit or delete anything**, at any depth. Editing an image prompt paints a new picture. Under any message: **Pin to a brain** (that brain gets it right after the World Bible, as it stands now) and **Said by…** (who said it, as if they always had). Deleting a character's sheet deletes their brain too if it never spoke.
- **Hidden notes:** a brain's secret notes (a character sheet, the GM's plans), written in a ```` ```hidden ```` block, show as a folded bar, `Hidden · 11 lines`, never a word of them. Click it to read the note, click again to fold it; every reload starts folded. Every brain reads the note, and you can write one too. Edit shows it as written.
- **Look at the pictures:** click one to open it large; ‹ › (or ← →) steps through every picture in the campaign. If one finishes while its card is out of sight, a "picture is ready" button at the bottom takes you to it.
- **Change the table mid-game:** **Settings** (top right) has four tabs. **Brains**: edit any system prompt, reminder, stop sequence or model, or **Add a brain** (blank, or from a preset). **Setup**: the World Bible. **Templates**: the `<!-- from: ... -->` framing, your rolls' wording and the fresh take's Muse note. **Conversation**: models, with each image model's price per picture, resolution, watermark and clone. Each image brain has its own shape (Portrait, Square or Landscape) on its card in Brains. The next message uses the change; nothing restarts.
- **Stop sequences:** each text brain stops at `<!-- from:`, so it can't write lines for you or for another brain: Venice ends its reply just before such a line. It isn't text the model reads, but it is in the request, so the Payload view shows it. Change it under Settings → Brains → the brain → **Stop sequences** (or `./sst brain.update --brain "Game Master" --stop ...`; `--stop '[]'` removes it).

**A new campaign from this one's setup** (say, Pathfinder from the D&D one): Settings → Conversation → **Clone this campaign**. Give it a title, keep **Setup only** (the brains, World Bible, templates and settings, with no story), and press **Clone and open it**. Then edit the World Bible and the prompts to suit. **With the story** copies everything instead, images included: a branch to try something else. The original stays as it was. From the terminal: `./sst conversation.clone --id c_... --title "Pathfinder" --without-messages` (`./sst conversation.list` shows the ids).

**Compare models at one point of the story:** under any message, **Clone from here** (the branch icon) makes a new conversation with the story up to and including that message, images and all. The title is filled in as "Tavern - " with the cursor after it: type the rest (or nothing, and it's named after the model), pick the text model, press Enter, and the copy opens, ready for the next turn. Cloning from the last message brings your unsent text along, so you can type the next action once, then clone, clone, clone and send it under each model. The copies and the original never touch each other. Characters made from later messages stay behind. From the terminal: `./sst conversation.clone --id c_... --through m_... --title "Tavern - Gemma" --text-model google-gemma-4-31b-it` (`./sst conversation.get --id c_... --json` shows the message ids).

**A model per brain:** the conversation's text and image models are the defaults, and any brain can have its own instead: say the table on DeepSeek V4.1 Flash and the Co-GM on Gemma 4 31B, or one painter on another image model. A brain without its own follows the conversation's model when you change it; one with its own keeps it (in a clone under another model too). In the browser: Settings → Brains → the brain → **Text model** (and **Image model** for a painter); "Conversation default" puts it back, and its reasoning switch and prices follow the model you pick. The chat header says when some brains are on their own, and the Payload view says which model a brain's request uses, and whose. From the terminal: `./sst brain.update --brain "Co-GM" --text-model google-gemma-4-31b-it`, `--image-model hunyuan-image-v3` on an image brain, and `--text-model null` to put a brain back on the conversation's. `./sst brain.list` names each brain's model. Some models always reason (GLM 5.3, if you enable it, refuses reasoning off): the brain's card and the Payload view say so.

### From the terminal

Everything the browser does is a `./sst` command (`./sst help` lists them all). To play a campaign from the terminal, set it once:

```bash
export SST_CONVERSATION=c_...
./sst turn --content "I walk over to the hooded figure."
./sst turn --brain "Dice Master" --content "What do I roll?"
./sst turn --brain "Game Master" --roll   # rolls a real d20 (the server rolls it) and sends it: "🎲 d20: 14", then the GM's reply
./sst message.regenerate --steer "Make her more nervous."
./sst message.regenerate --thought "Tired trope. Subvert it: three goblins in a trench coat." --wrap   # a fresh take: a note from the Muse before the reply (--wrap: in the Fresh take template)
./sst turn --brain "Scene Painter"
./sst image.get --id img_... --open       # look at the picture (the turn prints this line for you)
```

A brain can keep notes you only see on purpose (a character sheet with its secrets, the GM's plans) in a ```` ```hidden ```` block: every brain reads it, but the terminal folds it to one line, `[Hidden · 11 lines]`. Add `--reveal` to see it (`./sst conversation.get --reveal`, or the `message.get ... --reveal` line a reply prints after it). A brain's reasoning, when you switch it on, folds the same way as it streams: `--reveal` shows it. Any brain whose system prompt asks for it can write one, and so can you.

**Rolling dice.** `--roll` on any `turn` rolls a d20 (the server's random number generator, never a model), adds it to the conversation as your message, "🎲 I rolled a d20: **14**", after your text if you typed some, and then that brain answers. Every brain reads the roll. `./sst message.roll` just rolls, without asking anyone. It's the honor system: a roll is a normal message you can edit or delete. Its wording is a template like the others (`./sst conversation.update --templates.roll "..."`, with `{{roll}}` where the number goes).

Each reply's header names the campaign (`[Game Master · in "The Gilded Goat (D&D 5e)"]`), so after a clone you can see whether `SST_CONVERSATION` still points at the old one.

`image.get --open` decrypts the picture into your own private temp folder and opens it in your image viewer. That copy, like anything saved with `--out`, is a normal file that anyone with your OS account can read without your password: delete it when you're done (the command prints where it is).

To tweak a system prompt mid-game, or add a brain:

```bash
./sst brain.list --json | jq -r '.brains[] | select(.name=="Game Master") | .systemPrompt' > "$TMPDIR/gm.md"
"${EDITOR:-nano}" "$TMPDIR/gm.md"        # edit it and save
./sst brain.update --brain "Game Master" --system-prompt @"$TMPDIR/gm.md" && rm "$TMPDIR/gm.md"
./sst brain.add --name "Wren's Muse" --system-prompt "You are Wren's muse. Write one short verse Wren could sing right now."
./sst turn --brain "Wren's Muse"
```

(`--final-reminder.content @file` does the same for a brain's reminder; `./sst brain.list` shows every brain's prompts in full.)

One caution: whatever you type on a command line is saved in plain text in your shell history (`~/.zsh_history`, `~/.bash_history`). For anything private, use the browser, or `--content -` and type or paste the text (Ctrl-D ends it). Leave `--password` out and you're asked for it, hidden.

### Older campaigns

<details>
<summary>Campaigns started before the Muse (2026-10-15) or before the Creator made brains (T16)</summary>

**Before 2026-10-15**, brains' prompts didn't say what the Muse is. A fresh take mostly works anyway, but if one comes back empty or talks about the note, paste the presets' Muse sentence into that brain's prompt (Settings → Brains), after its line about hidden blocks: "Sometimes, right before your turn, the Muse (a helper who thinks up twists) leaves you a hidden note with an idea for your next reply. The player never sees it. Your next reply then carries that idea out, in your own voice and at your own pace, without reciting it. A note the Muse left for another helper is background: stay consistent with it, but it isn't yours to carry out."

**Before T16**, one Character Actor played everyone, and its sheets were written before the Creator made brains. To bring such a campaign up to date, give its Character Creator the preset's setting, make a brain from each old sheet, and move the Actor's lines onto the right brains.

In the browser:
1. Settings → Brains → **Add a brain** → **From a preset** → **Character Creator**. It suggests the name "Character Creator 2" and comes with the setting, its blueprint and the prompt that knows each sheet makes a brain.
2. Under each old sheet, the person icon, **Said by…** → **Character Creator 2**. Then **Make a brain** appears under it: type her name (or leave it blank for "Character 1") and press **Make brain**.
3. On each of the old Actor's lines, **Said by…** picks whose line it was.
4. Once the old Creator and the Actor have no lines left, delete them from their cards, and rename "Character Creator 2" to "Character Creator".

(Or keep your own Creator and give it a setting by hand: its card → **Makes brains: Set up…**, a pattern such as `Character {{n}}` and the new brains' prompt.)

From the terminal:

```bash
jq '.brains[] | select(.name == "Character Creator").makes' presets/tabletop-rpg.json > /tmp/makes.json
./sst brain.update --brain "Character Creator" --makes @/tmp/makes.json   # its blueprint, "Character {{n}}", from 1
jq -r '.brains[] | select(.name == "Character Creator").systemPrompt' presets/tabletop-rpg.json > /tmp/creator.md
jq -r '.brains[] | select(.name == "Character Creator").finalReminder.content' presets/tabletop-rpg.json > /tmp/creator-reminder.md
./sst brain.update --brain "Character Creator" --system-prompt @/tmp/creator.md --final-reminder.content @/tmp/creator-reminder.md   # the prompt that knows each sheet makes a brain (skip if you've rewritten yours)
./sst brain.make --message m_…                                       # a brain from an old sheet (its author's blueprint): Character 1
./sst brain.update --brain "Character 1" --name "Alice"
./sst message.set-author --message m_… --as "Alice"                  # each of the Actor's lines that was hers
```

Once the Actor has no lines left, `brain.delete --brain "Character Actor"` removes it.

</details>
