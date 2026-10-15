# T17 triage: fresh take as a note from the Muse

**Fixed 5, deferred 0, dismissed 1.** The QA findings were all small, and the most important change came from QA's live notes: **the Muse's own turn**. Its idea settled a roll that was still waiting, and on a quiet moment it could write its note with no ```` ```hidden ```` fence, so the player would have read it. A new Muse's prompt and reminder are now tuned live. No DESIGN CONCERN.

## Findings

| Finding | Decision | What changed / why |
|---|---|---|
| **QA-1** (minor): a fresh take re-versions any message by the brain called Muse right before the reply (a poet called Muse lost its poem) | **Fix** | `planMuseNote` (turn.ts) re-versions the note right before only when the Muse's active version there is `source: "authored"`, meaning an earlier fresh take's note or one you added by hand. Anything the Muse *generated* stays: its own twist, or a poem from a brain that only happens to be called Muse. The new note goes in after it, so the brain reads both, and the preview shows that. Regression test in `test/fresh-take.test.ts`; it fails with the old rule. |
| **QA-2** (minor): the schema-7 template swap ran on every load and import | **Fix** | `upgradeConversation` swaps T15's template only when the file is below schema 7. `conversation.import` does it only when the campaign file doesn't say `schemaVersion >= 7`. The campaign schema now reads `schemaVersion`; it isn't stored, and the import writes the current one. A test sets T15's wording on a schema-7 conversation and checks that it survives a read and an export → import. It fails without the gate. |
| **QA-3** (minor): "Muse is an image brain" was a 409 `conflict`, which the browser reads as "a reply is being written" | **Fix** | Now a 400 `bad_brain` (an existing code). `saveMuseNote`'s three mid-flight refusals changed too: "became an image brain" is `bad_brain` with the same rename advice, and the two "was deleted" ones are `not_found`. None of them says `conflict` any more. Tests check the status and the code. |
| **QA-4** (nit): renaming the Muse is silent, and the next fresh take stacks a second note | **Dismiss** (by design) | Identity by name is the engineer's deliberate call, and QA agrees it hurts no later ticket. `brain.update`'s help now says that a renamed Muse is just another brain, keeps its notes, and that the next fresh take adds a new one. The one-line warning at rename time belongs in the browser's Settings, which knows the old name: it's in the ticket's **For Frontend** note. |
| **QA-5** (nit): wording that assumes the note is hidden, plus stale phrases | **Fix** | `freshTakeNote` now says how the player sees the note: folded, with its hidden part folded, or as written (no ```` ```hidden ```` block). The CLI's `muse_note` line prints a note that isn't all hidden (folded where it is hidden) instead of "--reveal shows it". `message.get`'s label is "(the fresh take's thought, as sent; display only:)", which is true for T15 versions too. One sub-point was left as it is: `templateProblem`'s "your thought would be left out of the request" is still accurate. With no `{{thought}}`, your words aren't sent. |
| **QA-6** (nit): the Muse's own settings reach fresh takes (makes, pins) | **Fix** (makes) / dismiss (pins) | A Muse with `makes` makes a brain from each new note, as it would from any of its messages. The preview now says so (`museMakesNote`: "…so this note will make one too: Idea 1…"), with a test. Pins: a note pinned to the answering brain goes to the top, as any pin does, and `pinnedNote` already says where. It takes a deliberate pin, and the body still ends on a `user` message. |

## QA's live observations

**1. The Muse's own turn settled an uncertain action: tuned.**

I probed the scene with T07's preview plus a `stream: false` POST, saving nothing. I built the scene for free with `message.add`: the preset, the Goat's World Bible and opener, "I walk up to the hooded figure", a GM line, "…try to get a look under the hood without them noticing", the GM's *(That's a roll.)*, and the odds' "Roll a d20: 12 or higher succeeds".

| Muse prompt | Roll pending (odds named, no 🎲) | Control (no roll pending) |
|---|---|---|
| T17 engineer's | 2/2 leaned on the outcome: "**Success, mostly**: Wren catches a sliver of a woman's pale face…", and "Let the look mostly fail…" before a branch per result. QA saw the GM follow such an idea and skip the roll. | not probed |
| + a dice sentence ("How an uncertain action turns out is the dice's to say… your idea never says or hints whether it works. Give each outcome its own twist instead…, or work on something else") | 3/3 left it to the die: two gave a twist per outcome, one worked around it ("Whether Wren caught a glimpse… stays with the roll") | **no fence at all**: the answer began "An idea for the next reply…" and the player would read it all |
| + a Muse reminder saying "one ```hidden block" | not probed | **no fence again** |
| + the note's lines spelled out (first line ```` ```hidden ````, then the phrase, then the idea, last line ```` ``` ````), prompt and reminder | 1/1 left it to the die and worked around it. One hint: "press his luck a second time". | 2/2 fenced and clean |

The old prompt said the note "starts" with the phrase, and the model took that literally. It shipped as `MUSE_SYSTEM_PROMPT` plus a new `MUSE_REMINDER` (wording.ts). `newMuse` uses both, and a test checks the reminder. A Muse that already exists keeps the prompt it was made with: the engineer's and QA's were scratch ones, and Jason's own, if he has made one since this afternoon, can be refreshed with `brain.update`. The lesson is in AGENTS.md.

**2. Campaigns made before T17: a README note, nothing else.**

- The evidence is weak. The plain Assistant handled the note on the template alone (engineer 2/2), and the old Goat GM managed 1/1. The old preset GM gave one empty reply in three: one token cut by `<!-- from:`, which is T07's self-framing and may be chance. The app already says "no reply text… regenerate it" when that happens.
- A migration that rewrites brains' prompts would edit Jason's own words, which isn't ours to do.
- So the README's fresh-take bullet now has a sub-bullet. If a fresh take misbehaves in a campaign started before 2026-10-15, paste the presets' Muse sentence (quoted in full) into that brain's prompt after its hidden-block line.
- The bullet also says what asking the Muse itself does.
- I spent no live calls on re-measuring the old GM: one or two more samples wouldn't change the decision.

## Re-verification

- `npm run typecheck`: clean. `npm test`: **215/215** (214 + the new triage test).
- The new tests fail without their fixes. I checked by reverting the QA-1 rule and the QA-2 gate: "a new note, after the poem" and "a schema-7 file keeps T15's wording" both failed.
- Runs used a scratch mock server (4777/4778) and a scratch live server (4797), each with its own data and run dirs under the scratchpad, and users `dev-t17-mock` and `dev-t17-live`. Jason's 4747 was untouched until the final restart.

QA's exact repros, on the mock:

```
# QA-1: the poet called Muse
$ ./ss message.regenerate --thought "Critique the poem kindly."
[Muse's note m_6pa4gw46dc, right before the reply: every brain reads it]
Critique the poem kindly.                                   # QA-5: an unwrapped note is printed, not "--reveal shows it"
$ ./ss prompt.preview --json | jq -c '[.body.messages[]|[.role,.content[0:40]]]'
[["system",…],["user","<!-- from: the user -->\nWrite me a poem."],["user","<!-- from: Muse -->\nMOCK reply to brain \"You are a poet"],["user","<!-- from: Muse -->\nCritique the poem kindly."],["assistant",…]]
                                                            # the poem stays; the note is a new message after it
# QA-3
$ curl … /api/message.regenerate -d '{"conversation":"c_…","thought":"x"}'
{"error":{"code":"bad_brain","message":"A fresh take's note is written by the brain called Muse, and Muse here is an image brain. Rename it …"}}
# QA-2
$ ./ss conversation.update --id c_… --templates.thought $'```hidden\n{{thought}}\n\nThat sounds good, I\'ll respond next.\n```' --json | jq .templates.thought
$ ./ss conversation.get --id c_… --json | jq .templates.thought      # → T15's wording, as set (was: the new default)
```

The acceptance bullets, re-run on the mock with the preset, the Goat's World Bible and the opener, after a restart on the final code:

```
$ ./ss message.regenerate --thought @idea.txt --wrap
(added a brain called Muse (b_c68lwjrz4s): it writes the fresh takes' notes)
[Muse's note m_bpptj9bdba, right before the reply: every brain reads it; --reveal shows it]
preview == sent (#1, reminder on, new note)                 # cmp of jq -S bodies against /_mock/requests
== Co-GM / Show Me the Odds / Scene Painter: … the user, Muse, Game Master, reminder; last "user"
== Game Master: … the user, Muse, assistant, reminder; last "user"
$ ./ss brain.update --brain "Game Master" --no-final-reminder.enabled
$ ./ss message.regenerate --thought "The figure is a retired paladin…" --wrap
[Muse's note m_bpptj9bdba, version 2/2, right before the reply …]   # the same note, a new version
preview == sent (#2, no reminder, note v2)                  # body ends on the note: "user"
$ ./ss message.delete --message m_bpptj9bdba  →  Game Master: 0 Muse-framed, Co-GM: 0 Muse-framed
$ ./ss turn --brain Muse; ./ss turn; ./ss message.regenerate --thought "Goblins again." --wrap
  → Muse (generated, 1 version) · Muse (authored, the new note) · Game Master v2   # QA-1 in play
$ ./ss brain.list --json | jq … Muse .finalReminder.content  → MUSE_REMINDER
```

## Spend

**10 live text calls**, all `stream: false` probes of the Muse on `deepseek-v4-1-flash`. No app turns, no images. Balance went from **$6.86529694** to **$6.86097152**, a spend of **$0.0043**.

## Clean-up

- Scratch servers killed. The scratch data dirs and their `dev-t17-*` users were deleted.
- Jason's server on 4747 was restarted on the current code (`npm run up`, live), which logs out any session.
- The Vite dev server on 5173 was left as it was: it isn't mine.

## Files

- `src/conversations/turn.ts`: QA-1, QA-3, QA-5 and QA-6 notes.
- `src/conversations/wording.ts`: `MUSE_SYSTEM_PROMPT`, `MUSE_REMINDER`, `NoteShown`, `museMakesNote`.
- `src/conversations/defaults.ts`: QA-2, and the Muse's reminder.
- `src/commands/campaigns.ts`: QA-2.
- `src/commands/chat.ts`: QA-3.
- `src/commands/brains.ts`: QA-4 help.
- `src/cli/main.ts` and `src/conversations/format.ts`: QA-5.
- Tests: `test/fresh-take.test.ts`, `test/prompt.test.ts`.
- Docs: `docs/design.md`, `README.md`, `AGENTS.md` (lesson) and `TICKETS.md`.
