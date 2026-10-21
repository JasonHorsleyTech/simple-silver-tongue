# T03 engineer report: steered regeneration, versions, edit and delete (CP2)

## What I built

- **`planRegenerate`** (`src/conversations/turn.ts`) is the one plan for a regenerate, beside `planTurn`. `message.regenerate` sends its body and `prompt.preview --regenerate` returns it, so the steered request can be inspected before it is sent. It does every check itself:
  - only the last message, and only one a brain wrote;
  - the message's own brain answers;
  - the steer is trimmed, and blank means a plain re-roll;
  - `reviewBody` is applied.
  
  So the preview and the send can't disagree.
  - **With a steer** the active version stays in, as the brain's own last `assistant` message, followed by the reminder if any, then the rendered steer (T02's live-proven rule). Each steer revises **whichever version is active**, so "say it's blue", then "no, say it's green", then "make it iambic pentameter" each see only the current version and the current steer. Earlier steers are never sent.
  - **Without one** the message is left out. A re-roll that would then end on the same brain's own earlier reply is refused with a specific message ("Give it a steer, or edit the message instead"). The shared send-path check (`assertAnswerable`) refuses it too.
- **Versions.**
  - A regenerate appends a new version and makes it active.
  - The version stores `steer` and `steeredFrom`, the index of the version it revised (new, display only), so a pager can say "steer 'No, say it's green.' on version 2".
  - `message.select-version` goes back to any version of any message. From the next request on, every brain sees that version, and a later steer revises it.
- **Edit and delete, any message, any depth.**
  - `message.edit` replaces the active version's text in place (`edited: true`). Blank text is refused: delete the message instead.
  - `message.delete` removes the message with all its versions.
  - Every brain reads the ledger fresh on each request, so the edit is what "always was".
- **`generation.stop`** (the stretch goal) aborts a running turn or regenerate and returns once it has settled.
  - **Decision: what had arrived is kept**, marked `stopped: true`. A turn's partial reply becomes the brain's message, and a regenerate's becomes a new active version. Jason watched that text stream in, so it's his to edit, regenerate (with a steer) or delete. Discarding it would also leave a turn's player message with no reply to regenerate.
  - With no reply text yet (still connecting, or only reasoning), nothing is saved. The stream ends with error `stopped` (status 499), whose message says what was kept.
- **Ledger edits are refused (409) while a reply is being generated.** The reply in flight answers the messages as they were sent, and a regenerate's save expects its message to still be there. Stop it, then edit. Title, settings, templates and brains can still change mid-reply, as in T02.
- **Mock echo.** A last message over 60 characters now shows its first 30 and last 29 characters around `…`, so the mock's reply to a steer shows the instruction (`…direction: --> Say it's blue.`). Shorter messages echo exactly as before, and every older test passes unchanged.

## Commands added or changed

| Command | What it does |
|---|---|
| `message.regenerate --conversation [--message] [--steer]` (stream) | Writes the last message again as a new, active version. `--message` defaults to the last message; naming any other is `not_last_message`. A player message is `not_a_brain_message`. The `start` event carries `regenerate: true` and the `steer`, and `done.message` is the whole updated message. Relayed through `gen.relay`, so `generation.follow` works. |
| `prompt.preview ... --regenerate [--message] [--steer]` | The exact body `message.regenerate` would send, with a line saying what is kept or left out. `--message` or `--steer` without `--regenerate`, or `--regenerate` with `--content` or `--brain`, is a 400. |
| `message.get --conversation --message` | One message with every version: source, steer and what it revised, cost, stopped. For picking a version from the terminal. |
| `message.select-version --conversation --message --version N` | **1-based**, as the CLI shows "version 2/3"; the document's `activeVersion` stays 0-based. |
| `message.edit --conversation --message --content` | Active version, in place. Image messages are refused until T05. |
| `message.delete --conversation --message` | Any message. Messages with images are refused until T05 deletes the files too. |
| `generation.stop --conversation` | Returns `{stopped, message, error?}`, where `message` is what was saved. With nothing running: `{stopped: false, message: null}`; an unknown conversation is a 404. |
| `conversation.get` (text view) | Shows `version 2/3` and the active version's steer. |

## Terminal transcript (mock, `npm run up:mock`, user `dev-t03-mock`)

**Green, blue, green.** Preview equals send for each steer, and the next prompt carries no steer:
```
$ ./sst turn --conversation c_x4gn113615 --content 'What color is a lime?'
MOCK reply to brain "You answer in one word."; saw 2 messages; last: "<!-- from: the user --> What color is a lime?"
$ ./sst message.regenerate --conversation c_x4gn113615 --steer "Say it's blue."
MOCK reply to brain "You answer in one word."; saw 4 messages; last: "<!-- Behind-the-scenes directi…direction: --> Say it's blue."
[Assistant · version 2/2 · steered · 89 in / 33 out · $0.000066]
preview == sent (blue): IDENTICAL          (cmp of prompt.preview --regenerate --steer ... --json .body vs /_mock/requests)
$ ./sst message.regenerate --conversation c_x4gn113615 --steer "No, say it's green."
... last: "<!-- Behind-the-scenes directi…tion: --> No, say it's green."
[Assistant · version 3/3 · steered · 94 in / 33 out · $0.000068]
preview == sent (green): IDENTICAL
# the green request's last two messages: version 2 (blue), then only this steer
[{"role":"assistant","content":"MOCK reply ... --> Say it's blue.\""},{"role":"user","content":"<!-- Behind-the-scenes direction ... -->\nNo, say it's green."}]

$ ./sst prompt.preview --conversation c_x4gn113615 --content 'Why?'
4 messages:
── [0] system ──     You answer in one word.
── [1] user ──       <!-- from: the user -->\nWhat color is a lime?
── [2] assistant ──  MOCK reply to brain "You answer in one word."; saw 4 messages; last: "<!-- Behind-the-scenes directi…tion: --> No, say it's green."
── [3] user ──       <!-- from: the user -->\nWhy?
roles: ["system","user","assistant","user"]
any non-assistant message mentions Behind-the-scenes|blue|green: false
assistant content == the active version's content: true
```
The mock's reply echoes its input, so version 3's own text quotes its steer; that is the reply, not a steer message. Live, it is just "Green" (below).

**Back to version 2, then keep playing from it:**
```
$ ./sst message.select-version --conversation c_x4gn113615 --message m_4s8rq3640q --version 2
m_4s8rq3640q now shows version 2/3 (steer: "Say it's blue."). Every brain sees it from the next request.
$ ./sst message.regenerate --conversation c_x4gn113615 --steer 'Make it iambic pentameter.'
[Assistant · version 4/4 · steered · 96 in / 33 out · $0.000068]
$ ./sst message.get --conversation c_x4gn113615 --message m_4s8rq3640q
Assistant · m_4s8rq3640q · 4 versions, version 4 active
── version 1/4 · generated · $0.00004 ──
── version 2/4 · generated · steer "Say it's blue." on version 1 · $0.000066 ──
── version 3/4 · generated · steer "No, say it's green." on version 2 · $0.000068 ──
── version 4/4 (active) · generated · steer "Make it iambic pentameter." on version 2 · $0.000068 ──
$ ./sst prompt.preview --conversation c_x4gn113615 --regenerate
Regenerating m_4s8rq3640q as version 5: a plain re-roll, so the message is left out.
2 messages: [0] system, [1] user "What color is a lime?"
```

**Rejections:**
```
$ ./sst message.regenerate --conversation c_x4gn113615 --message m_377q73skku --steer x
error: Only the last message can be regenerated, and m_377q73skku is not the last one (m_4s8rq3640q is). To change an earlier message, edit it.   [exit 1]
$ ./sst message.regenerate --conversation $C          # after deleting the last reply
error: m_gzqjv19rzo is your own message, so there is no reply to regenerate. Edit it, or ask a brain to answer it.   [exit 1]
$ ./sst message.select-version ... --version 9
error: m_4s8rq3640q has 4 versions, so there is no version 9.   [exit 1]
```

**Edit a user message 3 turns back and an assistant message 2 turns back.** There were four turns ("Turn one." … "Turn four."):
```
$ ./sst message.edit --conversation c_81g6eiv4z7 --message m_i633gvzcal --content "Turn two, EDITED by me."
Edited m_i633gvzcal (you, version 1/1). Every brain sees the new text from the next request.
$ ./sst message.edit --conversation c_81g6eiv4z7 --message m_xim9mn0n1n --content "The assistant's EDITED answer."
Edited m_xim9mn0n1n (Assistant, version 1/1). ...
$ ./sst prompt.preview --conversation c_81g6eiv4z7 --content "Turn five."
── [3] user ──       <!-- from: the user -->\nTurn two, EDITED by me.
── [4] assistant ──  MOCK reply ...; last: "<!-- from: the user --> Turn two."     (that reply is what it was; it wasn't edited)
── [5] user ──       <!-- from: the user -->\nTurn three.
── [6] assistant ──  The assistant's EDITED answer.
── [9] user ──       <!-- from: the user -->\nTurn five.
$ ./sst turn --conversation c_81g6eiv4z7 --content "Turn five."
MOCK reply to brain "Be brief."; saw 10 messages; ...      (test/regenerate.test.ts asserts the sent body == this preview)
```

**Delete, the 409 guard and stop:**
```
$ ./sst message.delete --conversation c_81g6eiv4z7 --message m_7xrw5yeerv
Deleted m_7xrw5yeerv. 9 messages left.
$ ./sst turn --conversation $C --content "MOCK_SLOW tell a long story" &   # then, from another terminal:
$ ./sst message.edit --conversation $C --message m_kg4nipr6tp --content x
error: Conversation c_81g6eiv4z7 is busy: a reply is being generated from the messages as they are now. Wait for it to finish, or stop it, then change the messages.   [exit 1]
$ ./sst generation.stop --conversation $C
Stopped. What had arrived is saved: m_oreifujhg4, version 1/1.
  (the turn's terminal:)  MOCK reply to brain
                          [Assistant · stopped: what had arrived is saved (Venice reports no usage or cost for a stopped reply)]
$ ./sst conversation.get --id $C | tail -2
── Assistant · m_oreifujhg4 · stopped ──
MOCK reply to brain

# stop before Venice answers (mock paused with kill -STOP):
$ ./sst generation.stop --conversation $C
Stopped before the reply started. Nothing was saved.            (turn: exit 1, same message; 10 messages before and after)
$ ./sst generation.stop --conversation $C                         (a steered regenerate, mock paused)
Stopped before the new version started. m_oreifujhg4 keeps its current version.
$ ./sst generation.stop --conversation $C
Nothing is being generated for this conversation.
```

**Encrypted user** (`dev-t03-enc`): after a turn, a steered regenerate with the steer `STEER-SECRET-PHRASE` and an edit to `EDIT-SECRET-PHRASE`, the conversation file starts with `SSENC1`. `grep -a -c` finds 0 hits for the title, the system prompt, the message, the steer and the edit, and `.run/server.log` has none either. `message.get` decrypts it and shows the steer.

**Tests.** `npm test`: 78 pass (71 before).
- `test/prompt.test.ts` (pure): planRegenerate keeps the active version before the reminder and steer, and a re-roll leaves it out. A blank steer is a re-roll. Only the last message, only a brain's. The two-replies-in-a-row re-roll refusal is checked on the send path too.
- `test/regenerate.test.ts` (CLI end to end against the mock):
  - green, blue, green, with preview == sent for every regenerate;
  - the next prompt is exactly system, question, active version, new message;
  - select-version, then steer from version 2;
  - rejections, with nothing sent upstream;
  - edits at depth, with preview == sent;
  - delete;
  - 409s for edit, delete, select-version and turn mid-reply;
  - `generation.follow` sees `start.regenerate`, and stop keeps exactly the streamed text;
  - stop before any text for both turn and regenerate.

`npm run typecheck` is clean (server and web).

## Live check (`npm run up`, user `dev-t03-live`, `deepseek-v4-1-flash`, reasoning off)

```
$ ./sst turn --content "What color is a fresh lime?"                 Green                          [27 in / 2 out · $0.000011]
$ ./sst message.regenerate --steer "Say it's blue."                  Blue      [version 2/2 · steered · 66 in / 2 out · $0.000022]
$ ./sst message.regenerate --steer "No, say it's green."             Green     [version 3/3 · steered · 68 in / 2 out · $0.000023]
$ ./sst message.regenerate --steer "Make it iambic pentameter."      A fresh lime's color is a shade of green.   [version 4/4 · 69 in / 12 out]
$ ./sst prompt.preview --content 'Why that color?' --json | jq -c .body.messages
[{"role":"system",...},{"role":"user","content":"<!-- from: the user -->\nWhat color is a fresh lime?"},
 {"role":"assistant","content":"A fresh lime's color is a shade of green."},{"role":"user","content":"<!-- from: the user -->\nWhy that color?"}]
 any message mentions Behind-the-scenes|blue|iambic: false
$ ./sst message.select-version --message m_8nyalpl0f9 --version 2      → "Blue" is now what the brain said
$ ./sst turn --content "Why that color? One sentence."
Because you asked for one word, I gave a deliberately wrong color instead of the actual green.   [45 in / 20 out]
$ ./sst message.edit (user, 2 back) "What color is a ripe lemon?" ; ./sst message.edit (assistant) "Yellow"
$ ./sst message.regenerate                                            (plain re-roll of the last reply, with the edited history)
Ripe lemons are yellow because their skin contains carotenoid pigments that become visible as chlorophyll breaks down during ripening.
$ ./sst turn --content "Ignore the one-word rule: count from 1 to 300 in words, comma-separated." &  sleep 2.5; ./sst generation.stop
Stopped. What had arrived is saved: m_2d2ri3084z, version 1/1.
saved: {"stopped":true,"usage":null,"costUsd":null,"chars":446,"tail":"...forty-two, forty-three, forty-four"}
```
- **Steering works live.** Each steer revised only the active version, and the next request has only our four messages. 45 prompt tokens after selecting "Blue" fits system, question, "Blue" and the new message; a steered request is 66-69.
- **Going back to a version and playing on from it works.** The model took "Blue" as its own earlier answer; its explanation is just world knowledge.
- **Edits at depth are what the model sees.**
- **Finding: stopping doesn't stop the bill.** Over the 7 live calls, the recorded costs add up to $0.00017, but the balance fell by $0.00080. The difference, about $0.0006, is about the full `max_tokens` = 500 output tokens of the stopped reply, so Venice probably kept generating after we disconnected. Recorded in design.md: stop saves waiting, not money, and a stopped reply's cost is missing from the conversation's total.

## Live spend

7 live text calls, no images. Balance **$8.00927657 → $8.00847497** (−$0.0008, including the stopped reply's apparent full billing).

## Known gaps

- **A stopped reply's cost isn't counted.** Venice sends usage last, so the conversation total under-reports, and live suggests the whole reply is billed anyway. Fixing it would need a way to ask Venice what a stopped generation cost; I haven't looked for one.
- **No way to delete a single version.** A stopped or unwanted version stays in the pager; you can select away from it. The scope didn't ask for this.
- **Image messages** can't be edited or regenerated (`not_supported`, T05), and messages with images can't be deleted until T05 removes the image files with them. None can exist yet.
- **Stop before Venice answers, from a test.** That path is checked by hand (`kill -STOP` the mock), not by an automated test. Stop mid-reply and stop before any text are tested.
- **The edit lock has a small race.** The 409 check runs inside the conversation's write queue, but a generation that started a few milliseconds earlier may already have read the old ledger. Its reply then answers the pre-edit text. That is harmless, and no worse than an edit landing a moment after the reply finished.

## Changes to design.md

- Data model: `steeredFrom` and `stopped` on versions.
- Storage mechanics: ledger edits are refused while generating, and `generation.stop` uses the lock's `AbortController`.
- Prompt assembly: `planRegenerate` and `prompt.preview --regenerate`, and the preview's `regenerate` field.
- Turns/regenerate/edits:
  - regenerate's order and failure modes;
  - `--message` defaults to the last message;
  - version numbers are 1-based in commands;
  - edit refuses blank text;
  - the new **stop** entry with the keep-partial decision and why.
- Stream events: `start` gets `regenerate` and `steer`.
- The list of T03 commands.
- Live facts: chained steers, and stop not stopping the billing.
- Mock: the head…tail echo, and how to check "no trace of a steer" against the mock.

No design concern: the steer-keeps-the-reply rule and the shared ending check held up, live too.
