# T08 triage: hidden notes

**Result:** fixed 5, deferred 0, dismissed 0. No DESIGN CONCERN.

The most important fix is that the hidden-note rule now leans to hiding. QA-1 and QA-2 were the same disease: a scanner that follows Markdown faithfully also spills the way Markdown does whenever a model writes a note carelessly. The rule in `src/conversations/hidden.ts` now promises more than Markdown does: **whatever remark + GFM would parse as a `hidden` code block, `splitHidden` hides too.** A scratch fuzzer checked this against the web's own parser. The old rule missed 1,465 of 20,000 random texts. The new one missed none of 190,000. The rule also got simpler: it no longer tracks other code blocks or containers.

`npm run typecheck` is clean, and `npm test` passes 163/163 (161 before, plus 2 new rule tests).

## Decisions

| Finding | Decision | What changed / why |
|---|---|---|
| **QA-1** · minor · the scanner shows a note in 4 shapes that Markdown hides (a tab-indented list body, an indented fence before a note, a footnote, lone `\r`) | **FIX** | **Tabs** count to the next multiple of 4. **Lone `\r`** ends a line, in the scanner and in the stream folder's hold-back. **Footnote labels** (`[^1]:`) are an opener prefix, and `couldOpenHidden` holds a partial `[^1` so a split fence can't flash. **The indented fence** stopped mattering, because the scanner no longer tracks other code blocks at all (see QA-2). |
| **QA-2** · minor · a careless note spills: its container ends mid-note, or its label has a backtick | **FIX** (QA's policy, plus one step further) | **Containers never end a note.** Once a hidden opener is seen, the note runs to its closing fence or to the end of the message. A closing line may carry up to as many quote markers as the opener had, or none (lazy). **Backticks are allowed in the label.** **Further: a ```` ```hidden ```` line opens a note even inside another code block**, because the scanner doesn't track other code blocks. QA's two shapes weren't the only ones where a mis-tracked fence swallowed a note: a stray `~~~` used as a scene break, or a code block the model forgot to close, swallowed every note after it, in both clients (`"The door closes.\n\n~~~\n\nLater.\n```hidden\nSECRET\n```"` showed `SECRET`). The cost: an example of the convention inside a code block now folds too. That costs one click, and it's rare. |
| **QA-3** · nit · a reasoning-on brain's reasoning streams in full to stderr; the browser collapses it | **FIX** (here, not deferred) | `printStream` now prints `[Reasoning, folded: --reveal streams it; conversation.get --json has it]` once, in place of the reasoning. `--reveal` streams it as before. This matches the browser (collapsed) and `conversation.get`, which shows only `reasoning N chars (--json)`. It is cheap (one branch), and T10 needs it: a Character Actor that reasons over a sheet will reason about its secrets in plain words, and Jason wants to "think hard" there. Deferring would have left T10's live acceptance (step 3) spilling the sheet onto the screen. |
| **QA-4** · nit · per-command help doesn't mention the fold; `turn … > reply.md` saves a folded reply | **FIX** (wording only) | `turn`, `conversation.get` and `message.get` say that notes fold and that `--reveal` shows them. `turn` also says the same of reasoning. The reply-to-file example is now `… --reveal > reply.md   # --reveal: notes unfolded`. |
| **QA-5** · nit · the frontend recipe never shows the label, even once the note is opened | **FIX** (in the recipe; the frontend pass builds it) | design.md's browser recipe and TICKETS.md's "From T08 triage" now say: show `block.label` as a caption on the opened note, as `--reveal` does in the terminal. The fold itself still never shows it. |

## The rule, before and after

| | Engineer's rule (Markdown-faithful) | Now |
|---|---|---|
| Opens | a fence + `hidden` after quote/list markers, **not inside another code block**, no backtick in the info | the same, plus footnote labels; **anywhere** (other code blocks aren't tracked); backticks in the label are fine |
| Closes | same char, ≥ len, ≤ fence indent + 3, **inside the opener's containers** | same char, ≥ len. Indented ≤ max(3, fence column), or ≤ fence column + 3 when a list marker starts the opening line. That is never further than Markdown allows, so a note never ends before Markdown's block would. Up to as many quote markers as the opener had, or none. |
| Unclosed | to the end of the message **or of its quote/list item** | to the end of the message |
| Lines | `\n`, `\r\n` | `\n`, `\r\n`, `\r`; tabs count to multiples of 4 |

Openers are liberal and closers are strict on purpose. A missed opener or an early close spills. A spurious opener or a late close only over-hides. I found the closing indent bound while fuzzing. QA's suggestion (and the engineer's code) allowed a closer up to 3 columns past the fence. With an opener indented 1-3 columns, that closes before Markdown does: `"   ```hidden\nA\n    ```\nSECRET\n```"` showed `SECRET`. Markdown's container column is at least `col − 3` and at least 0, so `max(3, col)` is the tightest bound that's always safe. After a list marker, Markdown's column is exactly `col`, so `col + 3` is safe there, and it keeps `- ```hidden` / `\t```` closing (QA-1 case 1).

The API is unchanged. `block.open` is now always `!closed`, and both fields are kept.

## Tests

`test/hidden.test.ts`:
- **New:** "a quote or list item that ends doesn't end its note" (QA-2's shapes, the tab case, an unclosed note in a quote and in a list, and a closer with more quote markers than the opener).
- **New:** "a note opens anywhere a line starts with its fence" (a `~~~` scene break, an indented fence, an unclosed code block, an example inside ```` ````md ````, a backtick label, an 8-space opener).
- **Added to existing tests:** a footnote; a lone `\r`; the closer bound (`   ```hidden` … `    ```` stays open; `10. ` and nested list continuations still close).
- **Changed:** "what isn't a note" lost its two inside-a-code-block cases. They are notes now, on purpose.
- **Streaming corpus:** gained QA-1's and QA-2's eight shapes, each with a secret. Every one goes through the folder at every cut, one character at a time and on 200 random splits. The check now also asserts that the final output holds no secret, not just the output mid-stream.
- **Mutation check:** with the old `hidden.ts` restored, 7 of the 19 tests fail.

`test/chat.test.ts` and `test/e2e.test.ts` now expect the folded reasoning line, and the reasoning text with `--reveal`.

**The fuzzer** is a scratch script, not committed: it needs `web/node_modules`. AGENTS.md has a lesson on how to rebuild it. It generates random lines from fences, prefixes (`> `, `- `, `10. `, `[^1]: `, tabs, 4+ spaces), blank lines and unique tokens, with `\n` / `\r\n` / `\r` endings. It checks three things:
1. No token inside a remark `code` node whose lang is `hidden` lands in a `splitHidden` text part.
2. The stream folder on random cuts never prints a hidden token.
3. The folder's joined output equals `foldHidden`.

| Rule | Texts | Markdown misses | Mid-stream leaks | Fold mismatches |
|---|---|---|---|---|
| Old rule, general generator | 20,000 | 1,465 | 0 | 0 |
| Old rule, indentation-heavy generator | 5,000 | 278 | 0 | 0 |
| New rule, general generator (5 seeds) | 100,000 | 0 | 0 | 0 |
| New rule, indentation-heavy generator (3 seeds) | 90,000 | 0 | 0 | 0 |

## Re-verification (`npm run up:mock`, user `dev-t08-triage`, plaintext, now deleted)

QA's CLI repros, plus the scene break, each added with `message.add --as player --content @file`:
```
$ ./ss conversation.get --id $C
── you · m_kj1e5bvl0m ──            (tab.md: "- ```hidden" / "\tSECRET-TAB …" / "\t```" / "After the tab note.")
- [Hidden · 1 line]
After the tab note.
── you · m_5catsxmc7r ──            (indent.md)
    ```

[Hidden · 1 line]
── you · m_fad3nchrbs ──            (lazy.md)
Plans:
- [Hidden · 1 line]
- The tavern is loud.
── you · m_1fw2c741cs ──            (tick.md)
[Hidden · 1 line]
The figure waits.
── you · m_7pf6xp1px5 ──            (foot.md)
Text[^1]

[^1]: [Hidden · 1 line]
── you · m_2f22e5le1n ──            (cr.md, lone \r endings)
[Hidden · 1 line]⏎shown⏎
── you · m_i4xvh2okay ──            (break.md)
The door closes.

~~~

Later.
[Hidden · 1 line]

(7 hidden notes folded: ./ss conversation.get --id c_5uperxhnl0 --reveal shows them; --json has the raw text.)
secret count in folded view: 0 · with --reveal: 7
```

Acceptance, quickly:
```
$ ./ss turn --conversation $C --content "Who is the hooded figure? MOCK_HIDDEN"        exit 0
MOCK reply to brain "You are the Game Master."; saw 2 messages; …
[Hidden · 5 lines]
The hooded figure slides a folded map across the table.
(1 hidden note folded: ./ss message.get --conversation c_fnymomyet1 --message m_1qd6kg1hgc --reveal shows it; …)
secrets in stdout+stderr: 0
conversation.get / --reveal / --json: MOCK_SECRET 0 / 1 / 1 times
prompt.preview --brain "Character Creator": "<!-- from: Assistant -->" + the GM's message, verbatim (diff with get --json: equal)
```

The reasoning fold (QA-3):
```
$ ./ss brain.update --conversation $C --brain "Character Creator" --reasoning.enabled
$ ./ss turn --conversation $C --brain "Character Creator" --content MOCK_HIDDEN_ONLY
[Hidden · 6 lines]                                                           (stdout)
[Character Creator]                                                          (stderr)
[Reasoning, folded: --reveal streams it; conversation.get --json has it]
[Character Creator · 170 in / 120 out · $0.00019]
(1 hidden note folded: …)
$ ./ss message.regenerate --conversation $C --reveal                         (stderr)
[Character Creator]
MOCK reasoning (effort: low) over 4 messages.
```

`./ss help turn` now shows `Hidden notes and reasoning fold to one line each; --reveal shows them` and the `--reveal > reply.md` example.

There were no live calls. The server and the mock are stopped.

## Docs

- **design.md, "Hidden notes":** the rule is rewritten (more eager to hide, its guarantee, why other code blocks aren't tracked, the closing indent bound). Also: reasoning folds in the terminal; the browser recipe shows the label once a note is opened; and the stream contract's "reasoning to stderr" line.
- **TICKETS.md:** T08's status is `frontend`. A "From T08 triage" block covers the rule's three behaviour changes for the browser, a harmless rendering wrinkle (an example inside a ```` ````md ```` block cuts that block in two), the label caption, reasoning, and a note for T10.
- **AGENTS.md:** the `turn` line, and a lesson on how to fuzz the rule against remark.
- **README:** a sentence saying that reasoning folds like notes.
