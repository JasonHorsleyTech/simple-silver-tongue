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

Open http://localhost:4747, pick your name and type your password. The start page shows **The Gilded Goat**: press **Start this campaign**. You get your own copy, encrypted like the rest of your data, and it opens on the Game Master's opening scene. Start it again any time for a fresh evening (**New conversation** in the sidebar brings you back to that page).

From the terminal instead: `./ss auth.login --username jason`, then `./ss conversation.import --example dnd-tavern` (`./ss examples.list` lists the examples).

The Game Master's system prompt holds the evening's secrets, so the Payload view and the GM's settings will spoil them. When you try something uncertain (a lie, a sneak, a song), the GM names the check and stops: ask the Dice Master what to roll, tell it your roll, then press Send with nothing typed (or `./ss turn`) and the GM tells you how it goes.

## Play

In the browser:

- **Talk to the Game Master:** type what you do and press Enter.
- **Ask another brain:** each one has a colored chip beside Send (⌥1, ⌥2, …). With text, your text goes to that brain ("What do I roll?", "I rolled a 14", "Tell me a joke about this"). With nothing typed, it just responds to the scene. The Scene Painter and the Character Portraitist write an image prompt, and the picture is painted while you keep playing.
- **Regenerate with a steer:** on the last reply, Regenerate, and type a direction ("make her more nervous"), or leave it empty for a plain re-roll. The steer is used once and never sent again. The `‹ 1/2 ›` pager goes back to an earlier version.
- **Edit or delete anything**, at any depth. Editing an image prompt paints a new picture.
- **Look at the pictures:** click one to open it large; ‹ › (or ← →) steps through every picture in the campaign. If one finishes while its card is out of sight, a "picture is ready" button at the bottom takes you to it.
- **Change the table mid-game:** **Settings** (top right) has Brains (edit any system prompt, reminder or stop sequence, or **Add a brain**), Setup (the World Bible), Templates (the `<!-- from: ... -->` framing) and Conversation (models, image size, watermark, clone). The next message uses the change; nothing restarts.

**A new campaign from this one's setup** (say, Pathfinder from the D&D one): Settings → Conversation → **Clone this campaign**. Give it a title, keep **Setup only** (the brains, World Bible, templates and settings, with no story), and press **Clone and open it**. Then edit the World Bible and the prompts to suit. **With the story** copies everything instead, images included: a branch to try something else. The original stays as it was.

From the terminal: `./ss conversation.clone --id c_... --title "Pathfinder" --without-messages` (`./ss conversation.list` shows the ids).

## From the terminal

Everything the browser does is a `./ss` command (`./ss help` lists them all). To play a campaign from the terminal, set it once:

```bash
export SS_CONVERSATION=c_...
./ss turn --content "I walk over to the hooded figure."
./ss turn --brain "Dice Master" --content "What do I roll?"
./ss message.regenerate --steer "Make her more nervous."
./ss turn --brain "Scene Painter"
./ss image.get --id img_... --open       # look at the picture (the turn prints this line for you)
```

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
