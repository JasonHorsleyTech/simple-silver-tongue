# T05 triage: image brains (CP4)

**Fixed 5, deferred 1, dismissed 0.** No design concern. I also made the orchestrator's lock change: **an image no longer holds the conversation once its prompt is saved.** That change is what fixes QA-2 and QA-3.

## The lock change (orchestrator direction, QA's "lock and the play loop")

Jason's loop is: the painter paints, he sends the next line to the GM at once, and the image fades in. The other brains need only the prompt, and the prompt is in the ledger at `image_pending`. So the image brain's generation now **ends there**, and the image is a job of its own.

- **How it works.**
  - `paintReply` saves the prompt with a pending image and starts the image (`startPainting`, on its own `forkVault` copy).
  - It announces `image_pending` to followers, and the lock is released.
  - Only then does `turn` / `message.regenerate` yield `image_pending` to its own client. The stream then follows the image to `image_done` / `image_error` + `done`, so the event order and the CLI output are as before.
  - `generation.follow` that attached before `image_pending` follows the image to the end too.
- **Tracked per image.** `images.ts` holds each image being made: its message, and a `settled` promise with the final event.
- **A message whose image is still rendering.** The rule: what would replace or remove an image that Venice is already making and billing waits for it, with a 409. That is:
  - editing that version's prompt (the new image would replace it before it was ever shown);
  - retrying that image (a second bill for the same version);
  - deleting the message, and `conversation.delete` (the paid image would have nowhere to land).

  Nothing else waits:
  - any brain's turn;
  - **regenerate** (a new version with its own image; the old one lands in its own version, found by image id);
  - select-version;
  - edits and deletes of other messages;
  - brains, settings and templates.

  Prompt edits and `message.add` are still ledger edits, so they still wait for a *reply* being written. `image.retry` doesn't wait for a reply, because no brain sees anything new.
- **Edit, add and retry** no longer take the lock at all. `runDetached` is gone.
- **Verified live:** the GM's turn was accepted at `image_pending` on the first try and finished before the image landed (transcript below). QA had measured a 409 there and 8 retries.

## Findings

| Finding | Decision | What changed / why |
|---|---|---|
| **QA-1** · a restart mid-image loses a paid image, and its cost | **FIX** | On SIGTERM the server stops taking new work (503 `shutting_down` for a new turn, regenerate, edit, add or retry). It then waits up to 60 s for every generation and every image in flight (`stopTakingWork` + `finishInFlight`, store.ts; `src/server/main.ts`). It gives the ending streams 1 s to flush, then exits. A second signal exits at once. `scripts/proc.ts` now waits 65 s before SIGKILL (it was 2 s) and says why after 1 s. Live: `npm run up` mid-image took 3.2 s, the image was kept, and `spentUsd` matched the balance drop to the digit. Only `kill -9` or a crash can still lose one; I dismissed QA's optional "list price on an interrupted image": we can't tell whether its request went out without another write, and over-counting is no more honest. |
| **QA-2** · `generation.follow` can miss a fast image result | **FIX** | New stream command **`image.follow --conversation --message`**. It streams `image_pending` for each of the message's images being made, then `image_done` / `image_error`, and ends with `done` and the message as saved. With none being made, it ends at once with the current message. It reads, waits for each pending image's job, and reads again, so it can't miss a result. QA's exact repro (edit to `MOCK_IMAGE_ERROR`, then follow) now returns `done` with the `error` image. The frontend rule is in TICKETS.md: follow every pending image in your copy with it. |
| **QA-3** · stop says "finished and kept" for a pending image; a timeout says "Could not reach Venice" | **FIX** | Mostly dissolved by the lock change: after `image_pending` there is nothing to stop. `generation.stop` now returns `painting: [{messageId, imageId}]` and the CLI says so with `IMAGE_STOP_NOTE` (wording.ts), at once (0.1 s, mock frozen; it was 10.15 s and wrong). `imageFinished` is removed. A stop whose generation hasn't settled after 10 s now says `still_saving` instead of claiming success. Timeouts: `venice.request` reports its own timeout as "Venice didn't answer … within N s" (`details.timeout`), and `generateImage` turns that into "Venice didn't send the image within 180 s. It may still have made (and billed) it; retry to paint the prompt again." There is a unit test with a hanging fetch. |
| **QA-4** · a recovered-as-done image keeps `previous`, so a later replacement orphans that file; its cost isn't counted | **FIX** (the orphan) | `settleStaleImages` now swaps a recovered image in, as `paint()` does: it drops `previous` and deletes that file. That closes the orphan, which outlived message and conversation deletes. Not fixed: the recovered image's cost (the list price needs the model list, which a read doesn't have, and it takes a crash in a millisecond window), and `finishedAt` moving on each read until the next write (harmless). |
| **QA-5** · `image.retry` of a good image deletes it | **FIX** | A retry of a finished, clean image now **adds a new version with the same prompt** (`repaintOf`: the version it repaints; display only) and makes it active, so both paid images are kept. A failed, interrupted, blurred or flagged image is still replaced in place. Refusing the retry would have removed the only "same prompt, another roll" path, which design.md itself points to ("the same prompt again… use `image.retry`"). Live: the retry made v2, and both `.webp` files are on disk. |
| **QA-6** · an encrypted image's extension shows its type | **DEFER → T06** | Not trivial. Changing the on-disk name means `findImageFile` must keep finding old names, and `settleStaleImages` must sniff decrypted bytes for `mime`. T06's encryption audit owns it (bullet added under its **Deferred in**). |

### Other changes
- **`gen.relay` returns its generator's return value**, and closes the inner generator if it is closed early. `gen.announce(ev)` records an event for followers only.
- **`generation.follow` with nothing running** names the images still being made, in its note.
- **CLI.** The `image_pending` line says "the conversation is free meanwhile". The edit and add hints point at `image.follow`. The busy 409 reads "a reply is still being generated".
- **`web/src/api/types.ts`** has `image.follow`, the new `StopOutcome.painting`, and `imageFinished` removed. The UI itself is the frontend pass's: see **From T05 triage** in TICKETS.md.
- **Docs.** design.md ("Image generation" 5-8, Turns, stop, delete, the data model's `repaintOf`, the command surface) and AGENTS.md (Running it, the command list, and a lesson that replaces the T05 "holding the lock" notes).

### A note, not a concern
The GM now routinely answers while the image is still being made. So the default `otherBrainImage` ("that image is now on the player's screen") and the painter's tool result are a few seconds early. A failed image makes them wrong, as before. Both texts are editable, and the prompt is the canon. QA flagged the same point for failed images.

## Tests

- `test/images.test.ts`: from 7 to 11 tests.
  - The edit test no longer expects a 409 on `turn`. It expects one on a second edit while the image paints.
  - The stop test now expects `stopped: false` and `painting` after `image_pending`, with the turn's stream going on to `image_done` + `done`.
  - `settled()` uses `image.follow`.
  - New: **the play loop**.
    - At `image_pending` the GM's turn succeeds and sees the framed prompt while the image is still pending.
    - Edit, delete, retry and `conversation.delete` of the painting message get a 409. Editing another message and changing a brain succeed.
    - A follower that attached mid-prompt sees `image_pending → image_done → done`.
    - A regenerate during an image gives two versions, both done.
  - New: **QA-2** (a result that settled first is reported; live `image_pending → image_done → done`; an unknown message fails).
  - New: **QA-5** (done → new version, `repaintOf: 0`, the first file kept; a blurred one is still replaced in place).
  - New: **QA-1** (`finishInFlight` waits for an image mid-paint).
- `test/image-parts.test.ts`:
  - QA-4: a recovered image drops `previous`, and its file is gone.
  - QA-3: a timed-out image's wording, from a hanging fetch.
- `npm test`: **109 pass** (4 more runs of the image tests: all pass). `npm run typecheck`: clean.

## Re-verification

**QA's repros, mock (`npm run up:mock`, `qa-t05-plain`):**
```
# QA-2: edit to MOCK_IMAGE_ERROR, then follow
POST message.edit        → {"painting":{"imageId":"img_qo48099zc9",…},"st":"pending"}
POST image.follow        → {"type":"done","st":"error","err":"Venice 400 on /image/generate: mock: forced image error (MOCK_IMAGE_ERROR)"}

# QA-3: MOCK_IMAGE_SLOW turn, kill -STOP the mock, stop
$ time ./ss generation.stop --conversation $C
Nothing is being generated for this conversation.
Still being made: img_pxnv8k8261 (m_6zvz92ezmi). An image can't be stopped once its prompt is saved: Venice is already making it, and billing it, so it is kept when it arrives.
… 0.117 total                                     (was 10.15 s and "finished and kept")

# QA-1: MOCK_IMAGE_SLOW turn, then npm run up:mock
(the server is finishing what it is making first: replies and images in flight are saved, not lost)
npm run up:mock … 2.722 total
turn's own output: [Scene Painter · … · image img_vjdyrguz9f done (z-image-turbo, png, $0.01)]
server.log.1: SIGTERM: shutting down / waiting for 1 running reply or image to finish and save
after login: {"id":"img_vjdyrguz9f","status":"done","error":null}       (was "interrupted")

# QA-5: image.retry of a done image
{"active":1,"v":[{"repaintOf":null,"img":"img_vjdyrguz9f","st":"done"},{"repaintOf":0,"img":"img_kp08i0sov0","st":"done"}]}
img_vjdyrguz9f.png still on disk
```

**Acceptance, mock, encrypted `dev-t05-tri`:**
```
$ ./ss turn --conversation $C --brain "Scene Painter" --content "Paint the hooded figure."
MOCK image prompt after 2 messages; last: "<!-- from: the user --> Paint the hooded figure."
(making image img_d9bsqrke4c with z-image-turbo... the conversation is free meanwhile)
[Scene Painter · 16 in / 27 out · $0.000037 · image img_d9bsqrke4c done (z-image-turbo, png, $0.01)]
$ ./ss image.get --id img_d9bsqrke4c --out acc.png     → PNG image data, 64 x 64; on disk: SSENC1
$ ./ss prompt.preview --conversation $C --json | jq -r ".body.messages[-1].content"
<!-- from: Scene Painter. It called generate_image with this exact prompt, and that image is now on the player's screen: -->
MOCK image prompt after 2 messages; last: "<!-- from: the user --> Paint the hooded figure."
$ ./ss message.regenerate --conversation $C --steer "Make it brighter."
[Scene Painter · version 2/2 · steered · … · image img_21nna4ti6w done (z-image-turbo, png, $0.01)]
$ ./ss message.edit … --content "MOCK_IMAGE_SLOW A hooded figure in a red coat."
… Making its image img_21b4e0vnlm with z-image-turbo. img_21nna4ti6w stays until it is ready. Other brains can go on meanwhile. Watch it: ./ss image.follow --conversation c_cj712arguk --message m_u6j6kmlf55
$ ./ss turn --conversation $C --content "I wave."            # while the edit paints
[Game Master · 68 in / 24 out · $0.000049]
$ ./ss message.delete --conversation $C --message $M         # while it paints
error: Can't delete m_u6j6kmlf55 yet: its image img_21b4e0vnlm is still being made. Venice is already making it (and billing it), so it will be kept. Wait for it to arrive (image.follow watches it), then try again.
$ ./ss image.follow --conversation $C --message $M
(making image img_21b4e0vnlm with z-image-turbo... the conversation is free meanwhile)
[image img_21b4e0vnlm done (z-image-turbo, png, $0.01)]
images/: img_21b4e0vnlm.png img_d9bsqrke4c.png          (the steered version's replaced image is gone)
```

**Live (`npm run up`, encrypted `dev-t05-tri-live`, GM + Scene Painter with its default reminder, 768×512):**

Painter → GM at once (`playloop.mjs`: the GM's turn fired the moment `image_pending` arrived):
```
1.46s painter message / start
1.59s painter prompt
3.16s painter image_pending
3.95s GM turn answered HTTP 200       (QA measured a 409 here, then 8 retries)
4.79s GM done Game Master · 204 in / 61 out · $0.00013
6.04s painter image_done image/webp   (the GM was done before the image landed)
6.04s painter done Scene Painter · 391 in / 131 out · $0.00027 · image img_hs2n497v3f done (z-image-turbo, webp, $0.01)
```

The GM's view held the framed prompt exactly (one `user` message equal to the template plus the saved content). The image: a real 768×512 WebP, `SSENC1` on disk.

Then `image.retry` of that finished image, with `npm run up` at its `image_pending`:
```
(the server is finishing what it is making first: …)    npm run up … 3.189 total
[Scene Painter · image img_kf0gt74vln done (z-image-turbo, webp, $0.01)]
after login: v1 img_hs2n497v3f done, v2 img_kf0gt74vln done (repaintOf 0), both files on disk
```

## Live spend

**$7.94161291 → $7.92120401 = $0.0204089.**
- 2 `z-image-turbo` images (within the ≤2 limit).
- 2 text calls: the painter and the GM.
- The conversation's `spentUsd` is $0.0204089, the same figure. The balance stayed above $4.

## Housekeeping

- Deleted the users `qa-t05-plain`, `qa-t05-enc` and `qa-t05-live` (QA-4's orphan went with them), and my own `dev-t05-tri` and `dev-t05-tri-live`.
- The server and the mock are stopped (`npm run down`).
