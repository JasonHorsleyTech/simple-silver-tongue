# T20 QA: Compaction and a token counter

**Verdict:** Acceptance passes on the mock. The live bullet was not run: the balance is $1.58, under the $4 floor. 0 blockers, 0 majors, 1 minor, 5 nits. No DESIGN CONCERN.

**The cut holds everywhere I looked.** I checked every kind of brain against design.md step 2c, message by message:
- the default GM;
- two made characters, each with its sheet pinned from before the cut;
- the Creator, an image brain, the Muse, and the compaction brain itself.

Each one gets its system prompt, the setup, its pins, the compaction, then only the messages after it.

**Preview equals send.** It held for:
- a middle compaction;
- a re-version at depth;
- a second compaction at the end;
- a GM turn after the cut.

**`{{count}}` is right in every case I built**, including a middle compaction, a re-version and a second compaction. Deleting or re-authoring a compaction moves the cut, and the answer says so.

**The one real gap: three other ways to move the cut say nothing** (QA-1).

## How I ran it

- **Tests:** `npm test` passes 251/251 and `npm run typecheck` is clean, at f0593f2. I changed no code.
- **Jason's server was left alone.** His server on 4747 was never stopped, restarted or touched. `web/dist` and `.run/` were not touched.
- **Scratch servers, mock only.** A scratch mock on 4962 and a server on 4961, started by hand. The data dir, run dir, web dist and `SST_MODELS_FILE=models.example.ini` were all under my scratchpad. I restarted that server once to check persistence.
- **Users:** `qa-t20-a` (plaintext) and `qa-t20-enc` (encrypted), both in the scratch data dir.
- **No live calls.**
- **The story:** the Tabletop RPG preset, a World Bible, and a 15-message harbor ledger built with `message.add`. Two sheets in the Creator's mouth made Character 1 (the barkeep) and Character 2 (the hooded figure). It also has a Scene Painter image, a roll, a Muse note and GM lines.
- **A second conversation** ("Plain") had two compaction brains (`Sum A` with no reminder, `Sum B`) and an image brain. I used it for the refusals, 409s, stop, failure and `{{count}}` edge cases.
- **Preview against send:** I saved `prompt.preview … --json | jq -S .body`, ran the command, and `cmp`'d it against the newest `/chat/completions` body from the mock's `/_mock/requests`.

## Acceptance checklist

| Bullet | Result | Evidence |
|---|---|---|
| After a compaction on message N, every brain's preview holds the system prompt, setup, its pins (a sheet pinned to a made brain, written before N, still there), the compaction, then only the messages after it | **pass** | Compaction through message 8 of 15. Every brain's preview checked: `cut {before: 8}`. **GM:** system, World Bible, the Chronicler's note framed, then messages 9–15 (its own lines as `assistant`), reminder. **Character 1 and Character 2:** system, World Bible, **their own sheet** (`pinned index 2`, from before the cut), the compaction, messages 9–15, reminder. Character 2's own line is `assistant`; the other sheet is not sent. **Creator:** no sheets of its own; it gets only the summary. **Scene Painter:** its own image after the cut as tool call + tool result. **Muse:** its note as `assistant`. **Chronicler:** its compaction as its own `assistant` words. The cut note says "One of them is pinned to this brain, so it is still sent". |
| `prompt.preview` of the compaction equals what's sent | **pass** | `cmp` identical for: the middle compaction, the re-version at depth (`compact.newVersion: 2`, and its body equals the first version's request), a second compaction at the end, and a GM `turn` after the cut. The encrypted user's compaction ran the same path. |
| A compaction on a middle message leaves the later messages verbatim | **pass** | The 7 messages after message 8 kept their ids and text (`conversation.get`). They appear verbatim in every brain's request after the compaction. |
| A second compaction cuts at itself, and its request starts at the first | **pass** | The second compaction's body starts at the first compaction as the Chronicler's own `assistant` words. `{{count}}` is 15: 15 messages plus 1 compaction, the compaction not counted. Afterwards every brain's `cut` is the second compaction (`before: 16`). `conversation.get` marks the first as "an older one, above the newest". |
| Deleting the compaction brings the full ledger back | **pass** | Deleting the older compaction left the cut where it was. Deleting the newest answered "No compaction is left, so every brain's request holds the whole ledger again", and the preview went back to all 20 messages. `set-author` of the newest compaction to the player and back moved the cut both ways and said so. |
| Live on DeepSeek: the Chronicler's block, then the GM, a made character and the Creator (no re-sheeting) | **not run** | Balance $1.58 < $4 (AGENTS.md). Still open, as the engineer reported. The engineer's probe plan in `reports/T20-engineer.md` is sound. |
| The CLI shows each brain's prompt size from the last real usage | **pass** | `prompt.size` lists each brain's Venice count (cached included: "1,421 in (1,152 cached)"), how many messages ago, `beforeCut`, and an estimate now with the context length. A brain on an unknown model gets a row that says why. Every preview's `Size:` line says it is an estimate. I checked `size.chars` by hand against the body, tool schema included. |
| Every word sent stays visible and editable; test and typecheck pass | **pass** | No new text reaches a model. `{{count}}` is a number in the user's own reminder, rendered in the body and named in a note (like `{{roll}}`). A `{{count}}` in a system prompt or a player's message is sent as typed. `$&` in a reminder stays literal. 251/251, typecheck clean. |

Also checked, all fine:
- **Refusals:** `nothing_to_compact` (through a compaction, empty conversation), `above_compaction`, `no_compactor` (names the `brain.import`), several compaction brains with no `--brain`, `--brain` on a non-compactor or an image brain, an unknown or misspelled message id, and a preview mixing `--compact` with `--content` / `--steer` / `--regenerate`.
- **Compacting through an image message, a roll and a Muse note** (the note ends up above the cut).
- **Steer, plain re-roll and fresh take of a compaction that is the last message:** each cuts at the previous compaction. The fresh take's Muse note goes right before it.
- **A brain that both makes and compacts:** its compaction made Character 1, pinned. A re-version made nothing.
- **The setting itself:** `--compacts` on and off for a brain with messages; refused on an image brain and on a kind change to image unless `--no-compacts`.
- **Generation behavior:**
  - **409s:** `turn`, `message.compact` and `message.edit` all get a 409 while a compaction streams.
  - **`generation.follow`** replays it with "compacting through".
  - **A stop mid-reply** saves the compaction, which then cuts, with the redo note.
  - **A stop before Venice answers** saves nothing.
  - **A mid-stream break** saves nothing and carries `retry: message.compact`.
- **Clones and campaigns:**
  - `clone --through` the compaction keeps the cut; through the message before it there is no cut; `--without-messages` keeps the setting.
  - The campaign round trip keeps the cut and an identical Character 2 body.
  - A campaign with the Chronicler as default works, and a plain `turn` then compacts.
  - Bad `compacts` values in a file are refused by path.
- **Encrypted user:** no phrase from the scenario is in its files or the server log.
- **Restart:** the cut and `prompt.size` are the same after a restart.
- **Scale:** an 1,818-message ledger (imported) takes 0.12 s for `prompt.size` or `prompt.preview --compact`.

## Findings

### QA-1 (minor): three ways of moving the cut say nothing about it

`message.delete` and `message.set-author` answer `cutMoved` and print "Every brain's request now starts at the compaction m_…". Three other actions move the cut just as far and say nothing.

**Repro** (any conversation where the GM has spoken after the newest compaction, or none exists):
```bash
./sst brain.update --brain "Game Master" --compacts       # "Updated brain Game Master … · compacts": nothing more
./sst prompt.size | head -1                                 # "compacted at <the GM's newest line> (the 17 before it are left out of every request)"
./sst message.add --as Chronicler --content "A summary."    # "Added m_… (in Chronicler's mouth). Every brain sees it from the next request."
./sst turn --brain Chronicler --content "x"                 # header and done line: "[Chronicler · 1275 in / 35 out · $…]"; the player's "x" is now above the cut
```

- **Expected:** each says that requests now start at the new compaction and how many messages are left out. That is the `cutLine` the delete and set-author answers already print. For `turn` to a compaction brain, the start/done line could say "compaction", as `message.compact`'s does. The preview already warns with `compactsNote`, but the send says nothing.
- **Actual:** silent. `brain.update --compacts` given to the wrong brain (the GM) cuts every brain's context at the GM's latest line without a word. You only find out from `conversation.get` or `prompt.size`. It is reversible (`--no-compacts`), hence minor.
- **Cause:** `applyCompacts` (`src/commands/brains.ts` ~line 110) and `messageAdd` (`src/commands/messages.ts`) don't compare `cutAt` before and after. `turn`'s `start` / `replyNote` (`src/commands/chat.ts`) don't mark a compaction brain's reply.

### QA-2 (nit): `prompt.size` says a line below the cut is "before the newest compaction"

**Repro:**
1. Take a GM turn (last message).
2. `message.compact --message <an earlier message>`.
3. Run `prompt.size`.

The GM's row reads `1,401 in · m_xj2e2ofmw6, the newest message · before the newest compaction, so its next request is cut`.

`beforeCut` compares timestamps (`createdAt`), so it is right: that count was for an uncut request. But next to "the newest message" it reads as a contradiction, because the line sits *below* the compaction in the ledger. Suggest "counted before the newest compaction was written" (`lastCountLine`, `src/conversations/format.ts`).

A smaller wrinkle: a compaction re-versioned at depth keeps its message's `createdAt`, so a count taken between its versions isn't flagged (`lastCount`, `size.ts`).

### QA-3 (nit): `{{count}}` counts a fresh take's note to the Chronicler as story

On a compaction that is the last message:
- `prompt.preview --regenerate` sends "The story so far is 15 messages long";
- `prompt.preview --regenerate --thought "Mention the ring." --wrap` sends **16**, because the Muse's note is a message.

Once saved, the note stays counted in every later compaction. By design.md's letter ("messages from the start") this is right. Only mention it if the count should mean story messages. Rolls and image prompts are arguably story; a note to the Chronicler isn't.

### QA-4 (nit): a hand-edited image brain with `compacts: true` is listed as compacting

`isCompactor` correctly ignores the flag on an image brain: `message.compact --brain Painter` is refused, and there's no cut. But some places still say "compacts":
- `brain.list` prints "Its messages are compactions (T20)…";
- `brainLine` prints "compacts";
- `conversation.get`'s brain line prints ", compacts".

They read `b.compacts` instead of `isCompactor(b)` (`src/commands/brains.ts` ~322 and ~338, `src/conversations/format.ts` ~81). The app itself can't write this state; only a hand edit can.

### QA-5 (nit, for the Frontend pass): the web API types lag the server

`web/src/api/types.ts` is missing:
- `compacts` in `BrainFields`, the `brain.add` / `brain.update` args;
- `cutMoved` on the `message.delete` and `message.set-author` results;
- `compacts` on the library `BrainInfo`, used by `presets.list` / `examples.list`.

The server sends all of these. The Frontend pass will need them first thing.

### QA-6 (nit): two different token estimates for one request

A failed request's diagnostics print "about 35 tokens (an estimate: ~4 chars a token; no tokenizer here)". `prompt.size` and the preview estimate the same body at characters / 4.4 + 4 a message. Both say they are estimates, so nothing is wrong, but one estimate everywhere (`estimateSize`) would be simpler.

## Outside this ticket (not counted)

**`--password -` takes all of stdin, newlines included, as the password.** For example, `printf 'pw\npw\n' | ./sst user.create --username qa-x --password -` gives the password `pw\npw`:
- `printf 'pw\n' | ./sst auth.login … --password -` then says "Wrong password", and the two-line pipe logs in;
- the browser's login field can't type that password.

AGENTS.md says that without `--password` the CLI reads the first stdin line, so a script that answers the prompt twice (password and confirm) can set a password nobody can type. This is in `src/cli/args.ts` ~line 111, not T20. For the orchestrator to file or dismiss.

## Notes for triage and the live probe

- **The Creator's re-sheeting risk is still untested.** If the live probe shows it, a fix needs no new flag: `brain.pin` already keeps any message in front of one brain through a cut. Pinning each sheet to the Creator, or having a maker pin its message to itself as well as to the brain it makes, would keep its "Sheets already written" source exact.
- **Compacting right after a player's move** leaves that move only inside the summary for the GM's next request. The same goes for a Muse note waiting for its reply. That is what "through the last message" means, so it is not a bug. It may be worth one line in the Frontend pass's "Compact through here" wording.
- **Scratch state:** the scratch servers on 4961/4962 are stopped. The users `qa-t20-a` and `qa-t20-enc` live only in the scratchpad's data dir.
