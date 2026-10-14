# T05 QA report: image brains (CP4)

**Verdict: acceptance passes. 0 blockers, 0 majors, 3 minors, 3 nits.**

Checkpoint 4 delivers what Jason asked for:
- An image brain answers with a forced `generate_image(prompt)` call.
- The image is made, stored (ciphertext for an encrypted user) and served.
- Every other brain sees the exact prompt, framed. The painter sees its own call as `tool_calls` plus the tool result.
- Steered regenerate, prompt edits and retry each paint exactly the prompt that is saved.
- No message stayed pending in any failure I could cause. That includes `kill -9` mid-image, a restart mid-image, client disconnects, logout, stops, and an image request frozen for 180 s.

The findings are at the edges:
- A restart mid-image loses a paid image and its cost (measured live).
- A browser that follows an edit's image can miss a fast result.
- Slow images get misleading words from `generation.stop` and from the timeout.

No design concern. The engineer's open question (the lock is held for the whole image) is answered in **The lock and the play loop**, with a recommendation.

## How I tested

- **Mock** (`npm run up:mock`), with users `qa-t05-plain` (readable JSON) and `qa-t05-enc` (encrypted). **Live** (`npm run up`) with encrypted `qa-t05-live`.
- **Each brain's view, against my own builder.** `expect.mjs` in my scratchpad imports nothing from `src/`. It is design.md's steps 1-5 written out from the text:
  - single-pass placeholder rendering, where a placeholder with no value stays as typed;
  - blank setup messages skipped;
  - own image = `assistant` with `content: ""` and one `tool_calls` entry (`id: call_<m.id>`, the brain's current tool name, `arguments: JSON.stringify({prompt})`), then `role: tool` with the brain's `resultContent`;
  - other brains' images framed with `otherBrainImage` (`{{brain}}`, `{{prompt}}`);
  - reminder, then steer;
  - `tools` and a forced `tool_choice`.

  `checkall.sh` diffs it against `prompt.preview --json` for **every brain**: with and without `--content`, plus the regenerate re-roll and the steered preview. The test conversation had:
  - four brains: the GM, a Dice Master with a reminder, and two image brains. One image brain had custom tool text whose result is `Portrait shown {{prompt}} $& done.`. The other was renamed `Painter {{content}} $&`;
  - a setup message;
  - an `otherBrainImage` template full of stray placeholders (`[{{brain}} painted: {{prompt}} | {{content}} {{instruction}}]`);
  - a hand-written image prompt (`message.add --as Portraitist`) containing `{{content}} $\``;
  - an edited prompt with `café — 日本 "quoted" \ {{prompt}} {{brain}} $& $1 </script>`, a tab, a newline and 🎲;
  - a failed image, and nine versions with a non-last version active.

  **Every comparison matched**, before and after the ledger changes.
- **Preview == send.** I diffed the preview's chat body against the mock's logged request: equal. The `/image/generate` body equals `preview.image.params` plus the prompt. The image request's `prompt` is byte-for-byte the saved prompt for a turn, an edit (the tricky text above, `cmp`), a steered regenerate, and a retry of a non-last version.
- **Races.** `race.mjs` / `race2.mjs` ran 150 rounds over HTTP, randomising which command goes first, 0-6 ms apart:
  - `message.edit` (image) vs `turn`;
  - `image.retry` vs `message.delete` of the same message;
  - `message.add --as painter` vs `message.edit`.

  Exactly one side won every time, with a 409 or 404 for the other. After each round I checked that nothing stayed pending and that every `done` image's `image.get` was 200. No problems.
- `npm test` (104 pass) and `npm run typecheck` (clean) before I started.

## Acceptance checklist

| Bullet | Result | Evidence |
|---|---|---|
| Mock: a Scene Painter brain produces a tool call, an image is stored, `image.get` writes a valid file | **pass** | `turn --brain "Scene Painter"` streamed the prompt, then `image_pending` and `image_done`. `image.get --out` gave "PNG image data, 64 x 64". The file is `images/img_….png`, `SSENC1…` for the encrypted user. `GET /api/image.get?id=` returns 200 `image/png`, `cache-control: no-store`, and 401 without a cookie. |
| The GM's `prompt.preview` contains the exact prompt text, framed | **pass** | `<!-- from: Scene Painter. It called generate_image with this exact prompt, and that image is now on the player's screen: -->\n<prompt>`. Checked with `cmp` against the saved content (live too), and by the builder diff for every brain. |
| Live: one real tool call plus one real image with `z-image-turbo` | **pass** | Encrypted `qa-t05-live`, with the painter's default reminder on, at 768×512. Result: a real 768×512 WebP, `SSENC1` on disk. The GM's next request framed the exact prompt (`cmp`). |
| Editing the prompt generates a new image | **pass** | `message.edit` answered at once with `painting` and the old image as `previous`. The new image swapped in, and the old file was deleted. When the new image failed, the old one stayed beside the error. Editing a version that wasn't the last one repainted only that version. |
| A steered regeneration produces a new prompt and a new image | **pass** | It made a new version with its own image and `steer`. The old version kept its image. The request held the painter's `tool_calls` + `tool` result, then its reminder, then the steer (mock log). The painted prompt equals the new version's content (`cmp`). |

## Each brain's view of image messages

Everything matched my builder. What each brain gets:
- **The painter, for its own image:** `assistant`, `content: ""`, `tool_calls: [{id: "call_<m.id>", type: "function", function: {name: <current tool name>, arguments: "{\"prompt\":…}"}}]`, then `{role: "tool", tool_call_id, content: <resultContent verbatim>}`. A `$&` / `{{prompt}}` in `resultContent` is sent as typed.
  - A hand-written prompt (`message.add --as painter`) also shows as its own call, consistent with "words in a brain's mouth".
  - A brain that last spoke with its own image ends its request with `role: tool`, so an empty turn paints again, as designed.
- **Every other brain, image brains included:** one `user` message, `otherBrainImage` rendered in a single pass with `{{brain}}` = its current name and `{{prompt}}` = the active version's content. Values are never re-expanded (`Painter {{content}} $&` and a prompt containing `{{prompt}}` stay literal).
- **What doesn't depend on the image:** a failed, stopped or `max_tokens`-cut image is still framed as "now on the player's screen", and the painter's own tool result still says "The image was generated…". This is what design.md specifies ("the prompt is the canon"), and both texts are editable. I don't count it as a bug, but Jason should know the GM can be told an unmade image is on screen.

## Failure paths

| Case | What happened |
|---|---|
| `MOCK_IMAGE_ERROR` | The prompt is kept and the image is an `error`. `image_error.retry` is the exact `image.retry` request. The CLI exits 1. |
| `MOCK_IMAGE_FLAKY`, then `image.retry` | Done. |
| `MOCK_BLURRED` | `blurred: true`. Retrying with safe mode still on: blurred again. With `--no-safe-mode`: `safe_mode: false` was sent and the result was clean. The blurred file was deleted on swap-in. |
| Two parallel calls / no call / `max_tokens 3` | The first call is used, and the note says so. No call: `no_prompt` with retry, and only the player message stays. A `max_tokens` cut keeps the partial prompt with an `error` image. |
| 7,600-character prompt | Not sent; the image error says why. Then a short edit painted. |
| Stop mid-prompt / mid-image | The partial prompt is kept with "Stopped before the image was made", and the drain recorded the cost. Mid-image: waited, kept, `imageFinished: true`. |
| Client gone mid-image (`curl --max-time 0.6`), then `auth.logout` | The image finished and was saved. |
| `kill -9` mid-image after an edit (encrypted) | After restart and login: `error` "wasn't finished… Retry", with `previous` (the old done image) still there. `image.retry` then gave done, and the old file was deleted. |
| `npm run up:mock` mid-image | Interrupted, as for `kill -9` (see QA-1). |
| Bytes written but status not (hand-made state) | Recovered as done; see QA-4. |
| Image request frozen (`kill -STOP` on the mock) | Lock held for the full 180 s timeout, then `image_error`, and the stream ended with `done`. Nothing stuck. See QA-3 for the wording. |
| Delete message with 9 versions (+ an edited version's swap) | Every version's file was deleted and listed in `imagesDeleted`. `conversation.delete` removed all 14 files of a conversation. Only my hand-made orphan (QA-4) survives. |
| Edits racing generation | During an image, `turn`, `message.edit` / `.delete` / `.select-version`, `message.add`, `image.retry` and `conversation.delete` all got 409. The races above came out clean. |
| Cost | On the mock, `spentUsd` matched the mock balance drop exactly ($0.0402688). The run covered a turn, a retry, an edit, a failed image, a stopped prompt (drain), a steered regenerate and a GM turn. |

## Encryption

- On disk, an encrypted user has `conversations/<id>.json` and `images/<img>.<ext>`, all starting `SSENC1`, temp files included (vault).
- Prompts are only inside the encrypted conversation file. `grep -r` for marker words in my prompts and titles (`PLUGH`, `FROBOZZ`, `XYZZY`, `SECRET`) over the user's folder and `.run/server.log`: no hits. Live: `grep -ciE "coin|hooded|tavern|cloak"` over both logs gave 0.
- **What still shows:** the image's sniffed type as the file extension, the file size, the image count and the mtimes. The extension says which format Venice returned (WebP for z-image-turbo, PNG on the mock), which hints at the model family. The size and the mtimes are the same metadata a conversation file already gives away. See QA-6.

## The lock and the play loop

Measured live: painter → GM at once, `z-image-turbo` at 768×512, `deepseek-v4-1-flash`, painter reminder on.

```
1.27s message, start          (Venice accepted the chat request)
1.45s first prompt words
2.33s image_pending           (prompt saved; GM fired now)
2.36s GM turn refused: 409 (busy: a reply or an image is still being generated)
5.02s image_done, done        (image took 2.7 s)
~5.1s GM turn accepted (8th try, 100 ms apart); done at 6.86s
```

- **Default model: acceptable.** The lock costs the GM about 2.7 s. That is less than a GM reply takes, and about what typing the next line takes. Holding it buys a lot: nothing can edit, delete or regenerate a message under its image, `generation.follow` covers images for free, and the races above came out clean. Keep it for T05.
  - **The frontend should not surface the 409 as an error in the play loop.** While an image paints, show the other brains' chips as "waiting for the image…", or queue the send and fire it at `done`.
  - The frontend should also **render a pending image from the saved record** (`image.status`), not from the live stream. Then a later change to the lock costs little.
- **A slower model: not acceptable.** Jason's model list has models priced like slow ones: Nano Banana Pro, GPT Image, Flux 2 Max, Hunyuan. Some of those take tens of seconds. For that whole time the table is frozen: no GM, no Dice Master, no edits, no `message.add`.
  - Stop can't help: it waits 10 s and then misreports (QA-3).
  - Frozen upstream, the lock is held for the full 180 s timeout (measured).
- **Recommendation.** Before Jason picks a model slower than about 5 s, release the conversation lock at `image_pending` and guard only that message. Most of the pieces exist:
  - `painting` (images.ts) is already a per-image set.
  - `paint()`'s final save already finds its message by id and its version by image id, and handles a missing message.

  What would be needed:
  - Refuse edit, delete, select-version, regenerate and retry of a message whose image is painting, and `conversation.delete` while any image paints.
  - Keep the image (don't delete it) if its message went away.
  - Have `generation.stop` and `generation.follow` speak about the image separately.

  This is a later ticket, not a T05 fix. I'd note it under T07 (the D&D acceptance) or as its own ticket.

## Findings

### QA-1 · minor · A restart mid-image loses a paid image, and its cost goes unrecorded (measured live)

Repro (live, $0.01):
```
./ss turn --conversation $C --brain "Scene Painter" --content "Now paint the coin up close." &   # via curl
# at image_pending:
kill -9 $(cat .run/server.pid); sleep 15; npm run up; ./ss auth.login ...
./ss venice.balance; ./ss conversation.get --id $C --json | jq .spentUsd
```
- **Expected:** "Jason never loses a paid image".
- **Actual:**
  - The balance fell by $0.01023279: $0.000232785 for the prompt plus $0.01, so Venice made and billed the image. The message reads "wasn't finished… Retry", and the image itself is gone.
  - `spentUsd` recorded only the prompt. At the end of my run, the balance had dropped $0.03058079 while `spentUsd` was $0.02058078: exactly one image short.
  - The graceful path does the same thing: `npm run up:mock` mid-image gave the same "interrupted".

`kill -9` and crashes can't be helped. But **`npm run up` / `down` are the normal way to restart, and they also cut a running image**:
- The server's SIGTERM handler exits after 1 s (`src/server/main.ts:43-47`).
- `scripts/proc.ts:57-68` SIGKILLs after 2 s.
- A z-image-turbo image takes ~3 s.

Suggested fix: on SIGTERM, stop taking new generations and wait (bounded, say 30 s) for the running ones (the `generations` map in `store.ts`) before exiting, and give `proc.ts` the same patience. Optionally, put the list price on an interrupted image whose request had gone out, so the total stays honest. It is minor because the window is a few seconds and a retry costs $0.01, but it is exactly the case Jason named.

### QA-2 · minor · `generation.follow` right after an image edit or add can miss the result, leaving a client on "pending"

Repro (mock):
```
curl ... -d '{"conversation":"'$C'","message":"'$M'","content":"MOCK_IMAGE_ERROR now"}' localhost:4747/api/message.edit
#   → {"painting":{"imageId":"img_ytoy9hkvbs",…}, message …image.status "pending"}
curl ... -d '{"conversation":"'$C'"}' localhost:4747/api/generation.follow
#   → {"type":"done","message":null,"note":"Nothing is being generated for this conversation."}
```
- **Expected:** the client that edited learns how the image ended. TICKETS.md's "From T05 engineer" note says: "`message.edit` … then follow the image with `generation.follow`, which ends with `done`".
- **Actual:** any image that settles before the follow attaches leaves the client holding the edit's `pending` copy. That covers an instant Venice 4xx, a prompt over the limit, or a fast image. The server's state is right; a reload fixes it. The same gap exists at page load (`conversation.get` then `generation.follow`). `useChat.follow` patches it only when the last message is the player's (`web/src/features/chat/useChat.ts:274-277`).

This is the browser's version of "stuck pending", so it should be closed before the frontend pass. Either:
- document "`message: null` means it already settled: re-read", and have `useChat` re-read whenever its copy holds a pending image; or
- give `generation.follow` an optional `message` and have it return that message's current state when nothing runs.

### QA-3 · minor · Slow images: `generation.stop` waits 10 s, then says the image "was finished and kept" while it is still pending; a timeout says "Could not reach Venice"

Repro (mock):
```
./ss turn --conversation $C --brain "$P" --content "MOCK_IMAGE_SLOW paint the slow cellar" &
sleep 0.8; kill -STOP $(cat .run/mock.pid)
time ./ss generation.stop --conversation $C
#   → "Too late to stop the image: Venice was already making it (and billing it), so it was finished and kept in m_8lhv468ow1."  (10.15 s)
./ss conversation.get --id $C --json | jq '.messages[-1].versions[-1].image.status'   # "pending"
```
- **Expected:** words that match the state: "it is still being made and will be kept when Venice sends it".
- **Actual, part one:** the stop returned "finished and kept" with a `pending` message.
  - Cause: `stopGeneration` gives up after `waitMs = 10_000` (`src/conversations/store.ts:302-316`).
  - The CLI's format and `imageFinished` don't check the image's status (`src/commands/chat.ts:464-465`). The browser would show the same claim.
- **Actual, part two:** left frozen, the image request ended after 180 s with `image_error` "Could not reach Venice at 127.0.0.1:4748: The operation was aborted due to timeout".
  - Venice *was* reached and may well be making and billing the image.
  - `venice.request` labels every fetch failure that way (`src/venice/client.ts:39-43`), and `generateImage`'s own timeout wording (`src/venice/images.ts:29-31`) only covers a body timeout.
  - Suggested wording: "Venice didn't answer within 180 s; it may still have made (and billed) the image."

### QA-4 · nit · An image recovered as done keeps its `previous`, so a later replacement orphans that file; its cost is never counted

Repro (plain user, a hand-made "bytes written, status not" state, which a crash between `saveImageFile` and the status save would leave):
```
# with the server down: copy an image file to images/img_handmade01.png; set a version's image to
# {id: "img_handmade01", status: "pending", previous: <its old done image>}
npm run up:mock; ./ss conversation.get ...    # → status done, mime image/png, previous still set, no costUsd
./ss image.retry --conversation $C --message $M
# img_as3gz3devj (the old previous) is still on disk, referenced by nothing
```
- **Cause:** `settleStaleImages` (`src/conversations/images.ts:30-48`) marks the image done but doesn't do `paint()`'s swap-in (`paint.ts:78-81`: drop `previous`, delete its file). `newImageRecord` then drops `prev.previous` (`images.ts:53-56`). The leftover file survives `message.delete` and `conversation.delete`. The recovered image also gets no `costUsd` and adds nothing to `spentUsd`, although the comment says Venice billed it.
- It is only reachable by a crash in a window of milliseconds, hence a nit. A fix: on recovery as done, set `costUsd` from the model's list price if it's known, and leave `previous` for the next write to clean (or clean it there).
- While there: a settled-on-read image gets a new `finishedAt` on every read until something writes.

### QA-5 · nit · `image.retry` of a good image deletes it, and nothing makes a second image of the same prompt while keeping the first

`image.retry` accepts any image message. On success, the current image is dropped (file and all), even when it was done and unblurred. Design.md says retry is for "a failed, interrupted or blurred image", and "Replacing an image deletes the old file" is in the engineer's known gaps. Regenerate keeps versions, but it asks the brain for a *new* prompt, so "same prompt, another roll, keep both" isn't possible.

For Jason's "never lose a paid image", I'd either:
- refuse `image.retry` on a done, unblurred image (pointing at regenerate); or
- make a retry of a done image add a new version with the same prompt.

The frontend can also simply not offer Retry there. This is a triage call, not a bug.

### QA-6 · nit · Encrypted image files show their type in the extension

`data/users/<enc>/images/img_….webp` / `.png`. The contents are ciphertext, but the name gives away the format Venice returned. The extension carries nothing the app needs:
- the record already has `mime`;
- `image.get` sniffs the decrypted bytes anyway (`src/commands/images.ts:30`).

Using one neutral name (`img_….bin`, or no extension) for encrypted users would remove the leak. The file size and count still show; that's inherent. Fits T06's audit.

## Live check

- **User:** encrypted `qa-t05-live`. Two brains: the GM, and the Scene Painter with its default reminder on. Images at 768×512.
- **Balance:** **$7.9721937 → $7.94161291 = $0.03058079.**
- **Calls:** 3 `z-image-turbo` images (the play-loop image, the image cut by `kill -9`, and its retry) and 3 text calls (the painter twice, the GM once). `models.list --type image` once, which is free.
- **Recorded:** `spentUsd` is $0.02058078, one image short (QA-1). The balance stayed above $4.
- **Results:**
  - The forced call streamed its prompt as words: 393 in / 106 out, `finish_reason: tool_calls`.
  - The image was a real 768×512 WebP, `SSENC1` on disk.
  - The GM's next request framed the exact prompt.
  - `kill -9` at `image_pending` left the message "interrupted", with no file, though Venice billed the image; `image.retry` then painted it in 2.9 s.

## Housekeeping

- The server and the mock are stopped (`npm run down`).
- The `qa-t05-plain` (96 KB), `qa-t05-enc` (24 KB) and `qa-t05-live` (172 KB) users are kept for triage. The orphan from QA-4 is in `qa-t05-plain/images/img_as3gz3devj.png`.
- My scripts (`expect.mjs`, `checkall.sh`, `race.mjs`, `race2.mjs`, `playloop.mjs`) are in my scratchpad and are not committed.
