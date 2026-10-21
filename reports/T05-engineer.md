# T05 engineer report: image brains (CP4)

No design concern. design.md's flow held up. I changed four mechanisms, all documented in design.md, "Image generation":

1. The prompt streams as words (`prompt` events), not raw `tool_args` JSON.
2. Every image is made while holding the conversation's generation lock.
3. Edits and hand-written prompts paint in a detached job.
4. Pending images that nobody owns are settled when they are read.

The reasons are below.

## What I built

- **Image brains answer with a picture.** `turn --brain "Scene Painter"` sends the brain's forced `generate_image` call (T02's builder already made it). The prompt streams live, as words: a small decoder pulls the `prompt` string out of the argument fragments as they arrive, escapes and split points included.
  - The whole prompt is saved as the message's content, with a pending image.
  - Then `/image/generate` runs with the conversation's image model and the brain's safe mode.
  - The bytes are sniffed (WebP live, PNG on the mock) and stored as `images/<id>.<ext>` through the vault, so they are ciphertext for an encrypted user. Only after that does the record say `done`.
  - The stream stays open until the image is settled, then ends with `done`.
- **Every other brain sees the exact prompt, framed** (`otherBrainImage`). The painter sees its own call as `tool_calls` plus the editable tool result. This was already in T02's builder; it is now verified live.
- **Steered regenerate** of an image message gives a new prompt and a new image, as a new version. The old version keeps its image.
- **Editing the prompt by hand** (`message.edit`) edits it in place and starts a new image.
  - The edit answers at once. The old image stays as `previous` until the new one is done, then the new one swaps in and the old file is deleted.
  - If the new image fails, the old one is still shown beside the error.
- **`image.retry`** paints the active prompt again: for a failed, interrupted or blurred image. A blurred one usually needs safe mode turned off first.
- **`message.add --as "Scene Painter"`** makes your text its prompt and paints it.
- **`image.get --id`** returns the decrypted bytes with the sniffed Content-Type. `GET /api/image.get?id=` works for `<img src>`.
- **Deleting** a message or a conversation deletes its image files, after the ledger is saved.
- **Safe mode** is the brain's toggle, sent as `safe_mode`. A blurred or flagged answer is recorded as `blurred` / `contentViolation`.
- **Image settings.** `conversation.update --settings.image.{width,height,aspect-ratio,resolution,format,hide-watermark,negative-prompt}`.
  - Only what the model takes is sent, going by `/models` constraints: width×height in multiples of 8 for z-image-turbo, a listed resolution and aspect ratio for Nano Banana. Anything left out is named in notes.
  - A size the model can't take is refused when it is set.
  - `prompt.preview --brain <painter>` shows the exact image body (all but the prompt) after the chat body.
- **Cost.** The image's list price goes on the image and on `spentUsd` once Venice has made it. Live, the recorded total matched the balance drop to the last digit.

### Robustness (the part that mattered most)

- **The browser going away doesn't matter.** The work never waits on the client, and images get that for free: a killed client mid-image still gets its image saved (tested by hand and in `images.test.ts`). Logging out right after an edit doesn't stop its image either, because the detached job holds its own key copy.
- **Nothing stays "pending" forever.**
  - Each image job records its image in an in-memory set *before* the pending record reaches disk. It removes it only after the final status is written.
  - `loadConversation` settles any pending image that isn't in that set, which means the server stopped while painting it. If the file reached disk, it becomes `done`: Venice made it and billed it, so it is kept. Otherwise it becomes an error saying it was interrupted, which `image.retry` fixes.
  - Bytes are written before the status. So the only way to lose a paid image is a crash between Venice answering and our write, which is milliseconds.
- **One thing at a time.** An image is made inside a generation, holding the lock from the prompt to the settled image.
  - Nothing can edit, delete or regenerate the message under it (409).
  - `generation.follow` shows it like a reply, including after a reload.
  - Locking was the simplest way to rule out races between an image landing and an edit, and z-image-turbo takes ~3 s.
- **Stops are honest.**
  - A stop while the prompt streams keeps the prompt (it was shown and paid for), with no image and an error saying so.
  - A stop once the image is with Venice can't save money, so it waits, keeps the image, and says "Too late to stop the image… finished and kept" (`imageFinished: true`).
- **Bad answers fail cleanly.**
  - A model that ignores the tool, or calls it with no prompt, fails like a broken reply (`no_prompt`, with `details.retry`); only the player message stays.
  - A prompt cut by `max_tokens` is kept with an error image.
  - A prompt over the model's character limit is never sent.
  - Image HTTP errors become the image's error, with `image_error.retry`. The CLI exits 1 on an image error.
- **The T02 parallel-call bug is fixed.** Tool-call fragments are kept per `index`, and only the first call is used. A second call is named in the `done` note. `parallel_tool_calls` is still not sent.

## Commands added or changed

| Command | What changed |
|---|---|
| `turn --brain <image brain>` | Was refused. Now streams `start {kind:"image"}` → `prompt` deltas → `image_pending {message}` → `image_done` / `image_error {retry}` → `done`. |
| `message.regenerate` | Image messages: a new prompt and a new image, as a new version (steer or plain re-roll). |
| `message.edit` | Image message: the new prompt, then a new image swaps in. Answers at once with `painting: {imageId, model}`. |
| `message.add --as <image brain>` | Was refused. Adds the prompt and paints it. Answers at once with `painting`. |
| `message.delete`, `conversation.delete` | Delete the image files too. `message.delete` returns `imagesDeleted`. |
| `image.get --id img_…` (new, binary, GET too) | Decrypted bytes, Content-Type sniffed. 404 while pending or after a failure. |
| `image.retry --conversation --message` (new, stream) | Paints the active prompt again. |
| `prompt.preview` | For an image brain, adds `image: {path, params, notes}`, the exact image body minus `prompt`. |
| `conversation.update` | `--settings.image.*`, checked against the image model. |
| `generation.stop` | `imageFinished: true` when it came during an image. |
| `help` | Lists nested fields (`--settings.image.width`). |

Events: `tool_args` became **`prompt`** (decoded words). The image events now carry `message` (and `image`, `retry`), and `start` carries `kind` / `imageOnly`. All of it is in design.md and in `web/src/api/types.ts`.

**Mock:**
- Image triggers: `MOCK_BLURRED`, `MOCK_VIOLATION`, `MOCK_IMAGE_ERROR`, `MOCK_IMAGE_FLAKY` (fails once per prompt, for retry) and `MOCK_IMAGE_SLOW`.
- Chat triggers: `MOCK_TWO_TOOL_CALLS` (interleaved by `index`) and `MOCK_NO_TOOL_CALL`.
- `max_tokens` now also cuts tool-call arguments.

## Terminal transcript

### Mock (`npm run up:mock`, encrypted user `dev-t05-enc`)

```
$ ./sst brain.add --conversation $C --name "Scene Painter" --kind image --system-prompt "You are the Scene Painter. ..." --no-final-reminder.enabled
Added brain Scene Painter (b_d7eluedj86) · image · reasoning off · final reminder off · safe mode on
$ ./sst prompt.preview --conversation $C --brain "Scene Painter" --content "Paint the hooded figure."   (tail)
Then POST /image/generate, with "prompt" set to the prompt from its tool call, word for word:
{"model":"z-image-turbo","safe_mode":true,"format":"webp","hide_watermark":false}

$ ./sst turn --conversation $C --brain "Scene Painter" --content "Paint the hooded figure."
[Scene Painter]
MOCK image prompt after 3 messages; last: "<!-- from: the user --> Paint the hooded figure."
(making image img_p19e6aqf4o with z-image-turbo...)
(image ready: ./sst image.get --id img_p19e6aqf4o --out img_p19e6aqf4o.png)
[Scene Painter · 61 in / 27 out · $0.000051 · image img_p19e6aqf4o done (z-image-turbo, png, $0.01)]
$ ./sst image.get --id img_p19e6aqf4o --out painter.png && file painter.png
Wrote 179 bytes (image/png) to .../painter.png
painter.png: PNG image data, 64 x 64, 8-bit/color RGB, non-interlaced
$ head -c 6 data/users/dev-t05-enc/images/img_p19e6aqf4o.png
SSENC1
$ ./sst prompt.preview --conversation $C --json | jq -r '.body.messages[3].content'      # the GM's view
<!-- from: Scene Painter. It called generate_image with this exact prompt, and that image is now on the player's screen: -->
MOCK image prompt after 3 messages; last: "<!-- from: the user --> Paint the hooded figure."
```

**Steer, then a hand edit** (the old image stays until the new one lands; a turn meanwhile is a 409):
```
$ ./sst message.regenerate --conversation $C --steer "Make it brighter."
[Scene Painter · version 2/2 · steered · 144 in / 30 out · $0.000079 · image img_9iw9n1qvdj done (z-image-turbo, png, $0.01)]
$ ./sst message.edit --conversation $C --message $M --content "MOCK_IMAGE_SLOW A hooded figure in a worn leather coat, ..."
Edited m_iewew326so (Scene Painter, version 2/2). Every brain sees the new prompt from the next request. Making its image img_gc6sp36ovo with z-image-turbo. img_9iw9n1qvdj stays until it is ready. Watch it: ./sst generation.follow --conversation c_sd1z1w3tkf
$ ./sst turn --conversation $C --content "I wave."
error: Conversation c_sd1z1w3tkf is busy: a reply or an image is still being generated. Wait for it to finish, then try again.
$ ./sst generation.follow --conversation $C
[Scene Painter · image img_gc6sp36ovo done (z-image-turbo, png, $0.01)]
$ ls data/users/dev-t05-enc/images/      # img_9iw9n1qvdj (the replaced image) is gone
img_d5h6ucfuv9.png  img_gc6sp36ovo.png  img_p19e6aqf4o.png
$ ./sst prompt.preview --conversation $C --content "What is the figure wearing?" --json | jq -r '.body.messages[-2].content'
<!-- from: Scene Painter. It called generate_image with this exact prompt, and that image is now on the player's screen: -->
MOCK_IMAGE_SLOW A hooded figure in a worn leather coat, by a roaring fire, warm golden light.
```

**Failure and retry:**
```
$ ./sst turn --conversation $C --brain "Scene Painter" --content "MOCK_IMAGE_FLAKY paint the bar"     (exit 1)
image error: Venice 503 on /image/generate: mock: the image service is busy, try again (MOCK_IMAGE_FLAKY)
Retry it: ./sst image.retry --conversation c_sd1z1w3tkf --message m_zivpx3skfe
$ ./sst image.retry --conversation $C --message m_zivpx3skfe
[Scene Painter · image img_vnu07cfwqg done (z-image-turbo, png, $0.01)]
```

**Browser gone, then server killed, mid-image:**
```
$ ./sst turn ... --content "MOCK_IMAGE_SLOW paint the stairs" &  ; sleep 0.8; kill <the CLI>
── Scene Painter · m_zrtzn2v6sq · image prompt · image img_2izo5k9shd being made with z-image-turbo ──
--- 2.5 s later:
── Scene Painter · m_zrtzn2v6sq · image prompt · image img_2izo5k9shd done (png, $0.01) ──

$ ./sst turn ... --content "MOCK_IMAGE_SLOW paint the cellar" &  ; sleep 0.8; kill -9 $(cat .run/server.pid); npm run up:mock; ./sst auth.login ...
── Scene Painter · m_x3xmhfrndf · image prompt · image img_6ntpnye3lk failed: The image wasn't finished: the server stopped while it was being made. Retry it to paint this prompt again. ──
$ ./sst image.retry --conversation $C --message m_x3xmhfrndf
[Scene Painter · image img_j7iv5drtsw done (z-image-turbo, png, $0.01)]
```

**Stops:**
```
$ ./sst turn ... --content "MOCK_SLOW paint the rafters" & ; sleep 1.2; ./sst generation.stop --conversation $C
Stopped. What had arrived is saved: m_e8rf6sucm0, version 1/1.
── Scene Painter · m_e8rf6sucm0 · image prompt · image img_a1p2t1eo5k failed: Stopped before the image was made, so none was requested. Retry to paint this prompt as it is, or edit it first. · stopped ──
MOCK image prompt after 2
$ ./sst turn ... --content "MOCK_IMAGE_SLOW paint the door" & ; sleep 0.7; ./sst generation.stop --conversation $C
Too late to stop the image: Venice was already making it (and billing it), so it was finished and kept in m_sjin7ss4bm.
```

**Safe mode, parallel calls, no call, max_tokens, add, settings, delete:**
```
$ ./sst turn ... --content "MOCK_BLURRED the bathhouse"
[... · image img_n47cdi416p done (z-image-turbo, png, $0.01, blurred by safe mode)]
$ ./sst brain.update ... --no-safe-mode; ./sst image.retry ...;  curl -s localhost:4748/_mock/requests | jq ...
{"safe_mode":false,...}  then  {"safe_mode":true,...}
$ ./sst turn ... --content "MOCK_TWO_TOOL_CALLS paint"
[... · image img_ajft4q6at9 done (...) · it made 2 generate_image calls; only the first was used]
$ ./sst turn ... --content "MOCK_NO_TOOL_CALL paint"        (exit 1)
error: Scene Painter answered without calling generate_image (it wrote text instead), so there was no prompt to paint. Your message is saved; the reply isn't. To retry, send again to Scene Painter with no new message: turn --brain b_d7eluedj86 without --content, or Retry in the browser.
$ ./sst conversation.update --id $C --settings.max-tokens 4; ./sst turn ... --content "paint the window"
image error: The prompt was cut off by max_tokens, so no image was requested. Edit the prompt (or raise max_tokens and regenerate), then retry.
$ ./sst message.add --conversation $C --as "Scene Painter" --content "A barkeep with a leather apron, polishing a tankard."
Added m_l7ccwvdt7n (an image prompt in Scene Painter's mouth). ... Making its image img_iu78x2vn2o with z-image-turbo. Watch it: ...
$ ./sst conversation.update --id $C --settings.image.width 1001
error: z-image-turbo needs a width and height that are multiples of 8, and the width 1001 isn't.
$ ./sst conversation.update --id $C --settings.image.resolution 2K
error: z-image-turbo is sized by width and height, not resolution or aspect ratio.
$ ./sst conversation.update --id $C --settings.image-model nano-banana-2 --settings.image.resolution 2K --settings.image.aspect-ratio 16:9
$ ./sst prompt.preview --conversation $C --brain "Scene Painter" | tail -3
{"model":"nano-banana-2","safe_mode":true,"format":"png","hide_watermark":false,"resolution":"2K","aspect_ratio":"16:9","negative_prompt":"text, watermark"}
Note: Width and height are not sent: nano-banana-2 is sized by resolution and aspect ratio.
$ ./sst message.edit ... --content @long.txt          # 7600 characters
error: The prompt is 7600 characters, and z-image-turbo takes at most 7500, so no image was requested. ... · previous img_4k192o0rwd done
$ ./sst message.delete --conversation $C --message $M
Deleted m_iewew326so and its images (img_d5h6ucfuv9, img_gc6sp36ovo). 24 messages left.
```

`grep -ciE "hooded|tavern|leather|MOCK image prompt|barkeep" .run/server.log` → 0.

### Live (`npm run up`, encrypted user `dev-t05-live`, GM + Scene Painter with its default reminder, 768×512)

```
$ ./sst venice.balance
Venice balance: $8.00274144 USD
$ ./sst turn --conversation $L --brain "Scene Painter" --content "Paint the hooded figure."          # image 1
[Scene Painter]
Interior of a dim tavern, rain lashing the shuttered windows. A lone hooded figure sits by a crackling hearth, face lost in shadow beneath the cowl. Firelight glints off a silver coin turning between gloved fingers. Warm amber light, deep shadows, painterly fantasy realism.
(making image img_wxgvx7nbzs with z-image-turbo...)
(image ready: ./sst image.get --id img_wxgvx7nbzs --out img_wxgvx7nbzs.webp)
[Scene Painter · 387 in / 98 out · $0.00023 · image img_wxgvx7nbzs done (z-image-turbo, webp, $0.01)]     5.3 s total
$ ./sst image.get --id img_wxgvx7nbzs --out live1.webp && file live1.webp
live1.webp: RIFF (little-endian) data, Web/P image, VP8 encoding, 768x512
$ head -c 6 data/users/dev-t05-live/images/img_wxgvx7nbzs.webp
SSENC1
$ ./sst message.regenerate --conversation $L --steer "Make it brighter: morning sun through the windows."   # image 2
Sunlit tavern morning: bright gold light streaming through the window shutters, dust motes in the beams. A lone hooded figure sits by the cold hearth, ...
[Scene Painter · version 2/2 · steered · 547 in / 96 out · $0.00021 · image img_7x19euennt done (z-image-turbo, webp, $0.01)]
$ ./sst message.edit --conversation $L --message $M --content "Sunlit tavern morning: ... A lone hooded figure in a worn red leather coat sits by the cold hearth, ..."   # image 3
... Making its image img_40shcs2bul with z-image-turbo. img_7x19euennt stays until it is ready. ...
$ ./sst generation.follow --conversation $L
[Scene Painter · image img_40shcs2bul done (z-image-turbo, webp, $0.01)]
$ ls data/users/dev-t05-live/images/
img_40shcs2bul.webp  img_wxgvx7nbzs.webp               # version 1's image, and the edited version 2's
$ ./sst turn --conversation $L --content "I walk over. What is the stranger wearing?"     # the GM, which sees the prompt framed
[Game Master]
Beneath the hood you catch a worn red leather coat, scuffed boots, and a single gloved hand worrying a silver coin between its fingers. The stranger doesn't look up, but the coin stops turning.
[Game Master · 162 in / 45 out · $0.0001]
$ ./sst venice.balance
Venice balance: $7.9721937 USD
$ ./sst conversation.get --id $L --json | jq .spentUsd
0.030547740000000004
```

I opened the first image to confirm the plumbing: a real 768×512 picture of the prompt, with Venice's watermark.

## Live spend

**$8.00274144 → $7.97219370 = $0.0305.** That is 3 `z-image-turbo` images ($0.03) and 3 text calls: the painter's turn, the steered regenerate, and the GM's turn. The conversation's own `spentUsd` is $0.03054774, the same figure, so the image list price is what Venice charges.

## Tests

- `test/image-parts.test.ts` (5 tests, pure):
  - The prompt decoder at every split point, with escapes and surrogate pairs.
  - Parallel calls kept apart and only the first streamed.
  - `buildImageRequest` for z-image-turbo and Nano Banana: rounding, notes, the character limit. `imagePriceUsd` for all three price shapes. `imageSettingsProblem`.
  - `sniffImage`.
  - `settleStaleImages`: done if the file is on disk, an error if not, untouched if owned.
- `test/images.test.ts` (7 tests, CLI → server → mock, encrypted user):
  - Acceptance: preview == chat send, image body == preview params + prompt, `spentUsd` == mock charge, `image.get` PNG, ciphertext on disk, GET works, the GM's framed view, the painter's own tool call.
  - Steer, then edit swap-in with a 409 meanwhile.
  - Flaky image, then retry.
  - Client disconnect mid-image; logout after an edit.
  - Stop mid-prompt and mid-image.
  - Blurred, safe mode off, two calls, no call.
  - Add as painter; message and conversation delete.
- Two T04/T03 assertions were updated: image brains are no longer refused, and `start` carries `kind`.

`npm test`: 104 pass. `npm run typecheck`: clean (server and web).

## Known gaps

- **The lock covers the whole image.** With z-image-turbo (~3 s) that is unnoticeable. A slow image model would keep the table busy (409) for as long as it paints. If Jason picks a slow model, a per-message image lock would let play go on meanwhile, at the cost of edit/delete races this design avoids.
- **Replacing an image deletes the old file** once the new one is done (edit, retry), as design.md specifies. To keep both, regenerate (a new version) instead.
- **The default `otherBrainImage` template** says the image "is now on the player's screen", which is untrue while an image has failed. Every brain still sees the prompt, which is the canon. The template is editable.
- **The image cost is the list price.** `/image/generate` reports none. A request that times out but that Venice billed anyway isn't counted. A crash in the few milliseconds between Venice's answer and our write loses that image, and its cost goes unrecorded.
- **The file extension** (`.webp`, `.png`) shows an encrypted user's image format; the contents are ciphertext. T06's audit may prefer one extension for all.
- **Text a model writes beside its tool call** is not kept (the `done` note says how much there was). A second parallel call is dropped (named in the note).
- **Not sent:** seed, steps, cfg_scale, style_preset, variants and upscale. They aren't in the settings yet.
- The browser UI is the frontend pass's. Its notes are under **From T05 engineer** in TICKETS.md.

## design.md changes

- **Data model:** the `ImageRecord` type (`previous`, `safeMode`, `mime`, `blurred`, `contentViolation`, `costUsd`, timestamps). Image files' extension is sniffed.
- **"Image generation" rewritten as built:**
  - the prompt decoded from the first call only;
  - partial prompts saved unpainted;
  - the request builder and what it sends per model;
  - bytes before status;
  - images held under the generation lock, with detached jobs for edit and add;
  - stale pending images settled on read;
  - retry;
  - other brains' view doesn't depend on image status.
- **Turns:** regenerate, edit, delete, add and stop for image messages.
- **Events:** `prompt` replaces `tool_args`. The image events carry `message` / `image` / `retry`, and `start.kind` / `imageOnly` are added.
- **Command surface:** "Implemented in T05".
- **Mock:** the new triggers, and tool-argument `max_tokens`.
- **Live facts:** a new "Verified live in T05" list.
