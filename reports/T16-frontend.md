# T16 frontend: brains that make brains, in the browser

**Result:** Jason can play a table with a brain per character without the terminal.

- **A new character arrives in the browser at once.** The moment the Character Creator's sheet lands (`brain_made`), its chip appears beside Send and glows a few times in its color. Under the sheet (a folded hidden note), **Made a new brain, Character 3, from this message** opens straight on its name field: type "Hob Granger", press Enter, done. **Later** folds it. From then on a **Rename** button sits there, drawn as a button while the brain still has the name its pattern gave it.
- **Every message has the T16 actions.** Under any message you can see which brain it made and which brains it is pinned to (× unpins). The footer adds:
  - **Pin to a brain**: every brain, as check boxes.
  - **Said by…**: change who said it.
  - **Make a brain**: shows on a maker's message that has no brain yet. Type a name, or leave it blank for the next one.
- **A dozen brains or more stay one row.** The row shows initials, as in T12. When even those don't fit, the brains that spoke (or were made) most recently keep their places, and **+N** lists the rest, one click each. Settings → Brains lists made brains under "Made by Character Creator" as one-line cards, with a filter once there are more than eight brains.
- **Every word stays visible and editable.**
  - The maker's card has the setting: on/off, name pattern, next number, how the message is pinned, the brains made so far, and the whole **Blueprint**. The blueprint uses the same fields as a brain's own editor.
  - A made brain's card says who made it and from which message (**Jump to it**). It also says its words are its own copy of the blueprint.
  - Every card lists its **Pinned messages**: Jump, how each is sent, and unpin.

Jason's own migration case works entirely in the browser, walked on the mock:
1. Add the preset's Creator as "Character Creator 2".
2. On each old sheet, **Said by…** → Creator 2, then **Make a brain**.
3. Use **Said by…** to move the old Actor's lines onto Alice and Bob.
4. Delete the old Creator and the Actor, and rename Creator 2.

Afterwards, `prompt.preview --brain Alice` had her sheet pinned at index 1, her line as `assistant` and Bob's framed.

`npm run typecheck` is clean, `npm test` passes 213/213 (3 new tests), and the web build succeeds. Mock only, with no live calls: the browser's part is our own stream and commands, and the mock exercises all of it. **No DESIGN CONCERN.**

## What I built

**The event and the state** (`features/chat/useChat.ts`)
- `addMadeBrain` is the single path for a made brain. It handles `brain_made` in the shared reducer (turn, regenerate, generation.follow), `message.add`'s `made`, `generation.stop`'s `made`, and `brain.make`.
- The brain joins `conv.brains` at once and goes into `chat.fresh`, the brains made while this view is open.
- A re-read follows as soon as nothing is streaming, because the maker's counter moved.
- `message.delete` patches out `brainsDeleted` and every pin of the message, then re-reads, because the counter may have stepped back (QA-8).
- New actions: `pin`, `unpin` (allowed mid-reply), `make`, `setAuthor` (refused mid-reply, with the usual hint) and `renameBrain`.

**The message** (`features/chat/MessageLinks.tsx`, wired in `MessageItem.tsx`, data from `Scrollback.tsx`)
- `LinksBand` sits under the body (inside the bubble for a pinned player message). It shows:
  - "Made <badge> from this message, pinned at the top of what it reads · Rename". On a phone this shortens to "Made <badge> · Rename".
  - The rename form, open by itself for a fresh brain that still has its pattern's name.
  - "Also pinned to <badge> as a system message ×".
  - The **Make a brain** form, whose placeholder is the next name (`freeMadeName`).
  - Each badge opens that brain's card in Settings.
- `FooterMenu` is a footer icon that opens a menu above or below, whichever has more room in the scrollback. It is clamped inside the scrollback on a phone. On touch it never focuses the filter, so no keyboard pops up.
  - `PinMenu` uses check boxes and pins as `ledger`.
  - `AuthorMenu` shows the server's rules as disabled rows with reasons: an image prompt stays with an image brain, and a message with versions can't be yours. A roll has no Said by.
  - Both menus add a filter once there are more than eight brains.

**The composer** (`features/chat/Composer.tsx`, `lib/cast.ts`)
- It measures an invisible copy of every chip, as whole name and as initials, inside a 0×0 `overflow-hidden` box (`ChipMeasurer`). The row's own width never depends on the chips, so the choice can't flip back and forth.
- The order of preference:
  1. whole names, if they fit;
  2. otherwise initials;
  3. otherwise the most recently active, as picked by `fitRow` over `brainActivity`, kept in their row order, plus **+N**.
- `brainActivity` counts a made brain's sheet as its activity, so a brain just made is always on the row.
- **+N** lists the rest with whole names, a filter past six, and the same send/ask/roll a chip does. It glows when a fresh brain is inside it.
- ⌥1…⌥9 are the chips on the row.
- Past eight other brains, Send drops "to Game Master". The placeholder still says who Send talks to, and the chips need the room.
- Touch keeps T12's sideways strip and scrolls a new brain's chip into view.
- Initials keep numbers whole: "Character 12" → C12, never C1 beside "Character 1". A clash takes letters from the first word instead (Ch12 / Ca12).
- The pen's "Write as…" menu now scrolls.

**Settings → Brains** (`BrainsTab.tsx`, `BrainEditor.tsx`, new `PromptFields.tsx`, `PinnedMessages.tsx`, `MakerSettings.tsx`)
- **Groups.** Made brains come under "Made by <maker> · N" as one-line cards. Their prompt's first line is the blueprint's, identical for all of them, so it is dropped. Past eight brains, a filter appears.
- **Tags.** "makes Character N" (and "(off)") and "N pinned" come first. A made brain's own sheet doesn't count as an extra pin.
- **Opening a card from elsewhere.** A message's badge, a maker's "Made so far", or a made brain's maker badge opens the card at its top (`focusBrain`).
- **A made brain's editor** starts with: made by <maker>, the message's first line (a hidden note shows as its fold, never its words), **Jump to it** (the scrollback scrolls to the message and it lights up; a drawer closes first), and "its own copy of the blueprint… shapes only brains still to come" (the triage note).
- **Pinned messages** in every editor, right after the system prompt (where they are sent): author, one line, "Sent as in the story / as a system message / as its own words" (`brain.pin --as`), Jump to it, and unpin.
- **The maker setting** sits at the end of the editor.
  - Off: "Set up…", a name pattern plus the new brains' system prompt.
  - On:
    - the switch;
    - name pattern, with "Next: Character 4";
    - next number;
    - how the message is pinned;
    - "Made so far" badges;
    - the **Blueprint**: kind, plus `PromptFields` (system prompt, reasoning with effort and notes, final reminder, stop sequences, and for an image blueprint safe mode, shape and tool text);
    - **Stop making brains**, confirmed.
  - `PromptFields` is BrainEditor's former prompt section, factored out so the blueprint is edited with exactly the same rules. `StopSequences` now takes `{id, name, kind, stop}`.
- Deleting a made brain from its card re-reads the brains, since the newest made brain hands its number back.

**Elsewhere**
- **Payload view:** a pinned message's header says "pinned m_…", with how it is sent on hover. `pinnedNote` and `makesNote` show as information, not warnings.
- **Casts:** preset and example cards, the add-brain picker and the empty conversation tag a maker: "makes Character N".
- **Palette:** 14 colors in `BRAIN_COLORS` (orange, teal, indigo, fuchsia, yellow and rose added; the first eight are unchanged). It was 8, which repeated after eight brains, as the engineer flagged.
- **Shared rule:** `src/conversations/naming.ts` is new and dependency-free. It holds `madeName`, `nameTaken`, `freeMadeName` and `isPatternName`, and `makers.ts` uses it, so the browser runs the server's naming rule.

## Why this way (my calls)

| Question | Call | Why |
|---|---|---|
| Where to rename a new brain | Under the message that made it, open by itself for a fresh one, not focused | It is where the eye is when the sheet lands. Focusing would steal the composer, and a toast would be gone before the story names her. The card's Name field still works. |
| "One click to any of a dozen" | Recency keeps the active ones on the row; **+N** for the rest (two clicks) | T12's one row can't hold 20 chips at laptop width with Settings docked (8 fit at 1280 px). A sideways scroll on desktop hides the overflow with no cue and clips the hover flags. Recency means the one you just met, or just spoke to, is always one click away. |
| Which brains count as active | The newest message, or the message a brain was made from | A brain just made must show at once (the ticket's "its button appears"). |
| Pin / Said by / Make placement | Two footer icons and a labeled button | One click to each list. The labeled **Make a brain** only appears where it applies (a maker's message with no brain), which is exactly the migration case. |
| Pin role from the message | Always `ledger`; change it in the brain's card | That is the default on evidence (design.md). The card lists pins with their role. |
| Browser-only migration | Import the preset Creator, then Said by → it, then Make a brain | Uses only existing commands. I walked it end to end; the README has it as numbered steps. |

## Verified in Chrome (DevTools MCP, isolated context, scratch server)

Every flow was on the mock. The setup:
- My own server on **4817** and mock on **4818**, with `SS_DATA_DIR`, `SS_RUN_DIR` and `SS_WEB_DIST` in my scratchpad (the 2026-10-15 lesson).
- User `dev-t16-ui`, the only user in that data dir.
- The web app built into the scratch `dist` with `vite build --outDir`.

Jason's 4747, its `web/dist` and `.run/` were never touched.

- **A made brain appears** (desktop 1440 px). A Creator turn (its chip, nothing typed) put a new chip on the row while the reply ended (polled every 100 ms: `C13*`, with `data-fresh`). The pending name field showed under the reply. Renaming it to "The Widow Marsh" updated the chip and the band. The Write as… Creator route (`message.add` → `made`) gave the same.
- **A stopped maker reply.** A `MOCK_SLOW` turn to a scratch "Place Creator", stopped after 1.5 s, kept the text, made "Place 2" (fresh, with its name field), and showed the stop notice.
- **The generic case.** "Place Creator" was given the setting through **Set up…** in its card (`Place {{n}}` plus a prompt), then asked "What's going on here tonight?" through **+N**. That made **Place 1**, under "Made by Place Creator", with "makes Place N" tagged.
- **Pin and Said by.**
  - Pinned the GM opener to Hooded Figure from the message. The band said "Pinned to Hooded Figure". The card's role select set it to `system`, and the band followed ("as a system message").
  - Hooded Figure's payload showed `[2] system pinned m_…` and `[3] user pinned m_…`, with the pin note as information.
  - Moved a Hob Granger line to Character 6 with **Said by…**. The badge and frame changed, and the chips re-sorted.
  - Pinned a player message to Place 1; it showed inside the bubble.
  - Pinned an image card to Hooded Figure; it showed under the caption.
- **Make a brain.** On a sheet written with the maker off, **Make a brain** (placeholder "Character 14"), named "Tom Ashby", made Tom Ashby with no pattern number used.
- **Delete cascade.** Deleting Character 12's sheet from the UI took the never-spoken brain with it, and the Brains count went down by one.
- **Maker settings.** I toggled the switch off and back on. A pattern without `{{n}}` was refused inline in words. "Person {{n}}" saved, and the description showed "Next: Person 14". **Jump to it** from a pin scrolled the scrollback (not the page) to the message and flashed it.
- **Many brains.** With 22 brains, 14 chips fit at 1440 px with Settings closed, and **+7** listed the rest with a filter. At 1280 px with Settings docked, 8 fit (+12).
- **Phone** (`emulate 390x844x3,mobile,touch`):
  - The band is compact; the Said by and Pin menus stay inside the screen (measured 94–382 px of 390).
  - The strip scrolls sideways.
  - The settings drawer lists made brains as one-line cards.
  - The page never scrolls horizontally (`scrollWidth − innerWidth = 0`).
- **The migration in the browser:** see the top. All requests went to `/api/*` (`brain.import`, `message.set-author` ×4, `brain.make` ×2, `brain.update`, `brain.delete` ×2, `prompt.preview`). There were no console errors or warnings.

Screenshots:
- `reports/screens/T16-made-brain.png`: the barkeep's sheet just made Character 2. The chip glows on the row, and the name field is open under the sheet.
- `reports/screens/T16-maker-settings.png`: the Creator's card. The switch, name pattern with "Next: Character 3", next number, how it pins, "Made so far" and the start of the Blueprint, beside the renamed "The Barkeep".
- `reports/screens/T16-many-brains.png`: 22 brains. Initials for the 14 most recent, **+7** open with a filter, and a pinned image card.
- `reports/screens/T16-phone-pin.png`: a phone, with **Pin to a brain** open over a sheet (The Barkeep checked).

## Commands added

None. Every UI action is one of the engineer's T16 commands (`brain.pin`, `brain.unpin`, `brain.make`, `message.set-author`, `brain.update --makes`) or an existing one.

The one server change is `src/conversations/naming.ts`, the shared naming rule moved out of `makers.ts` with its behaviour unchanged, plus six more badge colors in `wording.ts`.

## Tests

`test/web-api.test.ts` has three new tests:
- initials with numbers;
- `brainActivity` and `fitRow` (most recent kept in place, ties by order, nothing fits), plus `madeFromIndex`, `makerOf` and `pinsByMessage`;
- the browser's naming rule (`freeMadeName` skipping taken names case-insensitively, `isPatternName` with regex characters in a pattern).

The engineer's `test/makers.test.ts` covers the shared rule through `makers.ts`.

## Known gaps

- **A brain on +N is two clicks.** Recency keeps the brains in play on the row; a quiet one from forty messages back is in **+N**. A "keep on the row" pin per brain would be the next step if that grates.
- **`fresh` lives in the tab.** A brain made from the CLI, or in another tab, isn't fresh here, so its name field doesn't open by itself. Its **Rename** still stands out while it has its pattern's name. A reload forgets which were fresh.
- **Tags in a narrow card still clip** (as before T16). The most telling ones now come first.
- **Pre-existing, not mine:** at phone width the Settings tabs run under the close ×. I left it alone.
- **Palette:** with 14 colors, the 15th brain repeats a color. Initials and names still tell them apart.
- **Server and data:** my scratch server and mock (4817/4818) are stopped. Their data (only `dev-t16-ui`) is in my scratchpad. No other user appeared there.
