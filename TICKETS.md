# Tickets

Each ticket goes through the four-pass loop in AGENTS.md: Engineer, QA, Triage & fix, Frontend. Status values: `todo`, `engineer`, `qa`, `triage`, `frontend`, `done`. The triage pass appends deferred items to the relevant later ticket under **Deferred in**.

**Scope bullets describe outcomes. Method details in them are suggestions** (see "How we delegate" in AGENTS.md). Acceptance bullets are the real bar.

Jason's checkpoints map onto tickets like this: CP1 → T02, CP2 → T03, CP3 → T04, CP4 → T05, CP5 → T01 + T06, and the final D&D acceptance → T07.

---

## T00: Project setup · `done`
AGENTS.md, docs/design.md, TICKETS.md, role skills, `.gitignore`, `git init`. Stack proposal awaiting approval.

---

## T01: Foundation: server, command registry, CLI, users and encryption · `triage`

**Engineer scope**
- `package.json` (ESM), `tsconfig.json` (`noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, strict), and the scripts `up`, `up:mock`, `down`, `logs`, `test`, `typecheck`. `up` stops any running server, builds the web app if there is one, starts the server detached (pid and log in `.run/`), waits for `/api/health` and prints the URL. `up` is idempotent: it always ends with a fresh server on current code.
- An `./ss` executable at the repo root (the CLI). `npm run ss -- ...` works too.
- The command registry with zod schemas. HTTP adapter (`POST /api/<cmd>`, JSON or NDJSON, plus GET for binary commands). CLI adapter: flag parsing, `@file` and `-` stdin for text args, `--json`, live printing of streamed events, help generated from the schemas.
- Storage: atomic file writes, per-user dirs, an encryption layer (plaintext when the user has no password), scrypt + AES-256-GCM per design.md.
- Users and sessions: `user.create` (hidden password prompt when `--password` is not given; empty = unencrypted), `user.list`, `auth.login`, `auth.logout`, `auth.whoami`. Browser sessions via httpOnly cookie, CLI via `.run/cli-session.json`.
- Venice client basics: `models.list` (text and image, cached ~10 min, showing name, price and privacy) and `venice.balance`.
- Mock Venice server (`src/dev/mock-venice.ts`) with `/models`, `/api_keys/rate_limits` and, already, a streaming `/chat/completions` and `/image/generate`, so later tickets can rely on them.
- Tests: crypto round trip (a wrong password fails), CLI arg parsing, one end-to-end test (create user, log in, whoami against an in-process server).

**Acceptance**
- `npm run up:mock && ./ss user.create --username dev-a --password ''` then `./ss auth.login --username dev-a --password ''` and `./ss auth.whoami` all work. So does the same for an encrypted user `dev-b`.
- `./ss models.list --type image` lists real models against the live API (`npm run up`).
- `npm run down` stops everything. `npm test` and `npm run typecheck` pass.

**Frontend scope:** Scaffold `web/` (Vite + React + TS + Tailwind v4, dark), with an API client that wraps `POST /api/<cmd>` and NDJSON streaming, a login screen (username + password, which may be empty), and an app shell with a sidebar placeholder and logout. `npm run up` builds and serves it.

**Deferred in:** *(none yet)*

---

## T02: Basic streaming chat (CP1) · `todo`

**Engineer scope**
- The full conversation document per design.md (settings, templates, setup, brains, ledger), even though brains and setup only get commands in T04. A new conversation gets one default text brain named "Assistant" with the given system prompt, and per-brain reasoning on at `low`.
- `conversation.create` (title, system prompt), `.list`, `.get`, `.update` (title and settings), `.delete`.
- `buildRequest` per design.md, as a pure function, implemented in full for text brains, with unit tests covering player framing, own vs other assistant messages, setup and reminder.
- `prompt.preview` returns the exact body. A test asserts the send path uses the same builder.
- The Venice streaming chat client (SSE parse, reasoning deltas, usage and cost), always `include_venice_system_prompt: false`.
- `turn` (stream): saves the player message, streams the default brain's reply, saves it with reasoning and cost, and holds a per-conversation lock (409 if busy).

**Acceptance**
- From the terminal: create a conversation with a system prompt, send 3 user messages, get 3 streamed replies, and see the full ledger in `conversation.get`.
- `prompt.preview` shows system, then framed user/assistant pairs, with no extra text.
- One live round trip on `deepseek-v4-1-flash` works.

- Handle the empty-system-prompt leak (design.md hard rule 1, T01 QA-1): warn in `prompt.preview` and pre-fill a non-empty system prompt.

**Frontend scope:** Sidebar conversation list, "New conversation" form (title + system prompt), and the chat view with routing at `/c/<id>`. Markdown-rendered scrollback, a composer (Enter sends, Shift+Enter adds a newline), live token streaming, collapsible reasoning, and a running cost per conversation.

**Deferred in:** *(none yet)*

---

## T03: Steered regeneration, versions, edit and delete (CP2) · `todo`

**Engineer scope**
- `message.regenerate --message <id> [--steer "..."]`: only for the last ledger message, and only when a brain wrote it. Uses the steer template, appended last. Produces a new version and makes it active.
- `message.select-version`, `message.edit` (any message, active version, in place), `message.delete` (any message).
- Optional stretch: `generation.stop` to abort an in-flight stream and keep the partial text.

**Acceptance**
- The green/blue/green scenario from Jason's brief: regenerate the latest reply with "say it's blue", then with "say it's green". `prompt.preview` for the next turn shows **no trace** of either steer, only the active version's text.
- Edit a user message 3 turns back and an assistant message 2 turns back. The next `prompt.preview` shows the edited text.
- Regenerating a message that is not the last one is rejected with a clear error.

**Frontend scope:** Per-message actions. Edit swaps rendered Markdown for a raw Markdown textarea with Save/Cancel. Delete asks for confirmation. The last brain message gets "Regenerate…" with an optional steer box, plus a version pager (`‹ 2/3 ›`) showing the steer that produced each version.

**Deferred in:** *(none yet)*

---

## T04: Multiple brains, setup messages and templates (CP3) · `todo`

**Engineer scope**
- `brain.add` / `.update` / `.delete` / `.set-default`. Delete is refused while the ledger references the brain. Kind is locked once the brain has messages. The final reminder is enabled by default on non-default brains, pre-filled with an editable `<!-- System reminder -->` example.
- `setup.add` / `.update` / `.delete` / `.move` (World Bible etc.; default pre-fill `<!-- This is the World Bible. -->`).
- `conversation.update` covers the templates.
- `turn --brain <name|id>`, sending to any brain. With empty content, it just invokes the brain.
- `message.add --as player|<brain>`: hand-authored messages, e.g. the GM's opening line.
- Regenerate always uses the message's own brain.
- `--brain` accepts a name or an id everywhere.

**Acceptance (terminal, mock, then one live pass)**
- A D&D setup: GM (default) with the system prompt "You are the GM…", a World Bible setup message, a hand-authored GM opener, and a Dice Master with a reminder.
- Player → GM → player → Dice Master → player → GM. `prompt.preview --brain "Dice Master"` shows: its own system prompt, the World Bible, GM lines as `<!-- from: Game Master -->` user messages, player lines framed, its own earlier replies as assistant, and the reminder last. `prompt.preview --brain "Game Master"` shows the Dice Master's line as a framed user message and no reminder.
- Editing a GM message changes what the Dice Master sees.
- Adding a third brain mid-conversation and editing the GM's system prompt both work without restarting the conversation.

**Frontend scope:** A conversation settings drawer: title, text and image model pickers from `models.list`, reasoning effort, a templates editor, a setup-messages editor (add, reorder, edit, delete), and a brains editor (name, color, kind, system prompt, reasoning on/off + effort, reminder checkbox + text, default, delete only when unused). The composer gets a big Send to the default brain plus a button per other brain. Messages get colored author badges. An "Exact payload" modal per brain renders `prompt.preview`.

**Deferred in:** *(none yet)*

---

## T05: Image brains (CP4) · `todo`

**Engineer scope**
- `kind: "image"` brains with a per-brain `safeMode` (default on) and editable tool text (`tool.description`, `tool.promptParamDescription`, `tool.resultContent`). The request carries `tools` and a forced `tool_choice`, with the tool args streamed.
- Image generation via `/image/generate` with the conversation's image model and options, respecting the model's constraints from `/models?type=image`. Images stored per user (encrypted when the user is). `image.get` serves the bytes (GET works for `<img>`), and `image.retry` re-runs a prompt.
- The stream stays open until the image is done. Generation completes and persists even if the client disconnects.
- Edit an image message, meaning its prompt, and a new image is generated; it swaps in when done. Regenerating with a steer produces a new prompt and a new image as a new version. Deleting the message deletes its images.
- Own history renders as assistant `tool_calls` plus a `tool` result. Other brains see `templates.otherBrainImage`.

**Acceptance**
- From the terminal (mock): a Scene Painter brain produces a tool call, an image is stored, and `image.get` writes a valid file. The GM's `prompt.preview` contains the exact prompt text framed.
- Live: one real tool call plus one real image with `z-image-turbo`.
- Editing the prompt generates a new image. A steered regeneration produces a new prompt and a new image.

**Frontend scope:** An image message card showing the prompt (streams in live, collapsible), then a loader, then the image (click to enlarge), or an error with Retry. Editing the prompt keeps the old image dimmed with a spinner until the new one arrives. The image model and size live in the settings drawer. The safe-mode toggle (default on) lives on each image brain.

**Deferred in:** *(none yet)*

---

## T06: Multi-user encryption hardening (CP5) · `todo`

**Engineer scope**
- An audit: for an encrypted user, every file under `data/users/<u>/` except `user.json` is ciphertext, conversations and images alike. No plaintext anywhere else: logs, temp files, `.run/`, error messages.
- Wrong passwords are rejected cleanly. Sessions live only in memory, so a server restart means logging in again (the CLI tells you so). A plaintext user still works as plain JSON.
- `user.delete` (with confirmation) and the `user.list` flags (encrypted yes/no).
- A test proving an encrypted user's conversation file contains none of a known plaintext string, and the same for an image file.

**Acceptance:** Two users, one plain and one encrypted, used side by side from both the CLI and the browser. `grep -r "<known phrase>" data/users/<encrypted>` finds nothing.

**Frontend scope:** Login polish (user picker from `user.list`, a lock icon for encrypted users, error on a wrong password), logout and switching users, and a session-expired redirect to login.

**Deferred in:** *(none yet)*

---

## T07: D&D acceptance, example campaign and polish · `todo`

**Engineer scope**
- `examples/dnd-tavern.json` (committed) with GM (default), Dice Master, Joke Teller, Scene Painter (image) and Character Portraitist (image), a World Bible setup message, a hand-authored GM opener, and sensible templates.
- `conversation.import --file` (from an example) and `conversation.clone [--without-messages]` (start "Pathfinder" from the D&D config).
- A live playthrough from the terminal as an encrypted `dev-` user: approach the hooded figure, steer a GM reply, ask the Dice Master, roll, have the GM continue, ask the Joke Teller, generate a scene image (the GM then references a detail from the prompt), edit the image prompt to regenerate, tweak a system prompt and add a new brain mid-game, and keep playing.

**Acceptance:** Jason's final paragraph, verbatim, works end to end in the terminal **and** in the browser, with data unreadable on disk.

**Frontend scope:** The same playthrough in Chrome, plus visual polish, empty states, keyboard niceties and error toasts. Screenshots go in `reports/screens/`.

**Deferred in:** *(none yet)*
