# T03 QA report: steered regeneration, versions, edit and delete (CP2)

**Verdict: acceptance passes. CP2's promise holds: 0 blockers, 0 majors, 3 minors, 1 nit.** No design concern.

Across about 330 randomized steps and a 40-round steer chain, every later prompt matched an independent rebuild of design.md's assembly rules exactly, and no steer appeared anywhere except in its own request. The minors are about edges: a ms-wide edit-lock race, a conversation cost that under-reports what Venice charged (now confirmed live), and a steer template that can silently drop the steer.

## How I tested

- **An independent oracle.** `chaos.mjs` (scratchpad, not committed) rebuilds the request body from `conversation.get` using only design.md's rules (system, setup, ledger by active version, reminder, steer last; a re-roll leaves the message out). It drives random chains through the same `POST /api/<cmd>` path the CLI uses: turns, empty turns, steers (padded, unicode, `{{brain}} $& $1`, `</think>`, fake `<!-- from: -->` framing), blank steers, re-rolls, select-version, edits and deletes at any depth (biased toward the last message's neighbours), stops after 0-3 deltas, and stops before Venice answers (mock `SIGSTOP`). Every step checks:
  1. `prompt.preview` equals the oracle, message by message;
  2. the body the mock received (`/_mock/requests`) deep-equals the preview;
  3. a refused request sends nothing upstream;
  4. the saved content equals the streamed deltas, `done.message` equals what is on disk, and `generation.stop`'s message equals `done.message`;
  5. no steer token appears in any non-assistant message except the current request's own final steer;
  6. after every step, the *next turn's* preview equals the oracle and carries no old steer.

  The runs were seeds 7, 11 and 23 (plain); seeds 5 and 99 (plain, reminder on); and seed 314 (encrypted, reminder on). **330 steps, 0 failures.**
- **A long chain** (`long-chain.mjs`) runs 40 rounds of "select a random version, then steer it" on one message (41 versions). Each sent body is exactly `[system, player, <selected version>, steer(this round)]`, and `steeredFrom` equals the selected index. The final next-turn prompt is `system,user,assistant,user`, its assistant text equals the active version, and no token appears outside it.
- Hand walks with `./ss` for every acceptance bullet and the edges below, plus race scripts, a restart mid-regenerate, an encrypted user, and a small live pass.

## Acceptance checklist

| Bullet | Result | Evidence |
|---|---|---|
| Green/blue/green: regenerate with "say it's blue", then "say it's green"; next `prompt.preview` shows no trace of either steer | **pass** | `c_syofn8zqlk`: preview == sent (cmp) for both steers. The green request's last two messages are version 2 (blue), then only the green steer. The next-turn preview is `[system, "What color is a lime?", <version 3 text>, "Why?"]`; the turn sent it byte for byte. Live (`qa-t03-live`, `c_rq3ldzc0le`): "Yellow" → steer "Say it's purple." → "Purple" (63 prompt tokens). The next turn sent `[system, question, "Purple", "Are you sure?"]` = 40 prompt tokens, so the steer wasn't carried forward. |
| Edit a user message 3 turns back and an assistant message 2 turns back; next preview shows the edits | **pass** | `c_grkyg9czs8` (four turns): edited "Turn two." and the reply to "Turn three.". The preview shows both edited texts in place, and the turn sent exactly the preview. A blank edit is refused, and an unknown id is a 404 with a clear message. |
| Regenerating a message that isn't the last one is rejected with a clear error | **pass** | "Only the last message can be regenerated, and m_du2hdxcghi is not the last one (m_ywicad914q is). To change an earlier message, edit it." (exit 1, nothing sent). Same for the preview. Deleting the four later messages made that message regenerable, and its version 2 was added. |

## Adversarial results that passed

- **Deleting next to the regenerated message.**
  - Deleting the player message just before the last reply leaves two replies in a row. A re-roll is then refused before anything is sent, and a steer works: `[…, A, A, steer]`, preview == sent.
  - Deleting the reply before that makes a re-roll legal again, and its body ends at the previous player message.
  - Deleting down to a lone reply: steering it sends `[system, A, steer]`.
  - Deleting down to an empty ledger: regenerate gives `nothing_to_regenerate`. `turn` with no content is refused ("only its system prompt"). The next turn starts clean, with preview == sent.
- **Editing while a reply streams.** Edit (any message, including the one being regenerated), delete, select-version, a second regenerate, turn and `conversation.delete` are all 409s with a clear message. Changing the steer template mid-regenerate is allowed and doesn't touch the request in flight.
- **`generation.stop` at different moments.** All behave as documented:
  - before Venice answers: HTTP 499, nothing saved;
  - right after `start`;
  - with reasoning only: error `stopped`. A turn keeps the player message; a regenerate keeps the current version;
  - after 1-3 deltas;
  - after the last word but before Venice's usage chunk: the full text is kept as `stopped: true` with no cost;
  - with nothing running: "Nothing is being generated".

  The 409 lock is always free once stop returns: an immediate regenerate after stop got a 409 0 times in 10. Another user's `generation.stop` or `generation.follow` on your conversation id is a 404.
- **Restart mid-regenerate** (`npm run up:mock` during a `MOCK_SLOW` steer). The CLI says the connection was lost. The ledger is byte-identical to before (no partial version), and a steer after logging in again works.
- **Odd steers.** A `@file` with `{{instruction}}`, `$&`, a fenced `</think>`, unicode and a zero-width space is sent verbatim, never re-expanded, and stored trimmed. `-` (stdin) works. A blank or whitespace-only steer, or empty stdin, is a plain re-roll, as designed. A 200 KB steer works (66,737 prompt tokens on the mock).
- **Reasoning on:** a steered version's reasoning is stored and never sent. Checked every stored reasoning string against the next preview: 0 hits.
- **Encrypted user** (`qa-t03-enc`): I ran a turn, steers (one stopped mid-reply, one hit with `MOCK_ERROR`, one with `MOCK_MIDSTREAM_ERROR`, one stopped before headers), an edit, select-version, and a 50-step randomized chain. The file starts with `SSENC1`. `grep -a` finds 0 hits for the steers, title, system prompt, messages and edit text under `data/users/qa-t03-enc`, `.run/` (server and mock logs) and `$TMPDIR`. `server.log` holds only `method path status ms` and `<cmd> failed: <status> <code>`: no ERROR lines and no stack traces across about 1,800 requests.

## Findings

### QA-1 · minor · The "no ledger edits while generating" rule has a ms-wide hole: a delete can lose a full (billed) reply, and an edit can be answered with the old text

The 409 guard runs inside the edit's own queued job (`assertLedgerIdle`, `src/commands/messages.ts:67,92,116`). The generation's first read is a plain `loadConversation` that skips the conversation's write queue (`src/commands/chat.ts:107` for turn, `:164` for regenerate; `src/conversations/store.ts:19`). An edit or delete whose idle check passes just before `beginGeneration` can therefore write after the generation has read the old file. The engineer listed the edit case as "harmless". The delete case isn't: the whole reply is generated and then thrown away.

Repro (mock): `race.mjs` and `race-edit.mjs` (scratchpad) fire the two commands 0-2.5 ms apart.
```
# message.delete of the last reply, then message.regenerate --steer race, 90 times:
delete 200 / regen 200 → stream ends with error conflict: 4
  "m_7l7k2r6l2t was deleted while its new version was being written, so the new version wasn't saved."
delete 200 / regen 400 not_a_brain_message: 86
# message.edit of the first player message, then turn, 90 times:
87 times both succeeded; 9 of those turns sent the pre-edit text
```
- **Expected:** either the edit gets its 409, or the generation reads the edited ledger. Never both succeeding with the generation working from the old one.
- **Actual:**
  - Delete + regenerate: the reply is streamed in full, sent to Venice (billed live), then dropped with an error.
  - Edit + turn: the edit succeeds without a 409, and the reply answers text that is no longer in the ledger. Later prompts are still correct.
- **Likely fix:** after `beginGeneration`, read the conversation through the same per-conversation queue (e.g. a `readConversation` that runs inside `serialize`). An edit that passed its check before the lock was taken then finishes writing before the plan reads, and every later edit is refused. It is two people, or two tabs, acting within a couple of ms, hence minor.

### QA-2 · minor · The conversation's cost under-reports what Venice charged: a stopped reply is billed in full (confirmed live) but recorded as $0, and deleting messages removes their cost

1. **Stop.** Live check (`live-billing.mjs`, `deepseek-v4-1-flash`, `max_tokens` 3000). It counts to 300 in words: once to completion, then the identical request (a plain re-roll) stopped after 1.5 s.
   ```
   A complete: 40 in / 1215 out, recorded $0.00147; balance dropped $0.00147000
   B stopped: 1206 chars arrived (~302 tokens), stopped=true, recorded cost undefined
     balance drop for B after +20s / +40s / +60s: $0.00147000 / $0.00147000 / $0.00147000
   expected if billed for what arrived ~$0.00037 · the natural reply ~$0.00147 · max_tokens ~$0.00361
   ```
   Venice keeps generating after we disconnect and bills **the whole natural reply** (the same as the complete run, about 4x what had arrived). It doesn't bill the `max_tokens` budget. In the engineer's run the reply probably ran into `max_tokens` 500, so the two looked the same, and design.md's "about the full `max_tokens`" should read "the whole reply Venice would have written (up to `max_tokens`)".

   The app records nothing (`turn.ts` `generatedVersion`; there is no usage once the stream is cut). The same happens to a stop that lands after the last word but before the usage chunk (mock).
2. **Delete.** `totalCost` (`src/conversations/turn.ts:197`) sums the versions still in the ledger, so deleting a message removes money already spent:
   ```
   ./ss conversation.get --id c_x1c5mdy4kr | head -1   →  2 messages · $0.00011   (a turn + a steer + a re-roll)
   ./ss message.delete --conversation c_x1c5mdy4kr --message m_2hxpe71ecx
   ./ss conversation.get --id c_x1c5mdy4kr | head -1   →  1 messages · $0
   ```
- **Expected:** the running cost is what this conversation has cost Jason.
- **Actual:** it leaves out every stop and every deleted message or version. Small sums, but this is the number Jason watches against the spending rules, and T05 images at $0.01 each will make it larger.
- **Likely fix** (see "Open questions" for what's worth doing):
  - Since the stopped reply is billed anyway, don't throw the stream away. After a stop, release the lock and keep reading the upstream in a detached job (`forkVault`, as AGENTS.md says), discarding the text. Patch the final `usage`/`cost.usd` onto the stopped version, keeping the saved partial content. This costs nothing extra.
  - Keep a monotonic `spentUsd` on the conversation, added to on every save, for the displayed total.

### QA-3 · minor · A blank steer template, or one without `{{instruction}}`, silently drops the steer; the request then ends with an empty user message right after the brain's own reply

`conversation.update` accepts any string for `templates.steer` (`src/commands/conversations.ts:82`, applied at `:126`), and `planRegenerate` (`src/conversations/turn.ts:83`) neither warns nor refuses. Repro:
```
./ss conversation.update --id $C --templates.steer ""
./ss prompt.preview --conversation $C --regenerate --steer "Hidden?" --json | jq -c '.body.messages[-1], .refusal'
{"role":"user","content":""}
null
./ss conversation.update --id $C --templates.steer "   "         →  {"role":"user","content":"   "}
./ss conversation.update --id $C --templates.steer "Rewrite it."  →  {"role":"user","content":"Rewrite it."}   (the steer is gone)
```
- **Expected:** the steer Jason typed reaches the model, or he is told it won't.
- **Actual:** it vanishes with no refusal or note. With a blank template, the request is effectively the brain's own reply followed by nothing. That is the shape T02's live probe showed makes deepseek continue or repeat itself and leak `</think>`, and the reason a blank `--steer` is refused in `buildRequest` (T02 QA-5).

  It isn't hidden text (the preview shows it), so it's minor. It's easy to hit when rewriting the template in T03's settings panel and forgetting the placeholder.
- **Likely fix:**
  - Refuse blank templates in `conversation.update`. The player template has the same hole: an empty user message on every turn.
  - Have `planRegenerate` refuse when the rendered steer message is blank.
  - Add a `notes` line when `templates.steer` has no `{{instruction}}` ("your steer isn't in the template, so it won't be sent").

### QA-4 · nit · The re-roll refusal names the wrong reason when the reply is the only message

`planRegenerate` replaces every plain re-roll refusal with "would end with X's own earlier reply" (`src/conversations/turn.ts:87-90`). Its comment says "Only a plain re-roll can hit this: the message before it is the same brain's own reply." That's wrong when nothing comes before it:
```
# ledger is just one Assistant reply (everything before it deleted)
./ss message.regenerate --conversation c_0ytl8c3g0z
error: Without m_ywicad914q, the request would end with Assistant's own earlier reply, so a plain re-roll has nothing to answer. ...
# the preview it just printed is "1 messages: [0] system": there is no earlier reply
```
- **Expected:** the "only its system prompt" wording that `nothingToAnswer` already produces.
- **Fix:** only override when the body's last message is `assistant`.

## The engineer's open questions

- **"Venice may keep billing after a stop."** It does, confirmed and measured (QA-2): the whole reply it would have written, not `max_tokens`. **Worth acting on, cheaply:**
  1. Record the real cost of a stopped reply by draining the stream in the background after the stop. The money is spent either way, so the drain is free and makes the running cost honest.
  2. Fix design.md's wording.
  3. Give the browser's Stop button honest copy ("stops the text, not the bill").

  **Not worth acting on:** trying to prevent the charge. There's no cancel call that we know of; the only lever is `maxTokens`, which already exists per conversation. At $1.20/M output a typical stopped reply costs a fraction of a cent.
- **"No way to delete a single version."** **Not worth it for CP2.** A version reaches a prompt only while it is active: proven across the 330 oracle steps and the 41-version chain. So an unwanted or stopped version is clutter in the pager, not stale text, and Jason can select away from it.

  If it's added later (T07 polish, or when Jason asks), mind two things:
  - `steeredFrom` is a version *index* (`types.ts`), so deleting version k must renumber or clear `steeredFrom` on later versions, or switch to version ids. Otherwise the pager's "on version N" points at the wrong one.
  - Deleting it would drop its cost from the total, unless QA-2's `spentUsd` exists.

## Outside this ticket

`./ss generation.follow --json | head -3` crashes the CLI with an unhandled `EPIPE` stack trace once `head` closes the pipe. There's no user content in it, it predates T03, and it's harmless.

## Live spend

5 live text calls, no images: the billing pair, plus turn → steer → turn. Balance **$8.00847497 → $8.00548847** (−$0.0030). Half of that is the stopped reply, which the app recorded as $0.

## Housekeeping

The server is stopped (`npm run down`). QA users: `qa-t03-plain` (348 KB), `qa-t03-enc` and `qa-t03-live` (20 KB each), kept for triage's repros. I deleted the conversation holding the 200 KB steer. `npm test` gives 78/78 and `npm run typecheck` is clean. No application code was changed.
