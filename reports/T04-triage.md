# T04 triage: multiple brains, setup messages and templates (CP3)

**Fixed 4, deferred 0, dismissed 0.** The most important fix is QA-1. Before it, a broken reply's retry hint, if you followed it, sent a billed request to the default brain instead of the brain whose reply broke. Now the hint names that brain by id. The error also carries the exact retry request as `details.retry`, so the browser's Retry can replay it instead of guessing.

No design concern. QA's two judgement calls stay as Jason specified them: setup messages go to every brain, and regenerate stays last-message-only.

## Decisions

| Finding | Decision | What changed / why |
|---|---|---|
| **QA-1** · minor · the retry hint after a non-default brain's broken reply sends the retry to the default brain | **FIX** | **CLI hint** (`turnEvents`, `src/commands/chat.ts`): "To retry, send again to Dice Master with no new message: turn --brain b_… without --content, or Retry in the browser." It names the brain every time, not only when it isn't the default, because `brain.set-default` is allowed mid-reply. It uses the id because the id is shell-safe and survives a rename. **For the browser:** `collectReply` puts the retry request on the error as `details.retry`. A turn gets `{command: "turn", args: {conversation, brain}}`. A regenerate gets `{command: "message.regenerate", args: {conversation, message, steer?}}`. Both are typed as `RetryRequest` in the dependency-free `src/conversations/types.ts`, which the web imports. `retryOf(err)` in `web/src/api/errors.ts` reads it back. Any details Venice already sent are kept. The `turn` help text says to retry with the same `--brain`. design.md (the event list and the error-wording rule) and a "From T04 triage" bullet in the T04 frontend scope describe the change. That bullet points out that `ChatView` still retries with `chat.send("")`, which goes to the default brain. Regression test in `test/brains.test.ts`: a Dice Master turn breaks mid-stream, and the test checks the hint text, `details.retry`, and that replaying it reaches the Dice Master. A steered regenerate's `details.retry` keeps the message and the steer. |
| **QA-2** · nit · a whitespace-only `--as` silently writes in the default brain's voice | **FIX** | A blank brain reference is now a 400 in the schema, not "the default brain". Only leaving the field out means the default. This covers `message.add --as` ("Say who wrote it: "player" (you), or a brain's name or id"), and `--brain` on `turn`, `prompt.preview` and the `brain.*` commands. `resolveBrain` is unchanged. Tested: nothing is added to the ledger. |
| **QA-3** · nit · brain names can hold line breaks or control characters, or be invisible | **FIX** (the "the user" part is left as is) | The `name` schema in `src/commands/brains.ts` (used by `brain.add` and `brain.update`) now refuses line breaks, tabs and control characters (`\p{Cc}`, `\p{Zl}`, `\p{Zp}`). It also needs at least one visible letter, digit, punctuation mark or symbol, so a zero-width-space name is refused. Format characters such as ZWJ are still allowed inside a name, so emoji sequences work. A brain called "the user" is still accepted with no warning: the player template is editable, so no check could be complete, and Jason names his own brains. Tested, including a name with an emoji. |
| **QA-4** · nit (pre-existing) · `./sst … \| head` crashes with an `EPIPE` stack trace | **FIX** | `src/cli/main.ts` now exits quietly (0) on `EPIPE` on stdout, as `cat` does, and rethrows any other error. The server never waits on the client, so a reply that is still streaming finishes and is saved. T03 triage had deferred this to T07. It is a one-line fix, and multi-brain previews make `\| head` the natural way to read them, so it is done now and the T07 **Deferred in** bullet is removed. |
| Note · setup messages reach every brain | no change | Jason asked for exactly this. |
| Note · regenerate is last-message-only | no change | Jason's spec. |
| Note · `{{brain}}` in the player or steer template isn't filled in | doc only | design.md now says that only the two other-brain templates fill in `{{brain}}`. The old "(`{{brain}}` is optional)" sat next to the steer template, where it read as if it worked there. |
| Note · the mock's echo can split an emoji | no change | Mock only: the app never slices the content it sends. |

## Re-verification (mock, `npm run up:mock`, current code)

Each finding was first reproduced on the unchanged code with QA's commands, as user `qa-t04-plain`. These are the same commands after the fix:

```
# QA-1 (before: "To retry, send again with no new message: turn without --content, ..." → preview brainName: Assistant)
$ ./sst turn --conversation $C --brain "Dice Master" --content "I try to read her intentions."
error: The Venice stream broke off (UND_ERR_SOCKET). Your message is saved; the reply isn't. To retry, send again to Dice Master with no new message: turn --brain b_dvlcg3zs4n without --content, or Retry in the browser.
$ ./sst turn --conversation $C --brain "Dice Master" --json | tail -1 | jq -c .error.details
{"retry":{"command":"turn","args":{"conversation":"c_iun073mxt2","brain":"b_dvlcg3zs4n"}}}
$ ./sst prompt.preview --conversation $C --brain b_dvlcg3zs4n --json | jq -r .brainName
Dice Master

# QA-2 (before: "Added m_i9f3bnusjn (in Assistant's mouth).")
$ ./sst message.add --conversation $C --as "   " --content "Who said this?"
error: Invalid arguments for message.add: as: Say who wrote it: "player" (you), or a brain's name or id          (exit 1)
$ ./sst turn --conversation $C --brain " " --content x
error: Invalid arguments for turn: brain: A blank brain names no one: give a brain's name or id, or leave it out for the default brain

# QA-3 (before: both accepted)
$ ./sst brain.add --conversation $C --name $'Line\nBreak' --system-prompt x
error: Invalid arguments for brain.add: name: A brain name is one line, with no line breaks, tabs or control characters
$ ./sst brain.add --conversation $C --name $'​' --system-prompt x
error: Invalid arguments for brain.add: name: A brain name needs at least one visible character

# QA-4 (before: "node:events:505 throw er; // Unhandled 'error' event ... Error: write EPIPE")
$ ./sst conversation.get --id c_w7r0xkla20 --json | head -c 10      # a 1 MB conversation
{
  "schem                                                            # nothing on stderr
```

**Acceptance bullets, rerun** (a new D&D conversation: GM default, World Bible, hand-written opener, Dice Master with a reminder; then player → GM → player → Dice Master → player):
```
--- prompt.preview --brain "Dice Master"         --- prompt.preview --brain "Game Master"
system     You roll dice.                         system     You are the GM…
user       <!-- This is the World Bible. -->      user       <!-- This is the World Bible. -->
user       <!-- from: Game Master -->  (opener)   assistant  Rain hammers the shutters.
user       <!-- from: the user -->                user       <!-- from: the user -->
user       <!-- from: Game Master -->             assistant  MOCK reply to brain "You are the GM…"
user       <!-- from: the user -->                user       <!-- from: the user -->
assistant  MOCK reply to brain "You roll dice."   user       <!-- from: Dice Master -->
user       <!-- from: the user -->                user       <!-- from: the user -->
user       <!-- from: Game Master -->             assistant  MOCK reply to brain "You are the GM…"
user       <!-- System reminder -->               refusal: "The last message is Game Master's own reply, so there is nothing new for it to answer."
edit the GM opener → the Dice Master's [2] is {"role":"user","content":"<!-- from: Game Master -->\nEDITED opener"}
Joke Teller added mid-game, empty turn → [Joke Teller] MOCK reply to brain "You joke."; saw 10 messages; last: "<!-- System reminder --> ..."
GM system prompt edited → [Game Master] MOCK reply to brain "GM EDITED PROMPT"; saw 11 messages
```

`npm run typecheck`: clean. `npm test`: 91 pass (89 before, plus the QA-1 test and the QA-2/QA-3 test). No live calls this pass, so nothing was spent. QA's users `qa-t04-plain` and `qa-t04-enc` were deleted, and the server was stopped (`npm run down`).
