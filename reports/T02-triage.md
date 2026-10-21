# T02 triage: basic streaming chat (CP1)

**Fixed 7, deferred 1, dismissed 0.** The most important fix is QA-2: a client that left before the first stream event kept the conversation locked (409) until the server restarted, and the reply was never generated. Now the stream work never waits on the client.

No live calls (spend $0.00). The new default sends exactly the body QA already measured live with reasoning off (17 prompt tokens for 13 of ours plus the template).

## Decisions

| Finding | Decision | What changed / why |
|---|---|---|
| **QA-1** · major (design) · reasoning on adds ~25 hidden prompt tokens | **FIX** (orchestrator's decision, 93c1b93) | `newBrain` now defaults to `reasoning: {enabled: false, effort: "low"}`. The sentence "Reasoning on: the provider adds a small hidden instruction we can't see or edit." is `REASONING_NOTE` in `prompt.ts`. `prompt.preview` now returns `notes: string[]` and carries the sentence whenever the request really turns reasoning on: the brain's toggle is on **and** the model can reason. On a model that can't reason, the toggle sends nothing, so the note would be false. The CLI preview prints it as a `Note:` line right under the header. `brain.update` prints it when reasoning ends up on, and the help for `conversation.create`, `brain.update` and `--reasoning.enabled` says that on is an opt-in. Existing files keep what they have (no migration, as instructed). |
| **QA-2** · major · early client disconnect locks the conversation forever | **FIX** (structural) | `src/server/app.ts`: the stream adapter **queues writes and never awaits them**. Once the request's `signal` reports the client gone (already, or later), it stops writing and aborts the response stream, so nothing piles up. The cause: when the socket has closed before the response starts, @hono/node-server never reads or cancels the body. An awaited `s.write()` then blocked forever, with the generator parked at its first `yield`, holding the 409 lock and the request's vault key. A smaller patch (racing each write against the signal) would still tie the work to the socket. Now the generator runs to the end whatever the client does, so `finally` always releases the lock and closes the key. Regression test: `test/e2e.test.ts` "a client that leaves before the first event doesn't park the work". It uses real HTTP, `req.destroy()` while the command waits, and asserts that the generator ran to the end. It fails ("parked") on the old adapter and passes now. |
| **QA-3** · minor · a system-only body is sent, and live the model continues the prompt | **FIX** | New `nothingToAnswer(body)` in `prompt.ts`: a body must end with a `user` or `tool` message. A body that is only the system prompt now gets its own message: "There is nothing for Assistant to answer yet: the request would hold only its system prompt. Send a message with --content." Tests: pure (`prompt.test.ts`) and CLI end to end (`chat.test.ts`, nothing goes upstream, and the preview shows the note). |
| **QA-4** · minor · one unreadable file breaks `conversation.list` | **FIX** | `listConversations` uses `Promise.allSettled` plus a minimal shape check. The result is `{conversations, unreadable: [{id, error}]}`, where `error` is our own content-free text ("not valid JSON", "expected an encrypted file, found plaintext", "not a conversation document (fields are missing)"). A closed vault (`session_ended`) still fails the whole list, and a file deleted mid-list is skipped. The CLI prints an "Unreadable conversation files" block under the table. Test in `chat.test.ts`. |
| **QA-5** · minor · the refusal lives only in `planTurn`, and a blank steer is silently dropped | **FIX** (structural) | (1) `reviewBody(brain, body, model)` in `turn.ts` is the one place a plan gets its `refusal` and `notes`. `planTurn` uses it, and the T03 ticket now says `planRegenerate` must too. (2) `openChatStream` calls a new `assertAnswerable(body)` next to `assertSendable`, so even a plan that forgets can't send such a body. (3) `buildRequest` throws `bad_request` on a blank `steer` instead of dropping it. T03 should trim the user's `--steer` and treat blank as no steer (noted on T03). Tests: pure, plus `venice-chat.test.ts` (the send path refuses with nothing sent). |
| **QA-6** · minor · live, `max_tokens` counts reasoning, so a reply can be empty | **FIX** (cheap) | The mock now spends `max_tokens` on reasoning words first, then content, as live, so the empty reply is reproducible for free (mock test and CLI test). The empty reply **is saved as it came**: it was paid for, its reasoning is worth seeing, and T03's regenerate and delete can replace it. Dropping it would also break the "the reply finishes and is saved" contract. The `done` note now says `cut off by max_tokens while reasoning: no reply text` (or `no reply text` with no cut). Defaulting reasoning to off makes this rare. The T02 frontend scope now asks for an explicit "no reply text" bubble. |
| **QA-7** · nit · `relayReply` merges parallel tool-call arguments | **DEFER → T05** | Unreachable in T02: `turn` refuses image brains, and text brains have no tools. What a second call should mean (keep the first, or one image per call) is a T05 product decision, and T05 reworks `tool_args` streaming anyway. Logged under T05 **Deferred in**, with a caution not to send `parallel_tool_calls` until a live call shows Venice honours it. |
| **QA-8** · nit · broken-stream errors don't say what happened or what to do | **FIX** (cheap) | When Venice drops mid-reply, the `turn` error now ends with "Your message is saved; the reply isn't. To retry, run turn again without --content." (or "No reply was saved." for a no-content turn). The CLI turns undici's bare `terminated` into "lost the connection to the server mid-stream (did it restart?). Check what was saved with ./sst conversation.get." Both are a few lines, and the first one helps the web chat view too. |

## Design concern

None. All the changes fit the design. design.md now records:
- the reasoning implementation;
- the `user`/`tool` ending rule, and that both the plans and the send path check it;
- `reviewBody`;
- the "never wait on the client" rule in the HTTP contract;
- the new `conversation.list` and `prompt.preview` result shapes;
- that blank steers are refused;
- that empty replies are saved with a note;
- the mock's reasoning-first `max_tokens` budget.

## Re-verification (mock, `npm run up:mock`, current code)

QA's own commands, rerun. QA-2 was reproduced on the old code first: the player message was saved, with no reply, and `turn` and `conversation.delete` both gave "is busy".

```
$ # QA-2, after the fix: CLI killed 1 s in while the mock is SIGSTOPped
$ kill -STOP $MP; ./sst turn --conversation $C --content "early bye" & sleep 1; kill %1; kill -CONT $MP; sleep 3
$ ./sst conversation.get --id $C
── you · m_obw6ma3m3c ──  early bye
── Assistant · m_nzsqgid09o · $0.000044 ──  MOCK reply to brain "Sys."; saw 2 messages; ...
$ ./sst turn --conversation $C --content again        → exit 0
$ ./sst conversation.delete --id $C                    → Deleted.
  (same with curl --max-time 1, curl exit 28; same for an encrypted user, the file is SSENC1 and decrypts;
   a disconnect 1.2 s into a MOCK_SLOW reply still gets 409 while running, then saves, then the lock is free)

$ # QA-1
$ ./sst conversation.create --title qa1 --system-prompt "You are terse."; ./sst conversation.get --id $C | sed -n 2p
Brains: Assistant (default) [b_qj34mh6gdb, text, reasoning off]
$ ./sst prompt.preview --conversation $C --content Hi | head -2      → no note, "reasoning_effort":"none"
$ ./sst brain.update --conversation $C --reasoning.enabled
Updated brain Assistant (b_qj34mh6gdb) · reasoning low · final reminder off · system prompt 14 chars
Reasoning on: the provider adds a small hidden instruction we can't see or edit.
$ ./sst prompt.preview --conversation $C --content Hi | head -2
Exact request for brain "Assistant" (b_qj34mh6gdb): POST /chat/completions
Note: Reasoning on: the provider adds a small hidden instruction we can't see or edit.
$ ./sst prompt.preview --conversation $C --content Hi --json | jq -c '{notes, effort: .body.reasoning_effort}'
{"notes":["Reasoning on: the provider adds a small hidden instruction we can't see or edit."],"effort":"low"}

$ # QA-3
$ ./sst turn --conversation $I
error: There is nothing for Assistant to answer yet: the request would hold only its system prompt. Send a message with --content.   [exit 1, nothing upstream]

$ # QA-4 (a truncated file plus a partial {"id","title"} doc)
$ ./sst conversation.list
ID            TITLE    MESSAGES  COST  MODEL                UPDATED
c_tkgv6nreta  sysonly  0         $0    deepseek-v4-1-flash  2026-10-14 06:54:21
...
Unreadable conversation files (2):
  c_corrupt01: not valid JSON
  c_partial01: not a conversation document (fields are missing)        [exit 0]

$ # QA-6 (max_tokens 5, reasoning on)
$ ./sst turn --conversation $D --content Hi
MOCK reasoning (effort: low) over
[Assistant · 11 in / 9 out · $0.000014 · cut off by max_tokens while reasoning: no reply text]
saved: {"content":"","finishReason":"length","reasoning":"MOCK reasoning (effort: low) over "}

$ # QA-8
$ ./sst turn --conversation $D --content "MOCK_MIDSTREAM_ERROR halfway"
error: The Venice stream broke off (UND_ERR_SOCKET). Your message is saved; the reply isn't. To retry, run turn again without --content.
$ # npm run up:mock during a MOCK_SLOW turn:
error: lost the connection to the server mid-stream (did it restart?). Check what was saved with ./sst conversation.get.   (no .tmp files left)

$ # Acceptance: 3 turns stream and save; the preview equals the send byte for byte; the ledger is complete
$ ./sst turn ... x3  → saw 2 / 4 / 6 messages, each with an "[Assistant · N in / M out · $…]" note
$ cmp preview.json sent.json && echo IDENTICAL        (content: 'Fourth: {{brain}} $& and "quotes"')
IDENTICAL
$ ./sst conversation.get --id $C --json | jq -r '[.messages[].author.type] | join(" ")'
player brain player brain player brain
```

`npm run typecheck` is clean (server, CLI, tests, web). `npm test` passes **68/68**, up from 60. New tests:
- the early disconnect;
- a system-only body, refused both end to end and pure;
- the send path refusing an unanswerable body;
- a blank steer;
- the reasoning note, shown only when the request reasons;
- the default reasoning off, plus opt-in, in the three-turn test, which still proves that reasoning is never sent back;
- `conversation.list` with bad files;
- the mock's reasoning-first budget;
- the empty-reply note;
- the mid-stream retry hint.

## Notes for the frontend pass

These are also written into T02's frontend scope in TICKETS.md.
- `conversation.list` → `{conversations, unreadable}`. Show unreadable rows with their reason.
- A brain reply can have `content: ""`. Render an explicit "no reply text" state.
- Reloading mid-reply is safe: the server finishes and saves the reply. To test "reload before the first token", `kill -STOP $(cat .run/mock.pid)`, reload, then `kill -CONT`.
- An empty composer in a fresh conversation gets a 400 `nothing_to_answer`. Show its message inline.

## Housekeeping

The server is stopped at the end of this pass. I removed my users `dev-t02-triage` and `dev-t02-triage-enc`. `qa-t02-live`, QA's QA-1 evidence, is left in place and can be wiped freely.
