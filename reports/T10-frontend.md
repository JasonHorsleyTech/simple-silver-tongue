# T10 frontend: presets in the browser

**Result:** Jason can start from a preset and add a preset brain without the terminal.

- **New conversation** now has three ways in, shown one at a time so the page stays calm: **Ready to play** (the Gilded Goat), **From a preset** (Tabletop RPG) and **From scratch**.
- Starting from a preset: type "Chinatown" in the preset card's Title box and press Enter. The new conversation opens on **Write the World Bible first**. One click adds the World Bible and puts the cursor in it, in the Setup tab.
- Adding one brain: **Add a brain** in Settings now has **From a preset**, which lists every preset's brains and the example campaigns' brains, each with its job. The name can be edited before adding. The new brain's card opens with `brain.import`'s notes on what stayed behind.

Live, in the browser, I started "Chinatown live" from the preset and wrote a one-line noir World Bible. Then I played Jason's loop, one live call per step:
1. The GM got "I approach the hooded figure." It answered in the second person and stopped at her offer.
2. The Character Creator, asked with nothing typed, wrote one hidden note ("Hidden · 15 lines").
3. The Character Actor answered as "**The hooded figure:**" in the first person. Its reasoning was collapsed (49 tokens).
4. Show Me the Odds got "…talk her down to half price." It answered: "Roll a d20: 13 or higher succeeds, 19 or higher is a hard success, 8 or lower is a hard failure."
5. I armed the die and pressed Roll & send to the GM. The die rolled 15, and the GM narrated the success it earned: "Half price… All right."

`npm run typecheck` is clean, `npm test` passes 182/182, and the web build succeeds. No DESIGN CONCERN.

**One thing for the orchestrator:** a user called `jason` appeared in my scratch data dir. Details are under "Server and data" below.

## What I built

**The start page** (`features/conversations/NewConversationView.tsx`)
- **Three tabs:** Ready to play, From a preset, From scratch. Each has an icon and a one-line description.
  - The choice is remembered in `localStorage`.
  - ← and → move between the tabs.
  - A tab with nothing in it (no presets, no examples) isn't offered.
- **Panels stay mounted while hidden.** A half-typed system prompt survives a look at the presets.
- **Focus:** the panel shown focuses its first field, without scrolling. That is the preset's Title, or the from-scratch system prompt.
- **Before:** the example card and the from-scratch form were stacked. With a preset card as well, the page ran to about three screens.

**The cards** (`ExampleCard.tsx`, the new `PresetCard.tsx` and `Cast.tsx`)
- Each card shows the file's title, its about line and its brains as badges.
  - Image brains carry the picture icon.
  - **"reasoning low"** sits beside the Character Actor.
  - Hovering a badge shows its job.
  - **What each brain does** turns the badges into a list with each job written out. **Just the names** turns it back.
- **The preset card** has a Title field ("e.g. Chinatown"; blank keeps "Tabletop RPG") and **Start from this preset** (`conversation.import --preset`). Enter in the title field starts it.
- **A file the import would refuse** (triage: `error` in the list) shows its reason in red and has no form. I tested this with a temporary preset that had two brains called "Game Master", then removed it.
- The lists come from `library.ts` (`usePresets`, `useExamples`), read afresh each time the page mounts.

**The World Bible nudge** (`features/chat/ChatView.tsx`, `SetupTab.tsx`, `SettingsPanel.tsx`)
- **When it shows:** a conversation with several brains, no setup and no messages. That is every conversation started from a preset.
- **Where it shows:** a highlighted card above the empty conversation's rows, reading **"Write the World Bible first."** These brains know how to play, not where. Say what kind of story it is, who you play, and where tonight begins: every brain reads it before anything else, word for word.
- **Write the World Bible** calls `setup.add --label "World Bible"`, which pre-fills `<!-- This is the World Bible. -->`. Settings then opens on the Setup tab with that message open and the cursor after the comment. Save it with ⌘ Enter as usual.
- **Errors** show inside the card.
- **A plain one-brain chat** isn't nagged; its Setup row still says "Add a World Bible".
- **The Opening row** now says "…or press Send with nothing typed and Game Master opens it" when there are several brains. The empty Send already asks the default brain to respond.
- **The empty conversation's Brains row** marks image brains and reasoning too.

**Add a brain, from a preset** (`features/settings/BrainsTab.tsx`, the new `ImportBrain.tsx`)
- **The add form's header** now offers **Blank | From a preset**, remembered in `localStorage`. Blank is the old form, with Kind moved beside the name. Its placeholder no longer suggests a brain that rolls for the player.
- **From a preset** lists each preset as a group, open by default. Each example campaign follows as a collapsed group, marked "Written for this campaign: their prompts may name its world and people".
- **Each brain row** shows its badge, the image icon or "reasoning low", "· one here already" when the name is taken, and its job.
- **Picking a row** opens **Name it here**:
  - The name is pre-filled with the brain's own name, or the first free one ("Character Actor 2") with a line saying why.
  - The name is selected, so typing replaces it.
  - The panel scrolls the form into view.
- **Add brain** (or Enter) calls `brain.import`, with `--name` only when the name changed.
- **Name clashes:**
  - A clash the tab knows about is said live under the name, in red: "A brain here is already called “Game Master”: pick another name."
  - A 409 it didn't see coming (a brain added elsewhere a moment ago) gets its own sentence, never the CLI's `--name` hint. The name field is then selected again.
- **The new brain's card** opens scrolled to its top. There, an info box reads "Added from the preset “Tabletop RPG”, whole: everything below came with it." It is followed by every one of `brain.import`'s `notes`, word for word:
  - the templates note;
  - the hidden-notes note (into the Goat);
  - "It was written for…" (an example's brain).

  It is dismissable, and the next add replaces it.
- **Esc** cancels the form.

**One command change.** `presets.list` and `examples.list` brains now carry `reasoning` (the effort, present only when the file switches it on). They also carry the color an import would give them, read from `toConversation`'s result instead of the raw file.
- The CLI's preset and example listings say "(reasoning low)" too.
- `test/presets.test.ts` checks that only the Character Actor is listed with `reasoning: "low"`.
- design.md, "Presets", has the new shape.

## Verified in Chrome (Chrome DevTools MCP)

All checks used user `dev-t10-web` (encrypted), with `SS_DATA_DIR=<scratchpad>/data`: `npm run up:mock`, then `npm run up` for the live part.
- **The start page:**
  - the tabs switch, and the choice survives a reload;
  - the preset's title field is focused;
  - "What each brain does" opens and closes;
  - there is no horizontal scroll at the smallest window Chrome allows (500 px).
- **Typed "Chinatown" + Enter:** I landed on `/c/…` with seven brains, no setup and the nudge. "Write the World Bible" opened Setup with the cursor at the end of the comment. I typed the World Bible and saved it with ⌘ Enter. `./ss setup.list` showed the text, and the nudge was gone.
- **On a Gilded Goat copy:**
  - Add a brain → From a preset → Character Actor → Enter. The card opened with the templates note and the hidden-notes note.
  - Adding it again pre-filled "Character Actor 2".
  - Typing "game master" showed the live clash. Add anyway made the server 409, and the hint stayed with no duplicate error.
  - A clash created from the terminal while the form was open gave the "added elsewhere" sentence.
  - The Gilded Goat's Joke Teller, renamed "Heckler", came with "It was written for…".
  - Blank still adds a brain, and Esc cancels.
- **A broken preset file** is listed as unusable on the start page and in the picker.
- **Network:** only `POST /api/<command>`: `presets.list`, `examples.list`, `conversation.import`, `setup.add`, `setup.update`, `brain.import`, plus the usual ones.
- **Console:** clean, except the two expected 409s from the clash checks.
- **Live:** the loop above, in the browser.

Screenshots:
- `reports/screens/T10-home-preset.png`: the start page on From a preset.
- `reports/screens/T10-world-bible-nudge.png`: the new "Chinatown, film noir" conversation with its nudge.
- `reports/screens/T10-add-from-preset.png`: the picker in the Goat's settings, with Character Actor picked.
- `reports/screens/T10-imported-notes.png`: the imported Actor's card with its notes.

## Spend

The balance went from **$7.68124515** to **$7.67786183**, so **$0.0034**. That was 5 live text calls (GM, Creator, Actor, odds, GM after the roll) and no images.

## Server and data

- **The server is stopped** (`npm run down`), so the next plain `npm run up` uses `data/`.
- **The `jason` folder:** while my mock server held port 4747 with `SS_DATA_DIR` pointed at the scratchpad, a user `jason` was created in that scratch data dir. The folder is `/private/tmp/claude-502/-Users-jasonhorsley-code-simple-silver/52056a7f-1f3e-4937-b2ba-0fdb4b6db6c4/scratchpad/data/users/jason`. Its `user.json` is from 15:11, and its `conversations/` was last changed at 15:16.
  - I didn't create it. Most likely it was `./ss user.create --username jason` (or the browser) reaching my test server instead of his own.
  - I never read, listed or touched its contents.
  - My switch to the live server at about 15:18 would have logged that session out.
  - If it was Jason, that account and conversation live only in the scratchpad, not in `data/`. The scratchpad also holds my `dev-t10-web` user and earlier passes' files.
  - I added a lesson to AGENTS.md about test servers on 4747.

## Known gaps

- **The import notes are the server's sentences, word for word.** Some name commands ("conversation.update --templates.<name>", "setup.add") beside the browser's place for the same thing. They are sentences for both clients, so I kept them whole rather than rewording them in the browser.
- **The picker can't preview a brain's prompt before adding it.** Its card shows every word right after, and Delete is one click away.
- **Colors can repeat after eight brains.** The server's `nextColor` wraps (the 11-brain test Goat had two greens).
- **An unexplained tab switch.** Once, after pressing Enter to import, the settings panel showed the Conversation tab. I couldn't reproduce it in four more tries (scripted and real key presses), and nothing in the import path switches tabs.
