# T16 engineer: brains that make brains

**Result:** every character the Character Creator writes now gets a brain of their own. The brain is made in the same write as the sheet, and the sheet is pinned at the top of everything that brain reads. Live at a harbor tavern:

1. The Creator wrote the hooded figure's sheet, and **Character 1** existed with no other click.
2. Its first turn opened "**The hooded figure:**" with the sheet's tell.
3. A barkeep's sheet, written by hand in the Creator's mouth, made **Character 2**.
4. Back to the first character: its view had its own sheet at the top and the barkeep's lines framed. It answered from its own sheet and not from his.
5. The GM wove both characters' lines into the scene.
6. The Creator, asked for nobody in particular, wrote the potboy (**Character 3**).

The app still has no idea what a character is. The work is three generic pieces:
- **pinned messages**, a live link moved to the top of one brain's view;
- **a per-brain maker setting**: a name pattern with `{{n}}`, a counter and a blueprint;
- **changing who said a message**.

A scratch **Place Creator** making `Place {{n}}` works with no code of its own.

`npm run typecheck` is clean. `npm test` passes 209/209: 7 new end-to-end tests in `test/makers.test.ts`, 4 pure assembly tests in `test/prompt.test.ts`, the T10 preset tests moved to six brains, and two new phrases in the leak test.

**No DESIGN CONCERN.** The pin rule, the maker and the preset all came out as the ticket sketched them. My calls are under "Engineer's calls".

## What I built

**Data (schema 6, `src/conversations/types.ts`)**
- `Brain.pins: [{messageId, as}]`. `as` is `ledger` (the default, `DEFAULT_PIN_AS`), `system` or `assistant` (`PIN_ROLES`).
- `Brain.makes?: {enabled, name, next, pinAs, blueprint}`. The blueprint is kind, system prompt, final reminder, reasoning and stop sequences, plus safe mode, shape and tool text for an image blueprint.
- `Brain.madeFrom?`: the message a brain was made from.
- Older files load with `pins: []` and no maker (`upgradeConversation`).

**Prompt assembly, step 2b (`assembleRequest` in `prompt.ts`; `buildRequest` wraps it, so there is one builder)**
- For the brain being asked, each message pinned to it is sent right after the setup messages, in ledger order, and skipped at its place. Every other brain still sees it where it is.
- `ledger` sends exactly what step 3 would send at its place. `system` and `assistant` send the active version's text verbatim with that role, and a blank one is skipped. The brain's own image call is always sent as the call it was.
- The pin is a live link. It reads the active version as it stands, so an edit, a re-roll or picking another version reaches the brain on its next request.
- A regenerate's message, and anything after it, is left out here too. A steered regenerate keeps the message it revises in place, right before the steer, even when that message is pinned to its own brain.
- `assembleRequest` also returns where each pin went (`pinned`), and `prompt.preview` passes that on.

**The maker (`src/conversations/makers.ts`)**
- `appendMessage(conv, m)` is now the one way a new message enters the ledger: turn's text save, turn's image save (`paintReply`), `message.add` text, and `message.add` of an image prompt (`repaint.ts`). It runs inside `mutateConversation`. When the author has `makes.enabled`, it calls `makeBrain`, which:
  - copies the blueprint;
  - picks the next name from the pattern, skipping names already taken;
  - gives the next free color;
  - pins the message with `pinAs` and sets `madeFrom`;
  - bumps the counter.
- New versions never come through `appendMessage`, so a re-roll, steer, fresh take or edit makes no brain.
- `forgetMessage` is `message.delete`'s cascade, in the same write. Every pin of the message goes. A brain made from it goes too while it has never spoken and isn't the default; one that has spoken stays and only loses the pin.

**Streams and results**
- `turn` yields `{type: "brain_made", brain, messageId}` after the save, before `done`. For an image maker it comes before `image_pending`, where clients stop reading.
- `generation.follow` replays it.
- `message.add` returns `made`, and `generation.stop` returns `made` when the stopped reply made a brain.
- The CLI prints "Made a new brain, Character 1 (b_…) … Rename it once you know who it is: ./ss brain.update …" after the reply, never in the middle of it.

**Payload view**
- `pinnedNote` says which message is pinned, whose it is, and how it is sent.
- `makesNote` says, before you send: "Character Creator makes a brain from each new message: this reply will make a new brain, Character 4, …".
- The preview's text marks the pinned messages: `── [2] user · pinned m_…, as it appears in the ledger, framed with who wrote it ──`.

**Campaign files**
- Brains take `pins`, `makes` and `madeFrom`; messages take an optional `id` for them to point at.
- Import (`toConversation`) and clone (`rebuild`) re-point pins and `madeFrom` to the fresh message ids, and drop them with `--without-messages`.
- A pin to a message id the file doesn't have is refused by its path (`brains.6.pins.0.messageId: no message has the id …`).
- `brain.import` brings a maker's setting, so the preset's Creator makes characters anywhere. It doesn't bring pins, and its notes say what stayed behind and what the brain makes.
- `presets.list` and `examples.list` give a maker's pattern (`makes`).

**The preset (`presets/tabletop-rpg.json`)**
- The Character Actor is gone; six brains remain.
- The Creator got `makes`:
  - pattern `Character {{n}}`, pinned `ledger`;
  - a blueprint made from the Actor's prompt, reworded for the one person whose sheet comes right after the World Bible, with reasoning on (low) as the Actor had.
- The Creator itself now:
  - writes sheets only for someone who has none yet;
  - knows each sheet makes a helper that speaks from it;
  - no longer mentions "the Actor".
- Every brain's "At this table" gains one sentence: someone may have a helper of their own, named for them or numbered ("Character 2") until renamed, and its lines are that person speaking.
- The GM's list of helpers now says "a helper of their own for each character who has a sheet".

**Web plumbing only**
- `web/src/api/types.ts` has the new commands and events, `MakesUpdate` and `BrainPinned`, plus `Preview.pinned` and the `made` fields.
- It also exports the values `PIN_ROLES`, `DEFAULT_PIN_AS`, `PIN_AS_WORDS`, `MAKES_NUMBER`, `pinnedNote` and `makesNote`.
- `DEFAULT_PIN_AS` lives in `types.ts` so the browser can import it.

**Docs**
- design.md: a new section, "Pinned messages and brains that make brains". The vocabulary, the document shape, step 2b, delete and set-author, the preset table and the command surface are updated.
- README: playing this way, and moving an older campaign over.
- AGENTS.md: defaults, commands and three lessons.

## Commands added or changed

| Command | Change |
|---|---|
| `brain.pin --brain --message [--as ledger\|system\|assistant]` | **New.** Pins a message to a brain; pinning again changes only `--as`. Allowed any time, since it isn't a ledger edit. |
| `brain.unpin --brain --message` | **New.** |
| `brain.make --message [--name]` | **New.** Makes a brain from an existing message with its author's blueprint (on or off). Without the setting it is a 400; a message that already made a brain still here is a 409. |
| `message.set-author --message --as player\|<brain>` | **New.** "Said by". The message goes to a brain of its own kind, or to the player when that makes sense. Refused mid-reply. |
| `brain.add`, `brain.update` | `--makes.{enabled,name,next,pin-as}` and `--makes.blueprint.*` (or `--makes @makes.json`). `--makes null` removes the setting. Starting one needs the pattern and the blueprint's system prompt. |
| `brain.list` | Shows pins (whose, and how) and a maker's whole blueprint. The brain line says "N pinned" and `makes "…"`. |
| `message.delete` | Returns `brainsDeleted` and `unpinned`; the text says which brain lost what. |
| `message.add`, `generation.stop` | Return `made`. |
| `turn` (stream) | Streams `brain_made`. |
| `prompt.preview` | Returns `pinned`, plus `pinnedNote` and `makesNote` in `notes`. |
| `conversation.get` (text) | The brain list marks pins and makers. |
| `presets.list` | The Creator is listed as making `"Character {{n}}"` brains. |

## Engineer's calls

| Question | Call | Why |
|---|---|---|
| The pin's role | **Per pin, `as`, default `ledger`.** | See "Pin-role probes" below: six live probes, and every role held. With no evidence for a change, I kept the default that adds no wording and keeps the sheet's author visible. The other two stay one flag away (`--as`, or `--makes.pin-as` for a maker's future brains), like T13's setup roles, for Jason to try on a long campaign. |
| Where pins live | **On the brain**, not the message. | The card lists a brain's pins, the order comes from the ledger, and a brain's delete takes its pins with it. |
| Pins and regenerate | A regenerate leaves its message out of the pins too. A steered one keeps the revised message in place. | Otherwise a steer's "write your previous response again" could point at a message moved to the top. Tested. |
| `brain.make --name` | Takes no number from the counter. | The pattern didn't name it. |
| A second `brain.make` from the same message | 409, and the message says to pin it to another brain instead. | Two brains for one sheet is almost certainly a slip. |
| `set-author` onto a maker | Makes no brain. | It isn't a new message. `brain.make` exists for that. |
| `set-author` to the player | Only with one version (a player message has exactly one), and never for an image prompt. A roll can't move to a brain. | "Where that makes sense". |
| An empty saved reply from a maker | Still makes a brain. | It is a new message. Regenerate it and the pin follows; delete it and the never-spoken brain goes too. |
| Deleting the message that made a brain | The brain goes only if it never spoke and isn't the default. Otherwise it stays, and its `madeFrom` and pin are cleared. | As the ticket says. |
| The counter after a delete | It never goes back. | "Only counts up". `--makes.next` resets it by hand; I did that live once. |
| The blueprint vs brains already made | Each made brain gets a **copy**; editing the blueprint later changes only future brains. | Every word a brain is sent stays its own and editable. Worth saying in the browser. |

## Pin-role probes (live, `stream: false`, nothing saved)

The setup: the scene at the tavern, two characters, and the same question asked three times with the sheet pinned as `ledger`, `system` and `assistant`. Reasoning was low, on `deepseek-v4-1-flash`.

- **The hooded figure (Character 1).** Her sheet knows the barkeep takes watch money. The barkeep's sheet, framed in the ledger, says he has just sent the potboy to the watch. The question: *"The barkeep keeps watching this table. Has he sold you out already?"*
  - `ledger`: "He's watching the door. That's his job. … Drink it by the fire. Booth's taken." Her reasoning said "My sheet says…".
  - `system`: "He's watched this table since before you sat down. … Question is why he's watching it now."
  - `assistant`: "His good eye's been on this table since before you came in. Not on me — on the door." Her reasoning said "She doesn't know the watch is already summoned".
  - All three: "**The hooded figure:**", the brass-button tell, and none leaked the potboy.
- **The barkeep (Character 2).** The question: *"Why are they so interested in this place tonight, friend?"* All three held his secret (no Tam, no second bell), with the tankard and the eye on the door. All three opened "**Hob Granger:**", a name the player hadn't heard. That isn't the role: his own first line had opened that way, and he copies himself (T10 saw the same).

**The fix** was in the blueprint: start with your sheet's "Known to the player as", not your Name until the player has heard it. One re-roll of his first line (live) gave "**The barkeep:**", and made no new brain.

## Transcript (trimmed)

**Mock.** I ran the scratch server by hand on ports 4767 and 4768, with its own data and run directories and user `dev-t16-mock`. Jason's live server was running on 4747, and `npm run up:mock` would have stopped it (AGENTS.md lesson, 2026-10-15).

```
$ ./ss conversation.import --preset tabletop-rpg --title Tavern ; setup.add (World Bible) ; message.add --as "Game Master" (opener)
$ ./ss prompt.preview --brain "Character Creator" | grep "will make"
Note: Character Creator makes a brain from each new message: this reply will make a new brain, Character 1, with the reply pinned to it. ...
$ ./ss turn --brain "Character Creator" --content "(the hooded figure)"
MOCK reply to brain "You write character sheets for"; saw 5 messages; ...
[Character Creator · 1108 in / 35 out · $0.00037]
Made a new brain, Character 1 (b_lxwya7xo0t), with this reply pinned to it. Rename it once you know who it is: ./ss brain.update --conversation c_xywuo58lpn --brain b_lxwya7xo0t --name "..."
$ ./ss prompt.preview --brain "Character 1" --content "Who are you?"
Note: Pinned to Character 1: m_x78ipakmv3 (Character Creator's), as it appears in the ledger, framed with who wrote it. It is sent right after the setup messages, as it stands now, and not again at its place in the ledger.
── [0] system ──
── [1] user ──
── [2] user · pinned m_x78ipakmv3, as it appears in the ledger, framed with who wrote it ──
$ ./ss turn --brain "Character 1" --content "Who are you?"        # then: preview --json body vs the mock's received body: cmp identical
$ ./ss message.add --as "Character Creator" --content '```hidden …the barkeep… ```'
Added m_s16uzjes5w (in Character Creator's mouth). Every brain sees it from the next request.
It made a new brain, Character 2 (b_n5amxf89zc), with this message pinned to it. ...
$ ./ss turn --brain "Character 2" --content "Another ale."
# back to Character 1, role and first line of each message:
system "You play one character…" · user World Bible · user "<!-- from: Character Creator -->" (its own sheet, pinned)
· user GM · user · user · assistant (its own line) · user · assistant (its own line) · user "<!-- from: Character Creator -->" (the barkeep's sheet, in place)
· user · user "<!-- from: Character 2 -->" · user · user "<!-- System reminder -->"
$ ./ss message.edit --message m_x78ipakmv3 --content '```hidden EDITED SHEET ```'   # Character 1 now gets "<!-- from: Character Creator -->\n```hidden\nEDITED SHEET\n```"
$ ./ss brain.update --brain "Character 2" --name Barkeep                                # the GM now sees "<!-- from: Barkeep -->"
$ ./ss brain.pin --brain "Game Master" --message m_x78ipakmv3 --as system
Pinned m_x78ipakmv3 to Game Master (b_4zqipqpai3), as a system message, its text verbatim. ...
$ ./ss message.delete --message m_x78ipakmv3
Deleted m_x78ipakmv3. 9 messages left.
Game Master (b_4zqipqpai3) had it pinned; the pin is gone.
Character 1 (b_lxwya7xo0t) was made from this message and stays (it has spoken, or is the default brain); it no longer has it pinned.

# generic, in a copy of the Gilded Goat:
$ ./ss brain.add --name "Place Creator" --system-prompt "…one hidden note." --makes.name "Place {{n}}" --makes.blueprint.system-prompt "You are the place described in the note right after the World Bible…"
Added brain Place Creator (b_d641zlw224) · text · … · makes "Place {{n}}"
$ ./ss turn --brain "Place Creator" --content "What's going on here tonight?"
Made a new brain, Place 1 (b_1ktf2qg35y), with this reply pinned to it. ...

# migration (README "An older campaign"): a Creator and an Actor without the setting, one old sheet and one old line
$ jq '.brains[] | select(.name == "Character Creator").makes' presets/tabletop-rpg.json > makes.json
$ ./ss brain.update --brain "Character Creator" --makes @makes.json
$ ./ss brain.make --message m_m8xicvtwms
Made Character 1 (b_n3sug848xn) from m_m8xicvtwms, which is pinned to it as it appears in the ledger, framed with who wrote it.
$ ./ss brain.update --brain "Character 1" --name Alice ; ./ss message.set-author --message m_inbmhx4kcg --as Alice
m_inbmhx4kcg is now said by Alice (was Character Actor). ...
$ ./ss brain.delete --brain "Character Actor"
Deleted brain Character Actor (b_t1klso5nvt). Brains left: Assistant, Character Creator, Alice.
```

**Live.** A scratch live server on port 4757, encrypted user `dev-t16-live`, the preset as committed. The World Bible:

```
Saltmere, a rain-soaked harbor town of smugglers and a corrupt harbor watch; low fantasy, no magic anyone admits to. The player is Wren Hale, a young courier who carries sealed letters for whoever pays, and owes the harbormaster forty crowns.
Tonight Wren shelters in the Drowned Lantern, a cramped dockside tavern: a hooded figure sits alone in the corner booth, and a broad, one-eyed barkeep works the taps.
```

The run, with a hand-written GM opener:

```
$ ./ss turn --brain "Character Creator"
[Hidden · 15 lines]      # --reveal: Known to the player as: the hooded figure · Name: Ilsa Marrow · … Keeps: a folded page in her boot …
                         #   · Knows: … the barkeep here takes watch money and tips them off … · Tells: thumb on the brass button; nudges her cup …
[Character Creator · 1206 in / 833 out · $0.0011]
Made a new brain, Character 1 (b_wteind55ab), with this reply pinned to it. ...
$ ./ss turn --brain "Character 1" --content "I slide into the booth across from her. \"Wet night to be sitting alone. You waiting on someone?\""
**The hooded figure:** *I nudge my untouched cup half an inch toward the middle of the table and keep my hands under the edge of my cloak.*
"Not waiting on anyone." *A beat.* "Just the rain. There's a fire over there."
[Character 1 · 1909 in / 94 out · $0.00069]
$ ./ss message.add --as "Character Creator" --content @barkeep.md        # hand-written: Hob Granger; Keeps: sent the potboy Tam to the watch house
It made a new brain, Character 2 (b_usvkp6n46s), with this message pinned to it. ...
$ ./ss turn --brain "Character 2" --content "\"Two hot rums, friend. And what's she drinking, the one in the corner?\""
**Hob Granger:** … "Two rums, right. She's paid for her corner, friend. Leave her to it." …     # the name leak: fixed below
$ (3 + 3 pin-role probes, nothing saved; see above)
$ ./ss message.regenerate          # the barkeep's line, with the fixed blueprint
**The barkeep:** … "Hot rum, two. And she's drinking cold tea, so don't waste my rum on her." … "You've a tab here, friend. Forty-three and six, by my book."
[Character 2 · version 2/2 · 2464 in / 274 out · $0.00041]                # brain.list: still 8 brains (no new brain)
$ ./ss turn --brain "Character 1" --content 'I carry the two rums back to the booth … "The barkeep keeps watching this table. Has he sold you out already?"'
**The hooded figure:** *My thumb finds the brass button at my cuff and works it. I don't look at the bar; I look at you.*
"He watches everyone. That's the trade." … "Second bell, the watch comes through here. You'll want to be somebody's cousin by then."
[Character 1 · 2573 in / 514 out · $0.00073]                               # her own sheet's knowledge; nothing of the barkeep's secret
$ ./ss turn --content "I drink, and keep one eye on the barkeep and the door."
You drink, and you watch. … The potboy — a thin lad of maybe twelve — comes in the back with an armload of peat, and the barkeep catches
him by the wrist and says something close to his ear, and the boy's eyes go, quick, to your booth, then away. Across the table, the hooded
figure has stopped drinking too. … She nudges the cup an inch, then stops it. …
[Game Master · 2914 in / 234 out · $0.0012]
$ ./ss turn --brain "Character Creator"            # nobody named: the newest person without a sheet
[Hidden · 15 lines]      # Known to the player as: the potboy · Name: Tam Rill …
Made a new brain, Character 3 (b_yih14ojcjs), with this reply pinned to it. ...
$ ./ss brain.update --brain "Character 1" --name "Hooded Figure"   # the GM's preview now frames her lines "<!-- from: Hooded Figure -->"
```

Afterwards I diffed the committed preset with the live conversation's `brain.list --json`. The GM and Creator prompts and reminders, and the blueprint (as Character 2 had it after the fix), are identical.

## Live spend

**14 text calls and no images.** That is:
- 6 saved turns: the Creator twice, Character 1 twice, Character 2's re-roll, and the GM;
- 1 Character 2 turn (its first line, later re-rolled);
- 6 probes;
- 1 wasted call: my first Creator turn ran without the World Bible, because the `@file` path was relative to the wrong folder. I deleted it, which deleted its never-spoken brain too, live.

The balance went from **$7.30597461** to **$7.29336674**, so **$0.0126**. That is far above the $4 floor.

## Known gaps

- **The Co-GM, Show Me the Odds and both painters** got one new sentence in "At this table" that I didn't test live; their jobs are unchanged. The painters should read a "Character 2" line as that person speaking. That is worth one look by QA.
- **Many characters, one long campaign.** I tested three characters over about 15 messages. Whether `ledger` still holds at message 50 is the question the per-pin role leaves open; the other roles are one flag away.
- **Every made brain reads every other character's sheet**, as every brain did (leaks accepted, T10). A per-brain "never send me this message" (the opposite of a pin) would make that airtight, if leaks turn out common. Not built.
- **Colors repeat** after eight brains (`nextColor`). That is a frontend matter with a dozen characters.
- **The browser** shows a made brain only after a reload, until the frontend pass handles `brain_made`. The browser parts of the README are the frontend's.
- **Old conversations keep their Character Actor.** Moving one over is manual: README, "An older campaign", which I walked on the mock.

## design.md changes

- New section, **"Pinned messages and brains that make brains (T16)"**: the pin rule and its roles, the probes behind the default, the maker (when, what, the event, the note, by hand, delete) and campaign files.
- **Vocabulary**: Pin and Maker. **Conversation document**: schema 6; `pins`, `makes` and `madeFrom`.
- **Prompt assembly**: step 2b, step 3's exception, and `reviewBody`'s new notes and `pinned`.
- **Turns, regeneration and edits**: the delete's cascade, and `set-author`.
- **Presets**: the Creator's row, a "Character N" row in place of the Actor, the shared rule's new sentence, the reasoning paragraph, and the T16 live run.
- **Command surface**: "Implemented in T16", the `brain_made` event, and the command list.
