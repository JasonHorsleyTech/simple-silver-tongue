# T16 triage: brains that make brains

**Fixed 8, deferred 0, dismissed 1.** No DESIGN CONCERN.

**The fix that matters is QA-1, in the preset.** Asked with nothing typed, the Character Creator kept writing a second sheet for someone who already had one, and so made a second brain for the same person. The fix has two parts:
- The prompt now spells out whose sheet to write.
- Every sheet now starts with a line the Creator writes itself, **Sheets already written:**, listing everyone it has already written a sheet for.

The rule alone still gave 1 duplicate in 3, twice. With the line it went 3 in 3, and both controls held.

The other seven fixes are small code changes, each with a regression test.

`npm run typecheck` is clean, and `npm test` passes 210/210 (one new test; four more tests added to existing ones).

| Finding | Decision | What changed / why |
|---|---|---|
| **QA-1** (major): with no note, the Creator re-sheets someone who already has a sheet, so a second brain | **Fix** (preset) | **The prompt.** A new "Whose sheet" paragraph and a new reminder:<br>• The player's note is their message right before the reminder, and it is obeyed.<br>• Without a note, the Creator picks someone with no sheet: the newest person the story has shown, or else the newest person anyone has mentioned (narration, a sheet's Ties).<br>• Never a second sheet for anyone. Match people, not names: a sheet may be under an old description, and a helper may be called "Character 2".<br>**The first line.** The sheet's first line is now **Sheets already written:**. The model lists everyone its earlier sheets are for, then writes someone else.<br>**The blueprint.** It said "your sheet's first line, 'Known to the player as'", which is no longer true; it now says "your sheet's 'Known to the player as' line".<br>Evidence is below. On the generic way out, see "Why no 'a maker may decline'". |
| **QA-2** (minor): an image blueprint with tool text is a 500; a new image blueprint has no tool text | **Fix** | `applyMakes` now fills any image blueprint, new or switched to image, the way a new image brain is filled. It adds tool text, safe mode and shape, and keeps what is already set. So `--makes.blueprint.tool.*` works at once, and `brain.list` shows every word the made brains will get. This also mends a blueprint stored before the fix. |
| **QA-3** (minor): `b_{{n}}` is accepted, then breaks its maker and `brain.list` | **Fix** | The pattern check refuses names that would look like brain ids. Checking `madeName(p, 1)` is enough, since only digits change from one name to the next. `nextMadeName`'s error now says what is actually wrong and how to change it. `brain.list` no longer fails for the whole conversation on such a pattern; it can still reach one through a hand-edited file. |
| **QA-4** (minor): `--without-messages` keeps made brains with no sheet, and keeps the counter | **Fix** | `rebuild` now leaves a brain with `madeFrom` behind when the ledger isn't copied: its prompt is about a pinned message that isn't coming. Each maker then counts from 1. If the default brain is left behind, the first remaining brain becomes the default. If every brain would go, they all stay. The same rule applies to `conversation.clone` and `conversation.import --without-messages`, and both help texts say so. |
| **QA-5** (minor): the Co-GM used a first name ("Hollis") that only a sheet had | **Dismiss** | This is the accepted leak rate (Jason, T10). It kept the real secret and answered from the player's side, 1 call in 1. I spent the live budget on QA-1, which defeats T16's purpose; one more probe would have measured this but couldn't have fixed it. |
| **QA-6** (nit): "(your's)" | **Fix** | `pinnedNote` now takes `author?`, where none means the player's, and says "(yours)". |
| **QA-7** (nit): "Made a new brain" glued to an image prompt | **Fix** | At `image_pending`, the CLI prints the newline first, then the made-brain line, then "(making image …)". |
| **QA-8** (nit): a gap in the numbers after a slip is deleted | **Fix** | New `freeNumber(conv, gone)` in `makers.ts`. A brain that goes while it still has the name its maker's newest number gave it hands that number back. It runs from `message.delete`'s cascade and from `brain.delete`. Deleting a sheet you didn't want now leaves no gap. A renamed or older brain changes nothing, so renaming "Character 1" still never frees 1. |
| **QA-9** (nit): `nothing_to_answer` blamed "its own reply" when the body ends on a pin | **Fix** | `reviewBody` notices when the body ends on a pinned message (`endsOnPin`). The refusal then says so: "The request would end with m_…, which is pinned to Thing 1 and sent as the brain's own words, its text verbatim, so there is nothing after it…". This also corrects a `system` pin, which used to be called "a system setup message". A plain re-roll's own wording doesn't override this one. |

## QA-1: the evidence (live, `stream: false` probes, nothing generated saved unless said)

- **Setup.** I built the scene by hand with `message.add`, at no cost: sheets written in the Creator's mouth still make their brains. QA's desert depot, Dry Creek:
  - Two sheets: Lottie Crandall, made Character 1 and renamed "Miss Crandall"; and Hollis Cheevers, the station agent, Character 2.
  - A line each, and Miss Crandall saying "Cheevers".
  - The player's latest action leans on the station agent, sent to Show Me the Odds, and the odds' reply.
  - Then `prompt.preview --brain "Character Creator" --json`, with no note.
- **Server.** A scratch live server on port 4797, with its own data and run dirs, as user `dev-t16-live`. Jason's 4747 was never touched.

| Prompt | Runs | Who it wrote |
|---|---|---|
| T16 as committed | 2 | Buckner (offstage, from a Ties line). Then **a placeholder sheet for "Show Me the Odds"** ("nobody — that's a label, not a person", every line "—"), which would have made a junk brain. |
| + "Whose sheet" rule, "never a second sheet", "newest anyone has *named*" | 3 | Buckner, Buckner, **Lottie Crandall**: a duplicate. Her sheet calls her "the woman in the grey duster", and the story has since said her name; "named" invited this. |
| + "mentioned", "match people, not names" | 3 | Buckner, **the station agent** (a duplicate), Buckner |
| + **Sheets already written** line (committed) | 3 | "Sheets already written: the woman in the grey duster (Miss Crandall), the station agent (Mr. Cheevers). This sheet is for someone else." Then **Buckner** each time (one gave him another name). |
| Control: note "(her brother Dell, in Kansas City)" | 1 | **Dell**. The note is obeyed. |
| Control: a teamster stamps in out of the storm (GM line added); no note | 1 | **The teamster**, the newest person shown |
| The teamster's brain (that sheet added by hand made Character 3), before and after the blueprint wording fix | 2 | "**The teamster:** *I wipe my palms down my coat…* "Now look. That's between him and her."" Its own tells, its own Keeps. The new first line didn't confuse it. |

- **What was committed.** `brain.list --json` of the tuned Creator was diffed against `presets/tabletop-rpg.json`: the system prompt and the reminder are identical. The blueprint change is the one sentence above.
- **Why the line works.** It is Jason's planted-thought finding seen from the other side. The rule as an instruction lost to the latest messages, which were about the station agent. A list the model has just written itself held.

### Why no "a maker may decline"

I looked at a generic way out. Two candidates:
- **"An empty message makes no brain."** It wouldn't give the Creator an honest out in practice: a model can't reliably answer with nothing. It would also take the brain away from a reply stopped before any text, which now gets its brain, so a re-roll fills it.
- **A per-maker "only when the message contains …".** That is a new field to show, edit and import everywhere, all for one prompt's sake.

The prompt now always has someone to write: a story names more people than it shows. Undoing a slip is one `message.delete`, which takes the never-spoken brain with it and, after QA-8, hands back its number. design.md records this under "A maker can't decline".

## Re-verification (scratch mock: server 4807, mock 4808, user `dev-t16-tri`; QA's commands)

```
$ ./ss brain.add --name ImgMaker --system-prompt x --makes.name "Pic {{n}}" --makes.blueprint.system-prompt y --makes.blueprint.kind image --makes.blueprint.tool.name paint_it
Added brain ImgMaker (b_kmlyi6v40y) · text · … · makes "Pic {{n}}"
$ ./ss brain.list | grep -A1 "Its tool"
  Its tool paint_it:
    description: Generate an image from a text prompt. The image is shown to the player.
$ ./ss brain.add --name IdMaker --system-prompt x --makes.name "b_{{n}}" --makes.blueprint.system-prompt y
error: Invalid arguments for brain.add: makes.name: The names this pattern makes would look like brain ids (b_...), which a brain name can't
$ ./ss turn --brain Painter --content "paint the docks"
MOCK image prompt after 2 messages; last: "<!-- from: the user --> paint the docks"
Made a new brain, Scene 1 (b_ozjuovsda2), with this reply pinned to it. Rename it once you know who it is: …
(making image img_0q867gfyrq with z-image-turbo... the conversation is free meanwhile)
$ ./ss prompt.preview --brain Assistant --content hi | grep "^Note: Pinned"
Note: Pinned to Assistant: m_ev7ug8nc59 (yours), as the brain's own words, its text verbatim. …
$ ./ss turn --conversation $C2 --brain "Thing 1"
error: The request would end with m_epc1dqpbjr, which is pinned to Thing 1 and sent as the brain's own words, its text verbatim, so there is nothing after it for Thing 1 to answer. Write a message for it first.

# acceptance, preset at the depot
$ ./ss turn --brain "Character Creator" --content "(the woman in the grey duster)"   → Made a new brain, Character 1 …
$ ./ss prompt.preview --brain "Character 1" --content "Who are you?"                  → [2] user · pinned m_…, as it appears in the ledger …
$ ./ss message.add --as "Character Creator" --content @sheet2.md                     → Character 2
$ ./ss brain.update --brain "Character 1" --name "Miss Crandall"; ./ss prompt.preview | grep -c "<!-- from: Miss Crandall -->"   → 1
# QA-8
$ ./ss message.add --as "Character Creator" --content '```hidden …slip… ```'          → Character 3
$ ./ss message.delete --message m_b7ob7mdard  → Deleted brain Character 3 (…) too: it was made from this message and had never spoken.
$ ./ss prompt.preview --brain "Character Creator" | grep -o "will make a new brain, [^,]*"   → will make a new brain, Character 3
# QA-4
$ ./ss conversation.clone --id $C --title "Fresh start" --without-messages
Brains: Game Master (default), Co-GM, Show Me the Odds, Character Creator, Scene Painter (image), Character Portraitist (image)
$ ./ss brain.list --conversation <new> | grep -o 'next Character [0-9]*'             → next Character 1
# README "An older campaign": the three new jq + brain.update lines, walked on the mock: the Creator's prompt, reminder and makes equal the preset's
```

## Tests added

All in `test/makers.test.ts`:
- **Delete test:** the newest brain's number comes back after `message.delete` and after `brain.delete`; an older brain's delete changes nothing.
- **New "triage" test:**
  - QA-2: the image blueprint gets tool text, and `brain.list` shows it.
  - QA-3: an id-shaped pattern is refused.
  - QA-6: "(yours)".
  - QA-9: the refusal that ends on a pin.
- **Campaign test (QA-4):** clone and import `--without-messages` leave Character 1 behind, and the counter is back at 1.

## Live spend

- **Calls:** 15 text calls, all `stream: false` probes, and no images:
  - 2 before the fix;
  - 9 across three versions of the Creator's prompt;
  - 2 controls;
  - 2 of the made brain.
- **Balance:** **$7.25797734 → $7.24481508**, so **$0.0132**. That covers anything Jason spent on 4747 meanwhile, too.

## Docs

- **design.md**
  - The maker counter now steps back, and id-shaped patterns are refused.
  - The image blueprint is filled.
  - `--without-messages` leaves made brains behind.
  - New: "A maker can't decline", and why.
  - The Creator's preset row: the rule and the new line.
  - A T16 triage paragraph with the probes.
- **README**
  - The Creator's line.
  - Deleting a sheet as the way to undo one.
  - "An older campaign" also takes the preset Creator's prompt and reminder.
- **AGENTS.md:** one lesson (make the model write the count first).
- **TICKETS.md:** T16 → `frontend`, with a "From T16 triage" note for the frontend:
  - the made brain's card should say its prompt is a copy;
  - the `next` counter can now step back on a delete;
  - image blueprints now always carry tool, safe mode and shape.

## Clean-up

My scratch processes were killed: the live server on 4797 and the mock server and mock on 4807/4808. Their data and run dirs are in the scratchpad. 4747 (Jason's server) was never restarted, stopped or called, and nothing under `data/` or `.run/` was read or written.
