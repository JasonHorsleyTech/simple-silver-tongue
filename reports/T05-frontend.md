# T05 frontend report: image brains (CP4)

No design concern. The T05 commands covered what the browser needed. Two small backend adjustments made the browser's job safe; both are below and in design.md.

## What I built

Jason can now play with image brains in the browser:
- He clicks the Scene Painter (or a Character Portraitist), with or without a note.
- The prompt streams in as readable text under the frame the picture will fill.
- Once the prompt is saved, the composer is his again, while the card paints.
- The picture fades in, and a click opens it large.

**The image card** (`features/chat/ImageCard.tsx`): the picture on top and the prompt under it as a plain-text caption. The caption is clamped to three lines, with "Show the whole prompt". The picture lives in one frame for its whole life, so nothing jumps:

| State | What shows |
|---|---|
| Writing the prompt | A softly moving placeholder in the brain's color, "Writing the prompt…", and the caption streaming with a caret. Stop is offered. |
| Painting | A spinner, "Painting…", the model and the seconds so far ("z-image-turbo · 3 s"). The frame has the conversation's size (1216×832 is landscape). |
| Prompt edited | The old picture stays, dimmed and slightly blurred under "Painting the new prompt…", until the new one swaps in. |
| Done | The picture fades in. It keeps its real shape and is never cropped. Hover shows an expand mark. |
| Large view | As large as the window allows, with the badge, model, real pixel size, price, the whole prompt and Download. Escape, the × or a click outside closes it. |
| Failed or interrupted | A "No image" box in the server's words, with **Retry** and **Edit the prompt**. If a last good image exists, it stays faded with the error beside it. |
| Blurred | "Safe mode blurred this image…", with **Turn safe mode off and repaint** (`brain.update` then `image.retry`), **Repaint as it is**, and a note that safe mode then stays off. |
| Flagged | Venice's content flag, with **Repaint**. |

**Actions on an image message:**
- **Regenerate…** on the last message: "a new prompt and a new image", optionally steered. The new prompt streams into the card's own slot, then paints as a new version.
- **Paint again** (a finished, clean image): `image.retry`, a new version. The header labels it "same prompt as v2".
- **Copy the prompt.**
- **Edit the prompt:** the picture stays above the editor, and the button is **Save and paint**.
- **Delete:** "Delete this message and its image?".
- The pager, and the meta line "171 in · 30 out · $0.000087 · image $0.01". Hovering it shows the image model and safe mode.
- While an image is being made, Edit, Paint again and Delete explain why they wait instead of sending ("Its image is still being made. Venice is already making it (and billing it), so it will be kept…"). Regenerate and the pager still work.

**The play loop** (`useChat`):
- The reducer handles `prompt` like `delta`. At `image_pending` it upserts the saved message, ends the live reply, and returns `true`. Every stream loop (turn, regenerate, generation.follow) stops reading there.
- So Send and the chips come back at once, and Stop disappears for the image.
- Every message whose image is pending in the browser's copy gets an `image.follow` watcher. It doesn't matter how the image got there: a turn, a regenerate, an edit, "Write as…", a retry, a reload, or the CLI. The watcher ends with the message as saved.
- A failed watch retries with a back-off.
- At most 3 watch at once: each holds one of Chrome's 6 connections per host, and more would queue the next turn.
- Messages from different streams can cross, so the browser keeps the newer copy of a message by `updatedAt`. An image landing for a deleted message never brings it back.

**Composer:**
- Image brains get a chip with a picture icon (⌥ shortcuts too).
- An image brain also appears in "Write as…" as "image prompt". The composer then says "your words are its prompt, painted as written", and the button is **Paint as Scene Painter**.
- The status line reads "Scene Painter is writing an image prompt".

**Settings:**
- The Conversation tab has an **Images** section: the image model, the size in the model's own terms (from `models.list` constraints), format, watermark, and the negative prompt. The negative prompt is text the image model reads, so it is editable.
  - For width × height models: Default / Square / Landscape / Wide / Portrait presets, plus a custom size checked for multiples of 8 as you type.
  - For resolution models: a resolution and an aspect ratio.
  - A size left from another model says it isn't sent, with **Clear it**.
- Each image brain's editor:
  - Safe mode (on by default), with what it does.
  - "Painted with z-image-turbo · 1216 × 832", with a link that opens the Images section.
  - A "safe mode off" tag on the card when it is off.
  - All T05-era "arrives in T05" wording is gone.

**Payload view:** an image brain's request ends with **Then POST /image/generate**: the exact parameters, the prompt "from its generate_image call, word for word", and any notes.

## Backend adjustments (no new commands)

| Change | Why |
|---|---|
| Image 409s have their own code, **`image_busy`** (`imageBusy()` in `src/lib/errors.ts`; `assertImageIdle`, and `conversation.delete` while images paint). | The browser can now tell "wait for this image" from `conflict`, which means "a reply is being written". It needs that to answer in the right words, and to re-read rather than follow a reply that doesn't exist. Messages and status are unchanged, so the CLI is unaffected. |
| A message's **`updatedAt` is stamped inside the write queue** (regenerate's save in `chat.ts`, the image's save in `paint.ts`; the other writes already did this). | Before, they used stamps taken before queueing (`version.createdAt`, `finishedAt`), so a later write could carry an earlier `updatedAt`. The browser merges crossing copies of a message by it. One case: a version switch's answer and an image landing for that message. |
| Mock images keep the asked shape (≤256 px a side), follow `aspect_ratio`, and are soft gradients per prompt. **`MOCK_IMAGE_SLOW_MS`** sets the slow-image time for `npm run up:mock`. | Each side used to be capped on its own, so 1216×832 came back square. A flat swatch also told nothing apart in the browser. The env var gives time to screenshot, edit or reload mid-paint. |

`web/src/api/types.ts`:
- exports `IMAGE_STOP_NOTE`;
- documents `image_busy` on `message.edit` and `message.delete`;
- types `imagesDeleted`.

## Flows verified in Chrome (DevTools MCP)

**Mock** (`npm run up:mock`; `MOCK_IMAGE_SLOW_MS=9000` for the slow cases), user `dev-t05-fe`, at 1440 px. The table, "The Gilded Goat", had a GM, a World Bible, a GM opener and a Scene Painter with its reminder off.

| Flow | Result |
|---|---|
| **Painter turn with a note** | Timeline polled every 150 ms: "Thinking of a picture…" + Stop at 0.15 s; "Writing the prompt…" at 0.6 s; at 3.6 s "Painting…", composer back to **Send to Game Master**, chip back; image at 5.6 s. ⌥1 also sends to the painter. |
| **GM right away, while it paints** | GM sent 56 ms after the composer freed; the GM replied (done at ~1 s) while the card still said Painting; image landed at 2.4 s. Repeated with a 9 s image: GM done, card still painting (screenshot). |
| **The GM's payload view** | Header Payload (GM): all three painter prompts appear verbatim, framed with `otherBrainImage`, equal to the template rendered with each saved prompt (checked in the page). The painter's own payload ends with `POST /image/generate` and `width 1216, height 832`. |
| **Steer-regenerate** | "Regenerate as version 2: a new prompt and a new image", steer typed, Enter. It streamed in the slot ("writing version 2… · steered “Night now…” on v1"), painted, and the pager showed 2/2. Paging back showed v1's own image. |
| **Edit the prompt** | The picture stayed above the editor ("Editing version 2 of 2 · Saving paints a new image from it"). Save and paint: the old image dimmed with "Painting the new prompt…" until the new one swapped in. |
| **Paint again** | v3 "same prompt as v2", painting. Clicking Delete meanwhile gave the inline wait hint, and Edit was dimmed. |
| **Reload mid-paint** | The card came back "Painting…" and turned into the image 0.8 s later, through `image.follow`, with no manual refresh. |
| **Reload mid-prompt** | `generation.follow` re-attached: "Writing the prompt" + Stop, then Painting, then the image at 9.5 s. |
| **Mock errors** | `MOCK_IMAGE_FLAKY`: "No image / Venice 503 …" with Retry; Retry replaced it in place. An edit to a `MOCK_IMAGE_ERROR` prompt: the last image stayed (faded) beside "The new image wasn't made: …"; Edit the prompt from there, then a fixed prompt painted. |
| **Blurred image** | `MOCK_BLURRED` with safe mode on: the notice and its buttons (screenshot). **Turn safe mode off and repaint**: replaced unblurred in place; the brain's safe mode was off and its card tagged "safe mode off". Switched back on in the brain editor. |
| **Stop mid-prompt** | Prompt kept with "No image / Stopped before the image was made…", Retry and Edit; "stopped · cost pending" became the cost a few seconds later. |
| **Write as Scene Painter** | The menu lists it as "image prompt", and the composer says "your words are its prompt, painted as written". **Paint as Scene Painter** added it, "written by you", painting, then done. |
| **Four images at once** | Four quick "Write as" paints: 3 `image.follow` streams, the 4th once one finished. A GM turn meanwhile took 613 ms. All four landed. |
| **CLI edit, browser unaware** | `./ss message.edit` of a prompt (slow image), then Delete in the browser: the server's `image_busy` gave the inline hint and a re-read. The card showed the CLI's prompt painting, then swapped in, and the hint cleared. |
| **Settings** | Landscape preset saved 1216×832. Width 1001: "must be a multiple of 8: 1000 or 1008" as typed; 1024 saved with Enter. Nano Banana 2 swapped in the resolution and aspect-ratio controls, plus the leftover-size note. Back to Z-Image Turbo, Landscape. The brain editor's link opens the Images section. |
| **Large view** | Fills the window (884×604 for a 256×175 mock image). Escape, a backdrop click and × close it; a click on the picture doesn't. |
| **Encrypted user** (`dev-t05-fe-enc`, separate browser context) | A Character Portraitist (reminder on, portrait 832×1216) painted, and the image loaded through `image.get` (175×256 decrypted). On disk: `SSENC1`. |
| **Narrow window** (760 px) | Card, error box and composer fit, with no horizontal scroll. |

- **Console:** no messages on any page.
- **Network:** every call was `POST /api/<command>` or `GET /api/image.get?id=…`:
  - `turn`, `message.regenerate`, `generation.follow`, `image.follow`, `image.retry`;
  - `message.edit` / `.add` / `.delete` / `.select-version`;
  - `brain.update`, `conversation.update`, `prompt.preview`, `models.list`.

### Live smoke (`npm run up`, encrypted `dev-t05-fe-live`, z-image-turbo at 1216×832)

1. **Painter turn** with "(paint the hooded stranger by the hearth, from across the room)".
   - The prompt streamed from 0.1 s to 3.4 s.
   - At 3.4 s the card said Painting and the GM was sent.
   - The GM answered by 6.1 s, while the image was still painting ("…black kid leather, immaculate despite the weather, turning that coin over and over").
   - The image landed at 7.3 s: a real 1216×832 WebP with Venice's watermark (screenshot).
   - `prompt.preview` and the browser's payload view both held the exact prompt, framed (`cmp`-style check: equal).
2. **Edit the prompt** to add the GM's details (oiled wool cloak, bird's-skull pin, kid gloves).
   - The real picture dimmed under "Painting the new prompt…" (screenshot).
   - The new one swapped in with the pin and gloves painted.
   - The old file was deleted; the new one is `SSENC1` on disk.

**Spend:** $7.92120401 → $7.90066551 = **$0.0205385**. That is 2 `z-image-turbo` images and 2 text calls (the painter, the GM). The conversation's `spentUsd` is exactly $0.0205385.

## Screenshots

- `reports/screens/T05-live-scene.png`: **live**. The painter's real image in its frame, with the prompt caption clamped to three lines and "Show the whole prompt".
- `reports/screens/T05-live-edit-repainting.png`: **live**. The prompt was edited by hand; the old picture is dimmed under "Painting the new prompt… z-image-turbo · 1 s" until the new one swaps in.
- `reports/screens/T05-play-loop-gm-while-painting.png`: mock. The painting card, with the player's next line and the GM's reply already below it, and the composer free.
- `reports/screens/T05-blurred-safe-mode.png`: mock. A blurred image with "Turn safe mode off and repaint" and "Repaint as it is".

## Fixed along the way (found by looking at the screenshots)

- **Cropped pictures.** The frame only adopted a picture's real shape when its parent re-rendered, so a finished image could be cropped into the expected shape. Each picture's frame (`Shot`) now owns its measured size.
- **The large view.** It showed a picture at its natural size, so the 256 px mock was smaller than inline. It now fills the window, and opening it no longer puts a focus ring on Download.
- **The brain card header.** The tags squeezed the name to "Scen…". The name now keeps its room and the tags give way.
- **The "Image model and size" link** used `scrollIntoView`, which also scrolled the page and pushed the app header off screen. It now scrolls the panel only.
- **Size presets** wrapped to three rows. They are now one row, with sizes in the tooltip and the inputs.
- **Error sentences.** The server's error had no final period, so "…(MOCK_IMAGE_ERROR) The last image…" ran together.

## Tests

`npm test`: **110 pass** (109 before). `npm run typecheck`: clean. The web build succeeds.

New in `test/web-api.test.ts`, with its own server so the slow image takes 300 ms, as an encrypted user:
- an image turn's events up to `image_pending`, read with the browser's client, which stops there;
- the GM's turn while the image paints;
- `image_busy` (409) for delete and edit;
- `generation.stop` naming the image (`painting`), and `IMAGE_STOP_NOTE` equal to the server's;
- `image.follow`, ending `image_pending → image_done → done`, with `image.get` 200 `image/png`;
- `image.follow` with nothing being made answering `done` at once;
- an edit's `painting` and `previous`;
- `image.retry` of a done image making v2 with `repaintOf: 0`;
- every later copy of the message having a later-or-equal `updatedAt`.

## Known UI gaps

- **The floating "Latest" button** (T02) sits over an image card's caption when you scroll up a little.
- **The large view has no previous/next** between a conversation's images.
- **A pending image far up the scrollback** gives no sign at the bottom when it lands. Today that only happens with a slow model or a "Paint again" on an old message.
- **The frame's first guess comes from the conversation's size settings.** An old image made at another size takes its own shape once loaded, with a small resize; sizes are remembered in memory after that.
- **Images are fetched with `no-store`** (the server's choice, so an encrypted user's pictures don't reach the disk cache). A reload refetches them all, which is local and fast.
- **The default `otherBrainImage` wording** ("now on the player's screen") is a few seconds early while the image paints. It is already noted for T07.

## Docs changed

- **design.md:**
  - Web app: a new "Image brains (T05 frontend)" section, plus the sending and settings lines.
  - The data model: when `updatedAt` is stamped, and why.
  - `image_busy` on the 409s.
  - Mock: image shapes, gradients, `MOCK_IMAGE_SLOW_MS`.
- **AGENTS.md:**
  - `MOCK_IMAGE_SLOW_MS` in the env overrides.
  - Two lessons: the image seams in `web/`, and watching images in Chrome MCP.
- **TICKETS.md:** T05 → `done`, and "From T05 frontend" notes under T07.

## Housekeeping

The server is left freshly started on current code against the mock (`npm run up:mock`).

Test users:
- `dev-t05-fe` (plain; "The Gilded Goat", "Probe");
- `dev-t05-fe-enc` (encrypted, password `silver-moon-7`; "Encrypted cellar");
- `dev-t05-fe-live` (encrypted, password `live-lamp-3`; "Live smoke T05").

All are `dev-*`, free to wipe.
