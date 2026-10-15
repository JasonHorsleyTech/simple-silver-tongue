# T17 frontend: a fresh take is a note from the Muse, in the browser

**Result:** in the browser, a fresh take now reads as what it is. Your idea goes in as a folded **✦ Muse's note for Game Master**, right above the new reply, and the reply's header says "fresh take". Every brain reads the note; you see it folded. Before you send, the Fresh take box says what will happen to the note this time. The Muse has a look, a chip and a Settings card of its own.

`npm run typecheck` is clean, `npm test` passes 217/217 (2 new tests) and the web build succeeds. I checked everything in Chrome against a scratch mock server, with no live calls. **No DESIGN CONCERN.**

## What Jason will see

- **The Fresh take tab** (Regenerate on the last reply).
  - It starts as before: the thought template with the brain's name filled in and the caret at the marker. ⌘ Enter sends exactly what the box holds, and **Payload** shows the request first.
  - Its text now says what happens: "This goes in as a note from the Muse, word for word, right before the reply: every helper reads it, the player doesn't (it's folded). Game Master answers it without seeing the version on screen; the new version is the reply alone." T15's "carries on from your thought" and "the new version is this, then the reply" are gone.
  - A second line says what happens to the note this time:
    - "The first fresh take adds a brain called Muse…" when there is no Muse yet.
    - "Muse's note above gets this as version 2 (its own ‹ › pager), rather than a second note", or "…already says this, so it stays as it is", when a note you wrote is right above.
    - "Muse's own idea above stays as it is; yours goes in after it" when the Muse's own turn is right above.
  - **Start from the note above** (a link, when a note you wrote is right above) puts that note's text in the box, so you can change the idea rather than retype it.
  - On the Muse's own message the tab is off ("This is Muse's own note: edit it, or re-roll it"). While the brain called Muse is an image brain, the box says to rename it and the button is disabled. That is the server's `bad_brain` case, now caught before sending.
- **The Muse's note in the scrollback.** It is an idea, not a line of the story, so it wears no speaker's badge.
  - Its header is a sparkle in the Muse's color, then **Muse's note** for **Game Master** (the brain whose message comes next, in that brain's color), the time, and "written by you" or "its own idea". The rail is dotted, and the note sits close above the reply it is for.
  - The body is folded like any hidden note. Footer, edit (raw Markdown), delete, pin, Said by and the version pager are any message's.
  - A version you wrote (the note's second idea) isn't called a "re-roll".
  - The Muse's own turn streams in the same frame, so nothing jumps when it is saved.
  - A renamed Muse's notes look like any brain's again, which is how the server reads them.
- **The reply's header** still says "fresh take", and its tooltip now says it answered the Muse's note above. A T15 text version (saved merged) keeps its old tooltip.
- **Images.** An image version no longer repeats its idea above the picture, since the note right above has it. It still shows the idea when no note above has it (a T15 version, or a note you deleted), captioned "The fresh take's idea (display only: it is in no message above)". The live slot no longer shows the thought either.
- **The composer.** The Muse's chip has a sparkle where other chips have a dot. Its labels are "Ask Muse for an idea" and "Send to Muse for an idea", and its title says it answers with a hidden note every brain reads. The chip glows once when a fresh take has just added the Muse. **Write as… → Muse** is tagged "a note": its bar says "a note every brain reads; nothing is generated", and its placeholder suggests a ```` ```hidden ```` block.
- **Settings → Brains.**
  - The Muse's card is tagged "writes fresh takes' notes". An image brain called Muse is tagged "can't write fresh takes' notes", in amber.
  - Its editor opens on **The Muse**: what a fresh take does with it, that its prompt and reminder are used only on its own turns, and that it is the Muse by its name.
  - Typing a new name warns before you save. Renaming the Muse gives "Renamed, Muse is no longer the Muse: its notes stay (framed with the new name), and the next fresh take adds a new Muse". Renaming another brain to Muse says it becomes the Muse, and for an image brain that it would stop fresh takes. After saving, one line says what changed.
- **Settings → Templates.** The template is now "Fresh take: the Muse's note", with `{{brain}}` and `{{thought}}` explained and the advice to keep it in a ```` ```hidden ```` block. "Another brain's messages" says the Muse's notes are framed with it too.
- **The payload view of a fresh take.**
  - The subtitle reads "…the messages before this one, without it, ending on the Muse's note (framed like any helper's), then the final reminder. Game Master answers the note, which is saved when you send."
  - The note's message carries a sparkle tag: "Muse's note, its version 2, saved when you send" or "…saved when you send".
  - `freshTakeNote` shows as information, or as a warning when the note has no hidden block (the player would read it). `museMakesNote` shows as information.
- **Retry after a broken fresh take** is now a plain re-roll, as the server's `details.retry` says (the note is already in the ledger). It used to resend the thought.

## Code

- `web/src/lib/thought.ts`: three helpers, all DOM-free and tested.
  - `freshTakeTarget(conv, messageId)` mirrors `planMuseNote` and returns `new` / `after` / `version` / `own` / `image`.
  - `thoughtBesideImage(v, prev, brains)` decides whether an image version's idea shows above its picture.
  - `mergedThought(v)` spots a T15 text version.
- `features/chat/MessageFrame.tsx`:
  - `BrainMessageFrame` takes `muse: {for}` and renders `MuseNoteFrame`.
  - `SteerNote`'s `freshTake` is `note` / `merged` / `beside`, with a tooltip for each.
- `features/chat/SteerBox.tsx`: takes `target` (the `reminder` prop is gone). It has the new wording, the situation line, **Start from the note above**, and the `own` / `image` states.
- `features/chat/MessageItem.tsx`:
  - Takes `freshTarget`, `noteFor` and `thoughtBeside`.
  - On the Muse's own message, the box opens on Revise.
  - The in-slot Retry is a plain re-roll.
  - "re-roll" only shows on a generated version.
- `features/chat/Scrollback.tsx`:
  - Computes the fresh target for the last message, each note's `noteFor` (the next message's author) and `thoughtBeside` for image versions.
  - A Muse note's row gets `!mb-1`, so it sits close above its reply.
- `features/chat/LiveReply.tsx`: the Muse's own turn streams in the note frame, and the image thought above the live picture is gone.
- `features/chat/useChat.ts`: `muse_note` with `brainCreated` marks the Muse fresh (its chip glows), and stale T15 comments are fixed.
- `features/chat/Composer.tsx`: the Muse chip, its titles and labels, the measurer, the "+N" list and the Write as… Muse wording.
- `features/payload/PayloadDialog.tsx`: the subtitle, the note's tag (`museNote`) and the note tones.
- Settings:
  - `BrainEditor.tsx`: the Muse panel, `museRename` (the warning) and the line after saving.
  - `BrainsTab.tsx`: the card tag.
  - `TemplatesEditor.tsx`: the wording.
- `components/SavedLine.tsx`: a `warn(value)` prop, a line shown under the field while the value is unsaved.
- Tests (`test/web-api.test.ts`):
  - "the Fresh take box says what the server will do…" runs `freshTakeTarget` and `planMuseNote` on the same ledgers: no Muse, a note you wrote (new words and the same words), the Muse's own idea, the Muse's own message, and an image Muse. Dropping the `source: "authored"` check from the browser's copy makes it fail. I tried that mutation and reverted it.
  - A second test covers `thoughtBesideImage` and `mergedThought`.
- No new command: everything is `message.regenerate`, `prompt.preview`, `message.*`, `brain.update` and `conversation.update`, as before.

## Verified in Chrome

I used the DevTools MCP in an isolated context. The scratch server ran on 4777 with mock 4778, scratch data and run dirs and a scratch web build (`SS_WEB_DIST`), as `dev-t17-fe`. Jason's 4747 was untouched until the end, and no `data/users` listing was made.

1. **The Goat example: first fresh take from the CLI, then the browser.**
   - The note showed as "Muse's note for Game Master", folded. The GM's header said "fresh take", and the Muse chip had its sparkle.
   - The Fresh take tab pre-filled "An idea for Game Master's next reply…", with the caret on the empty line.
   - I typed with real keystrokes. **Payload** showed `[4] user ✦ Muse's note, its version 2, saved when you send`, then the reminder.
   - I sent with ⌘ Enter and followed the order on a 100 ms timeline: the note became `Version 2 of 2` at once, and the GM's slot showed "writing version 3…", then 3/3.
2. **A plain conversation (no Muse, no reminder).**
   - The box said "The first fresh take adds a brain called Muse…". After sending, the note and the live reply were in place, and the Muse chip glowed (`data-fresh`) with "Ask Muse for an idea".
   - **Muse's own turn** (its chip): it streamed in the note frame ("for the next reply · its own idea").
   - Regenerate on that note opened on Revise, with Fresh take disabled ("This is Muse's own note: edit it, or re-roll it").
   - After a GM turn, the fresh take box said "Muse's own idea above stays as it is; yours goes in after it", and the send added a second note below the Muse's idea.
3. **Start from the note above.** It loaded the note (caret at the end), and the line switched to "…already says this, so it stays as it is".
4. **A broken fresh take** (`MOCK_MIDSTREAM_ERROR` in the note, a brain with no reminder).
   - The partial reply was dimmed, with the server's message ("The Muse's note … stays, so a plain regenerate (no thought) answers it").
   - **Retry** sent `{"conversation":…,"message":…}` with no `thought`; I checked the request body in the Network panel.
   - I then edited the note in place (raw Markdown) and saved it: "edited", 2/2.
5. **Reload mid fresh take** (`MOCK_SLOW` in the note): after the reload, the note's version 3 was in place and the slot read "writing version 3… · fresh take".
6. **An image fresh take** (the Scene Painter). No idea showed above the picture. After I deleted the note from its footer, the idea came back above the picture with its "display only" caption.
7. **An image brain called Muse.** The box showed the amber rename line, and the Fresh take button was disabled.
8. **A T15 file** (hand-made: schema 6, a merged version with `thought`, no Muse, imported with `conversation.import --campaign`). It loads, shows "fresh take" with the folded thought at the head of the version, and its tooltip says "from before 2026-10-15".
9. **Settings.**
   - Renaming Muse → "Old Muse" warned while typing. Saving gave "Old Muse is no longer the Muse…", the card lost its tag, and the note lost its Muse look.
   - Renaming → "muse" warned "becomes the Muse" and saved with "muse is the Muse now…". I then set it back to "Muse".
   - The Templates tab shows "Fresh take: the Muse's note".
10. **The note's pager:** ‹ took the note to 1/2 while the GM stayed at 3/3, the disagreement the ticket accepts.
11. **Phone-ish width** (the window's minimum, 500 px): the note's header fits on one line, with no horizontal scroll (`scrollWidth` 500).
12. **Console and network.** The console had no errors, only Chrome's usual "form field should have an id or name" issues. Every call went to `/api/<command>`.

Screenshots:
- `reports/screens/T17-muse-note.png`: the note above the GM's fresh take, with the sparkle chip.
- `reports/screens/T17-fresh-take-box.png`: the box with a second idea ("gets this as version 2", **Start from the note above**).
- `reports/screens/T17-muse-settings.png`: the Muse's card and the rename warning.

## Left over / known gaps

- **The Muse's color is whatever was free.** In the Goat it got red (`#f87171`, the sixth color), which reads a little like an error. `newMuse` takes the next free color, and that's the server's choice. Jason can change it in Settings. A fixed Muse color would be a one-line change in `defaults.ts` if he wants one.
- **Deleting a note brings an image version's idea back above the picture.** The idea is labelled "display only", and a T15 version and a deleted note look the same in the data. I judged showing it honest rather than surprising.
- **Write as… offers the Muse only once it exists.** The server's `message.add --as Muse` would add one, but the menu lists brains only. Fresh take is the way in.
- **No live smoke**, as asked: the browser's part is our own stream and commands, all on the mock.

## Clean-up

The scratch servers (4777, 4778) are stopped, and the scratch data dir with `dev-t17-fe` is deleted. 4747 was restarted **live** on this code with Jason's own `data/` (`npm run up`). The restart logs out any session there.
