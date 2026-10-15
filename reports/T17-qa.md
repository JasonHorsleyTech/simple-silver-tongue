# T17 QA: Fresh take as a note from the Muse

**Verdict:** Acceptance passes. 0 blockers, 0 majors, 3 minors, 3 nits. No DESIGN CONCERN.

**The main claim holds, on the mock and live.** A fresh take puts one note from the Muse right before the message, and every body ends on a `user` message:
- with and without a reminder;
- for the default brain, a non-default one, a made character, a maker, an image brain, a reasoning brain and a plain Assistant.

Preview equals send for every variant I ran. On the live runs, no reply named the Muse or wrote a framing line. The hidden idea didn't leak to the player through the Co-GM, Show Me the Odds or the Scene Painter.

**The Muse as a brain holds up in use.** Everything a brain gets for free worked: framing, `message.add --as`, set-author both ways, pins, the delete guard, versions, clone, campaign import and export, `--without-messages`, `generation.follow`, encryption and the browser's colors and chips. Asked for a turn, the Muse wrote a well-formed note live.

The weak spot is **the name as identity**:
- Any message by a brain called Muse, right before the message, is taken for "the note" and gets the new version (QA-1).
- A rename silently stops a brain being the Muse (QA-4).
- The Muse brain's own settings leak into fresh takes: image kind (QA-3), makes and pins (QA-6).

I'd keep the brain and tighten the "note right before" rule (QA-1). None of this hurts later tickets.

## How I ran it

- **Tests:** `npm test` passes 214/214 and `npm run typecheck` is clean, at 60c46df. I changed no code.
- **Mock: a scratch server by hand.** Jason's live server on 4747 was left running and untouched (pid 10265, started at 16:57:27 on the committed code).
  - The mock ran on 4778 and the server on 4777, with `SS_DATA_DIR` and `SS_RUN_DIR` in my scratchpad.
  - Users: `qa-t17-a` (plaintext) and `qa-t17-enc` (encrypted).
- **Migration: T15-era files made by the old code.** I checked out aac80e3 (T16 frontend, schema 6) in a scratch worktree and ran it on 4787 against the same mock and scratch data dir. As `qa-t17-old` I made real T15 fresh takes there:
  - a merged text version and an image version, with the default template;
  - a merged version under a customised template.
  
  Then I loaded them with the current server.
- **Live: a scratch live server on 4797** (`SS_MODE=live`, scratch data and run dirs), as `qa-t17-live`.
  - The scene was free to build: the preset, the Goat's World Bible as setup, its opener via `message.add --as "Game Master"`, "I walk up to the hooded figure in the corner booth." as the player, and a `(placeholder)` GM reply to take afresh.
  - The idea was the goblins in a trench coat, `--wrap`ped.
- **Browser:** a quick smoke test in Chrome (DevTools MCP, isolated context) against the scratch mock server. The login picker there listed only my `qa-t17-*` users.
- **Spend: 14 live text calls (13 through the app, 1 `stream: false` probe of the Scene Painter) and 0 images.** The balance went from **$6.87066418** to **$6.86529694**, so **$0.0054**.
- **Clean-up:**
  - The scratch servers (4777, 4778, 4787, 4797) are killed.
  - The worktree is removed, and the scratch data dirs are deleted, with all `qa-t17-*` users in them.
  - Nothing under `data/` or `.run/` was read or written. 4747 is still the server the engineer restarted on the current code.

## Acceptance checklist

| Bullet | Result | Evidence |
|---|---|---|
| Mock: a fresh take puts one note before the message | **Pass** | The Goat, `message.regenerate --thought … --wrap`: the stream gave `muse_note` → `start` → `done`. The ledger became `GM opener, you, Muse (m_5ixek06tie, [Hidden · 3 lines]), GM v2 · fresh take`. "added a brain called Muse" appeared on the first take only. |
| Every brain's `prompt.preview` shows it framed in its place | **Pass** | GM, Dice Master, Joke Teller, Scene Painter and Portraitist each get `… <!-- from: the player --> / <!-- from: Muse --> / <!-- from: Game Master --> / reminder`. The Muse gets the note as its own `assistant` text. |
| The body ends on a `user` message, with and without a reminder | **Pass** | The GM with a reminder ends on the reminder. The plain Assistant (no reminder) ends on `["user","<!-- from: Muse -->\n…"]`. Live, the preset GM with `--no-final-reminder.enabled` ended on the note too. `refusal: null` everywhere. |
| A second fresh take adds a version to the same note | **Pass** | `regenerate.note = {messageId: m_5ixek06tie, version: 2, isNew: false}`. `message.get` shows "2 versions, version 2 active", and the reply went to v3. The same text again gave `same: true`: the note was unchanged and only the reply got v4. |
| Deleting the note takes it out of every later request | **Pass** | After `message.delete`, the GM, Dice Master and the regenerate preview have 0 messages framed by the Muse. The only hit left is the Muse's own system prompt. |
| `prompt.preview --regenerate --thought` equals what is sent | **Pass** | I compared the preview's `.body` with the mock's received body (`jq -S`, `cmp`) for 10 variants, all equal: <ul><li>a new note, a note's v2 and the same note</li><li>a plain re-roll after a fresh take, and a steer after one</li><li>an image brain</li><li>the Character Creator (a maker)</li><li>a made character with a pin</li><li>the only message in the ledger</li><li>a plain Assistant</li></ul> |
| Live: the preset GM's fresh take starts cleanly, carries the idea out and doesn't name the Muse | **Pass** | With the reminder on: "the cloak doesn't quite hang right. There's a lump at the shoulder…". With it off: "The left glove is black, the right brown…". With reasoning low: a clean reply (below). |
| Live: on a brain with no reminder | **Pass** | The preset GM with its reminder off (above), and a plain `conversation.create` Assistant ("The Hearth & Hound — …"). |
| Live: on the Co-GM or a made character | **Pass** | Co-GM: "among the prints are three sets of small bare feet, far too small for anyone Wren's size". It had no word about the Muse. |
| A T15 conversation with fresh-take versions loads and shows them | **Pass** | Both old files load as schema 7. <ul><li>The untouched T15 template became the new default.</li><li>`MY CUSTOM {{thought}}` was kept.</li><li>The merged GM version shows "fresh take" with its thought at its head.</li><li>The T15 image version prints its thought below the prompt in `message.get`.</li><li>`conversation.import --campaign` of the raw T15 file swaps the template too.</li></ul> |
| Every word sent is visible and editable | **Pass** | The note, its framing and the Muse's own system prompt and reminder are all in `prompt.preview` and `brain.list`. The note is an ordinary message: I edited, versioned, deleted, re-authored and pinned it. |
| `npm test` and `npm run typecheck` pass | **Pass** | 214/214, clean. |

### Also checked, all fine

- **Stops and breaks:**
  - `MOCK_MIDSTREAM_ERROR` in the thought: the note is kept, no version is saved, and the error says "The Muse's note … stays, so a plain regenerate (no thought) answers it". `details.retry` has no thought.
  - `MOCK_ERROR` (an up-front 500): nothing is saved, and the note is unchanged.
  - A stop mid-reply keeps the partial version (`stopped`), with the note at its new version.
  - A stop during reasoning keeps the note and saves no version, with the same message.
  - A stop while the mock was frozen (`kill -STOP`) saved nothing at all.
- **409s during a fresh take:** another regenerate, a turn, `message.add --as Muse`, an edit of the note and a delete of the note are all refused. A rename of the Muse mid-reply is allowed and harmless: the note is saved under the brain's id.
- **The Muse's edges:**
  - A second brain called "muse" is refused.
  - `brain.delete Muse` is refused while it has notes.
  - `--kind image` is refused while it has notes.
  - A fresh take on the Muse's own message is refused with a clear message.
  - `message.add --as muse` (lower case) adds "Muse".
  - set-author works both ways, Old Muse → Muse included.
  - A pinned note follows its new versions.
  - `turn --brain Muse` works.
- **A maker:** a fresh take on the Character Creator's sheet made no brain. Neither did the note.
- **An image brain:** the image request's prompt is the tool call's text (mock), with no note in it. The version keeps the note in `thought`, for display only.
- **A follower:** `generation.follow` receives `following, muse_note, start, done`.
- **Encrypted user:** two unique words from a saved note and a broken one appear nowhere in the user's folder or the run dir. `--reveal` shows both.
- **The server log** has no note text.
- **Clone and campaign files:** clone, clone `--without-messages`, and import of a `conversation.get --json`, with and without messages. The Muse and Old Muse come along, note authors are re-pointed, and the Co-GM's pin of a note is re-pointed (and dropped without messages).
- **Browser smoke (mock):**
  - The Fresh take tab pre-fills "An idea for Game Master's next reply, which the player won't see:".
  - Sending it puts the Muse's note in its place, folded ("Hidden · 3 lines"), with the reply marked "fresh take".
  - A Muse chip joins the composer, everything survives a reload, and there are no console errors.
  - The tab still shows T15's wording ("this goes in as its own words … The new version is this, then the reply"), which the engineer already flagged for the Frontend pass.

## Findings

### QA-1 · minor · any message by a brain called Muse, right before the reply, is overwritten by the note

The rule "the message right before is already the Muse's note, so give it a new version" matches any text message by the brain called Muse. A brain called Muse that is something else, such as a poet in Jason's own campaign or one in an older file, loses its reply: the fresh take's idea becomes that message's active version. From then on every brain reads the note in its place, and the poem is gone from every request.

```
./ss conversation.create --title Poet --system-prompt "You help."
./ss brain.add --name Muse --system-prompt "You are a poet who writes four-line poems."
./ss turn --brain Muse --content "Write me a poem."
./ss turn --brain Assistant
./ss message.regenerate --thought "Critique the poem kindly."
./ss prompt.preview --json | jq -c '[.body.messages[]|[.role,.content[0:70]]]'
# → [system], [user "Write me a poem."], [user "<!-- from: Muse -->\nCritique the poem kindly."], [assistant …]
./ss message.get --message <the poem>   # "2 versions, version 2 active": v1 the poem (generated), v2 "Critique the poem kindly." (authored)
```

- **Expected:** a fresh take adds its own note and leaves other messages alone. It should version only a note that is itself a fresh take's or hand-written idea.
- **Actual:** the poem is replaced as the active version. The pager gets it back, but nothing says this happened: the preview note says "the Muse's note right before … gets this as version 2".
- **The same rule covers the Muse's own turns, by design.** Live, my fresh take on the GM's reply made the Muse's *generated* twist into v1 and my idea into v2. That one is defensible, since both are ideas for the same reply.
- **Cause:** `planMuseNote`, `src/conversations/turn.ts:212` (`ours = … prev.author.brainId === existing.id`).
- **Suggestion:** version only a note whose active version is `source: "authored"`, or mark the note a fresh take writes (for example, the message id it is for), and insert a new note otherwise.

### QA-2 · minor · the schema-7 template swap runs on every load, not once

`upgradeTemplates` runs on every load and on every campaign import, whatever the file's schema version. A conversation already at schema 7 whose thought template you deliberately set back to T15's wording gets the new default back on every read. The file keeps your text, but the app shows and uses the default. That breaks "every word is editable" in a narrow case.

```
./ss conversation.update --id c_… --templates.thought $'```hidden\n{{thought}}\n\nThat sounds good, I\'ll respond next.\n```' --json | jq .templates.thought   # your text
./ss conversation.get --id c_… --json | jq .templates.thought        # "An idea for {{brain}}'s next reply…"
jq .templates.thought <the file on disk>                              # still your text
```

- **Expected:** the swap only for files below schema 7.
- **Cause:**
  - `src/conversations/defaults.ts:98` calls `upgradeTemplates` without checking `conv.schemaVersion < 7`.
  - `src/commands/campaigns.ts:241` does the same for an import. A file that declares `schemaVersion >= 7` could be exempt.

### QA-3 · minor · "the Muse is an image brain" is a 409 `conflict`, which the browser reads as "a reply is being written"

`planMuseNote` refuses a fresh take when the brain called Muse is an image brain, with `409 conflict`. In the browser, `useChat.regenerate` (`web/src/features/chat/useChat.ts:677`) treats every `conflict` as a reply in progress. It shows BUSY_LEDGER ("A reply is being written from the messages as they are now…") and starts `generation.follow`, so the real reason ("Rename it …") never shows.

`saveMuseNote`'s three mid-flight 409s (`src/commands/chat.ts:353,356,361`) have the same code, but they are nearly unreachable.

```
./ss brain.add --name Muse --kind image --system-prompt paint
./ss turn --content hi
curl -s -H 'content-type: application/json' -H "cookie: ss_session=<token>" -d '{"conversation":"c_…","thought":"x"}' localhost:4777/api/message.regenerate
# {"error":{"code":"conflict","message":"A fresh take's note is written by the brain called Muse, and Muse here is an image brain. Rename it …"}}
```

- **Expected:** a code the browser shows as it stands (a 400 such as `bad_brain`).
- **Cause:** `src/conversations/turn.ts:198-202`.

### QA-4 · nit · renaming the Muse is silent, and the next fresh take stacks a second note

`brain.update --brain Muse --name "Old Muse"` says nothing about the brain no longer being the Muse. After the rename:
- Its notes are framed `<!-- from: Old Muse -->`, which no prompt explains. The Goat's GM would read that as "Anyone else: table talk".
- The next fresh take on a reply right after one of its notes adds a new Muse and a second note. The brain then reads two "An idea for X's next reply" notes in a row, possibly conflicting:

```
… Old Muse: "Pretend to be deaf." · Muse: "Second idea." · Character 1 (fresh take)
```

The engineer chose this on purpose, so it's a nit. A one-line warning on the rename (CLI and Settings), or a fresh take that recognises a renamed Muse's note right before, would make it visible.

### QA-5 · nit · wording that assumes the note is hidden, plus two stale phrases

- `freshTakeNote` (`wording.ts:122`) says "the player sees it folded", and the CLI's stream line (`src/cli/main.ts:367`) says "--reveal shows it". A `--thought` sent without `--wrap` is a plain, unfolded note, and the player sees it in full.
- The thought template's `templateProblem` (`prompt.ts:51`) still says "your thought would be left out of the request". It is the Muse's note now.
- `message.get` labels a **T15** image version's thought "(the fresh take's note it answered, as sent …)". In T15 it was the brain's own planted thought, not a note it answered.

### QA-6 · nit · the Muse brain's own settings reach fresh takes

- **Makes:** a Muse with `--makes` makes a brain from every fresh-take note (`muse_note`, `brain_made`, `start` → "Idea 1"). The preview's notes don't say so: T16's `makesNote` covers only the answering brain (`turn.ts:58`).
- **Pins:** if the note right before is pinned to the brain answering, it is sent at the top as a pin, not right before the turn. The body then ended on the player's "hi", while the preview note still says "right before". This needs a deliberate pin, so it's a nit.

## Observations (live, not plumbing bugs)

- **Pre-T17 prompts:** Jason's existing campaigns keep the prompts they were made with, without the Muse line. I ran two old files through the app.
  - The old Goat GM, whose list says "Anyone else: table talk", carried the idea out 1 in 1.
  - The old preset GM gave **one empty reply in three**: 1 output token, cut by the `<!-- from:` stop sequence, with reasoning off. The app reported it correctly ("no reply text … regenerate it"). The other two runs were clean.
  - With the current prompts, every run I made was clean (GM ×3, Co-GM, Assistant).
  - This may be T07's self-framing at random rather than the note. If it recurs, `brain.update --system-prompt` with the new preset text adds the Muse line.
- **The Muse's own turn.** `turn --brain Muse` wrote a well-formed ```` ```hidden ```` note. It started "An idea for Game Master's next reply…", copying the earlier note rather than its prompt's "for the next reply". The GM's next turn carried it out with no word about the Muse.
  - The idea resolved the peek the odds had just asked a d20 for ("Wren's peek fails before it starts"), and the GM followed it and skipped the roll.
  - The Muse's prompt says "leaving the player's choices to the player" but nothing about outcomes waiting on a roll. That is prompt tuning for triage, from one sample.
- **Reasoning on (GM, low), a fresh take on the reply that followed the Muse's own note:** it came back as a clean reply and wasn't cut by the stop sequence. It carried out half the idea ("goes very still"), then ended on "That's a roll", as its reminder asks for an uncertain action that has no roll yet.
- **Leak checks with the goblin note in the ledger:**
  - Co-GM, asked "Who is really under that cloak?": "it reads as one person … the shoulders sit oddly low and wide". No goblins.
  - Odds, on "I try to get a look under the hood": a d20 target. No goblins.
  - Scene Painter (probe, no image): "The cloak hangs low and broad at the shoulders". No goblins, and no footprints either.
