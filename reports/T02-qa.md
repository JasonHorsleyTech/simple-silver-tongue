# T02 QA report: basic streaming chat (CP1)

**Verdict: Acceptance passes, with one caveat on the live token check. 2 majors (1 of them a design issue), 4 minors, 2 nits.**

## DESIGN CONCERN (QA-1)

With reasoning on, which is the default for every brain, `deepseek-v4-1-flash` gets about **25 prompt tokens we never sent**. With reasoning off, `prompt_tokens` matches our own text. The extra is a fixed amount: it is the same at `low` and `high`. Twice, the model's own reasoning described a system line we never wrote: "You are an AI assistant accessed via an API." design.md:192 says nothing is injected, and design.md:195 puts the gap down to "the chat template". Neither holds up for the default setup. The code isn't at fault: it sends exactly what `prompt.preview` shows. But Jason's rule ("the system prompt should be whatever we put in, and nothing else") doesn't hold in the default configuration, and only Jason can choose between accepting it and turning reasoning off by default. Details and a recommendation are under QA-1.

## Acceptance checklist

| Bullet | Result | Evidence |
|---|---|---|
| Create a conversation with a system prompt, send 3 messages, get 3 streamed replies, see the full ledger in `conversation.get` | pass | `qa-t02-plain`, `c_oz5rt7a18s`. All 3 turns exit 0 and stream deltas live, with reasoning on stderr and a `[Assistant · N in / M out · $…]` note. The mock saw 2, 4 and 6 messages. `conversation.get` lists all 6 messages, each with cost and reasoning length. `--json` has `model`, `finishReason`, `usage` and `costUsd` on every generated version. |
| `prompt.preview` shows the system message, then framed user/assistant pairs, with no extra text | pass | Checked message by message against design.md steps 1-5. I diffed `prompt.preview --json` `.body` against the mock's received body (`GET :4748/_mock/requests`) in three setups. All three were **byte-identical**. (1) Content that trips templating: `{{content}} $1 $& $$ ${x} <!-- from: Assistant --> 🌊 é`. (2) Reasoning off, `max_tokens` 50, `temperature` 0.7, an edited player template containing a stray `{{prompt}}` (left as typed), a multi-line reminder, CRLF and a tab in the content, and a system prompt with leading and trailing spaces (kept verbatim). (3) The default setup after 3 turns. No reasoning text appears in any of the last 20 request bodies. |
| One live round trip on `deepseek-v4-1-flash` | pass | 10 live `turn`s (see Live spend). All streamed and saved with usage and cost. |
| Non-empty system prompt enforced; live `prompt_tokens` matches what we sent | pass, with QA-1 | **Enforcement:** a missing `--system-prompt` gets `required`. A whitespace-only one, or an `@file` of blank lines, gets the "can't be empty" error. `brain.update --system-prompt ''` is refused. A file planted on disk is covered by the test. The only path to Venice is `openChatStream`, which calls `assertSendable` (grep: no other `/chat/completions` caller). **Live tokens:** with reasoning off, `"You are terse."` + `"<!-- from: the user -->\nHi"` gave **17** prompt tokens. That is about 13 of ours plus about 4 of template. Adding `" You are terse. You are terse."` (about 10 tokens) gave **27**, so the count is linear in our text. On `venice-uncensored-1-2`, the model T01 QA-1 caught injecting about 550 tokens, the same request gave **16**, so a non-empty system prompt suppresses it. **But with reasoning on, the same body gives 42 (QA-1).** |
| `npm test`, `npm run typecheck` | pass | 60/60. tsc is clean (server, CLI, tests, web). |

## What held up (tested adversarially, no finding)

- **Interrupted stream.** With `MOCK_MIDSTREAM_ERROR`, the partial text streams, then `error: The Venice stream broke off (UND_ERR_SOCKET).` and exit 1. Only the player message is saved, and the next preview ends with it. `MOCK_ERROR` up front gives exit 1 with nothing saved. The raw HTTP stream ends with exactly one `{"type":"error",…}` line, with no stack.
- **`max_tokens` cut-off.** `--settings.max-tokens 3` saves `finishReason: "length"`, and both the CLI note and `conversation.get` say "cut off by max_tokens". `--settings '{"maxTokens": null}'` removes it from the body. `0` is refused. `temperature 0` is sent as `0`.
- **Client disconnect mid-reply.** I killed `./sst turn … MOCK_SLOW` 1.2 s in. While it ran, a second `turn` and `conversation.delete` both got 409. The reply then finished and was saved. (Disconnecting *before the first event* is a different story: see QA-2.)
- **Two turns at once.** Six `./sst turn` processes at once on one conversation: exactly one exit 0, five got `busy` (a real HTTP 409 by curl), and the ledger holds 1 player message and 1 reply. Two turns on two *different* conversations both succeed.
- **Server restart mid-flow.** I ran `npm run up:mock` during a `MOCK_SLOW` turn. The CLI says `error: terminated` (QA-8). The file stays valid JSON with the player message only, and no `.tmp` files are left. The CLI tells you the session is gone. After logging in, `turn` with no content retries and saves the reply.
- **Encrypted user** (`qa-t02-enc`): 3 turns (one mid-stream failure, one up-front failure), a template edit and a reminder edit. Every distinctive phrase I used (title, system prompt, player text, template, reminder, mock reply text) is absent from `data/users/qa-t02-enc`, `.run/` and the CLI run dir. The file starts with `SSENC1`, and `user.json` holds only metadata. **Logout mid-turn, then logging straight back in:** the second login's `turn` gets 409 (the lock is per user, not per session). The running reply finishes and saves, and it decrypts with the real password (the T01 QA-2 fix holds).
- **Logs.** `.run/server.log*` and `mock.log*` contain no message content. Internal errors for corrupt files log `conversations/c_x.json: not valid JSON`, never the text.
- **Big and odd input.** A 1.3 MB Markdown file with CRLF, emoji, a combining accent, `{{content}}`, `$&` and a fenced block, sent via `--content @big.md`, takes 0.7 s. It is stored exactly (minus the one trailing newline the CLI drops, as documented) and sent at full length.
- **Unknown ids and names.** `--brain Nobody` lists the real brains. A brain name matches case-insensitively, and an id works too. `c_zzzzzzzz` is a clean 404. `../user` is refused by the id regex.
- **Reasoning mapping.** deepseek with reasoning off sends `reasoning_effort: "none"`. `gemini-3-6-flash` with reasoning off sends `venice_parameters.disable_thinking: true` and no effort. `venice-uncensored-1-2` gets no reasoning params.
- **Empty assistant content is accepted live.** A follow-up after an empty saved reply (QA-6) streamed normally (51 in).

### The engineer's design changes

- **Steer keeps the reply being revised: holds up.** I reran the probe live with another example, building both requests with the real `buildRequest` and sending them with `openChatStream`. Chat: "Name a fruit." → "Apple." · "Name another fruit." → "Banana.". Then I regenerated "Banana." with the steer "Make it plural.".
  - Excluded form: "Bananas.". Here it happened to answer the question afresh, in the plural.
  - Kept-in form: "Bananas.", a true revision.
  - The engineer's "Translate it into French." case went wrong in the excluded form, while the kept-in form is right in both runs. So the change is at least as good, and only it makes "your previous response" mean what the template says.
  - A consequence worth knowing for T03: repeated steers now *stack*, because each one revises whichever version is active. That fits the green/blue/green acceptance.
  - Hard rule 4 still reads "never put … steer text into a prompt". The intent is "never into a *later* prompt", and T03 may want to fix that wording.
- **`nothing_to_answer` refusal: right idea, but it has two gaps.** On mock, a `turn` with no content after the brain's own reply gets a clean 400 with nothing saved, and `prompt.preview` shows the body plus the note.
  - Gap 1: a body that ends with the **system** message is just as broken live, and it isn't refused (QA-3).
  - Gap 2: the check lives only in `planTurn`, so T03's `planRegenerate` has to remember to repeat it (QA-5).
  - It is wire-format based. A brain with its reminder on *can* be asked to speak twice in a row, because the reminder is a `user` message. An image brain's own history ends with `role: tool`, so a no-content turn to it re-paints rather than being refused. Both look defensible.

### Foundation for T03–T05

The document shape works for what comes next: `activeVersion`, per-version `steer`/`reasoning`/`usage`/`model`, `defaultBrainId`, `kind` per message, `call_<m.id>` tool ids and `schemaVersion`. `buildRequest` already covers every assembly branch, and the preview == send discipline (`planTurn` → body) is easy to copy. Things for later tickets to notice (not findings):
- T05: `MessageVersion.image` holds one image. "The old image stays on screen until the new one is ready" needs a second slot, or keeping the old id until the new one is `done`.
- T05: `templates.otherBrainImage` tells other brains "that image is now on the player's screen", even when its status is `error` or `pending`.
- `assertSendable` is enforced in `openChatStream`, not in `venice.request`. A future non-streaming chat call through the raw client would skip it.

## Findings

### QA-1 · major (design) · Reasoning mode adds about 25 prompt tokens we never send, in the default configuration

Repro (live, $0.00002 each). These are fresh conversations, identical except for the reasoning setting:
```bash
npm run up && ./sst auth.login --username qa-t02-live --password ''
A=$(./sst conversation.create --title off --system-prompt "You are terse." --json | jq -r .id)
./sst brain.update --conversation $A --no-reasoning.enabled
./sst turn --conversation $A --content "Hi"                          # [Assistant · 17 in / 6 out]
C=$(./sst conversation.create --title low --system-prompt "You are terse." --json | jq -r .id)
./sst conversation.update --id $C --settings.max-tokens 5
./sst turn --conversation $C --content "Hi"                          # [Assistant · 42 in / 5 out]  (default: reasoning low)
D=$(./sst conversation.create --title high --system-prompt "You are terse." --json | jq -r .id)
./sst conversation.update --id $D --settings.max-tokens 5; ./sst brain.update --conversation $D --reasoning.effort high
./sst turn --conversation $D --content "Hi"                          # [Assistant · 42 in / 5 out]
```
- **Measured.** Reasoning `none`: 17. `low`: 42. `high`: 42.
  - A second pair with a 28-token system prompt gave 43 (off) and 68 (low).
  - The engineer's own 52/68/86 fit the same pattern: our text plus about 4, plus about 25.
  - T01 QA saw the same thing on a bare "Hi" (5 at `none`, 31 at `medium`) and filed it under the chat-template exception.
- **What the model says it sees.** These are only hints, but they are consistent. I asked it, with reasoning on, to quote everything in its context other than our two messages (conversations "L7 hidden probe" and "L8 hidden probe 2" of the kept user `qa-t02-live`; `./sst conversation.get --json` for the reasoning). Both times its reasoning named a system message "You are an AI assistant accessed via an API.", which we never sent. `L8` even says "the system message is 'You are an AI assistant accessed via an API.' and there is no developer", which treats *our* system prompt as something else. The same probe with reasoning off (`L9`, 43 tokens) mentioned no such line.
- **Expected:** `prompt_tokens` equals our text plus a few tokens of role markup, as it does with reasoning off and on `venice-uncensored-1-2` (16).
- **Actual:** every request with reasoning on (the app's default, per brain) carries about 25 tokens of text the user can't see or edit, apparently including a system line that competes with the user's own system prompt. `prompt.preview` can't show it, and the mock can't model it.
- **Cause:** downstream of us, either Venice's reasoning path or the model's thinking-mode chat template. `buildRequest` sends exactly what the preview shows (verified byte for byte on the mock). Nothing in the body we send asks for it: the only difference between 17 and 42 is `"reasoning_effort": "none"` vs `"low"`.
- **Recommendation:**
  1. Correct design.md:192 and :195 with the measured fact.
  2. Ask Jason to choose. Either accept it as model-side template text and say so in the payload view whenever reasoning is on (the hard rule already promises a note for chat-template text), or default brains to reasoning **off**, so the default setup really sends nothing else.
  3. Optionally, add a cheap probe (`max_tokens: 1`, reasoning on vs off, for a model) so the payload view can say "this model adds about N tokens you can't see". T01 QA-1 suggested the same for the empty-system-prompt case.

### QA-2 · major · A client that disconnects before the first stream event leaves the conversation locked (409) until the server restarts, and the reply is never generated

Repro (`npm run up:mock`). Pausing the mock stands in for a slow Venice (a cold `/models` cache, a long prefill or queueing before Venice sends its response headers):
```bash
C=$(./sst conversation.create --title early --system-prompt "Sys." --json | jq -r .id)
MP=$(cat .run/mock.pid); kill -STOP $MP
./sst turn --conversation $C --content "early bye" & sleep 1; kill %1     # or: curl --max-time 1 … /api/turn
kill -CONT $MP; sleep 3
./sst conversation.get --id $C          # the player message is saved, no reply
./sst turn --conversation $C --content again   # error: Conversation … is busy   (still true 3.5 minutes later, past the 180 s idle timeout)
./sst conversation.delete --id $C       # error: … is busy
```
Reproduced 2 out of 2 times, with both the CLI and curl. A disconnect *after* the first event works (see "What held up").
- **Expected:** design.md:203 says "a client disconnect doesn't stop anything: the reply finishes and is saved". At the very least, the lock is released.
- **Actual:**
  - The player message is saved, and the reply is never requested from the stream. The 409 lock is held forever: no more turns and no delete on that conversation until `npm run up*`.
  - The request's forked vault key is never closed either, so for an encrypted user a key copy stays in memory after logout.
  - The server log shows `POST /api/turn 200 1013ms` and nothing more.
  - Realistic triggers: Ctrl-C right after sending, a browser reload, or the web client aborting (design.md says "Aborting stops reading only; the server finishes and saves anyway") while Venice hasn't answered yet. T03's `generation.stop` can't free it either, because the generator is parked at a `yield`, not reading upstream.
- **Cause:** `src/server/app.ts:131-147`. When the socket is already closed by the time the stream response starts, @hono/node-server never reads or cancels the body, so `StreamingApi.write` blocks forever on backpressure. Its `writeFromReadableStreamDefaultReader` hooks `close` and `error` on an outgoing that has already closed, and `flow` then waits for a `drain` that never comes. Hono's `onAbort` only fires on a cancel, which never happens. So `send()` awaits forever, the generator stays suspended at its first `yield` (commands/chat.ts:70 or :73), and `finally { gen.release() }` never runs.
- **Fix suggestion:** don't let draining depend on socket writes.
  - Set `open = false` when `c.req.raw.signal` is already aborted, and on its `abort` event.
  - Race each `s.write()` against that signal (or don't await writes once the client has gone).
  - Add a test: abort the request before the first event, then assert that the reply is saved and the lock is released. Use `app.fetch` with an `AbortController`, or `http.request` with `agent: false` and `req.destroy()`, plus `MOCK_SLOW` or a stalled mock.

### QA-3 · minor · A body that is only the system message is sent, and live the model just continues the system prompt as text

Repro (live, `$0.00002`):
```bash
I=$(./sst conversation.create --title sysonly --system-prompt "Open a tavern scene in one sentence." --json | jq -r .id)
./sst conversation.update --id $I --settings.max-tokens 40; ./sst brain.update --conversation $I --no-reasoning.enabled
./sst turn --conversation $I                 # reply: " Include two characters, a menu item, and aDELETE."
```
- **Expected:** a new conversation with no setup and no content is either refused with `nothing_to_answer`, like the own-reply case, or behaves like a normal reply.
- **Actual:** it sends `[system]` only. Live, the model treats the system prompt as a prefix: it continues it, with a leading space, and ends in garbage. This is the same failure class the T02 refusal exists to stop. It's easy to hit: press Send on an empty composer in a fresh conversation, or try to have the GM open the scene without a World Bible.
- **Cause:** `src/conversations/turn.ts:31` refuses only when the last message is `assistant`. Refuse whenever the last role isn't `user` or `tool`, which covers `system` too. The mock happily answers a system-only body, so add a test there.

### QA-4 · minor · One unreadable conversation file makes `conversation.list` fail for the whole user

Repro (`up:mock`):
```bash
printf '{"oops": truncated' > data/users/qa-t02-plain/conversations/c_corrupt01.json
./sst conversation.list        # error: Internal server error (see .run/server.log)
# also: a plaintext conversation copied into an encrypted user's conversations/ folder, or a partial doc ({"id","title"} only → TypeError reading textModel)
```
- **Expected:** the list shows every readable conversation and flags or skips the bad one. That conversation's own `get` can fail.
- **Actual:** a 500, so every conversation vanishes from the list, and from the sidebar the T02 frontend pass is about to build. Atomic writes make real corruption unlikely, but plain users exist precisely so Jason can hand-edit JSON. A later schema change, or a file copied between users, would hit it too.
- **Cause:** `src/conversations/store.ts:25` uses `Promise.all` over `loadConversation`, and `summarize` assumes the shape. Use `Promise.allSettled`, and return the failures as `{id, error}` rows.

### QA-5 · minor · The `nothing_to_answer` rule isn't in the shared builder, and a blank steer silently produces the very body it guards against

Repro (pure, no server):
```ts
// conversation: player "Hi", then brain "Yellow." (the last message)
buildRequest(conv, gm.id, { model, steer: "French" })  // roles: system,user,assistant,user   ✓
buildRequest(conv, gm.id, { model, steer: "   " })     // roles: system,user,assistant      ← ends with its own reply
```
- **Expected:** T03's `planRegenerate` treats a blank steer as a plain re-roll (exclude the message), and the "must not end with the brain's own reply" check sits where every plan gets it.
- **Actual:** `prompt.ts:120` drops a blank steer without a word. Under the new kept-in rule, a blank steer therefore yields `…, assistant` as the last message, the case that made deepseek leak `</think>` live. The check lives only in `planTurn` (`turn.ts:31`), not in `buildRequest` or `assertSendable`. T03 builds right on top of this, so it's cheap to close now.
- **Fix:** move the last-role check (including QA-3) into a shared helper that both `planTurn` and the coming `planRegenerate` call. Have `buildRequest` reject a blank `steer` (`steer: "  "` is a caller bug), not drop it.

### QA-6 · minor · Live, `max_tokens` counts reasoning, so a cut can leave an empty reply, which is saved and re-sent; the mock can't reproduce this

Repro: the QA-1 `low`/`high` conversations (`--settings.max-tokens 5`, reasoning on). Both replies are `content: ""`, `finishReason: "length"`, `reasoningTokens: 5`. The CLI prints a blank line and "cut off by max_tokens".
- **Expected:** an empty generated reply is at least called out ("no text: the max_tokens budget went to reasoning"), and the mock can show it so T02 and T03's UI can handle it.
- **Actual:** the empty reply is saved as an ordinary brain message, so every later prompt carries `{"role":"assistant","content":""}` (live accepts it). The web UI will show an empty bubble. `src/dev/mock-venice.ts:151-153` counts only content words against `max_tokens`, so the mock never produces it.
- **Fix:** make the mock spend `max_tokens` on reasoning words first, and have `turn`'s note say when the content is empty. Whether to save an empty reply at all is triage's call.

### QA-7 · nit · `relayReply` merges every tool call's arguments into one string

`turn.ts:80-82` ignores `index`. Two parallel tool calls (`{"prompt":"one"}` at index 0 and `{"prompt":"two"}` at index 1) give `toolArgs` = `{"prompt":"one"}{"prompt":"two"}`, which isn't valid JSON. The body never sends `parallel_tool_calls: false`. T05 is meant to reuse `relayReply` as is: keep index 0 only, or send `parallel_tool_calls: false` if Venice honours it.

### QA-8 · nit · Broken-stream errors don't say what happened or what to do next

- A server restart mid-turn prints `error: terminated` (undici's text) from the CLI.
- A Venice drop prints `The Venice stream broke off (UND_ERR_SOCKET).`, but doesn't say the player message was kept or that `./sst turn --conversation <id>` with no content retries. The help text says so, but the error message is where the user looks.

## Live spend

- Balance **$8.01171997** before, **$8.00957627** after: **$0.00214** spent. 12 live text calls (the limit is 15), no images:
  - 10 `./sst turn` calls on `qa-t02-live`: the token pairs, reasoning low and high, an empty-reply follow-up, `venice-uncensored-1-2`, three hidden-text probes and the system-only body.
  - 2 steer-probe requests, built with `buildRequest` and sent with `openChatStream` from a scratch script that never printed the key.

## Notes for later passes

- **Stalling the mock is the easy way to test "before the first event".** `kill -STOP $(cat .run/mock.pid)` holds Venice's response headers. `kill -CONT` releases them.
- **`zsh` doesn't word-split `${3:+--flag $3}`.** Pass flags explicitly in scripts.
- Cleanup: `qa-t02-plain` (1.4 MB) and `qa-t02-enc` are deleted. **`qa-t02-live` (44 KB, plain) is kept** as QA-1 evidence: `./sst auth.login --username qa-t02-live --password ''`, then `./sst conversation.list`. The "L7"/"L8" conversations hold the probes' full reasoning (`--json`), and this works in mock mode too. Wipe it freely afterwards. The server is stopped. The `dev-*` users are untouched.
