# T07 QA: D&D acceptance, example campaign and polish

**Verdict:** Acceptance passes: every clause of Jason's paragraph works from the terminal, using only README.md. 0 blockers, 1 major (the GM decides rolls itself and skips the Dice Master), 6 minors, 2 nits.

> **DESIGN CONCERN (QA-2): the framing can be impersonated, and prompts are the only guard.** The example's lines ("never write `<!-- from: ... -->` comments yourself") held in my run: 0 of 22 brain replies had a framing line. They are still a probability, though, and nothing guards a brain Jason adds himself. A fake line also misleads every *other* brain, because it arrives inside a real `<!-- from: Game Master -->` message, where it looks like a separate turn. I recommend the app add an **editable, visible stop-sequence setting**: it shows in `prompt.preview` as `"stop": [...]`, the example pre-fills it with `<!-- from:`, and new conversations default to the template prefix. I checked it live with one call. On `deepseek-v4-1-flash`, Venice cut the reply exactly before a requested `<!-- from: Dice Master -->` line (`finish_reason: "stop"`). It is a decoding parameter, not words sent to the model, so it stays within the "no hidden text" rule. As a cheaper second layer, `done` could flag any saved reply that contains a framing line ("this reply speaks for others: edit or regenerate it"). Neither is needed to accept T07.

## How I ran it

- **As Jason, from README.md only.** I ran `npm run up` (live), created an encrypted user `qa-t07-enc` with `printf … | ./sst user.create`, then `auth.login` and `conversation.import --example dnd-tavern`, then `export SST_CONVERSATION=…`. I played 21 live turns and regenerates, painted 3 images, and made 1 direct Venice probe (the stop sequence).
- **Then adversarial, on `npm run up:mock`.** This covered odd campaign files, round trips, clones made while an image was painting, `SST_CONVERSATION` edge cases, restarts, cross-user access and log checks. `npm test` gave 139/139 and `npm run typecheck` was clean.
- **Spend.** The balance went from $7.84644391 to $7.80706577, so **$0.0394** in all: 22 text calls (cap ~25) and **3 images** (cap 4). The conversation recorded $0.04.

## Acceptance checklist: Jason's paragraph, clause by clause

| Clause | Result | Evidence |
|---|---|---|
| README alone gets him running | **pass** (with QA-5 and QA-6) | `npm run up` → `user.create` (hidden prompt twice) → `auth.login` → `examples.list` → `conversation.import --example dnd-tavern` → `export SST_CONVERSATION` → `turn`. Every command in the README ran as written, and the output of `import` says what to do next. The README's terminal section has no recipe for tweaking a prompt (QA-5), and `SST_CONVERSATION` doesn't cover `conversation.get` (QA-6). |
| A boring game in the tavern; walk up to the hooded figure | **pass** | GM: *"The hooded figure startles, and the letter vanishes under the table fast — then resurfaces, because there is nowhere else to put it. 'I — yes. Fine. Sit.'"* That is 160 tokens, second person, and stops on an open moment. |
| Regenerate what the AI said, with a slight steer | **pass** | I ran `message.regenerate --steer "Make her a little braver: she speaks first and asks me if I'm headed east."`, which gave v2/2 *"Are you headed east? Tomorrow, I mean. Past Hollowmere?"* `prompt.preview --regenerate --steer` showed the steer last, after the old reply and the reminder. A later `prompt.preview` contained no trace of the steer. |
| A second agent with specific instructions ("tell me what dice to roll") | **pass** | Dice Master: `**Insight check:** roll 1d20 + 3, DC 12.` → "I rolled a 14" → `**14 + 3 = 17 vs DC 12: success.**` Then a plain `turn` made the GM narrate the success (*"This isn't trouble… She's a young woman working up the nerve to ask a favour"*). A failure path also flowed back: `4 + 4 = 8 vs DC 13: failure.` → the GM narrated an awkward, non-disastrous failure. QA-1 covers the GM rarely *asking* for these rolls. |
| …or "tell me a funny joke about this situation" | **pass** | The Joke Teller stayed out of the fiction, and the GM never reacted to its joke in the story. Joke quality varies (see Quality below). |
| Another agent whose text goes straight to the image generator | **pass** | The Scene Painter streamed its prompt, then `(making image … the conversation is free meanwhile)`, then a real 1024×768 WebP with no watermark: the crowned goat's head, Moss on the stool, Tobin, the farmers, and a red-haired woman in a green cloak. The Character Portraitist did the same for Odessa. Editing the painter's prompt (adding a silver fox brooch and two bowls of soup) repainted it with both details, and the old file was deleted. |
| The image is saved, and unreadable without the password | **pass** (see QA-3 for terminal viewing) | Every file under `data/users/qa-t07-enc/` except `user.json` starts with `SSENC1`. A `grep -a` for `Odessa`, `Wren`, `Gilded`, `tariffs`, `Hollowmere`, `RIFF`, `WEBP` and `VP8` over the user folder and `.run/` found nothing, and the server and mock logs held no content. After a restart, `image.get` gave `Not logged in` and the raw `GET /api/image.get` gave 401. Another user got `No image …` / `No conversation …`. A wrong password gave `Wrong password for qa-t07-enc.` |
| Tweak a system prompt mid-game and keep playing | **pass** | I added one GM line ("Tobin keeps wandering over to offer onion soup at the worst possible moments") with `brain.update --system-prompt @gm.md`. The very next GM reply had Tobin bursting in: *"ONION SOUP?"* Nothing restarted. |
| Add a new brain and keep playing | **pass** | `brain.add --name "Wren's Muse" …` mid-game. It answered in role from its first turn (a four-line verse about the clerk, the letter and the soup), saw the whole ledger, and got the default reminder. |
| The campaign survives a restart | **pass** | After `npm run up` again and a re-login: 32 messages, the Muse, the edited GM prompt and reminder, both images. |
| Clone the campaign for "Pathfinder" | **pass** | `conversation.clone --without-messages` kept the six brains, the World Bible and the edited prompts, with 0 messages. A full clone copied both images under new ids, re-encrypted. `prompt.preview` bodies for the original, the full clone and a `get --json` → `import` round trip were byte-identical for every text brain. For the Scene Painter they differed only in `call_<message id>`. |

## Is it pleasant to play?

Mostly, yes. Replies came in 2-5 s and images about 4 s, and the voice is warm and funny without overdoing it. Brain by brain:

- **Game Master: good prose, but out of its lane on checks.**
  - It kept to the word limit, ended on open moments and played Tobin and Odessa with distinct voices.
  - It never spoke for the Dice Master or wrote framing lines, and it picked up details only an image prompt held. Asked about her eyes and clothes, it answered *"Light brown eyes… a plain wool dress with a high collar"*, word for word from the Portraitist's prompt.
  - It **settled 3 of 4 uncertain actions itself** (QA-1), and wrote the lyrics of Wren's song.
- **Dice Master: excellent.** It was terse, the maths was right, it used the sheet's modifiers, it never narrated, and its verdicts flowed into the GM both ways.
- **Joke Teller: in its lane, but hit and miss.** The first joke had no punchline (*"…which is honestly the most honest thing about her"*). The plain re-roll landed (*"bards never tell anyone's secrets. We just put them in the second verse and change the names"*), though it said "we" as if it were the bard. That is LLM variance, and a re-roll fixes it, so it is not filed.
- **Scene Painter: very good.** It painted the moment and ignored the joke that came just before it. It also matched the World Bible's crown, cat and barkeep. It did invent "hood fallen back", which the GM then adopted as canon, as its prompt tells it to.
- **Character Portraitist: good.** The portrait matched the scene, and the GM later quoted it. Both painters run long (147-178 words against the 60-120 asked), which is harmless at z-image-turbo's 7500-character limit.
- **A new brain and a tweaked prompt both worked on the next message.** This is the best part of the app.

## Findings

### QA-1 · major · The GM settles uncertain actions itself, so the Dice Master is skipped

The GM's system prompt says that for persuading, lying, noticing or sneaking it should "name the check… and stop", and that it "never rolls". In play it did so once, for an Insight check after the player asked a direct question. Three times it resolved the action instead:
- **Deception** (the player tells Tobin "she's my cousin"): Tobin sees through it, and Odessa asks *"Do you always lie that badly on purpose?"* That is a failure nobody rolled for.
- **Performance** (a silly song): *"Odessa lasts three lines. Then it cracks out of her — a real laugh."* That is a success nobody rolled for, and the GM wrote Wren's lyrics.
- **Sleight of Hand** (peeking at the letter): Odessa catches him. That is a failure nobody rolled for. The Dice Master, asked afterwards, said *"the GM let it ride."*

This breaks the loop Jason's paragraph shows off: the GM names a check, the Dice Master gives the numbers, the GM honours the roll. A player who doesn't think to ask the Dice Master *before* the GM answers never rolls.

**Probable cause:** `examples/dnd-tavern.json:35`. The GM's final reminder is the last and most heeded message. It says "Continue the story from the player's latest action, and any roll that settles it" and says nothing about stopping at a check. The rule lives only deep in the system prompt.

**Fix, tried once live:** I changed the reminder to *"…then stop on the player's turn. If the latest action's outcome is uncertain (persuading, lying, noticing, sneaking, performing) and no roll has settled it yet, narrate up to that moment, name the check, and stop. Write only your own narration…"* A plain re-roll of the sneak then ended *"…that's a Sleight of Hand check."* The Dice Master gave `4 + 4 = 8 vs DC 13: failure.`, and the GM narrated the failure. It still revealed the address before stopping, but that is far closer. That is one sample, so triage should probe 2-3 kinds of check with the T07 lesson's preview+POST trick.

**Repro** (live, fresh import):
```
./sst turn --content 'I walk over to the hooded figure.'
./sst turn --content 'I beam at Tobin. "This is my cousin, from out of town."'   # expect: "That's a Deception check." and a stop
```

### QA-2 · minor (DESIGN CONCERN) · A brain can impersonate other speakers' framing; only prompts guard it

This is in the box at the top. The example's mitigation was enough in my run, with 0 framing lines in 22 brain replies, 9 of them from the GM. Two weaknesses remain:
1. It is probabilistic, and the risk grows with the ledger. The framing is a pattern a model continues, and every new framed message reinforces it.
2. It guards only brains whose prompts say so. A brain Jason adds gets `REMINDER_EXAMPLE` ("reply only as yourself"), which helps but is weaker.

Damage is visible, because the fake lines sit in that brain's own bubble, and Jason can edit or regenerate. So this is minor today. **Recommendation:** add a per-conversation `stop` list, shown in `prompt.preview` and editable in the Conversation settings, pre-filled with `<!-- from:` in the example. The live probe above shows Venice honours it on the default model. Optionally, add a `done` note when a reply contains a line that starts with a template's rendered prefix.

### QA-3 · minor · The CLI's own image hint puts a decrypted picture in the project folder, which is not gitignored

After every image the CLI prints `(image ready: ./sst image.get --id img_… --out img_….webp)` (`src/cli/main.ts:252`). From the README's working directory (the repo root), that writes a **plaintext** WebP into `~/code/simple-silver/`. `.gitignore` doesn't cover it, so `git status` shows it, and any `git add -A` by a later pass would put Jason's picture in git history. When he plays from the terminal, this command is the only way to see an image, so the paragraph's "unreadable by anyone without the password" quietly stops being true for every picture he looks at. The README's privacy section doesn't mention it either. design.md files it under "What you export: your choice", but here the app is the one suggesting it.

**Suggest:**
- Make the hint `--out "$TMPDIR/img_….webp"`, or add an `image.open` that writes to a temp file, runs `open`, and deletes the file afterwards.
- Add `/img_*` and `*.webp` at the root to `.gitignore`.
- Add one README line: "a picture you save with `image.get` is a normal, unencrypted file".

### QA-4 · minor · `conversation.import` accepts blank messages (the refine always passes)

`src/commands/campaigns.ts:29-31`: `blank()` returns `s.trim() !== "" || "<message>"`. A non-empty string is truthy, so zod's `refine` never fails. As a result:
- `{"versions":[{"content":"  "}]}` imports, and the next request carries `{"role":"assistant","content":"  "}`. This is an invariant the rest of the app keeps (`message.edit` refuses blank text).
- A blank **image** prompt imports. `image.retry` then sends `prompt: " \n "` to `/image/generate`, which the mock answers `400 prompt is required`, and the error says "Retry it", which can never work.

**Repro:**
```
echo '{"brains":[{"id":"g","name":"GM","systemPrompt":"S"}],"messages":[{"author":{"type":"brain","brainId":"g"},"versions":[{"content":"  "}]}]}' > blank.json
./sst conversation.import --campaign @blank.json            # expected: messages.0.versions.0.content: A message can't be blank
./sst prompt.preview --conversation c_… --content hi --json  # actual: an assistant message of two spaces
```
**Fix:** `(s) => s.trim() !== ""` with the message as `refine`'s second argument.

### QA-5 · minor · No terminal recipe for "slightly tweak a system prompt" or "add a brain"

The README's "Change the table mid-game" points only to the browser's settings panel, and "From the terminal" shows only `turn` and `regenerate`. To tweak one line from the terminal, Jason first has to get the current prompt into a file. `brain.list` prints it with headers and indentation around it, so in practice that means `./sst brain.list --json | jq -r '.brains[] | select(.name=="Game Master") | .systemPrompt' > gm.md`, which he would have to work out himself from `./sst help`. The command surface is complete (parity holds). The README just isn't sufficient on its own for clause 5 from the terminal.

**Suggest:** three README lines (the `jq` export, edit, `brain.update --brain "Game Master" --system-prompt @gm.md`, plus `brain.add`). A raw output mode would also do it, e.g. `brain.list --brain X --field system-prompt`.

### QA-6 · minor · `SST_CONVERSATION` stops short of `conversation.*`, and a stale one routes turns silently

With `SST_CONVERSATION` exported:
- `./sst conversation.get` gives `Invalid arguments for conversation.get: id: required`. The same happens for `conversation.update`, `.delete` and `.clone`, which take `--id`, not `--conversation` (`src/cli/main.ts:90` fills only `conversation`). Reading the story so far, or changing the image size, is exactly what you do mid-game.
- After cloning "Pathfinder", if Jason forgets to re-export, `./sst turn` plays in the **old** campaign. Nothing in the reply's output names the conversation.
- A bad value says `No conversation c_… ` without mentioning that it came from `SST_CONVERSATION`.

**Suggest:** let `SST_CONVERSATION` fill `conversation.*`'s `--id` too, and print a dim `(campaign: <title>)` line on stderr when the env var supplied the id.

### QA-7 · minor · 28 `dev-*`/`qa-*` users are still in `data/users/`, and Jason's login picker lists them all

The engineer flagged this, and it is still open. Jason's first browser login "the morning after" would show a picker of about 28 test accounts. It needs one command before handover (TICKETS.md T07 notes: `find data/users -maxdepth 1 \( -name 'dev-*' -o -name 'qa-*' \) -exec rm -rf {} +`). The last pass should run it after its own Chrome checks. I removed my own three users.

### QA-8 · nit · Three wording slips in import and clone output

- **Clone hint.** `conversation.clone` prints "(2 image prompts: image.retry paints one)" even though a clone *copies* the finished images (`campaigns.ts:347`, shared with import). For a clone, the hint should only appear for images that came out as errors.
- **Unknown model in import.** The error says "set it with `./sst conversation.update --id <conversation>`" (`turn.ts:125`), but nothing was created. "Fix `settings.textModel` in the file" fits better.
- **Template error.** It ends with a double period: "where the text should go..".

### QA-9 · nit · Small text issues in the example campaign

- **Portraitist reminder.** The Character Portraitist's reminder is the Scene Painter's ("…for the latest moment in the story…", `examples/dnd-tavern.json:87`), while its own prompt says to paint whoever was named or introduced most recently. It worked anyway.
- **Spoilers.** The GM's secret notes show in the Payload view and in `brain.list`. A README half-line ("the GM's prompt holds the story's secrets") would save a spoiled evening.

## Hard requirements: project-wide sweep (last chance)

- **No hidden text: holds.**
  - I compared `prompt.preview` with design.md's assembly for the GM, Dice Master, painter, regenerate, steer and a mid-game brain. Every string came from a visible, editable field: system prompt, World Bible, templates, reminder, tool text, steer.
  - `buildRequest` (`prompt.ts:100-150`) adds no prose.
  - Known residuals, all documented: the model's own chat template; reasoning-on's provider text (an opt-in, labelled); and the structural tool schema (`"prompt"` parameter name, `call_<id>`). None are new.
- **Terminal parity: holds.**
  - Every command in `web/src/api/types.ts` is registered.
  - No web code calls `fetch` outside `web/src/api/`.
  - The reverse gap (no browser UI yet for `examples.list`, `conversation.import` and `conversation.clone`) is frontend scope, already in the ticket.
- **Local only: holds.**
  - The server listens on `127.0.0.1` (`config.ts:37`), and so does the mock (`mock-venice.ts:314`). Vite dev uses its localhost default.
  - The built web app loads nothing from other hosts.
  - There is no git remote. `.env`, `data/` and `.run/` are ignored.
  - The one plaintext export path the app itself suggests is QA-3.
- **Every word editable: holds.** The opener, the World Bible, all five brains' prompts, reminders and tool text, and all four templates can be edited. I did it live mid-game for a prompt, a reminder and an image prompt.

## Cleanup

- `npm run down`; the server and mock are stopped.
- I deleted `qa-t07-enc`, `qa-t07-plain` and `qa-t07-other`, along with my scratch exports (including the plaintext `conversation.get --json` of the test campaign, made-up content).
- I didn't change any app code.
