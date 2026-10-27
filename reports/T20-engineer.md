# T20 engineer: compaction and a token counter

**No live calls this pass.** `./sst venice.balance` said **$1.58** at the start, under the $4 floor in AGENTS.md, so I made none. The mechanism, the commands and the token counter are proven on the mock. The preset's Chronicler, and the lines the other brains gained about it, are written by craft and **not tuned live**. The ticket's live acceptance bullet is still open: a few dozen messages with two made characters, the Chronicler's block, then the GM, a made character and the Creator after it, with the Creator not re-sheeting anyone. It needs about 10 to 25 DeepSeek calls once the balance is topped up (see "For whoever probes it live").

## What I built

**The setting.** `Brain.compacts` means "Its messages are compactions". It is set with `brain.add` / `brain.update --compacts` and cleared with `--no-compacts`, and it is stored only when on. Only text brains take it: an image brain is refused, so is a kind change to image, and so is a campaign file that tries it. There is no schema bump, because absent means off, as in every older file. Turning it on for a brain that already has messages makes all of them compactions at once, and turning it off makes them ordinary again. Nothing is lost either way.

**The rule (the cut).** Every brain's request takes the ledger from the newest compaction on, that message included.
- The rule is `compactionCut` in `src/conversations/compaction.ts`, which is dependency-free so the browser can find the cut the same way. It is step 2c of `assembleRequest`.
- System prompt, setup and pins are untouched. A message pinned to a brain still reaches it at step 2b, even when it sits before the cut. That gives Jason's order for a made character with no special case: system prompt, World Bible and setup, **its sheet**, the compaction, the turns since, its reminder.
- Earlier messages are never removed, only left out of requests. **Deleting the compaction brings them back.**
- `assembleRequest` now returns `cut` and `count` beside `body` and `pinned`, so the preview and the send share one builder, as before.
- The one special case: a **steered** regenerate of a compaction cuts at the compaction *before* it. A steer that could see only its own summary couldn't add what it left out.

**Compacting.** `message.compact --conversation [--message m_…] [--brain]` (stream) and its twin `prompt.preview --compact [--message] [--brain]` share one planner, `planCompact` in `turn.ts`.
- The compaction brain answers the ledger up to and including the message, from its own point of view. That view is cut at the previous compaction, so a second compaction summarizes the first plus what came after it.
- Its reply goes in **right after that message** (`insertMessage`), and the messages after it stay verbatim below.
- `--message` defaults to the last message. That is the plain case, and its body equals `turn --brain Chronicler` (tested).
- `--brain` defaults to the only compaction brain. With none, the error names the `brain.import` that adds the preset's; with several, it asks which.
- It is a generation like `turn`: a 409 while one runs, ledger edits refused while it runs, `generation.follow` replays it, and a failure carries the retry (`RetryRequest` `message.compact`).

**The count.** A `{{count}}` in **any** brain's final reminder is sent as the number of messages from the start through the last one the request holds, compactions not counted (`messageCount`). A first compaction through message 42 reads 42; a second one, 20 messages later, reads 62. It is rendered on every build, so it shows in the body, and the payload view says what it was sent as (`countNote`). A reminder without it is sent exactly as before.

**The token counter.**
- `prompt.size --conversation` shows, per brain:
  - **its last real count**: Venice's prompt tokens for its newest reply, cached tokens included, how many messages ago that was, and "before the newest compaction" when a cut came after it;
  - **an estimate of its request now**: the body `planTurn` would send with no new message;
  - its model's context length.
- Every `prompt.preview` carries the same `size` for its own request, and its text says it is an estimate. The estimate is characters / 4.4 + 4 per message (`estimateSize`). The ratio comes from T18's live measurement on DeepSeek: the preset GM's ~5,200-character body counted 1,185 tokens. There is no new data: it is all computed from what is stored.
- The mock now reports `cached_tokens`: the messages a request shares, from the start, with the previous one for the same model. That gives the counter something to show on the mock.

**The payload view's notes:**
- `cutNote`: where the request starts, how many messages are left out, and how many of those are pinned to this brain and so still sent.
- `countNote`: what a reminder's `{{count}}` was sent as.
- `compactsNote`: a turn to a compaction brain moves the cut.
- `compactNote`: for `--compact`, where the reply goes and how many messages stay verbatim after it.

**Elsewhere:**
- `conversation.get`'s text marks the cut, the compaction and each message above it ("compacted: left out of requests").
- `brain.list` says "compacts".
- `message.delete` and `message.set-author` answer `cutMoved {from, to}` when they move where requests start, and say so in words.
- Campaign files take `compacts`, so it round-trips through `conversation.get --json` → `conversation.import`.
- `brain.import` brings it and says what it does.
- `presets.list` / `examples.list` mark a compaction brain.

**The preset** (`presets/tabletop-rpg.json`, now seven brains).
- **Chronicler** (`compacts: true`, reasoning off, the default stop sequence). Its prompt is Jason's brief:
  - one hidden block and nothing else, its lines spelled out (as T17 triage learned);
  - the second line is **The story so far, N messages:**, where N comes from its reminder's `{{count}}`;
  - **Characters**: the player's character first. For each person: what the player knows them as; whether they have a sheet and so a helper, by its name; their **Looks** line word for word; what the player has seen; what is hidden from the player, the sheets' secrets word for word where it matters; their story so far.
  - **Plot**, with the rolls; **Changes**; **Open threads**, with pending rolls and their odds; **Details**, with exact wordings and each painter's **style line** word for word; **Where we are**.
  - An earlier summary is the story up to there and is carried whole. A Muse's idea isn't an event.
- Every brain's "At this table" paragraph (the made characters' blueprint's too) gains one sentence: when the story gets long the Chronicler sums it up in one hidden note that then stands in for everything before it, so take it as what happened, and the sheets, looks and style lines it quotes as the originals.
- **Character Creator**: its "Sheets already written" line, its prompt and its reminder now also list everyone the Chronicler's summary says has a sheet. This is the Creator-after-the-cut risk.
- **Painters**: reuse a style line from the summary too.
- **Co-GM**: the summary's "seen by the player" counts as shown; what it marks hidden stays out of answers.
- **GM**: lists the Chronicler among the helpers.

## Calls I made (edge cases)

1. **A compaction above the newest one is refused** (`above_compaction`). It would be cut out of every request at once. A compaction that ends up there anyway (by `set-author`, or in a file) is just a message before the cut: the newest compaction by place wins.
2. **A re-roll at any depth.** Compacting the message right before your own newest compaction gives that compaction a new version, with the same request as its first. This is the only way to re-roll a compaction that isn't the last message, because `message.regenerate` works on the last message only. Steer and fresh take still need it to be last.
3. **A message that is a compaction can't be compacted through** (`nothing_to_compact`).
4. **A stopped compaction is saved and cuts**, like any stopped reply. Nothing is lost, and its `done` note says to compact through the same message again (a new version) or delete it. Not saving it would make compaction the one generation whose stop keeps nothing.
5. **A brain that both makes and compacts** makes a brain from each new compaction. The two settings compose and nothing special happens. **`set-author`** to a compaction brain makes the message a compaction, and away from one makes it ordinary.
6. **No per-message "keep through compaction" flag.** Pins already keep each sheet in front of its own character. The Creator's list of who has a sheet now comes from the summary's Characters section, which the Chronicler's prompt asks for by helper name. If the live probe shows the Creator re-sheeting after a cut, that flag is the generic fix: a message sent at its place even when it is before the cut.
7. **The example campaign gets no Chronicler.** It is a short, ready-to-play opener, and `brain.import --preset tabletop-rpg --brain Chronicler` adds one to it, or to any conversation.
8. **The Chronicler's color is `#fde047`**, late in the palette, so the made characters keep the colors they had (Character 1 is still green).

## Commands added or changed

- New: `message.compact` (stream) and `prompt.size`.
- `prompt.preview`: `--compact` (with `--message` and `--brain`). Every preview → adds `size`, plus `cut?`, and `compact?` for `--compact`.
- `brain.add` / `brain.update`: `--compacts` / `--no-compacts`.
- `message.delete` / `message.set-author` → add `cutMoved`.
- `turn` / `message.compact`'s `start` → adds `compact: {through}`. The CLI's header reads `[Chronicler · compacting through m_…]`.
- Campaign files: brains take `compacts`. `presets.list` / `examples.list` brains carry `compacts: true`.
- `web/src/api/types.ts` (types and re-exports only):
  - the new commands, `Preview.size` / `cut` / `compact`, and `start.compact`;
  - re-exports of `compactionCut`, `isCompaction`, `isCompactor`, `messageCount`, `estimateSize`, `lastCount`, `LastCount`, `PromptSizes`;
  - re-exports of the T20 wording (`cutNote`, `countNote`, `compactNote`, `compactsNote`, `ESTIMATE_NOTE`).

## Transcript (mock, trimmed)

This ran on a scratch server on :4957 with a mock on :4958, its own data and run dirs, user `dev-t20-mock`, and the Tabletop RPG preset. A 22-message harbor ledger was built for free with `message.add`: two sheets in the Creator's mouth made Character 1 (the barkeep) and Character 2 (the hooded figure).

```
$ ./sst prompt.size
Prompt sizes in "Harbor" (c_dr22kj37fe): 22 messages, no compaction yet.
BRAIN                  LAST REAL COUNT (VENICE: PROMPT TOKENS)  NOW (ESTIMATE)
Game Master            no reply counted yet                     ~2,632 of 1,000,000
…
Chronicler             no reply counted yet                     ~2,557 of 1,000,000
Character 2            no reply counted yet                     ~2,402 of 1,000,000
NOW: the request each brain would be sent for a turn with no new message. An estimate: about 4.4 characters a token (measured on DeepSeek, English) plus 4 a message. Venice's own count comes with each reply.

$ ./sst turn --content "I follow the lanterns along the quay, keeping to the shadows."   # then a second turn
[Game Master · 2857 in / 35 out · $0.0009]
$ ./sst prompt.size | sed -n 4p
Game Master            2,857 in (2,711 cached) · m_53dln0vua9, the newest message  ~2,744 of 1,000,000

$ ./sst prompt.preview --compact --message <m12>      # a middle message
Note: A compaction through m_7gqcer8xze: Chronicler answers the ledger up to and including it, and its reply goes in right after it. From then on every brain's request starts at the compaction; the 14 messages after m_7gqcer8xze stay as they are, below it. Nothing is deleted: …
Note: The final reminder's {{count}} is sent as 12: the messages from the start of the conversation through the last one this request holds, compactions not counted. …
Size: about 2,215 prompt tokens of the model's 1,000,000 (9,478 characters). An estimate: … Chronicler has no reply Venice counted yet.
15 messages: …   [24] user: "You are the Chronicler. The story so far is 12 messages long. … its second **The story so far, 12 messages:** …"

$ ./sst message.compact --message <m12>
[Chronicler · compacting through m_7gqcer8xze · in "Harbor"]
[Chronicler · compaction through m_7gqcer8xze · 2371 in / 35 out · $0.00075]

$ ./sst conversation.get | grep "^──\|^Compacted"
Compacted at m_gcxhqq0hyy: every request starts there, and the 12 messages above it are left out (kept here; delete the compaction to bring them back).
── Game Master · m_1hxxi347dx · compacted: left out of requests · written by you ──
…
── Character Creator · m_83lpt5brey · compacted: left out of requests · written by you ──   (the hooded figure's sheet)
…
── you · m_7gqcer8xze · compacted: left out of requests ──
── Chronicler · m_gcxhqq0hyy · compaction: every request starts here · $0.00075 ──
── Game Master · m_p0xhbdrgzu · written by you ──      (the 14 later messages, verbatim)
…

$ ./sst prompt.preview --brain "Character 2" --content "Will you keep your word?" --json | jq …
{"messageId":"m_gcxhqq0hyy","before":12}                    # cut
[{"index":2,"messageId":"m_83lpt5brey","as":"ledger"}]      # her sheet, from before the cut, still pinned
["system","You play one character …"]
["user","<!-- This is the World Bible. -->"]
["user","<!-- from: Character Creator -->"]                  # her sheet
["user","<!-- from: Chronicler -->"]                         # the compaction
["user","<!-- from: Game Master -->"] … ["assistant","**The hooded figure:** \"Dawn, then. …"] … ["user","<!-- from: the user -->"]
["user","<!-- System reminder -->"]

$ ./sst prompt.preview --compact --json | jq .body > preview.json    # a second compaction, through the last message
[["system","You keep the record …"],["user","<!-- This is the World Bible. -->"],["assistant","MOCK reply to brain …"],["user","<!-- from: Game Master -->"]]   # starts at the first, as its own words
… "The story so far is 26 messages long." …                         # 22 + 4 turns; the first compaction not counted
$ ./sst message.compact
[Chronicler · compaction through m_53dln0vua9 · 1776 in / 35 out · $0.00057]
$ cmp preview.json sent.json      # sent.json: the newest /chat/completions body from the mock's /_mock/requests
identical

$ ./sst message.delete --message <the second compaction>
Deleted m_e28m93j15r. 27 messages left.
Every brain's request now starts at the compaction m_gcxhqq0hyy (it started at m_e28m93j15r).
$ ./sst message.delete --message <the first compaction>
Deleted m_gcxhqq0hyy. 26 messages left.
No compaction is left, so every brain's request holds the whole ledger again.

$ ./sst message.compact            # (a MOCK_SLOW reminder, then generation.stop from another shell)
Stopped. What had arrived is saved: m_hy91e52drz, version 1/1.
[Chronicler · compaction through m_q6ey3dsmz5 · stopped: what had arrived is saved …]

$ ./sst brain.update --brain "Co-GM" --compacts     # it has a message: that message is a compaction now
$ ./sst prompt.preview --json | jq .cut
{"messageId":"m_lbac3mq9ry","before":18}
$ ./sst brain.update --brain "Co-GM" --no-compacts && ./sst prompt.preview --json | jq .cut
null
$ ./sst brain.update --brain "Scene Painter" --compacts
error: Scene Painter is an image brain, and only a text brain writes compactions (its messages are image prompts).
$ ./sst message.compact --brain "Game Master"
error: Game Master's messages aren't compactions. Give it the setting first (brain.update --brain "Game Master" --compacts), or pick a brain that has it.
```

`test/compaction.test.ts` (11 tests) covers:
- the cut, with a pin from before it reaching its brain, and delete undoing it;
- `{{count}}` for a first and a second compaction;
- re-roll, steer and fresh take of a compaction;
- an image brain never compacting;
- every `planCompact` path and refusal, and the last-message compaction equalling a turn's body;
- the estimate and `lastCount`;
- end to end on the mock: preview == send for a compaction and for a turn after one; a made character's view in Jason's order; a middle compaction leaving the later messages verbatim; a re-version; a second compaction starting at the first; `set-author` moving the cut; `prompt.size` with cached tokens and `beforeCut`; `--compacts` refusals; the campaign round trip and the refused image brain; clone `--through` before the cut; `brain.import`; a 409 while a turn runs; a broken compaction saving nothing, with its retry wording.

A mutation check: no cut, pins only after the cut, and a steer cutting at its own message each fail tests. `presets.test.ts` now pins the seventh brain, its `{{count}}`, and that every brain (the blueprint too) knows the Chronicler. `npm test`: 251/251. `npm run typecheck`: clean.

## Live spend

None. The balance was $1.58 before and after (no calls; see below).

## For whoever probes it live (about 10 to 25 DeepSeek calls)

Build a ledger like the 22-message harbor one above with `message.add` (free: sheets in the Creator's mouth make the characters' brains), then:
1. `prompt.preview --compact --json | jq .body` and POST it once with `stream: false`. Check one closed ```` ```hidden ```` block, the count line, all the sections, both Looks lines word for word, the secrets (the Marigold, the potboy sent to the watch), the open thread (dawn at the lighthouse steps) and the names the player knows.
2. `message.add --as Chronicler --content @answer.md`, after the last message, puts that answer in place for free.
3. Probe the GM, Character 2 and the Creator (no note) with `stream: false`. The Creator must not re-sheet the barkeep or the hooded figure; its first line should list both from the summary. Run a control with a newcomer in the scene.

If the Creator re-sheets, try prompt craft first. Then consider the "keep through compaction" flag (call 6 above).

## Known gaps

- **Not tuned live** (above): the Chronicler's output, and every brain's behavior after a cut, are unmeasured.
- **The estimate is a fixed ratio.** It is not calibrated per model or per brain. Every place that shows it says it is an estimate, and the last real count sits beside it.
- **Steer and fresh take of a compaction need it to be the last message**, as for any reply. Only the plain re-roll works at any depth (call 2).
- **The browser UI** is the Frontend pass: Compact in the footer, the folded band above the cut, and the counter.

## design.md changes

- New section **"Compaction (T20)"**: the rule, the command, the edge cases above, the count and the token counter.
- Vocabulary: **Compaction**.
- `Brain.compacts` in the document type.
- A paragraph on `{{count}}` in final reminders.
- Prompt assembly: **step 2c (the cut)**, step 3 "from the cut on", step 4's `{{count}}`.
- `prompt.preview`'s new fields and notes.
- The preset table: a Chronicler row, and the "At this table" sentence.
- Command surface: an "Implemented in T20" block.
- Mock Venice: the cache stand-in.

README: the preset's seventh brain, a "Compaction and a token counter" bullet, and a **Compact a long campaign** paragraph with the commands. AGENTS.md: the command list, "seven brains", and a T20 lesson.
