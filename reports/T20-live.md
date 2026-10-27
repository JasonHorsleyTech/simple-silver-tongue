# T20 live: the compaction pipes on DeepSeek

The live acceptance bullet the earlier passes couldn't run, done as Jason asked: a plumbing test on a tiny, hand-written ledger, not prompt tuning. **4 live text calls, all `deepseek-v4-1-flash`, no images, $0.0072. Every check passed, so no prompt or code changed.**

**Balance:** $26.5789 before and $26.5718 after (Jason had topped up since the engineer pass's $1.58). The spend matched the four replies' recorded costs to the cent fraction ($0.0028 + $0.0011 + $0.0012 + $0.0021).

## Setup (free)

- **Scratch live server** on :4961, started by hand: `env -u VENICE_BASE_URL SST_MODE=live SST_PORT=4961`, with its own `SST_DATA_DIR` / `SST_RUN_DIR` under the scratchpad, `SST_WEB_DIST` pointing at a missing dir, `SST_MODELS_FILE=models.example.ini` and `SST_SESSION_IDLE_MINUTES=0`. The key came from `.env` and was never printed. `./sst` used its own `SST_URL` and `SST_SESSION_FILE`. Jason's server on :4747 was never touched, and this pass didn't touch `.run/`, `web/dist` or `data/`. The pid was killed at the end.
- **The conversation:** user `dev-t20-live` (unencrypted), `conversation.import --preset tabletop-rpg`, and a two-line World Bible (Saltmere, a rainy smugglers' harbor; the player is Tam, a courier off the evening ferry).
- **11 messages by `message.add`:**
  1. The GM's opener: a bald barkeep, a one-eyed dockhand, a hooded figure.
  2. The player asks for a room.
  3. **A Creator sheet for the barkeep**, which made Character 1 with it pinned. Secret: brandy in the cellar for the Corley crew.
  4. Character 1: "Room's three silver… and that's that."
  5. The player pays.
  6. A GM line.
  7. **A Creator sheet for the hooded figure**, which made Character 2. Secret: a watch informant.
  8. Character 2's line.
  9. The player sits.
  10. The GM: a note, "Meet me at the lighthouse at dawn."
  11. The player: "I'll be there."

## The run (trimmed)

```
$ sst prompt.size                      # before: 11 messages, no compaction, no counts yet
Game Master  no reply counted yet  ~2,046 of 1,000,000   … Chronicler ~1,958

$ sst prompt.preview --compact --json
compact {through: m_3umn81jd4w (the last message), after: 0}, cut null
messages: system, World Bible, the 11 messages (framed), reminder
reminder: "You are the Chronicler. The story so far is 11 messages long. … its second **The story so far, 11 messages:** …"
note: "The final reminder's {{count}} is sent as 11 …"     size ≈ 1,958 tokens

$ sst message.compact                  # LIVE 1
[Chronicler · compaction through m_3umn81jd4w · 1987 in / 1809 out · $0.0028]
```

**The compaction** (7,317 characters; excerpt):

````
```hidden
**The story so far, 11 messages:**

**Characters:**

- Tam (the player's character; a young courier …). No character sheet written; no helper of his own. …
- the barkeep (name not yet spoken to the player; his sheet names him Hob Tanner). Sheet written by the Character Creator; his helper is "Character 1". Looks: A broad bald man in his fifties, red beard, leather apron, a burn scar across the back of his left hand. Seen by the player: … Hidden from the player: … Underneath: He hides smuggled brandy in the cellar for the Corley crew. … Keeps: the brandy in the cellar; he'd admit it only to a watchman with a warrant, because it would ruin him. …
- the hooded figure (name not yet spoken to the player; her sheet names her Mira Vell). Sheet written by the Character Creator; her helper is "Character 2". Looks: A thin woman in her thirties, grey wool cloak with a deep hood, a dark braid over one shoulder, a silver ring shaped like a gull. … Underneath: She is a watch informant hunting the brandy smugglers. …
- the one-eyed dockhand. No sheet written; no helper. Seen by the player: nursing a pint by the fire …
- Mentioned only in hidden sheets, not yet seen or heard by the player: Nell …, the Corley crew …, Captain Dray …, Pell …

**Plot:**  (the six beats, in order)
**Changes:** … the folded note, now in his pocket. …
**Open threads:**
- Tam agreed to meet the hooded figure at the lighthouse at dawn.
- … No roll has been made and no action is waiting on a roll.
**Details:** … The note's exact words: "Meet me at the lighthouse at dawn." … No painter's style lines have been given yet.
**Where we are:** … Waiting on the player: what Tam does next …
```
````

```
$ sst conversation.get | grep '^Compacted\|^──'
Compacted at m_vyoi2mlpjr: every request starts there, and the 11 messages above it are left out (kept here; …).
── Game Master · m_dbxyqfpkn7 · compacted: left out of requests · written by you ──   (… all 11 marked)
── Chronicler · m_vyoi2mlpjr · compaction: every request starts here · $0.0028 ──

$ sst prompt.preview --brain "Game Master" --content "I finish my ale and ask the barkeep if the inn has a back door."
cut {messageId: m_vyoi2mlpjr, before: 11}, pinned none     ≈ 2,954 tokens
[system] [World Bible] [<!-- from: Chronicler --> ```hidden…] [<!-- from: the user --> I finish my ale…] [<!-- System reminder -->]

$ sst turn --brain "Game Master" --content "…back door."      # LIVE 2
You drain the ale, stand, and leave the hooded woman at the table … At the bar, the barkeep is wiping the same mug …
"A back door?" … His scarred hand goes flat on the bar, and for a moment he looks at the cellar door behind him … "Back door's for deliveries, and that's that."
The one-eyed dockhand by the fire has stopped drinking. …
*(That's a roll.)*
[Game Master · 3070 in / 144 out · $0.0011]

$ sst prompt.preview --brain "Character 2" --content "I walk back to her table and ask the hooded figure, straight out, who she really works for."
cut {before: 11}, pinned [{index 2, m_nm6h7wjvmz (her sheet), as ledger}]   ≈ 3,149 tokens, reasoning low
[system] [World Bible] [<!-- from: Character Creator --> ```hidden (her sheet)] [<!-- from: Chronicler --> ```hidden]
[the user: back door] [Game Master's reply] [the user: who do you work for] [<!-- System reminder -->]

$ sst turn --brain "Character 2" --content "…who she really works for."   # LIVE 3
**The hooded figure:** *I turn the ring on my finger, once, and don't look up at him.* "You went to the bar to ask about me. What did he tell you?"
*Now I look up.* "Sit down. You're making the room nervous."
(reasoning: "Mira keeps that she works for the watch — she'd say so only to save her own life. So she deflects: asks a question instead of answering. …")
[Character 2 · 3338 in / 171 out (109 reasoning) · $0.0012]

$ sst prompt.preview --brain "Character Creator"            # no note: the last message is Character 2's
cut {before: 11}, pinned none     ≈ 3,375 tokens; note: "this reply will make a new brain, Character 3"
[system] [World Bible] [Chronicler] [user] [Game Master] [user] [Character 2] [<!-- System reminder -->]   (its own sheets are above the cut)

$ sst turn --brain "Character Creator"                      # LIVE 4
```hidden
**Sheets already written:** Hob Tanner (the barkeep); Mira Vell (the hooded figure). This sheet is for someone else.
**Known to the player as:** the one-eyed dockhand
**Name:** Ruen Sallow
… (every line of the sheet) …
```
{"type":"brain_made", "name":"Character 3", …}
[Character Creator · 3518 in / 831 out · $0.0021]

$ sst prompt.size                      # after
Prompt sizes in "T20 live": 17 messages, compacted at m_vyoi2mlpjr (the 11 before it are left out of every request).
Game Master            3,070 in · m_vx4n3b1l2l, 3 messages ago      ~3,966 of 1,000,000
Character Creator      3,518 in · m_5b7gnt6dz9, the newest message  ~4,156 of 1,000,000
Chronicler             1,987 in · m_vyoi2mlpjr, 5 messages ago      ~3,861 of 1,000,000
Character 2            3,338 in · m_fqj3cbyz1u, 1 message ago       ~3,990 of 1,000,000
(the other six brains: no reply counted yet, with their estimates)
```

## Checks

| Check | Result |
|---|---|
| The compaction is one closed ```` ```hidden ```` block and nothing else | **Pass.** First line ```` ```hidden ````, last line ```` ``` ````, exactly 2 fences, nothing outside it. |
| Its count | **Pass.** "**The story so far, 11 messages:**", the number the reminder's `{{count}}` was sent as. The preview showed it rendered and noted it. |
| Its sections | **Pass.** Characters, Plot, Changes, Open threads, Details, Where we are, in that order. |
| What it must carry for the others | **Pass.** Both Looks lines word for word; both sheets' secrets (copied nearly whole); helpers named "Character 1" / "Character 2"; the names the player knows; the unsheeted dockhand; the open thread (the lighthouse at dawn, the note's exact words); "no roll pending"; "no style lines yet". |
| The cut | **Pass.** `conversation.get` marks the 11 messages as left out and the compaction as where every request starts. Each post-cut preview has `cut {before: 11}`. |
| GM's request after the cut | **Pass.** System, setup, compaction, the turn since, reminder (the GM has no pins). |
| Character 2's request after the cut | **Pass.** Jason's order exactly: system, World Bible, **its sheet (pinned, from before the cut)**, the compaction, the turns since, reminder. |
| Creator's request after the cut | **Pass.** System, setup, compaction, the turns since, reminder. Its own earlier sheets are gone from it, as designed. |
| The GM answers from the summary | **Pass.** It used the barkeep's scarred hand, the glance at the cellar door (a Tell) and "and that's that", plus the dockhand, all of which came only through the summary. It used no name the player hasn't heard. |
| The character answers from its pinned sheet | **Pass.** It opened with "**The hooded figure:**" (the sheet's Known-to-the-player line), kept the watch secret per Keeps, deflected with a question (Voice), and turned the ring (Tells). |
| The Creator doesn't re-sheet | **Pass.** Its first line listed both sheeted people from the summary, and it sheeted the dockhand, the one person shown without a sheet. Character 3 was made. The "keep through compaction" flag is still not needed. |
| `prompt.size` shows real counts afterwards | **Pass.** Each brain that spoke has Venice's count, its message and "N messages ago"; the rest say "no reply counted yet". Venice reported no cached tokens on these four calls (each brain's prefix differs from the previous call's), so no "cached" figure showed. |
| The estimate against real `usage` | **Pass, roughly.** It ran 1.5% to 5.7% low (table below). |

| Request | Estimate (preview) | Venice `prompt_tokens` | Off by |
|---|---|---|---|
| Chronicler, the compaction | 1,958 | 1,987 | -1.5% |
| Game Master after the cut | 2,954 | 3,070 | -3.8% |
| Character 2 (reasoning low) | 3,149 | 3,338 | -5.7% |
| Character Creator | 3,375 | 3,518 | -4.1% |

The estimate is consistently a little low on this ledger. The Markdown-heavy sheets and the summary probably tokenize denser than T18's GM body, and reasoning on adds the provider's ~25 hidden tokens. It is well within what "an estimate" promises. I didn't change the constant on four samples.

## Observations (not failures, nothing changed)

- **On a tiny ledger, a compaction costs more than it saves.** The 11 messages were 3,059 characters and the summary is 7,317, because it copies both sheets nearly whole into "Hidden from the player". The prompt asks for that on purpose: after the cut, the summary is the only copy of the sheets the GM and the Creator have. A made character therefore gets its own sheet twice, once pinned and once in the summary. This is a fixed cost per sheeted person while the plot part grows, so it pays off on the long campaigns the feature is for. Worth one line in the README's "Compact a long campaign" if Jason wants it: compact when the counter is large, not early.
- **The Creator's list used sheet names**, "Hob Tanner (the barkeep); Mira Vell (the hooded figure)", where the prompt says "as the player knows them now". The line is in a hidden note the player doesn't read, and it matched the right people, so this is a nit, not worth tuning.
- The GM ended "*(That's a roll.)*", the preset's own way to call for a check, which is correct for a sneaky question about a back door.

## Calls and spend

4 live text calls, out of a budget of 5–10 (cap 12): `message.compact`, `turn` GM, `turn` Character 2, `turn` Creator. No `stream: false` probes were needed, because nothing failed. No images. $0.0072 in total.

## Changes

No code or prompt changes: `presets/tabletop-rpg.json` is as T20 engineer wrote it. TICKETS.md (T20 → `done`, a "From T20 live" block) and design.md's Compaction section ("Verified live…", plus the "keep through compaction" paragraph no longer saying "not yet probed live") are the only edits, with this report.
