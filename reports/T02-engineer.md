# T02 engineer report: basic streaming chat (CP1)

## Design concern (for T03): a steer needs the reply it is revising

design.md said regenerate builds the request *excluding* the message being regenerated, and then adds the steer. The default steer template, though, says "Write your previous response again, following this direction". With the message excluded, the model's "previous response" is an **earlier** reply. I probed it live: in a chat whose replies were Blue, Red, Green, Green, Yellow, I regenerated "Yellow." with the steer "Translate it into French.":

| Request | Last three messages sent | Reply |
|---|---|---|
| A: design.md as written (message excluded) | `assistant: …Green.` · `user: One last color.` · `user: <steer> Translate it into French.` | **"Vert."** (it translated the wrong reply) |
| B: active version kept, steer after it | `user: One last color.` · `assistant: Yellow.` · `user: <steer> Translate it into French.` | **"Jaune."** |

**Recommendation, now written into design.md:** with a steer, keep the message's active version in the request (as the brain's own last `assistant` message, then the reminder if any, then the steer). Only a plain re-roll without a steer excludes the message. Hard rule 4 still holds: only that one request carries the old version and the steer, and later prompts see only the active version. `buildRequest` already supports both forms (`steer`, `excludeFromMessageId`), and the T03 ticket now has a note pointing at this.

## What I built

- **The conversation document** (`src/conversations/types.ts`, `defaults.ts`): settings, templates, setup, brains and the ledger with versions, as in design.md. A new conversation gets one text brain, "Assistant", with the user's system prompt and reasoning on at `low`. Changes from the design:
  - `defaultBrainId` on the conversation replaces `Brain.isDefault`, so "exactly one default" holds by construction.
  - `schemaVersion: 1`.
  - Generated versions also store `model`, `finishReason` (`"length"` means cut off by max_tokens) and `usage` (prompt, completion, reasoning and cached tokens), next to `costUsd` and `reasoning`.
- **The pure prompt builder** (`src/conversations/prompt.ts`): `buildRequest(conv, brainId, {model, excludeFromMessageId?, steer?})` implements every branch of design.md's assembly, not just text brains:
  - player framing, own text replies as `assistant`, other brains' text and images framed as `user`;
  - an image brain's own images as `tool_calls` plus a `tool` result, with `tools` and a forced `tool_choice`;
  - setup messages, the final reminder, the steer (last), and exclusion for regenerate.
  
  T03–T05 only have to wire commands to it.
  - `render()` replaces placeholders in a single pass with a function replacer, so content containing `{{brain}}` or `$&` is never expanded again.
  - Reasoning params follow the brain's toggle and the model's capabilities: `reasoning_effort` with the brain's level; `"none"` when reasoning is off; `venice_parameters.disable_thinking` for models that can't take `none`; nothing for models without reasoning.
  - `venice_parameters` explicitly turns off everything that adds text: `include_venice_system_prompt: false`, `enable_web_search: "off"`, `enable_web_scraping: false`.
- **One path for preview and send** (`src/conversations/turn.ts`): `planTurn()` builds the would-be player message and the body. `prompt.preview` returns `plan.body`; `turn` sends `plan.body`. A test compares the preview with the body the mock actually received.
- **Hard rule 1, enforced in four places:**
  - `conversation.create` and `brain.update` reject an empty or whitespace-only system prompt.
  - `buildRequest` refuses an empty one, which covers `turn` and `prompt.preview` (same error, nothing saved).
  - `openChatStream` calls `assertSendable(body)` before anything leaves the server: the first message must be a non-empty `system` message and Venice's own prompt must be off.
  - The mock rejects any request that breaks the rule, so a regression fails the tests.
- **Venice streaming client** (`src/venice/chat.ts`):
  - It parses SSE by hand (CRLF, comments, multi-byte characters split across chunks, a missing `[DONE]`).
  - It reads content on every chunk, the finishing one included, and also picks up reasoning deltas, tool-call fragments, usage and `cost.usd`, plus error chunks.
  - Timeouts: 120 s to start answering, 180 s of silence between chunks, and no limit on the total. The old 30 s total timeout would have killed long reasoning replies.
  - Error messages never contain model content, since errors are logged.
- **`turn`** (stream):
  - It holds a per-conversation generation lock, so a second turn is a real HTTP 409.
  - Order: plan, then open the Venice stream (an up-front refusal saves nothing), then save the player message, then stream, then save the reply with reasoning, model, usage and cost, then `done` with a one-line `note` that the CLI prints to stderr.
  - If the stream breaks midway, the player message stays and no partial reply is saved; `turn` without content retries.
  - It refuses (`nothing_to_answer`) when the request would end with the brain's own `assistant` message (see "Live" below).
- **Storage** (`src/conversations/store.ts`): every write is a read-modify-write through `mutateConversation`, one at a time per conversation, so a rename while a reply streams survives the reply's save. `conversation.delete` is refused while a generation runs. The generation lock carries an `AbortController`, ready for T03's `generation.stop`.
- **Fixed in passing:**
  - **undici GC bug.** undici cancels the body of a `Response` that is garbage-collected unread, and a cancelled body reads as a clean, empty end. `turn` lost its whole reply about one run in three, because the player message is saved between opening the stream and reading it. `openChatStream` now locks the body immediately. A regression test forces a GC; it fails on the old code and passes now.
  - **Log leak.** `readJson` could leak decrypted content into `server.log`, because V8's `JSON.parse` error quotes the text it failed on and internal errors are logged with their stack. It now throws a plain "not valid JSON".

## Commands added

| Command | What it does |
|---|---|
| `conversation.create --title --system-prompt [--text-model]` | New conversation with an "Assistant" brain. The system prompt is required and must have real text; the model must be in Venice's list. |
| `conversation.list` | ID, title, message count, total cost (every version ever generated), model, updated. |
| `conversation.get --id` | Text view of the whole ledger (active versions, cost, reasoning length); `--json` for the full document. |
| `conversation.update --id [--title] [--settings.*] [--templates.*]` | Title, text and image model (validated), maxTokens and temperature (`null` unsets them), and the four templates. The templates are included already: the player template is sent from T02 on, and hard requirement 1 says everything sent must be editable. |
| `conversation.delete --id` | Delete; 409 while generating. |
| `brain.update --conversation [--brain] [...]` | Name, color, system prompt, reasoning on/off and effort, final reminder. Included for the same reason: the system prompt is sent, so it must be editable before T04. T04 adds `brain.add/delete/set-default`, kind and tool text. |
| `turn --conversation [--content] [--brain]` | Streams the reply to stdout, with reasoning and status on stderr. |
| `prompt.preview --conversation [--brain] [--content]` | The exact body `turn` would send (`--json` prints it byte for byte), with a note when turn would refuse it. |

`--brain` takes a name (case-insensitive) or an id, via `resolveBrain`.

## Terminal transcript (mock, `npm run up:mock`)

```
$ ./ss user.create --username dev-t02-plain --password ''
Created dev-t02-plain (unencrypted). Log in with: ./ss auth.login --username dev-t02-plain
$ ./ss auth.login --username dev-t02-plain --password ''
Logged in as dev-t02-plain (unencrypted).
$ ./ss conversation.create --title 'Haiku bot' --system-prompt 'You answer only in haiku.'
Created c_ijw9bcejhg "Haiku bot" · deepseek-v4-1-flash · brain Assistant
$ ./ss turn --conversation c_ijw9bcejhg --content 'Tell me about the sea.'
[Assistant]
MOCK reasoning (effort: low) over 2 messages.
MOCK reply to brain "You answer only in haiku."; saw 2 messages; last: "<!-- from: the user --> Tell me about the sea."
[Assistant · 19 in / 42 out · $0.000056]
$ ./ss turn --conversation c_ijw9bcejhg --content 'Now about mountains.'
... saw 4 messages; last: "<!-- from: the user --> Now about mountains."
$ ./ss turn --conversation c_ijw9bcejhg --content 'And finally, the moon.'
... saw 6 messages; last: "<!-- from: the user --> And finally, the moon."
[Assistant · 101 in / 42 out · $0.000081]
$ ./ss conversation.get --id c_ijw9bcejhg
Haiku bot (c_ijw9bcejhg) · deepseek-v4-1-flash · 6 messages · $0.00021
Brains: Assistant (default) [b_ai1vqdgliq, text, reasoning low]

── you · m_83a3suseh9 ──
Tell me about the sea.

── Assistant · m_3n14dk4djt · $0.000056 · reasoning 45 chars (--json) ──
MOCK reply to brain "You answer only in haiku."; saw 2 messages; last: "<!-- from: the user --> Tell me about the sea."
... (4 more, alternating)
$ ./ss prompt.preview --conversation c_ijw9bcejhg --content 'One more?'
Exact request for brain "Assistant" (b_ai1vqdgliq): POST /chat/completions
{"model":"deepseek-v4-1-flash","stream":true,"stream_options":{"include_usage":true},"venice_parameters":{"include_venice_system_prompt":false,"enable_web_search":"off","enable_web_scraping":false},"reasoning_effort":"low"}
8 messages:

── [0] system ──
You answer only in haiku.

── [1] user ──
<!-- from: the user -->
Tell me about the sea.

── [2] assistant ──
MOCK reply to brain "You answer only in haiku."; saw 2 messages; ...
... ([3]-[6] alternate the same way)
── [7] user ──
<!-- from: the user -->
One more?
$ ./ss turn --conversation c_ijw9bcejhg
error: The last message is Assistant's own reply, so there is nothing new for it to answer. Send a message with --content.   [exit 1]
$ ./ss conversation.list
ID            TITLE      MESSAGES  COST      MODEL                UPDATED
c_ijw9bcejhg  Haiku bot  6         $0.00021  deepseek-v4-1-flash  2026-10-14 06:21:04
```

Preview equals send, checked by hand as well as in `test/chat.test.ts`. The content was chosen to trip naive templating:
```
$ ./ss prompt.preview --conversation $C --content 'Fourth: {{brain}} $& and "quotes"' --json   → .body → preview.json
$ ./ss turn --conversation $C --content 'Fourth: {{brain}} $& and "quotes"'
$ curl -s localhost:4748/_mock/requests   → requests[0].body → sent.json
$ cmp preview.json sent.json && echo IDENTICAL
IDENTICAL          (last message: '<!-- from: the user -->\nFourth: {{brain}} $& and "quotes"')
```

Errors, the lock and encryption:
```
$ ./ss conversation.create --title x --system-prompt '   '
error: Invalid arguments for conversation.create: systemPrompt: The system prompt can't be empty: some Venice models inject their own when there is none   [exit 1]
$ (./ss turn --conversation $C --content 'MOCK_SLOW long one' &); sleep 0.5; ./ss turn --conversation $C --content 'me too'
error: Conversation c_ijw9bcejhg is busy: a reply is still being generated. Wait for it to finish, then try again.   [exit 1]
$ ./ss turn --conversation $C --content 'MOCK_ERROR up front'
error: Venice 500 on /chat/completions: mock: forced error (MOCK_ERROR)   [exit 1]    (nothing saved)
$ ./ss turn --conversation $C --content 'MOCK_MIDSTREAM_ERROR halfway'
[Assistant]
MOCK reasoning (effort: low) over 10 messages.
MOCK reply to brain "You answer only
error: The Venice stream broke off (UND_ERR_SOCKET).   [exit 1]
$ ./ss conversation.get --id $C --json | ... authors
player brain player brain player brain player brain player      (MOCK_SLOW finished and saved; MOCK_ERROR saved nothing; the mid-stream failure kept only the player message)
$ ./ss conversation.update --id $C --settings.text-model nope
error: Venice has no text model "nope". See ./ss models.list --type text, then set it with ./ss conversation.update ...   [exit 1]
$ ./ss brain.update --conversation $C --system-prompt ''
error: Invalid arguments for brain.update: systemPrompt: The system prompt can't be empty: ...   [exit 1]

$ ./ss user.create --username dev-t02-enc --password pw-t02 && ./ss auth.login --username dev-t02-enc --password pw-t02
$ ./ss conversation.create --title GILDED-GOAT --system-prompt 'You are the SECRET-GM.'   -> c_s9cgriesvx
$ ./ss turn --conversation c_s9cgriesvx --content 'I order the PLUM-WINE.'
MOCK reply to brain "You are the SECRET-GM."; saw 2 messages; last: "<!-- from: the user --> I order the PLUM-WINE."
$ grep -rlE 'GILDED|SECRET-GM|PLUM-WINE|MOCK reply' data/users/dev-t02-enc || echo 'no plaintext on disk'; head -c 6 .../c_s9cgriesvx.json
no plaintext on disk
SSENC1
$ grep -rE 'PLUM|SECRET|haiku|MOCK reply' .run/*.log || echo 'no content in logs'
no content in logs
```

Also checked on the mock: `--settings.max-tokens 5` cuts the reply (`finishReason: "length"`, and the note says "cut off by max_tokens"); `--templates.player '{{content}}'` sends the player's text unframed; `--no-reasoning.enabled` sends `reasoning_effort: "none"`.

## Terminal transcript (live, `npm run up`)

```
$ ./ss venice.balance
Venice balance: $8.01216187 USD · DIEM 0 · tier paid
$ ./ss conversation.create --title "Live colors" --system-prompt "You are terse. Reply in at most ten words."
Created c_4vpob2lwk6 "Live colors" · deepseek-v4-1-flash · brain Assistant
$ ./ss turn --conversation c_4vpob2lwk6 --content "Name a color."
[Assistant]
We need answer. User asks "Name a color." Need terse, at most ten words. We can just say Blue. Ensure no extra.
Blue.
[Assistant · 52 in / 34 out · $0.000056]
$ ./ss turn --conversation c_4vpob2lwk6 --content "Name another one."
... Red.
[Assistant · 68 in / 34 out · $0.000061]
$ ./ss turn --conversation c_4vpob2lwk6 --content "And one more, please."
... Green.
[Assistant · 86 in / 48 out · $0.000083]
usage per reply: {"promptTokens":52,"completionTokens":34,"reasoningTokens":30} 0.0000564 stop
                 {"promptTokens":68,"completionTokens":34,"reasoningTokens":30} 0.0000612 stop
                 {"promptTokens":86,"completionTokens":48,"reasoningTokens":44} 0.0000834 stop

$ ./ss turn --conversation c_4vpob2lwk6          # (before the refusal existed) request ends with its own reply
[Assistant]
### Trip 1: Wrong ... No trip.</think>Green.      ← it repeated itself, and reasoning plus </think> landed in content
$ ./ss brain.update --conversation c_4vpob2lwk6 --no-reasoning.enabled
$ ./ss turn --conversation c_4vpob2lwk6 --content "One last color."
[Assistant]
Yellow.
[Assistant · 129 in / 3 out · $0.000042]          ← reasoning_effort "none": no reasoning at all
$ ./ss turn --conversation c_4vpob2lwk6          # after restarting on current code
error: The last message is Assistant's own reply, so there is nothing new for it to answer. Send a message with --content.
$ node steer-probe.ts                             # two regenerate requests, built with buildRequest (see Design concern)
A: … reply: "Vert."  ($0.0000525)
B: … reply: "Jaune."  ($0.0000555)
$ ./ss venice.balance
Venice balance: $8.01171997 USD · DIEM 0 · tier paid
```

`prompt_tokens` was 52 for about 25 tokens of our own text plus DeepSeek's chat template. Venice's injected prompt would add about 550, so nothing was injected. QA should still make the precise check the ticket asks for.

## Live spend

- Before **$8.01216187**, after **$8.01171997**. Spent **$0.00044**.
- 7 live chat calls, all `deepseek-v4-1-flash`: 3 turns, 1 no-content turn, 1 turn with reasoning off, and 2 steer-probe requests. No images.

## Tests

`npm test`: **60 pass**, up from 40. `npm run typecheck` is clean, server and web. New files:
- `test/prompt.test.ts` (11 tests). Exact message lists for each brain of a 3-brain table (default, a brain with a reminder, an image brain), with setup, an authored opener, a multi-version message and an image message; steer and exclusion; reasoning text, steers and inactive versions never sent; edited templates; the reasoning-parameter table; hard rule 1; `planTurn`; `resolveBrain`; single-pass `render`.
- `test/venice-chat.test.ts` (3 tests): SSE at chunk sizes 1, 2, 3, 7 and 1000; `chunkEvents`; the GC regression.
- `test/chat.test.ts` (6 tests, CLI end to end against the mock):
  - 3 turns, with the preview equal to the mock's received body each time, and the refusal;
  - a 409 plus refused delete, and a rename mid-stream that survives;
  - an up-front failure (nothing saved) and a mid-stream failure (player message only);
  - an empty system prompt planted on disk never goes upstream;
  - settings, template and brain edits reach the next request;
  - an encrypted user's file is ciphertext with no known phrase.

## Known gaps

- No browser UI (that's the Frontend pass). The web client's types (`web/src/api/types.ts`) don't have the new commands yet; the Frontend pass adds them.
- A failed reply leaves no trace in the ledger. The partial text is shown live and then dropped. T03's `generation.stop` (keep the partial) is the natural place to decide whether to keep partials.
- `turn` refuses image brains (`not_supported`) until T05, although `buildRequest` already builds their requests.
- Templates and the final reminder accept any text, even an empty template or one without `{{content}}`, which silently drops the message. That's the user's call, but T04's editor might warn.
- `brain.update` accepts any of Venice's documented effort levels, even one the current model doesn't support. Venice then rejects the request with a clear error.
- `conversation.list` decrypts every conversation to read its title. That's fine for dozens; an index would only be worth it with many more.

## Changes to docs

- **design.md**
  - Conversation document: the T02 shape (`defaultBrainId`, `schemaVersion`, new version fields), single-pass templating, storage mechanics (write queue, generation lock).
  - Prompt assembly: `model` input, `planTurn` as the one path, blank setup and reminder skipped, the full `venice_parameters`, the reasoning table, `assertSendable` on the send path, the live T02 findings.
  - Turns: order and failure behaviour, the `nothing_to_answer` refusal, **the changed steer rule for regenerate**, and brain delete refused while generating.
  - Command surface: T02 commands, `start.messageId`, `done.note`.
  - Mock: the system-message check, `slowDelayMs`, mid-stream drops that flush first.
  - Vault: the `readJson` log-safety note.
- **AGENTS.md:** example conversation commands under "Running it", and four lessons-learned bullets (the undici GC trap, the conversation code map, proving preview == send, live behaviour).
- **TICKETS.md:** T02 → `qa`. A note on T03 about the steer rule and `planRegenerate`, and notes on T04 marking what T02 already did (`brain.update`, templates in `conversation.update`, `--brain` resolution).
