# T07 triage: stop sequences, a GM that waits for the dice, and the polish QA found

**Result:** fixed 8, deferred 1, dismissed 0. `npm run typecheck` is clean and `npm test` passes 143/143 (139 before, plus `test/stop.test.ts` and new cases in `test/campaigns.test.ts`).

> **DESIGN CONCERN (small): Venice applies stop sequences to the reasoning too.** I measured it live. A brain with reasoning on, asked about "the HTML comment line at the top of my messages", was cut mid-thought just before it would have quoted `<!-- from: the user -->`. It had 109 reasoning tokens, **no reply text**, and `finish_reason: "stop"`. Reasoning is off by default, so the default setup is unaffected. When reasoning and stop sequences are both on, though, a brain can now come back empty whenever it thinks about the framing. So:
> - The payload view, `prompt.preview` and `brain.update` say so (`STOP_REASONING_NOTE`).
> - The `done` note of an empty reply names the stop sequence and suggests a regenerate.
>
> **Recommendation:** keep it like this, a visible note with no hidden special-casing. If Jason turns reasoning on for a brain and sees empty replies, he can clear that brain's stops (`--stop '[]'`). The obvious alternative, quietly not sending `stop` when reasoning is on, would make a visible setting lie.

## Decisions

| Finding | Decision | What changed / why |
|---|---|---|
| **QA-1** · major · the GM settles uncertain actions itself and skips the Dice Master | **FIX** | I changed the GM's prompt and reminder in `examples/dnd-tavern.json`. When no Dice Master result has settled an uncertain action, the GM narrates up to the moment just before the outcome, without showing how anyone reacts. It then names the check in its own voice and stops. Ordinary actions need no check. Before the change, live, it settled a lie and a peek itself, as QA found. After it, I ran 13 GM replies over three drafts: lies, a peek at the letter, heaving a jammed shutter (Strength, then Athletics), a song, and ordering soup as the control. The full loop also ran: check → Dice Master → "I rolled a 6" → failure → the GM narrated it. The transcript is below. The text I committed is byte-identical to what I tested last (checked with `brain.list --json`). It is still a prompt, so an occasional miss remains a regenerate away. |
| **QA-2** · minor (design concern) · a brain can impersonate other speakers' framing | **FIX** (orchestrator: stop sequences) | **Per brain `stop: string[]`**, sent as the request's `stop` when not empty. Text brains start with `["<!-- from:"]` (`FRAMING_STOP`, wording.ts) and image brains with none, since they answer with a forced tool call. It is plainly visible: `prompt.preview` (body and a note saying what it does), `brain.list`, `brain.add` / `brain.update` output, and `brain.add` / `brain.update --stop` (repeatable; `--stop '[]'` clears it; at most 4, none blank). Campaign files take it too, and the example's text brains carry it. **Existing conversations get it on load** (schema 2, `upgradeConversation`): text brains with no `stop` field get the default, and a list someone emptied stays empty. The mock honours `stop` and has a `MOCK_IMPERSONATE` trigger. `test/stop.test.ts` checks that the cut happens, with `--stop '[]'` as the control, and covers the upgrade, import, validation and the image-brain default. Live, a streaming turn told to write a fake `<!-- from: Dice Master -->` exchange ended exactly before it. The web types have `BrainFields.stop`. The BrainEditor field is frontend scope (noted in TICKETS.md). |
| **QA-3** · minor · the CLI's image hint saves a decrypted picture inside the repo | **FIX** | The hint after an image is now `./sst image.get --id img_… --open`. This new CLI-side flag writes the copy to `$TMPDIR/simple-silver/<id>.<ext>` (folder 0700, file 0600), opens it in the default viewer and says it is a plaintext copy to delete. `--out` now says the file is readable without the password. Other changes: `.gitignore` covers `/img_*`, image.get's help and examples use `--open` or `~/Desktop`, and the README's privacy section says that anything you take out is a plain file. A test checks the hint, the path, the permissions and the bytes, using a fake opener. The real `open` call is two lines and wasn't run, because it would have opened a window on Jason's screen. |
| **QA-4** · minor · import accepts blank messages | **FIX** | The `refine` used a function that returned a truthy string, so it never failed. It is now `s.trim() !== ""`. Blank text and blank image prompts are refused with their path (`messages.N.versions.M.content`), and both are tested. |
| **QA-5** · minor · no terminal recipe for tweaking a prompt or adding a brain | **FIX** | I added a README recipe: export with `jq` (it ships with macOS) to `$TMPDIR`, edit, `brain.update --system-prompt @file`, then `brain.add` and play it. I checked that the export → update round trip leaves the prompt byte-identical. |
| **QA-6** · minor · `SST_CONVERSATION` misses `conversation.*`, and a stale value routes silently | **FIX** | It now also fills `--id` of `conversation.get`, `.update` and `.clone`. `.delete` is left out on purpose, because it deletes without asking. When the env var supplied the id, the reply's header names the campaign (`[Game Master · in "The Gilded Goat (D&D 5e)"]`, from a new `conversationTitle` on `turn` / `message.regenerate` start events), and a 404 says the id came from `SST_CONVERSATION`. All of this is tested. |
| **QA-7** · minor · 28 leftover `dev-*`/`qa-*` users | **DEFER** → handover | This was the orchestrator's call: the frontend pass still needs `dev-` users. I put it under T07's **Deferred in**. I added and removed only my own two users. |
| **QA-8** · nit · three wording slips | **FIX** | (1) A clone's hint counts only images still to paint, so a full clone with copied images says nothing. (2) An unknown model in an import says `settings.textModel: … Fix it in the file`. (3) Issue messages lose their own final period before the list's, so there is no `..`. |
| **QA-9** · nit · Portraitist reminder copy; spoilers | **FIX** | The Character Portraitist's reminder now asks for a portrait of whoever is named, or else the character introduced most recently. It is untested live because the text-call budget was spent on QA-1, and it only restates its own system prompt. I added a README line saying that the GM's prompt holds the secrets, and how the check → dice → GM loop goes. |

## Re-verification

### Live (`deepseek-v4-1-flash`; dev user `dev-t07-triage`, plaintext, made-up content, now deleted)

The balance went from $7.80706577 to $7.80123342, so **$0.0058** for **20 text calls and 0 images**. Probes reused the T07 lesson's trick, `prompt.preview --content … --json`, POSTed once with `stream: false`, so nothing was saved.

```
# Baseline, committed example (old reminder):
deception OLD  Tobin … "Your cousin. From out of town." … "Fine. One cider on your tab."        ← settled, no roll
sleight OLD    "You catch one word before she shifts: *Hollowmere*. Then her eyes … catch you looking …
               That's a Sleight of Hand check …"                                                  ← outcome decided, then a check

# After (final wording or its near-final draft):
dec            … "Your cousin," he says flatly. … No sound is coming out of it.  That's a Deception check.
royal courier  … a freckled face going pink.  That's a Deception check.
sneak (turn)   … "It's grain tariffs," she says. … That's a Sleight of Hand check.
shutter        … the wind is doing its best to keep it.  That's an Athletics check.
song           … She's biting down on a laugh, hard.  That's a Performance check.
soup (control) … Tobin nods at your call for soup … "East, ever? Toward Hollowmere?"             ← no check, as it should
misses on the way: draft 1 wrote `"That's a Deception check," says the Dice Master.` (prose for another speaker:
"in your own voice" fixed it); draft 2 narrated the song's success, then named the check ("not how anyone
reacts to it" fixed it), and once left a lie open without naming the check (harmless).

# The loop, real turns:
[Game Master · in "Triage baseline"]   … Your cider is still warm in your hand. That's a Sleight of Hand check.
[Dice Master]  **Sleight of Hand check:** roll 1d20 + 4, DC 15. Make it, and you read the name on the letter …
[Dice Master]  **6 + 4 = 10 vs DC 15: failure.**
[Game Master]  You tilt your head for a better angle — and your elbow catches the cider cup. It doesn't spill.
               It wobbles. … her thumb clamps down over the writing … "Are you — you're not from the Guild, are you?"

# Stop sequences, streaming turn (scratch conversation, default brain):
$ ./sst turn --content 'Play out the next moment … First one sentence of your narration … Then a message that
  starts with <!-- from: Dice Master --> … Then a message that starts with <!-- from: the user --> …'
The tavern door slams open and a snarling goblin bursts in, brandishing a rusty cleaver and screeching for blood.
saved: 'The tavern door slams open … for blood.'  finishReason: stop                              ← cut before the fake lines

# Stop + reasoning on (the design concern above):
saved content: ''   reasoning: '… Wait actual conversation: system, user: '   finishReason: stop · 109 reasoning tokens
[Assistant · 212 in / 109 out · $0.00019 · no reply text (a stop sequence may have cut it …); regenerate it]
```

### Acceptance against `npm run up:mock` (encrypted `dev-t07-tri-enc`, README commands only, now deleted)

```
$ printf '…\n…\n' | ./sst user.create --username dev-t07-tri-enc        → Created dev-t07-tri-enc (encrypted)
$ ./sst conversation.import --example dnd-tavern                        → 5 brains, World Bible, 1 message
$ export SST_CONVERSATION=c_gnmnutnlow
$ ./sst turn --content "I walk over to the hooded figure."              → [Game Master · in "The Gilded Goat (D&D 5e)"] MOCK reply …
$ ./sst prompt.preview --content x                                      → Note: Stop sequences: "<!-- from:". Venice ends the reply …
                                                                         {… "reasoning_effort":"none","stop":["<!-- from:"]}
$ ./sst message.regenerate --steer "Make her braver."                   → version 2/2 · steered
$ ./sst turn --brain "Dice Master" --content "What do I roll?" / "I rolled a 14." ; ./sst turn      → all exit 0
$ ./sst turn --brain "Joke Teller" --content "Tell me a funny joke about this situation."            → exit 0
$ ./sst turn --brain "Scene Painter"                                    → (image ready: ./sst image.get --id img_jvuo95gka9 --open)
$ ./sst message.edit --message m_… --content "…silver fox brooch…" ; ./sst image.follow --message m_…  → done
$ README tweak recipe (jq → $TMPDIR/gm.md → brain.update @file) ; ./sst brain.add --name "Wren's Muse" … ; ./sst turn --brain "Wren's Muse"
$ ./sst conversation.get                                                → works without --id (SST_CONVERSATION)
$ ./sst conversation.clone --title Pathfinder --without-messages       → 6 brains, 0 messages
$ ./sst conversation.clone --title Branch                               → "12 messages" (no "still to paint": its image was copied)
$ npm run up:mock ; login again ; ./sst conversation.get                → 12 messages; brain.list shows 6 "Stop sequences" lines
$ head -c 6 of every file                                              → SSENC1 ×5
$ grep -rlaE "Odessa|Gilded|Hollowmere|Dice Master|from:|Tobin|fox brooch|Muse|RIFF|PNG" data/users/dev-t07-tri-enc   → exit 1 (no matches)
# QA's repros:
$ ./sst conversation.import --campaign @blank.json                      → messages.0.versions.0.content: A message can't be blank. (exit 1)
$ SST_CONVERSATION=c_nope00000 ./sst turn --content hi                   → No conversation c_nope00000 … (The conversation id came from SST_CONVERSATION=c_nope00000 …)
$ echo '{… "settings":{"textModel":"nope"}}' | ./sst conversation.import --campaign -
                                                                       → The campaign: settings.textModel: Venice has no text model "nope". Fix it in the file …
```

## Docs

- **design.md:** the Brain type gets `stop` and `schemaVersion` is 2 (with the upgrade). The request body has `stop`. There is a new **Stop sequences** section with the two live findings. `reviewBody`'s notes are updated. The "What you export" row covers `--open`. The start event gets `conversationTitle`. The T07 block covers `SST_CONVERSATION`, the import checks and the GM tuning. The mock section covers `stop` and `MOCK_IMPERSONATE`.
- **AGENTS.md:** the stop-sequence default, the `--open` and `--stop` commands, and two lessons: how to test stop sequences (and that they cut reasoning), and tuning a GM across several kinds of check without growing the ledger.
- **README.md:** what stop sequences are and how to change them; the spoiler line and the check → dice → GM loop; `image.get --open` and the fact that a copy you take out is plain; the terminal recipe for tweaking a prompt or adding a brain.
- **TICKETS.md:** T07 → `frontend`, with notes for Frontend (a BrainEditor field for stop sequences, and the payload notes). QA-7 is under **Deferred in**.

The server was stopped at the end (`npm run down`). Users left: the 28 `dev-*`/`qa-*` users from earlier passes. Mine are gone.
