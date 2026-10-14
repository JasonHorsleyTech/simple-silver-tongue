# T02 frontend report: basic streaming chat (CP1)

## What I built

The browser chat is done, on top of the T02 commands and the T01 shell. I added one command, `generation.follow`, so a reload mid-reply re-attaches to the stream instead of waiting for a save.

- **Sidebar.** "New conversation", then every conversation (newest first, relative time), linked to `/c/<id>` with the active one highlighted. Files the server can't read are listed greyed out with the reason (T02 QA-4). It refreshes after every change and when the tab regains focus, so CLI changes show up.
- **New conversation (`/`).** Title (optional) and a system prompt, pre-filled with an editable default ("You are a thoughtful, concise assistant. Format your answers in Markdown."). A blank system prompt is refused before anything is sent. ⌘ Enter starts it, and you land in the chat with the composer focused.
- **Chat (`/c/<id>`).**
  - **Header:** the title (click to rename), the model, the running cost (every generated version), **Payload** and **Settings**.
  - **Empty state:** before the first message it shows the brain and its system prompt, so nothing about the conversation is hidden.
  - **Scrollback:** player messages are quiet bubbles on the right. Brain messages are full-width Markdown under a colored brain badge, with a footer: copy-the-Markdown, then `in · out · $cost` (model and finish reason on hover). The footer is always shown on the last message and on hover elsewhere.
    - It follows the stream while you're at the bottom and leaves you alone once you scroll up, with a "Latest" pill to jump back.
    - An empty saved reply is an explicit "No reply text" card saying why (T02 QA-6). `finish_reason: length` with text gets a "Cut off by max_tokens" tag.
  - **Streaming:** tokens are painted once per animation frame (buffered), with a blinking caret.
    - Before the first token you see the dimmed, not-yet-saved player bubble plus typing dots.
    - Reasoning shows as a collapsed "Thinking…" (shimmer) that you can open to watch live, then as "Reasoning · N tokens", collapsed.
  - **Composer:**
    - Enter sends, Shift+Enter adds a newline, and Enter during IME composition is left alone. It grows to 40% of the window, then scrolls.
    - The text is kept per conversation while you move around (memory only; never browser storage, since an encrypted user's words must not land on disk).
    - An empty Send asks the brain to respond. In a fresh conversation that is the server's 400 `nothing_to_answer`, shown inline.
    - The send buttons are shaped for T04: the big Send goes to the default brain, plus one small button per other brain (none today).
  - **Errors, never swallowed:**
    - **Up-front failure** (400, 409, 502): an inline notice above the composer, and your text goes back into it, because it wasn't saved.
    - **Mid-stream break:** the partial text stays dimmed in the reply's own frame, marked as not saved, with the server's message, **Retry** (a `turn` with no new message) and **Dismiss**.
    - **409 busy** (another tab or the CLI is replying): the notice, your text back, and the view *follows* that reply as it streams.
- **Reload mid-reply.** On load (and on tab focus) the view calls `conversation.get` and then `generation.follow`. If a reply is running you get what has streamed so far, then the rest live, then the saved message, with no duplicates. Before Venice has accepted, it says "Waiting for Venice to start the reply…".
- **Settings (every word sent is editable).** The panel is docked beside the chat at 1180 px and up, and is an overlay drawer below that (Escape or the backdrop closes it). Its open state is remembered per browser.
  - **Brain:** system prompt; reasoning on/off, with effort levels from `models.list`, and when on the provider note "Reasoning on: the provider adds a small hidden instruction we can't see or edit."; final reminder on/off plus text.
  - **Framing templates:** all four (player, other brain's text, other brain's image, steer), each saying when it is used, with a warning when a template drops its `{{content}}`, `{{prompt}}` or `{{instruction}}`.
  - **Conversation:** model, price and privacy; id; delete (with confirmation; refused while replying).
  - Text fields save on purpose: Save (or ⌘ Enter) and Revert (or Escape), with "Unsaved changes" and "Saved" states. A half-typed system prompt is never sent.
- **Payload.** `prompt.preview` for the default brain, including the unsent composer text, so it shows exactly what Send would send. It has a "Messages" view (parameters, then each message verbatim with role, index and length) and a "Raw JSON" view, plus the server's notes (the reasoning note) and refusal. "Copy JSON" copies the body.
- **Markdown** (`components/Markdown.tsx`):
  - `react-markdown` + `remark-gfm` + `remark-breaks` + `rehype-highlight` (highlight.js's common languages, colors tuned to the palette).
  - Code blocks get a language label and Copy. Tables keep their GFM alignment and scroll sideways. Task lists, footnotes and strikethrough work.
  - External links open in a new tab; footnote links stay in place.
  - **Raw HTML is shown as faint literal text instead of being dropped.** Models here see `<!-- from: … -->` framing and can echo it, and nothing a model wrote should be invisible.
- **T03/T04 seams** (also in AGENTS.md *Lessons learned* and the T03/T04 tickets):
  - `useChat` has one reducer for every generating stream and upserts saved messages by id, so a regenerate's `done.message` replaces the message in place.
  - `MessageItem` has header/body/footer slots, ready for edit-in-place with raw Markdown, actions and the version pager.
  - `SettingsPanel` maps `conv.brains` to `BrainEditor`s; `PayloadDialog` takes a `brain`; `Composer` takes all brains; `BrainBadge` colors by `brain.color`.

### Server-side changes (all through the registry, so the CLI has them too)

- **`generation.follow --conversation`** (new stream command). `beginGeneration` now also records, in memory only, the events the generation streams (consecutive deltas merged), via `gen.relay(events)`. A follower gets `{type:"following", startedAt}`, what has streamed so far, then the rest live, ending with the generation's own `done` (same message, same note) or the same error. With nothing running it ends at once with `{type:"done", message: null}`; an unknown id is a 404. `turn` now relays through it. The CLI prints a status line for `following`.
- **Client-neutral error wording.** These messages reach the browser too, so they no longer offer a CLI flag as the only remedy:
  - `nothing_to_answer` now ends "Write a message for it first."
  - The broken-stream retry hint is now "send again with no new message: turn without --content, or Retry in the browser."
- **Mock: `MOCK_MARKDOWN`** (`src/dev/mock-markdown.ts`). It appends a long Markdown reply after the echo line (about 7 s at the default delay), so rendering and reload-mid-stream can be checked for free.

## Commands added

| Command | What it does |
|---|---|
| `generation.follow --conversation c_…` | Replays the running reply so far, then streams the rest live; `done` with `message: null` when nothing is running. |

`web/src/api/types.ts` gains `models.list`, `conversation.*`, `brain.update` and `prompt.preview`, plus the `turn` and `generation.follow` streams. The conversation document and model types are now `import type`d from the server's own dependency-free files, so they can't drift.

## Flows verified in Chrome (DevTools MCP)

Run against `npm run up:mock` as `dev-t02-fe` (plain) and `dev-t02-fe-enc` (encrypted), at 1440×900 and 420×860.

| Flow | Result |
|---|---|
| Log in, create "The Gilded Goat" via the form (⌘ Enter) | Routed to `/c/c_muabfe3uo6`; the sidebar shows it; the composer is focused. A blank system prompt is refused inline. |
| Fix the system prompt in Settings (my first edit had appended text) | "Unsaved changes", then ⌘ Enter, then "Saved"; the empty state followed. |
| Type with Shift+Enter, send with Enter | The composer value held `\n`; Enter sent it; the reply streamed with a caret; the header cost became $0.000056. |
| Long Markdown reply (`MOCK_MARKDOWN`) | Headings, bold, italic, strikethrough, inline code, link, nested ordered/unordered lists, a task list, nested quotes, an hr, an aligned table, highlighted ts/python/bash with Copy, the footnote, and the HTML comment visible. |
| Payload with a draft in the composer | 6 messages: system, framed pairs, and the draft framed last. Escape closes it. **The browser's `prompt.preview` body and the body the mock received, both SHA-256 `4de46c6e…342c3f`, were identical.** |
| **Reload mid-stream** (2 s into a 7 s Markdown reply) | The ledger loaded, `generation.follow` replayed the partial reply and it carried on streaming live; it finished and saved once (8 messages, no duplicates). |
| **Reload before the first token** (`kill -STOP` the mock, send, reload, `kill -CONT`) | "Waiting for Venice to start the reply…", then the saved player message and the reply streamed in; 10 messages, no duplicates. |
| Server restart while on `/c/<id>` | The login screen showed the "session ended" notice; Enter logged in and returned to the same conversation. |
| Empty Send in a fresh conversation | Inline: "There is nothing for Assistant to answer yet: … Write a message for it first." Dismissable; it also clears when you type. |
| `MOCK_ERROR` (up-front 502) | Inline error, nothing saved, and the text was back in the composer. |
| `MOCK_MIDSTREAM_ERROR` | The partial text was dimmed and marked not saved, with the server's error, Retry and Dismiss. Retry sent `{"conversation":"c_vqs6sa738e"}` (no content), checked in the Network panel. |
| Reasoning on, from Settings | The effort select offered `low/high/max` (from the model) and the provider note showed. Replies showed "Thinking…" live (opened mid-stream: the reasoning text), then "Reasoning · 12 tokens", collapsed. |
| `max_tokens` 5 with reasoning (set from the CLI) | A "No reply text" card: "It ran out of max_tokens while reasoning, before writing anything." |
| Unreadable files (a truncated file plus a partial doc) | After a tab focus, two greyed rows: "not valid JSON" and "not a conversation document (fields are missing)". |
| **CLI and browser at once** (CLI `turn … MOCK_SLOW`, then Send in the browser) | 409 notice, my text back in the composer, and the browser followed the terminal's reply live; then I could send. |
| Rename (click the title, type, Enter) | Header and sidebar updated. Escape cancels without saving. |
| Template editor | Removing `{{content}}` shows the warning; Escape reverted it (and didn't close the panel). |
| Delete (Settings, Delete, confirm) | Back to `/` with the list refreshed. |
| 420 px wide | The settings panel turned into an overlay drawer, and Escape closed it. The composer was 300 px tall at first (bug, fixed below), then 42 px. The header shows icon buttons. |
| Encrypted user | Created a conversation and sent 2 turns. `grep` for the title, the player text and "MOCK reply" over `data/users/dev-t02-fe-enc` and `.run/` found nothing, and the file starts `SSENC1`. |
| Browser storage | `localStorage` holds only `ss.lastUsername` and `ss.settingsOpen`; nothing else is stored, and `document.cookie` is empty (httpOnly). |

- **Console:** no app errors or warnings. I checked twice, including messages preserved across the last 3 navigations, after the main chat and after the error flows.
- **Network:** every app call was `POST /api/<command>`: `auth.*`, `health`, `conversation.list/create/get/update/delete`, `models.list`, `brain.update`, `prompt.preview`, `turn` and `generation.follow`.

### Live smoke (`npm run up`, `deepseek-v4-1-flash`)

"Live smoke" conversation, system prompt "You are terse. Answer in Markdown, in at most 25 words.":

1. "Give me a two-item bulleted list of tavern names, with one in bold." It streamed in and rendered as `<ul><li><strong>The Drowned Rat</strong></li><li>The Gilded Flagon</li></ul>`, 45 in · 14 out · $0.00003.
2. Reasoning on in Settings, then "Add a third name." "Thinking…" showed live, then "Reasoning · 179 tokens" collapsed above a 3-item list, 98 in · 200 out · $0.00027.

**Spend:** $8.00957627 → $8.00927657 = **$0.0003**, for 2 live text calls and no images. The server log holds no message content.

## Screenshots

- `reports/screens/T02-chat-markdown.png`: the long Markdown reply under a player bubble: heading, link, strikethrough, inline code, nested lists, task list, the faint literal HTML comment, the fade into the composer.
- `reports/screens/T02-code-table-quote.png`: nested block quote, hr, the aligned table, a highlighted TypeScript block with Copy.
- `reports/screens/T02-payload.png`: the exact-payload dialog, ending with the unsent draft framed by the player template.
- `reports/screens/T02-live-settings-reasoning.png`: **live** `deepseek-v4-1-flash`. A Markdown list, the collapsed "Reasoning · 179 tokens", and the docked Settings panel with reasoning on and the provider note.

### Fixed after looking at my own screenshots and runs

- **The whole shell scrolled.** remark-gfm's visually hidden "Footnotes" heading is absolutely positioned; its containing block was outside the scroll box, so it overflowed `<main>` and scrolled the header away. Fixed with `.md { position: relative }`.
- **Shift+Enter lines merged** (single newlines are soft breaks in plain Markdown, which would also flatten a haiku). Added `remark-breaks`.
- **Footnote links opened a new tab.** `#` links now stay in the page.
- **The composer was 300 px tall at narrow width.** It was measured on window resize while the docked panel still took the width. It now re-measures on its own width changes (ResizeObserver).
- **The caret dropped to its own line in nested lists.** The selector now targets the deepest last list item.
- **Too much air under each player bubble.** Its hover-only footer took layout space; it now floats in the gap.
- **The scrollback stopped at a hard edge** above the composer. Added a fade.
- **A followed reply before `start` showed a grey "Reply" badge.** It now says "Waiting for Venice to start the reply…".
- **Times read "02:16 AM".** Now "2:16 AM".
- **CLI-only wording in browser errors.** Made client-neutral (above).
- **The failed-reply text said "broke off" twice.** Now "The text above is partial and was not saved."
- **The payload dialog's focus ring sat on the close button.** Focus now goes to the dialog body (arrow keys scroll).
- **The delete confirmation appeared below the fold.** It scrolls into view.

## Known UI gaps

- **The live reply always renders at the end of the list.** That's right for `turn`; T03's regenerate should render it in the regenerated message's slot (noted on T03).
- **The reasoning disclosure re-collapses when a live reply is saved:** it becomes a different component. Small; it can be lifted into `useChat` if it annoys.
- **No Stop button.** `generation.stop` is T03's optional stretch; the lock's `AbortController` is ready.
- **No model picker yet.** Model, max tokens and temperature are T04's settings drawer; the panel shows the model read-only, and the CLI sets them today.
- **Two bars at narrow width.** Below `md` the T01 top bar and the chat header stack. Fine for a laptop-first app; T07 polish could merge them.
- **Bundle size.** The JS bundle is ~617 kB (highlight.js's common languages). It's served from localhost, so I raised Vite's warning limit rather than split it.
- **Live-only.** The reload-before-first-token and 409-follow paths were checked on the mock only; they're server-side and identical live.

## Tests

`npm test`: **71 pass** (68 before). `npm run typecheck` is clean (server, CLI, tests, web), and the web build succeeds. New:

- `test/chat.test.ts` › **generation.follow**:
  - Idle gives an empty `done`; an unknown id gives a 404.
  - A late follower gets `following`, `message`, `start`, the merged replay, then live deltas; its text equals the saved message and the sender's text; its `done` equals the sender's.
  - A broken reply gives the follower the same `venice_error`, and afterwards there is nothing to follow.
- `test/chat.test.ts`: `generation.follow` from the CLI says when nothing is running.
- `test/mock-venice.test.ts`: `MOCK_MARKDOWN` streams the sample verbatim, indentation and newlines included.
- Updated the retry-hint assertion for the new wording.

## Docs changed

- **design.md:** the generation lock's live event log; `following` and `done.message: null`; `generation.follow` under the T02 commands; client-neutral error wording; Web app → types, the chat view, Markdown, the settings and payload views; the mock's `MOCK_MARKDOWN`.
- **AGENTS.md:** `generation.follow` under *Running it*, and three *Lessons learned* bullets (the chat view's seams for T03/T04, re-attaching to a stream, Chrome MCP tips).
- **TICKETS.md:** T02 → `done`. Pointers on T03's and T04's frontend scopes to the pieces they extend.

## Housekeeping

The server is left freshly started on current code against the mock (`npm run up:mock`). Test users: `dev-t02-fe` and `dev-t02-fe-enc` (`dev-*`, free to wipe). I removed the two unreadable files I planted.
