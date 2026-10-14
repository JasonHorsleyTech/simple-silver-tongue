# T07 frontend: Jason's paragraph in the browser, start to finish

**Result:** the whole acceptance paragraph played live in Chrome as an encrypted `dev-` user, with no terminal step after creating that user: start the example campaign, walk up to the hooded figure, a steered regenerate, the Dice Master's check → roll → GM loop, the Joke Teller, the Scene Painter's picture (then an edited prompt repainted), unreadable on disk, a system prompt tweaked and a brain added mid-game, a portrait, and a "Pathfinder" clone that plays at once. `npm run typecheck` is clean, `npm test` passes 144/144 (143 before, plus 1; one more check in an existing test), and the web build succeeds.

## What I built

- **Start the example campaign from the browser.** `/` (the start page, also **New conversation**) now opens with the example campaigns (`examples.list`), above the from-scratch form: the title, the `about` line, the cast as colored badges (image brains marked with a picture icon), and **Start this campaign** (`conversation.import --example`), which opens your new copy on the GM's opening scene. `features/conversations/ExampleCampaigns.tsx`. The from-scratch form keeps its focus without scrolling the example away.
- **Clone from the browser.** Settings → Conversation → **Clone this campaign** (`conversation.clone`): a title (placeholder "<title> (copy)"), **Setup only** (the default, `--without-messages`: same brains, World Bible, templates and settings, no story) or **With the story** (every message, version and image), then **Clone and open it**. The original stays as it was.
- **Stop sequences in the brain editor** (`features/settings/StopSequences.tsx`, under the final reminder): each shown quoted, so spaces are visible, with a remove button; an input to add one (at most 4, none blank, no duplicates, whitespace kept); "Add the default, `<!-- from:`" on a text brain that lacks it; "1 of 4". Each change saves the whole list with `brain.update --stop`. The brain card tags "stop sequence" (amber "no stop sequence" on a text brain with none), and with reasoning on and stops set, the editor shows `STOP_REASONING_NOTE` under the reasoning note. The payload view's stop note is now an information box, not a yellow warning on every text brain's preview (it describes a visible setting; checked in Chrome that it and `"stop": [...]` in the parameters read well).
- **Polish (from the ticket's candidates):**
  - **"Latest" no longer sits on image captions.** It is a small round ↓ just right of the text column (outside it when the window has room).
  - **A picture that lands out of sight says so.** If an image finishes (or fails) while its card is scrolled away, a "Scene Painter's picture is ready ↑/↓" pill appears at the bottom of the scrollback; a click scrolls the card into view. Seen live after an edited prompt repainted while I was at the bottom.
  - **The large view steps through the campaign's pictures:** ‹ › buttons and ← →, "1 of 2", in ledger order (each image message's active version).
  - **The server log is quiet:** a successful `auth.whoami` or `health` (each open tab polls both every 30 s) isn't logged any more; failures still are (T06 frontend's candidate).
- **README.md:** the browser is now the path for starting the example ("Start this campaign") and for cloning ("Clone this campaign"), with the terminal one line below each; stop sequences point to the brain editor; a line on stepping through pictures and the "picture is ready" pill.

## Commands added or changed

- `examples.list` now returns each brain's `color` (for the start page's badges); `test/campaigns.test.ts` checks it. No new commands: the browser calls `examples.list`, `conversation.import` and `conversation.clone`, now in `web/src/api/types.ts`.
- `src/server/app.ts`: successful `/api/auth.whoami` and `/api/health` requests are no longer logged; `test/e2e.test.ts` checks that they aren't, and that a failed one and other commands are.

## The playthrough in Chrome, live

`deepseek-v4-1-flash` and `z-image-turbo`, user `dev-t07-play` (encrypted, made-up password), on a scratch data dir (`SS_DATA_DIR`) so no other username could reach a screenshot. Every step was clicks and typing in the page; the network panel shows only `POST /api/<command>` calls (plus `GET /api/image.get` for pictures), and the console had no errors or warnings.

| # | Paragraph clause | In the browser | Screenshot |
|---|---|---|---|
| 0 | (the campaign) | Log in by clicking the user, password → start page → **Start this campaign** → the GM's opening scene | `reports/screens/T07-start-page-example.png` |
| 1 | walk up to the hooded figure | "I shake the rain off my coat… walk over to the hooded figure…" → GM: *"I— yes. I mean no. I mean, it's a free tavern."* | |
| 2 | regenerate with a slight steer | Regenerate → steer "Same moment, but she's so flustered that she knocks her own cider over." → v2/2, *"the elbow catches the untouched cup of cider, which goes over in a slow brown wave"*; header says "steered … on v1" | `T07-live-steered-regenerate.png` |
| 3 | a second agent: "tell me what dice to roll" | "…try to win her trust… What do I roll?" → **Dice Master** chip → *"Persuasion check: roll 1d20 + 5, DC 15."* → "I rolled a 13." → *"13 + 5 = 18 vs DC 15: success."* → Send with nothing typed → the GM narrates the success (*"It's grain tariffs. Very boring. Extremely official."*) | `T07-live-dice-loop.png` |
| 4 | "a funny joke about this situation" | **Joke Teller** chip → *"…that's not a grain tariff. That's a plot device."* | |
| 5 | text piped into an image generator | **Scene Painter** chip, empty → the prompt streamed (1.4 s), painting (4.4 s), the image (8.9 s): green hood, red strand, the bard, the crowned goat, the cat | `T07-live-scene-painter.png` |
| 6 | saved, unreadable without the password | Both conversation files and both images start `SSENC1`; `grep -a` for Gilded, hooded, cider, heather, Dice Master, Bard's Muse, limerick, tariff, Tobin, Pathfinder, RIFF, WEBP, VP8 over the user folder and `.run/server.log`: no match. `GET /api/image.get` without a session: 401 | |
| 7 | (edit the image prompt) | Edit the prompt → added "a small sprig of white heather pinned at its clasp" → **Save and paint**; I was at the bottom, so the "picture is ready" pill appeared; the GM later answered "Is that for luck?" with *"the little sprig of white heather pinned at her clasp"*, a detail only the prompt held | `T07-live-picture-ready-pill.png`, `T07-live-gallery-edited-scene.png` (large view, "1 of 2", heather visible) |
| 8 | tweak a system prompt | Settings → Brains → Joke Teller → appended "Tonight, every joke is a limerick: five lines, AABBA." → Save → its next joke was a (loose) limerick | `T07-live-brain-editor-stops.png` (also shows its stop sequence) |
| 9 | add a new brain | Settings → Brains → **Add a brain** "Bard's Muse" → its chip appeared → a four-line verse → the GM took it up (*"The verse lands somewhere under that hood…"*, then named an Insight check) | `T07-live-new-brain-mid-game.png` |
| 10 | (portrait) | **Character Portraitist**, "Paint her: the young woman in the green hood." → a portrait | |
| 11 | keep playing without a restart / the campaign as a template | Settings → Conversation → **Clone this campaign**, "Pathfinder at the Goat", Setup only → opened with all six brains (the Muse and the limerick line included, checked with `brain.list`) and no messages → the GM opened a fresh scene | `T07-live-clone-campaign.png` |

**Spend:** balance $7.80123342 → $7.76508485, so **$0.036** for **14 text calls and 3 images** (caps ~25 and 4).

Also checked on the mock (`npm run up:mock`, scratch data dir): the stop-sequence editor (remove, add the default back, a blank refused, a custom one added, `brain.list` agrees), the reasoning + stops note, the payload view's notes, clone both ways, the gallery's ← → and buttons, the "picture is ready" pill both when scrolled up and when pinned at the bottom (the latter needed a fix, below), and the start page at 760 px wide.

## Found and fixed on the way

- **The "picture is ready" jump snapped back.** Live, clicking the pill while pinned at the bottom did nothing visible: a smooth scroll starts inside the 96 px "at the bottom" zone, so its first scroll event re-pinned the view and the next render scrolled back down. The jump now unpins and ignores its own scroll events until `scrollend`. Verified on the mock with a card 600 px above the view: it lands in view and "Latest" appears. (AGENTS.md lesson.)

## Skipped, on purpose

- **Import a campaign file from the browser** (`conversation.import --campaign`) and an export: no browser path asked for it, and a file you pick and a file you save are plaintext anyway. The terminal has both (`conversation.get --json`).
- **Per-brain image size** (T07 engineer's note): the Portraitist still paints at the conversation's 1024×768. It needs a new field; not play-blocking.
- **The login card's footer below the fold with many users** (T06 candidate): after the handover cleanup the picker has no test users, so it doesn't arise.
- **A damaged conversation can't be removed in the app:** by design (T06).

## Known UI gaps

- The Character Portraitist paints landscape (see above).
- With six brains the chips wrap to a second row under the composer at laptop width; it reads fine.
- The "picture is ready" pill tracks one picture at a time (the latest that landed out of sight).

## Handover

After the commit: every `dev-*` and `qa-*` user in `data/users/` deleted with `./ss user.delete` (no other user touched), the scratch data dir removed, the server stopped, and `npm test` / `npm run typecheck` run once more. Details in the final reply.
