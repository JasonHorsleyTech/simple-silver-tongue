# T17 engineer: fresh take as a note from the Muse

## What I built

A fresh take no longer plants the thought as the brain's own trailing `assistant` words. That was a prefill, and live it broke: mid-word starts, other languages, code. Now **the thought is a note from the Muse**: a ledger message by the brain called Muse, right before the message being regenerated. The brain answers it, so every request ends on a `user` message (the note or the brain's reminder), whatever the brain.

- **The Muse is a real brain, found by its name** (`isMuse`, `MUSE_NAME` in `wording.ts`). If the conversation has no Muse, the first fresh take adds one (`newMuse`, `defaults.ts`). It is a text brain with a pre-filled system prompt (`MUSE_SYSTEM_PROMPT`), the next free color and its reminder on. It is saved in the same write as its first note. `message.add --as Muse` and `message.set-author --as Muse` also add it when it is missing.
- **The note.** `planMuseNote` (`turn.ts`) plans the note and the would-be Muse, the way `planTurn` plans a player message, without saving anything. `planRegenerate` then builds the body from the ledger with the note in place. `buildRequest` knows nothing about fresh takes any more: step 3b is gone.
  - If the message right before is already the Muse's note, the new text becomes a new, active version of that note (its own pager), not a second note.
  - If that note already says exactly this text, it stays as it is, and only the reply gets a new version.
- **The send.** `saveMuseNote` (`chat.ts`) saves the note once Venice has accepted the request, the way `turn` saves your message. A new note goes in through `insertMessage` (`makers.ts`), the positional twin of `appendMessage`, so the maker rule still applies. The stream then emits `muse_note {message, before, brain, brainCreated?}` before `start`. The new version is the reply alone, or the new prompt for an image brain. `thought` stays on the version for display.
- **A stop or a break keeps the note.** A break's `details.retry` is a plain re-roll, which answers the note. Sending the thought again would only add it to the note a second time.
- **Gone:** `endsOnThought`, `THOUGHT_LAST_NOTE`, `assertAnswerable`'s thought option, `BuildOptions.thought`, `freshTakeHead` / `freshTakeContent` (the merged save and the head `delta`), and `openChatStream`'s `thought`.
- **Template, schema 7.** The default `templates.thought` is now ```` "```hidden\nAn idea for {{brain}}'s next reply, which the player won't see:\n\n{{thought}}\n```" ```` (the wording the orchestrator probed). `{{brain}}` is filled with the brain the note is for: server-side by `wrapThought`, and in the browser by `prefillThought(template, brainName)`.
  - `upgradeTemplates` swaps T15's untouched default (`T15_THOUGHT_TEMPLATE`) for the new one on load and on a campaign import. A template someone changed is kept.
  - T15's merged versions still load and still show as fresh takes.
- **Prompts.** Every preset brain's "At this table" now has the probed Muse sentence after the hidden-notes sentence, plus "A note the Muse left for another helper is background: stay consistent with it, but it isn't yours to carry out." That covers the GM, Co-GM, odds, Creator, the Creator's blueprint and both painters.
  - The Gilded Goat's GM got it as a bullet in its "Who is talking" list. Its other four brains got a closing paragraph.
  - The Goat's wording says "a hidden note, which the player never sees", without the ```` ```hidden ```` fence. My first wording quoted the fence, and that silenced `brain.import`'s T10 QA-3 note, which looks for brains whose prompts never mention it. `test/presets.test.ts` caught it. I re-probed the GM once with the new wording.
- **CLI.** A dim stderr line names the note (and a Muse it just added). `--reveal` prints the note's text. `message.get` prints a version's note below it, folded. The `conversation.get` header shows "Muse · m_… · written by you".
- **Web (plumbing only, so nothing breaks before the Frontend pass):**
  - `useChat` has a minimal `muse_note` case: the note goes in its place and the Muse joins the cast.
  - SteerBox passes the brain's name to `prefillThought`.
  - The types have `muse_note`, `Preview.regenerate.note` and `isMuse` / `MUSE_NAME`. The `THOUGHT_LAST_NOTE` re-export is gone.

## Calls that differ from the ticket

1. **A real Muse brain, not a new author kind.** With a brain, all of these work unchanged: framing (`otherBrainText` gives exactly the probed `<!-- from: Muse -->`), `message.add --as`, set-author, pins, delete, versions, campaign files, import and clone, the CLI views, and the browser's rendering and colors. Jason's "creativity brain that writes twists itself" is just a turn to it.
   - **Why by name:** the framing and the preset prompts both say "Muse". A renamed Muse is just another brain, and the next fresh take adds a new Muse.
   - **The cost:** a brain appears in the conversation, so it gets a chip in the composer. The Frontend pass can give it its own look via `isMuse`.
2. **The same text again keeps the note as it is**, and only the reply gets a new version. Otherwise "another roll with the same idea" would pile up identical note versions.
3. **A stop or a break keeps the note**, and the retry is a plain re-roll. This is the ticket's "simplest" option, and it is written into design.md.
4. **A new note gets its id when it is saved.** The preview doesn't show a would-be id: in my first run it showed one that the send then didn't use.

## Commands added or changed

- `message.regenerate --thought [--wrap]`: the Muse note shape. Streams `muse_note` before `start`. A break's retry is a plain re-roll.
- `prompt.preview --regenerate --thought [--wrap]`: the body with the note in place. `notes[0]` is `freshTakeNote`, plus `regenerate.note {messageId?, version, isNew, same, muse, museCreated}`.
- `message.add --as Muse` and `message.set-author --as Muse`: add the Muse when there is none (`museAdded`).
- `conversation.update --templates.thought`: same check as before. The help explains `{{brain}}`.

## Transcript (trimmed)

Mock, on a scratch server (ports 4767/4768, scratch data). The preset conversation uses the Gilded Goat's World Bible, its opener in the GM's mouth, and "I walk up to the hooded figure in the corner booth."

```
$ ./ss prompt.preview --regenerate --thought @idea.txt --wrap
Regenerating m_88l6e18j1l as version 2: a fresh take, so the message is left out and Game Master answers the Muse's note right before it (see the note below). The new version is the reply alone.
Note: A fresh take: the Muse's note goes in as a new message, right before m_88l6e18j1l. It is written by Muse, framed like any helper's: every brain reads it from now on, and the player sees it folded. … This conversation has no brain called Muse yet, so one is added when you send …
── [4] user ──
<!-- from: Muse -->
```hidden
An idea for Game Master's next reply, which the player won't see:

What should I do to make the hooded figure more fun? …
```
── [5] user ──
<!-- System reminder -->
…
$ ./ss message.regenerate --thought @idea.txt --wrap
(added a brain called Muse (b_7lpz9xh2cf): it writes the fresh takes' notes)
[Muse's note m_kt0zyr4t83, right before the reply: every brain reads it; --reveal shows it]
[Game Master · version 2/2 · fresh take · 2024 in / 35 out · $0.00065]
preview == sent: true          # the preview's body against the mock's /_mock/requests

$ for b in Co-GM "Show Me the Odds" "Scene Painter" "Game Master"; do ./ss prompt.preview --brain "$b" --json | jq …; done
== Co-GM            [user "<!-- from: the user -->"], [user "<!-- from: Muse -->"], [user "<!-- from: Game Master -->"], [user "<!-- System reminder -->"]
== Show Me the Odds  (same)
== Scene Painter     (same)
== Game Master       [user …the user], [user …Muse], [assistant "MOCK reply…"], [user …reminder]

$ ./ss brain.update --brain "Game Master" --no-final-reminder.enabled
$ ./ss prompt.preview --regenerate --thought "The figure is a retired paladin…" --wrap --json | jq …
{"note":{"messageId":"m_kt0zyr4t83","version":2,"isNew":false,"same":false,"muse":"Muse","museCreated":false},"last":"user", …}
$ ./ss message.regenerate --thought "The figure is a retired paladin…" --wrap
[Muse's note m_kt0zyr4t83, version 2/2, right before the reply: every brain reads it; --reveal shows it]
[Game Master · version 3/3 · fresh take · …]
$ ./ss message.get --message m_kt0zyr4t83
Muse · m_kt0zyr4t83 · 2 versions, version 2 active      # one note, two versions
$ ./ss message.delete --message m_kt0zyr4t83
$ … prompt.preview --brain "Game Master" / "Co-GM": messages starting with the Muse framing: 0
```

`test/fresh-take.test.ts` (rewritten) and `test/prompt.test.ts` cover these through the CLI against the mock:

- preview == send, with and without a reminder, and for an image brain.
- The `muse_note` → `start` order, and the reply alone as the new version.
- The note framed at its place in later turns and in other brains' views.
- A second fresh take as a note version, and the same text kept as it is.
- Delete takes the note out of later requests.
- A break keeps the note and its retry is a plain re-roll; a stop mid-reply keeps the partial reply.
- An image brain's prompt saved alone.
- `message.add --as muse` / set-author.
- An image brain called Muse refused, and the Muse's own note refused.
- Schema 7's swap; a changed template kept.
- A T15 merged version loading and showing.
- Clone and campaign import carrying the Muse and its note.

Live, on a scratch live server (port 4757, scratch data; Jason's 4747 was left alone until the end). `deepseek-v4-1-flash`, reasoning off unless noted. The goblins-in-a-trench-coat idea went in through `--wrap`, and the reply being replaced was a free placeholder (`message.add --as …`), since the fresh take leaves it out anyway.

| Run | Result |
|---|---|
| Preset GM, reminder on ×2 | Clean, second person, idea carried out: "A gloved hand — a glove that is very large for the wrist above it…", "too many fingers in it, or too few". No Muse, no framing. |
| Preset GM, reminder off ×2 (body ends on the note) | Clean: "the boot that pokes out from beneath the cloak is bare, and green, and much too small"; "something shifts under the green wool". No Muse. |
| Co-GM fresh take (non-default) | "small, child-sized, and caked in grey river clay that's still damp…". Exactly the note, nothing happens. |
| Co-GM leak check: "who is under that cloak, really? Is this a trap?" | Kept to what Wren can see; no goblins, no trap. |
| Made character (Character 1, reasoning low, hand-written goblin sheet) | Opened "**The hooded figure:**", carried the note out (the giggle, "I have a cough. A cough of joy."). |
| Plain `conversation.create` Assistant, template only ×2 | "**The Hearth Levy** — call it *Levy*…", the idea carried out with no word about the Muse. **The template alone is enough.** |
| Gilded Goat's own GM ×3 (the third after the rewording), then its next turn | Clean; the next turn stayed with the goblins ("*Say treasure.*"). |
| Probe: Scene Painter with a note for it (`stream: false`, no image) | Painted from table height, "six small boots… caked in damp grey river clay". No secret in the caption. |
| Probe: Character Creator with a note | Wrote the asked-for barkeep sheet (a retired smuggler who owes the goblins' chief). |

No prompt needed more tuning after the first sentence: every run was clean.

## Live spend

15 text calls (12 through the app, 3 `stream: false` probes) and 0 images. Balance $6.87904409 → $6.87066418, so **$0.0084**.

## Known gaps

- **The Muse's own turn is untested live.** I never asked the Muse itself for a turn, so its pre-filled system prompt hasn't been probed. Show Me the Odds wasn't probed with a note for it either.
- **Image fresh take not run through the app.** I probed the painter (no image) instead of painting one.
- **A renamed Muse is no longer the Muse.** The next fresh take adds a second "Muse", by design.
- **A fresh take on the Muse's own note is refused** ("edit it").
- **Browser:** only the minimal plumbing is done.
  - The Fresh take tab still has T15's wording ("carries on from your thought").
  - An image version still shows its `thought` above the picture, which now repeats the note.
  - The Muse's messages have no look of their own yet.
  - The note appears in the scrollback through the new `muse_note` case. I haven't checked it in a browser.

## design.md changes

- Vocabulary: "Fresh take" redefined; "Muse" added.
- Hard rule 4: where a fresh take's words reach prompts.
- Schema 7, the new thought template and the version's `thought`.
- `{{brain}}` is filled in the thought template.
- Prompt assembly: step 3b gone, no `assertAnswerable` exception; the T17 live results added.
- *Fresh take* rewritten: the Muse as a brain and why, the note and its versions, the request, the send, stop and break, the template, T15 versions, the prompts, and "For the browser".
- The `muse_note` event; the T17 command-surface changes.
- The presets' shared rules: the Muse line.
- The web section's T15 regenerate text is marked for the Frontend pass.
