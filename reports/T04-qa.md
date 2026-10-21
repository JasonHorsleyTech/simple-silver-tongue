# T04 QA report: multiple brains, setup messages and templates (CP3)

**Verdict: acceptance passes. 0 blockers, 0 majors, 1 minor, 3 nits.**

The heart of checkpoint 3 is correct:
- Every brain sees the ledger from its own seat.
- Setup messages reach every brain.
- Reminders go only to brains that have them on.
- Edits reach every brain's view.
- Brains can be added, renamed and re-pointed mid-campaign without breaking anything.

I checked this against an independent oracle over about 1,950 random operations, and no request ever differed from design.md's rules. The findings are around the edges: one misleading retry hint, and three small polish items.

No design concern. Some notes on the design for Jason's table are at the end.

## How I tested

- **Independent oracle.** I wrote my own version of design.md's "Prompt assembly" steps 1-5 and the request body. It imports nothing from `src/`; the model capabilities were copied by hand from the mock's `/models`. It covers:
  - single-pass placeholder rendering, where a placeholder with no value stays as typed;
  - skipping blank setup messages and blank reminders;
  - the image-brain tool call and tool result;
  - the reasoning table;
  - `max_tokens` and `temperature`;
  - `tools` and `tool_choice`;
  - the "must end with `user` or `tool`" refusal.
- **Random sequences**, through the HTTP API, of 13 kinds of operation:
  - turns (any brain, with or without content);
  - regenerates (steered, blank-steered and plain);
  - `message.add` (as the player or any brain), edit, delete and select-version;
  - `brain.add`, `.update` (name, prompt, reminder, reasoning, kind), `.delete` and `.set-default`;
  - setup add, update, move and delete;
  - template changes, including ones that must be refused;
  - settings changes (three text models, `max_tokens`, temperature).

  Names and content include `{{content}}`, `{{brain}}`, `$&`, `$1 $' $\``, `<!-- x -->`, `-->`, unicode and emoji, an RTL override, a NUL, newlines, 3,000-character messages and whitespace-only text.
- **What each step checked:**
  - After every step, **every brain's** `prompt.preview` body was `deepEqual`'d with the oracle, and its refusal flag compared. The brain was addressed by id, by name or by upper-cased name.
  - Every successful `turn` and `message.regenerate` was also compared three ways: preview body, the mock's logged request (`/_mock/requests`) and the oracle.
  - Every refused operation was checked to leave the conversation unchanged on disk.
  - Expected error codes were predicted from the spec: `default_brain`, `brain_in_use`, `kind_locked`, a duplicate or reserved name, `nothing_to_answer`, `not_supported`, a position past the end, a template missing its placeholder.
- **Runs:** seeds 1-12 (60 + 11 × 150 steps) on a plain user and seeds 21-22 (2 × 120) on an encrypted user, about 1,950 steps in all. Everything passed. Final conversations ran to 3-12 brains, 0-9 setup messages and 14-59 messages.
- **Mutation check of the harness.** I broke the oracle on purpose twice: once to expand placeholders inside values, once to send blank setup messages. Both mutants were caught: the first on 1 of its 2 seeds (at step 28), the second on both (steps 54 and 145). So "it passed" means something.

## Acceptance checklist

| Bullet | Result | Evidence |
|---|---|---|
| D&D setup: GM (default) "You are the GM…", a World Bible, a hand-authored GM opener, a Dice Master with a reminder | **pass** | `brain.update --name "Game Master"`, `setup.add` (pre-filled `<!-- This is the World Bible. -->`), then `setup.update --setup "world bible"`, `message.add --as "Game Master"`, `brain.add --name "Dice Master"` (reminder on, pre-filled). |
| Player → GM → player → Dice Master → player → GM; `prompt.preview --brain "Dice Master"` | **pass** | In order: its own system prompt; the World Bible verbatim; the opener and both GM replies as `<!-- from: Game Master -->` user messages; all three player lines framed `<!-- from: the user -->`; its own reply as `assistant`; the reminder last. |
| `prompt.preview --brain "Game Master"` | **pass** | The opener and its replies are `assistant`. The Dice Master's line is a framed `user` message. There's no reminder, so it is refused as "nothing new to answer", correctly. |
| Editing a GM message changes what the Dice Master sees | **pass** | `message.edit` of a GM reply → the Dice Master's `[4]` became `<!-- from: Game Master -->\nEDITED GM line`. The fuzzer did the same at any depth, for any author and brain, and after version switches. |
| Third brain mid-conversation; GM system prompt edited; no restart | **pass** | Joke Teller added at message 9 answered an empty turn and saw 10 messages, all framed, with its reminder last. After `brain.update --system-prompt "GM EDITED PROMPT"`, the next GM request (checked in the mock log) started with it. |
| Live pass | **pass** | Encrypted `qa-t04-enc`, 4 calls. Covered in the Live check section below. |

## Goal-by-goal

- **Perspective.** Holds over every random sequence:
  - Own text messages, generated or hand-written, are `assistant`.
  - Everyone else's are framed `user`, the player's included.
  - A rename re-frames history with the new name, as designed.
  - A brain addressed by id, by name or by name in another case gets the same request.
- **Setup and reminders.**
  - Setup messages reach every brain, verbatim and in order, and are never framed. Labels are never sent, and blank ones are skipped.
  - With 150 setup messages (229 KB requests) and 40 random moves, both brains' previews equalled the oracle. A turn went through: 56,254 tokens in on the mock. `setup.update` on a label used by 21 messages asks for an id.
  - A reminder is sent only when it is on and not blank.
  - Steered regenerate of a non-default brain sends, in order: its reply, its reminder, the rendered steer. Its next request has no trace of the steer.
- **Shared edits.** Edit, delete and select-version are what every brain sees from the next request, including in the mock log.
- **Mid-campaign changes.** All of these happened while the Dice Master was writing (a slow reply):
  - Refused, correctly (409): deleting it, changing its kind, `message.add`, a second `turn`.
  - Allowed, and saved under the right brain id: renaming it, making it the default, deleting an unused brain, deleting the old default, `setup.add`, a template change.

  The reply sent was byte-identical (`cmp`) to the preview taken before those changes.

  **Races.** `turn --brain X` and `message.add --as X` against `brain.delete X` (X never spoke), 240 rounds with either request first and 0-2.5 ms apart. The result was always one clean winner, with no orphaned message. Concurrent same-name `brain.add` ×3 gave exactly one success in 30 of 30 rounds. `set-default` racing `delete` never left the default missing.

  **Other checks.** Stop mid-reply on a non-default brain saves the partial under that brain, and the drain's cost lands. A restart left every preview of every conversation byte-identical (a 3.6 MB snapshot).
- **No hidden text.** Every string in every body came from a user-editable field. The full list:
  - system prompt;
  - setup content;
  - the four templates;
  - reminder;
  - tool name, description, parameter description and result;
  - ledger content;
  - steer.

  The pre-fills (`REMINDER_EXAMPLE`, `DEFAULT_TOOL`, setup pre-fill) are stored in the document and shown by `brain.list` and `prompt.preview`. The text payload view prints the tool text too.

  The only fixed strings are JSON-schema structure: the `prompt` parameter key and `call_<id>` ids, which design.md specifies. Templates without their placeholder are refused.
- **Encrypted user.** All 3 files are `SSENC1`. There were 0 hits for 17 distinctive strings in the files and in `.run/server.log`: brain names, setup text and labels, templates, reminders, ledger text, and names echoed in 404/409 errors. The log never held content for the plain user either.

## Findings

### QA-1 · minor · The retry hint after a non-default brain's broken reply sends the retry to the default brain

Repro (mock):
```bash
C=$(./sst conversation.create --title qa1 --system-prompt "You are the GM." --json | jq -r .id)
./sst brain.add --conversation $C --name "Dice Master" --system-prompt "You roll." --final-reminder.content "MOCK_MIDSTREAM_ERROR"
./sst turn --conversation $C --brain "Dice Master" --content "I try to read her intentions."
# error: The Venice stream broke off (UND_ERR_SOCKET). Your message is saved; the reply isn't.
#        To retry, send again with no new message: turn without --content, or Retry in the browser.
./sst prompt.preview --conversation $C --json | jq -r .brainName     # → Assistant: what that retry would reach
```
- **Expected:** the hint names the brain that failed, e.g. `turn --brain "Dice Master" without --content`. With several brains, "turn without --content" is a different request.
- **Actual:** following the hint literally sends a **billed** request to the default brain, which then answers the player line meant for the Dice Master. The browser's future Retry button has the same trap if it reuses `turn` without the brain.
- **Cause:** `src/commands/chat.ts:144`. The `retry` text is fixed and doesn't mention `plan.brain`. Add `--brain "<name>"` (at least when it isn't the default), and make the frontend's Retry keep the brain from `start.brainId`.

### QA-2 · nit · A whitespace-only `--as` silently writes in the default brain's voice

```bash
./sst message.add --conversation $C2 --as "   " --content "Who said this?"
# Added m_... (in Assistant's mouth).
```
- **Expected:** 400. `--as` has no documented default, and a blank author is almost surely a mistake.
- **Actual:** the message is saved with the default brain as author.
- **Cause:** `resolveBrain` (`src/conversations/prompt.ts:63`) treats a blank ref as "the default brain". That is right for an omitted `--brain`, but `message.add` (`src/commands/messages.ts:63-64`) passes `as` straight through. `turn --brain " "` and `brain.delete --brain " "` fall back to the default the same way. That is harmless there, but untidy.

### QA-3 · nit · Brain names can contain newlines and control characters, be invisible, or impersonate the player's framing

```bash
./sst brain.add --conversation $C --name $'Line\nBreak' --system-prompt x     # accepted; breaks brain.list / conversation.get lines
./sst brain.add --conversation $C --name $'​' --system-prompt x         # accepted: a zero-width-space name, invisible in every view
./sst brain.add --conversation $C --name "the user" --system-prompt x        # accepted
```
- **Expected:**
  - A name is one line of visible text.
  - Ideally, a name can't render the same as the player template's speaker. With the default template, a brain called "the user" is framed `<!-- from: the user -->`, exactly like the player, so every other brain takes its lines for Jason's.
- **Actual:** all three are accepted. Only `player` is reserved, for the CLI's `--as player`.
- **Cause:** `src/commands/brains.ts:25` (`z.string().trim().min(1).max(60)`). Reject `\p{C}` and line breaks, and require at least one visible character. For "the user", a warning is enough: the player template is editable, so no check can be complete.

### QA-4 · nit (pre-existing, CLI) · Closing stdout early crashes the CLI with a Node stack trace

```bash
./sst conversation.get --id <c_...> --json | head -c 10    # also: ./sst prompt.preview ... --json | jq <typo>
# node:events:505 throw er; // Unhandled 'error' event ... Error: write EPIPE at ... src/cli/main.ts:114
```
- **Expected:** a quiet exit, as `cat` does.
- **Actual:** a stack trace on stderr. It holds no user content.
- **Why it matters now:** this isn't T04 code. But multi-brain previews are long, and piping them into `head` or `jq` is the natural way to read them.
- **Cause:** `src/cli/main.ts:114` writes to stdout with no `EPIPE` handler. Add `process.stdout.on("error", (e) => e.code === "EPIPE" && process.exit(0))`.

## Live check

`npm run up`, encrypted `qa-t04-enc`, `deepseek-v4-1-flash`, reasoning off, `max_tokens` 200. The table: a GM ("never roll dice yourself"), a World Bible naming Vessa, and a Dice Master with a one-roll-line reminder.

| # | Call | Reply | Tokens in / out |
|---|---|---|---|
| 1 | player → GM | Narration naming Vessa | 80 / 73 |
| 2 | player → Dice Master | "Insight (Wisdom): DC 13 — Roll 17 — Success." | 196 / 17 |
| 3 | Dice Master, empty turn, right after its own reply | "Perception (Wisdom): DC 12 — Roll 8 — Failure." | 216 / 17 (44 cached) |
| 4 | GM, empty turn, after the roll | A narrated outcome | 213 / 52 |

- **Call 3** checks the one live case the engineer didn't. The request ended `[assistant (its roll), user (reminder)]`, the shape that T02 found goes wrong when the brain's own reply is last. Here it was a clean new roll line, `finish_reason: stop`.
- **No `</think>` leak** in any of the 6 ledger messages.
- **No injected prompt.** Prompt tokens track our own text, with nothing like Venice's ~550-token prompt.
- **Spend:** balance **$8.00345825 → $8.00306882**, a drop of $0.00038943. The conversation recorded $0.00039, so recorded matches billed.
- **Encrypted:** the file is `SSENC1`, with 0 hits for "Vessa", "Gilded Goat", "Dice Master", "World Bible", "System reminder", "Insight" or "hooded" in the file and in `.run/server.log`.

## Notes (not findings)

- **Mock echo splits emoji.** The mock's echo (`headTail`, `src/dev/mock-venice.ts:310`) cuts at UTF-16 units. A system prompt like "Système 🎲" can then leave a lone surrogate in a mock reply, and `jq` refuses to read that conversation file or its `--json` output. This is mock-only: the app never slices content it sends. Worth knowing when `jq` suddenly fails during QA.
- **`{{brain}}` in the player and steer templates** is never filled in. It is sent as the literal `{{brain}}`, which the preview shows, as design.md's "left as typed" rule says. design.md line 140's "(`{{brain}}` is optional)" sits next to the steer template and reads as if it worked there. If Jason wants "the user, to {{brain}}" framing for multi-brain play, it would be a small addition (the target brain's name). Not a bug today.
- **For Jason's table (judgement calls, no change needed for T04):**
  - **Regenerate is still last-message-only.** Once the Dice Master has rolled, the GM's narration before it can be edited but not re-rolled without deleting the roll. The engineer flagged it. Multi-brain play makes it come up more often; it may be worth revisiting after CP3 play-testing.
  - **Setup messages go to every brain.** That's as specified, but a GM-only module with secrets would reach the Joke Teller too. If that ever matters, a per-brain "sees this setup" toggle would fit the data model without changing the assembly rules for anyone else.

## Housekeeping

- Users `qa-t04-plain` (1.0 MB) and `qa-t04-enc` (68 KB) are kept, small, for triage to reproduce from.
- `npm test`: 89 pass. `npm run typecheck`: clean.
- The server was stopped at the end (`npm run down`).
