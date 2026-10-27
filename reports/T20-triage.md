# T20 triage: Compaction and a token counter

**Result:** fixed 4, deferred 1 (to this ticket's Frontend pass), dismissed 1. I also fixed QA's out-of-ticket finding (`--password -`). `npm test` passes 252/252 and `npm run typecheck` is clean. No DESIGN CONCERN.

**No live calls.** The balance was $1.58, under the $4 floor. The Chronicler's live tuning is still open, and I didn't touch the preset prompts.

**Jason's server on 4747 was left alone.** I never ran `npm run up` or `down`, `web/dist` and `.run/` were not touched, and I started no server on 4747. I used my own mock on :4972 and server on :4971, started by hand, with data, run dir and web dist in my scratchpad (`t20-triage/`) and `SST_MODELS_FILE=models.example.ini`. The users were `dev-t20-tri` and `dev-t20-pw`, in that scratch data dir only. I killed both pids at the end.

## Decisions

| Finding | Decision | What changed / why |
|---|---|---|
| **QA-1** (minor): `brain.update --compacts`, `message.add --as <compaction brain>` and a plain `turn` to a compaction brain move the cut without a word | **FIX** | **One helper set.** `cutAt` / `cutMove` and the `CutMoved` type moved from messages.ts to `compaction.ts`, which is dependency-free. The sentence moved to `cutMovedLine` in wording.ts. Both are re-exported to the web. `CutMoved` gained `before`, the number of messages left out, so every answer says how much went: "Every brain's request now starts at the compaction m_… (it started at m_…), and the 7 messages before it are left out (kept in the ledger)." **`brain.update`** compares the cut before and after, inside the same write. When the cut moves, it answers the brain plus `cutMoved`. With `--compacts` the CLI adds "Not what you meant? --no-compacts undoes it." **`message.add`** does the same, so a message in a compaction brain's mouth reports that it is the new compaction. **A `turn` to a compaction brain** is a compaction through the last message, the same as `message.compact` with no `--message`. Its `start` now carries `compact: {through}`, so the CLI's header reads `[Chronicler · compacting through m_…]` and its done line `[Chronicler · compaction through m_… · … in / … out]`. A `generation.follow` replays the same `start`. `message.delete` / `message.set-author` use the shared helpers, and their wording is unchanged apart from the count. |
| **QA-2** (nit): `prompt.size` says a line *below* the cut is "before the newest compaction" | **FIX** | The wording is now "counted before the newest compaction was written, so its next request is cut" (`lastCountLine`). **The wrinkle is fixed too.** `lastCount`'s `beforeCut` compares against the compaction's version in use, not its message's `createdAt`, so a compaction re-rolled at depth counts as written when its new version was. Unit test added. It was mutation-checked: going back to the message's `createdAt` fails it. |
| **QA-3** (nit): `{{count}}` counts a fresh take's Muse note to the Chronicler | **DISMISS** | This is by design.md's letter, and it is the simpler rule. The count is the messages the ledger shows, which the player can check by counting. Rolls, image prompts and Muse notes all count, and the code knows nothing about what is "story" (the ticket: "Nothing in the code should know what a character or a summary is"). An off-by-one in "The story so far, N messages" changes nothing a model does with the summary. design.md's count bullet now says it in one sentence. |
| **QA-4** (nit): a hand-edited image brain with `compacts: true` is listed as compacting | **FIX** | `brainLine`, `brain.list`'s line, and `conversation.get`'s brain line now use `isCompactor(b)`, the rule that is actually applied, instead of `b.compacts`. Checked by hand on a scratch file: Scene Painter with `compacts: true` shows no "compacts", and only the Chronicler does. |
| **QA-5** (nit): `web/src/api/types.ts` lags the server (`compacts` in `BrainFields`, `cutMoved` on results, `compacts` on `BrainInfo`) | **DEFER** to T20 Frontend | This is the Frontend pass's first job, as QA says. Noted under the ticket's "For Frontend", with the two results that now also carry `cutMoved`. I added only the re-exports the fixes created (`cutAt`, `type CutMoved`, `cutMovedLine`) and the `start.compact` comment. |
| **QA-6** (nit): two token estimates (diagnostics ~4 chars/token, `prompt.size` 4.4) | **FIX** | `diagnose.ts` now estimates with `CHARS_PER_TOKEN` / `TOKENS_PER_MESSAGE` from wording.ts. wording.ts is dependency-free, so diagnose.ts stays importable by the browser. Its line says "~4.4 chars a token, as prompt.size counts". The diagnostics still count text content only, so the two can differ by a tool schema's characters. Both say they are estimates. |
| **Outside T20**: `--password -` takes all of stdin, newlines included | **FIX** (small, clearly right) | A secret flag's `-` now reads **the first line** of stdin (`\n` or `\r\n`), as the no-terminal prompt already did. No one can type a password with a newline in it, at the hidden prompt or in the browser. `printf 'pw\npw\n' \| ./sst user.create … --password -` now sets `pw`, and `printf 'pw\n' \| ./sst auth.login … --password -` logs in. An empty stdin is still an empty password, unchanged. There is a test in `cli-args.test.ts`, and the AGENTS.md CLI bullet says it. |

## Tests

- `test/compaction.test.ts`:
  - **New e2e test (QA-1):**
    - `brain.update --compacts` on the GM after it spoke returns `cutMoved {from: null, to: <its line>, before: 7}`, with the undo hint.
    - A colour change says nothing, and `--no-compacts` says the whole ledger is back.
    - `message.add --as Chronicler` says it is the new compaction, and a player message says nothing.
    - `turn --brain Chronicler` prints "compacting through <the last message>" and "compaction through …", and an ordinary turn prints neither.
  - **Extended unit test (QA-2):** a compaction re-rolled at depth flags a count taken between its versions.
- `test/cli-args.test.ts`: `--password -` with `pw\npw\n`, with `\r\n`, and with empty stdin.

## Re-verification (scratch mock, QA's commands)

```
$ ./sst turn --content "I wait."
[Game Master · 1372 in / 35 out · $0.00045]
$ ./sst brain.update --brain "Game Master" --compacts
Updated brain Game Master (b_ey9tgy7ph5) · text · … · compacts · system prompt 4888 chars
Every brain's request now starts at the compaction m_1tccc5zxyp, and the 7 messages before it are left out (kept in the ledger). Not what you meant? --no-compacts undoes it.
$ ./sst brain.update --brain "Game Master" --no-compacts
Updated brain Game Master … · system prompt 4888 chars
No compaction is left, so every brain's request holds the whole ledger again.
$ ./sst message.add --as Chronicler --content "A summary."
Added m_vocay7du0j (in Chronicler's mouth). Every brain sees it from the next request.
Every brain's request now starts at the compaction m_vocay7du0j, and the 8 messages before it are left out (kept in the ledger).
$ ./sst turn --brain Chronicler --content "x"
[Chronicler · compacting through m_ex8vk2tiro · in "Harbor"]
MOCK reply to brain "You keep the record of a one-p"; saw 5 messages; …
[Chronicler · compaction through m_ex8vk2tiro · 1221 in / 35 out · $0.00041]
$ ./sst prompt.size | grep "Game Master"
Game Master   1,372 in · m_1tccc5zxyp, 3 messages ago · counted before the newest compaction was written, so its next request is cut  ~1,261 of 1,000,000
```

The acceptance bullets were re-run on a fresh preset conversation with a sheet that made Character 1. Each `cmp` compares `prompt.preview … --json | jq -S .body` with the mock's newest `/chat/completions` body.

```
== middle compaction: preview == send                     identical
== Character 1's view: cut {before: 5}; its sheet pinned at index 2 (from before the cut);
   system, World Bible, Character Creator (sheet), Chronicler, Game Master, the user, Game Master, System reminder
== the later messages stay verbatim after the compaction (G2, P3, G3)
== second compaction, through the last: starts at the first as the Chronicler's own assistant words   identical
== GM turn after the cut: preview == send                  identical
== delete the newest:  "… now starts at the compaction m_6i4r06pb21 (it started at m_4xiqmj8t3p), and the 5 messages before it are left out"
   delete the first:   "No compaction is left, so every brain's request holds the whole ledger again."   → cut null, 13 messages
== printf 'pw\npw\n' | user.create --password -, then printf 'pw\n' | auth.login --password -   → "Logged in as dev-t20-pw (encrypted)."
== Scene Painter hand-edited to compacts: true → brain.list and conversation.get show "compacts" for the Chronicler only
```

## Docs

- **design.md, "Compaction":**
  - every command that moves the cut says so: `cutMoved {from, to, before}` / `cutMovedLine`, now on `message.add` and `brain.update` too, and why;
  - a turn to a compaction brain carries `start.compact`;
  - `{{count}}` counts every message the ledger shows, Muse notes included (QA-3);
  - `beforeCut` uses the compaction's version in use;
  - the diagnostics share the estimate.
- **design.md, the T20 command list:** these changes.
- **AGENTS.md:** a secret's `-` reads stdin's first line.
