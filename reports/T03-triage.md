# T03 triage: steered regeneration, versions, edit and delete (CP2)

**Fixed 4, deferred 1, dismissed 1.** The most important fix is QA-1. A generation now reads the conversation through the same per-conversation queue that ledger edits use, after taking its lock. So the 409 rule really holds: no delete can throw away a full, billed reply, and no edit can be answered with the old text. T04 and T05 add more generating paths (per-brain sends, image saves), so the pattern is now written down in design.md, AGENTS.md and the T04 ticket.

QA-2 changes what a stop means. A stop now saves waiting, not money, and the app says so. The server keeps reading a stopped reply quietly in the background and records what Venice really billed. Checked live: it recorded $0.0004902 against a balance drop of $0.00049020.

No design concern. Every change fits the design, and design.md records each one.

## Decisions

| Finding | Decision | What changed / why |
|---|---|---|
| **QA-1** · minor · the ledger-edit 409 has a ms-wide hole (a delete loses a billed reply, an edit gets answered with old text) | **FIX** (structural) | `GenerationHandle.load()` (`src/conversations/store.ts`) reads the conversation through its write queue, and `turn` and `message.regenerate` use it after `beginGeneration` instead of a bare `loadConversation`. The idle check already runs inside the queue (`assertLedgerIdle` in `mutateConversation`). So an edit whose check passed just before the lock finishes writing before the generation reads, and every later edit sees the lock. `conversation.delete`'s busy check moved inside the queue too, for the same reason. Regression test: `test/store.test.ts` holds an edit open after its check, then takes the lock. It asserts that the read waits for the edit and sees it, and that a later edit gets the 409. It fails on the old read (checked) and passes now. QA's scripts: 0/90 and then 0/150 lost replies (3/90 before), and 0/87 and then 0/146 stale turns (8/88 before). |
| **QA-2** · minor · the conversation's cost under-reports (a stopped reply is billed in full but recorded as $0, and deleting removes cost) | **FIX** | **Stop:** a stop no longer cancels the Venice request. `relayReply(events, stopSignal)` stops relaying at once and returns what had arrived plus the unread `rest` of the stream. The generation saves the partial text and frees its lock exactly as before. A detached drain (`drainStopped`, `src/commands/chat.ts`, on its own `forkVault` key copy) then reads the rest, discards the text, and puts Venice's final `usage`/`cost.usd` on the stopped version and on the running total. This covers a stop mid-reply, a stop during reasoning only, and a stop before Venice answered (the drain picks the request up once it answers). A stop before anything was sent still sends nothing. `release()` aborts the Venice request only when a stop didn't hand it on (`keepUpstream`), so a failed turn still never leaves a connection open. **Total:** a new `conversation.spentUsd` only grows: each save adds its cost (`addSpend`), the drain adds a stopped reply's, and `message.delete` pins the total before the message goes. Older files without it fall back to summing their versions, and the first save or delete pins it. The CLI header, `conversation.list` and the web header (`conversationCost`) all show it. **Copy:** `generation.stop` returns `note`, the one sentence "Stopping saves waiting, not money: Venice still writes and bills the whole reply, so its cost is added to the conversation once Venice reports it." The CLI prints it, the `done` note and the help text say the same, design.md records the rule and fixes the "about the full `max_tokens`" wording with QA's measurement, and the T03 frontend scope asks for the server's sentence on the Stop button. Tests: the drained cost equals the mock's charge for a stopped turn, a stopped regenerate (on the new version) and a stop during reasoning only, and the total survives deleting every message. |
| **QA-3** · minor · a blank or placeholder-less steer template silently drops the steer | **FIX** | Each template must keep the placeholder its text goes into: `{{content}}` for player and other-brain text, `{{prompt}}` for other-brain image, `{{instruction}}` for steer. `conversation.update` refuses one without it, with a message saying what would go missing ("The steer template has no {{instruction}}, so your steer would be left out of the request. Put {{instruction}} back in the template, where the text should go."). `buildRequest` refuses to *use* one (`bad_template`, 400, nothing sent), which covers files written before the check. So a template can't drop text silently, now or in T04/T05. I chose a refusal over QA's "notes" idea: a note only shows if you open the preview, and the steer would still have been dropped. Tests: pure (all four templates, blank, whitespace-only, fixed text) and CLI end to end (update refused and nothing changed; a hand-broken file refuses the preview and the regenerate with nothing sent upstream, while a plain re-roll still works). |
| **QA-4** · nit · the re-roll refusal gives the wrong reason when the reply is the only message | **FIX** | `planRegenerate` replaces the refusal only when the body really ends with the brain's own `assistant` message. A lone reply now gets `nothingToAnswer`'s "the request would hold only its system prompt. Write a message for it first." Pure test added. |
| Engineer's open question · no way to delete a single version | **DISMISS** | As QA showed (330 oracle steps, a 41-version chain), a version reaches a prompt only while it is active, so an unwanted one is clutter in the pager, not stale text, and Jason can select away from it. If it is ever added: `steeredFrom` is an index, so it needs renumbering (or version ids). Deleting a version's cost from the total is no longer a concern, since `spentUsd` keeps it. |
| QA "Outside this ticket" · `./sst generation.follow --json \| head -3` crashes with an `EPIPE` stack trace | **DEFER → T07** | Real but harmless (no user content), it predates T03, and it is CLI polish. Logged under T07 **Deferred in**. |

## Other changes

- **T04 ticket:** a "From T03 triage" bullet says that "brain delete, not while generating" must check the lock inside `mutateConversation`, and that generating commands read through `gen.load()`.
- **AGENTS.md:** two lessons (the lock/read pattern, and the stop → drain → cost path, with how to test it), plus the `generation.stop` line under "Running it".
- **design.md:** `spentUsd` and the cost rules (clones and imports in T07 start at 0), the required template placeholders, "The lock and the read must agree", the new stop semantics and its sentence, QA's live billing measurement, and the `generation.stop` result's `note`.

## Re-verification (mock, `npm run up:mock`, current code)

Each finding was first reproduced on the unchanged code with QA's own commands. These are the same commands after the fix:

```
# QA-1: QA's race.mjs / race-edit.mjs, 90 rounds each (before: 3 conflicts / 8 stale turns), then 150 rounds
{ 'delete 200 / regen 400  not_a_brain_message': 90 }
87 times both succeeded; 0 of those turns sent the pre-edit text
{ 'delete 200 / regen 400  not_a_brain_message': 149, 'delete 409 / regen 200 done ': 1 }   # either order is consistent now
146 times both succeeded; 0 of those turns sent the pre-edit text

# QA-2, delete (before: $0.00011 → $0)
qa-repro (c_qxdgdnm3w4) · deepseek-v4-1-flash · 2 messages · $0.00011
Deleted m_n0blvojard. 1 message left.
qa-repro (c_qxdgdnm3w4) · deepseek-v4-1-flash · 1 messages · $0.00011

# QA-2, stop (before: the mock charged $0.00063, recorded null)
$ ./sst turn --conversation $C --content "MOCK_SLOW MOCK_MARKDOWN go" &  sleep 1.2; ./sst generation.stop --conversation $C
Stopped. What had arrived is saved: m_zw42ybg6rt, version 1/1.
Stopping saves waiting, not money: Venice still writes and bills the whole reply, so its cost is added to the conversation once Venice reports it.
mock charged: 0.00062880
{"spentUsd":0,"v":{"stopped":true,"costUsd":null,"chars":20}}                  # right after the stop
{"spentUsd":0.0006288,"v":{"stopped":true,"costUsd":0.0006288,"usage":{"promptTokens":16,"completionTokens":520},"chars":20}}   # after the drain
# QA's late-stop.mjs (stop after the last word, before usage): all 6 stopped versions got their cost; spentUsd = their sum
# stop before Venice answers (mock SIGSTOPped): "Stopped before the reply started. Nothing was saved." + the note;
#   the lock was free at once, and after SIGCONT the drained $0.0000297 reached spentUsd (no version to attach it to)
# encrypted user: the drained cost is recorded, the file is still SSENC1, 0 hits for the title/message phrases under
#   data/users/dev-t03-tri-enc and .run/server.log, and 0 ERROR lines

# QA-3 (before: the steer silently became "" / "Rewrite it.")
$ ./sst conversation.update --id $C --templates.steer ""
error: Invalid arguments for conversation.update: templates.steer: The steer template has no {{instruction}}, so your steer would be left out of the request. Put {{instruction}} back in the template, where the text should go.
$ ./sst conversation.update --id $C --templates.steer "Rewrite it."      → same error, exit 1; the template is unchanged

# QA-4 (before: "...would end with Assistant's own earlier reply...")
$ ./sst message.regenerate --conversation $C          # the ledger is one lone reply
error: There is nothing for Assistant to answer yet: the request would hold only its system prompt. Write a message for it first.
```

**Acceptance bullets, rerun:**
```
preview == sent (Say it's blue.): IDENTICAL
preview == sent (No, say it's green.): IDENTICAL
next turn: roles [system,user,assistant,user]; any non-assistant message mentions Behind-the-scenes|blue|green: false;
           the assistant message is the active version (version 3)
edit 3 turns back + 2 turns back → next preview: ["<!-- from: the user -->\nTurn two, EDITED.","EDITED answer."]
regenerate a non-last message → "Only the last message can be regenerated, and m_eg9vkvve1h is not the last one (m_z65hp3kize is). To change an earlier message, edit it."  exit 1
```

**Live, once** (`npm run up`, user `dev-t03-tri-live`, `deepseek-v4-1-flash`, `max_tokens` 400): "Count from 1 to 150 in words", stopped after 1.5 s.
```
{"spentUsd":0,"v":{"stopped":true,"costUsd":null,"chars":483}}               # right after the stop
drain done after ~3s
{"spentUsd":0.0004902,"v":{"stopped":true,"costUsd":0.0004902,"usage":{"promptTokens":34,"completionTokens":400},...,"chars":483}}
balance 8.00548847 -> 8.00499827 = drop 0.00049020                            # recorded == billed, to the cent
```
About 120 tokens had arrived, and Venice billed all 400. That confirms QA-2 and shows the drain records exactly what was billed.

`npm run typecheck` is clean (server, CLI, tests, web). `npm test`: 83 pass (78 before: +1 store, +2 prompt, +2 regenerate).

## Live spend

1 live text call, no images. Balance **$8.00548847 → $8.00499827** (−$0.00049).

## Housekeeping

Triage users: `dev-t03-tri` (plain), `dev-t03-tri-enc` and `dev-t03-tri-live`. QA's users are untouched. The server is stopped (`npm run down`).
