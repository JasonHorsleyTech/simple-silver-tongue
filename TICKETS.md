# Tickets

Each ticket goes through the four-pass loop in AGENTS.md: Engineer, QA, Triage & fix, Frontend. Status values: `todo`, `engineer`, `qa`, `triage`, `frontend`, `done`. The triage pass appends deferred items to the relevant later ticket under **Deferred in**.

**Scope bullets describe outcomes. Method details in them are suggestions** (see "How we delegate" in AGENTS.md). Acceptance bullets are the real bar.

Jason's checkpoints map onto tickets like this: CP1 → T02, CP2 → T03, CP3 → T04, CP4 → T05, CP5 → T01 + T06, and the final D&D acceptance → T07. T08 (hidden notes), T09 (dice rolls) and T10 (presets) came after the acceptance (Jason, 2026-10-14). T10 builds on both, so they run in that order.

---

## T00: Project setup · `done`
AGENTS.md, docs/design.md, TICKETS.md, role skills, `.gitignore`, `git init`. Stack proposal awaiting approval.

---

## T01: Foundation: server, command registry, CLI, users and encryption · `done`

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

## T02: Basic streaming chat (CP1) · `done`

**Engineer scope**
- The full conversation document per design.md (settings, templates, setup, brains, ledger), even though brains and setup only get commands in T04. A new conversation gets one default text brain named "Assistant" with the given system prompt, and per-brain reasoning **off** by default (see design.md, T02 QA-1).
- `conversation.create` (title, system prompt), `.list`, `.get`, `.update` (title and settings), `.delete`.
- `buildRequest` per design.md, as a pure function, implemented in full for text brains, with unit tests covering player framing, own vs other assistant messages, setup and reminder.
- `prompt.preview` returns the exact body. A test asserts the send path uses the same builder.
- The Venice streaming chat client (SSE parse, reasoning deltas, usage and cost), always `include_venice_system_prompt: false`.
- `turn` (stream): saves the player message, streams the default brain's reply, saves it with reasoning and cost, and holds a per-conversation lock (409 if busy).

**Acceptance**
- From the terminal: create a conversation with a system prompt, send 3 user messages, get 3 streamed replies, and see the full ledger in `conversation.get`.
- `prompt.preview` shows system, then framed user/assistant pairs, with no extra text.
- One live round trip on `deepseek-v4-1-flash` works.

- **Enforce a non-empty system prompt** (design.md hard rule 1, T01 QA-1, Jason's explicit request): never send a request without a user-written system message. Creating a conversation requires a system prompt or pre-fills an editable default, and the send path and preview refuse an empty one. QA should confirm, on one cheap live call, that `usage.prompt_tokens` matches what we sent, with nothing injected.

**Frontend scope:** Sidebar conversation list, "New conversation" form (title + system prompt), and the chat view with routing at `/c/<id>`. Markdown-rendered scrollback, a composer (Enter sends, Shift+Enter adds a newline), live token streaming, collapsible reasoning, and a running cost per conversation.
- **From T02 triage:** `conversation.list` also returns `unreadable: [{id, error}]`; show those rows (greyed, with the reason) rather than dropping them. A saved brain reply can have empty content (`finishReason: "length"` with reasoning on): render it as an explicit "no reply text" bubble, not a blank one. Reloading mid-reply is safe now: the server finishes and saves the reply, so on load just show the ledger (the reply appears once it is saved). Sending from an empty composer in a fresh conversation is a 400 `nothing_to_answer`; show its message inline.

**Deferred in:** *(none yet)*

---

## T03: Steered regeneration, versions, edit and delete (CP2) · `done`

**Engineer scope**
- `message.regenerate --message <id> [--steer "..."]`: only for the last ledger message, and only when a brain wrote it. Uses the steer template, appended last. Produces a new version and makes it active.
  - **From T02 (live probe):** with a steer, keep the message's active version in the request, before the steer; only a plain re-roll excludes it (design.md, "Turns, regeneration and edits"). `buildRequest` already supports both (`steer`, `excludeFromMessageId`). Add a `planRegenerate` next to `planTurn` and give `prompt.preview` matching options, so the steered request can be previewed exactly.
  - **From T02 triage:** build the plan as `{ ..., body, ...reviewBody(brain, body, model) }`, as `planTurn` does, so the preview gets the same `refusal` and `notes`. `buildRequest` throws on a blank `steer`, so trim the user's `--steer` at the command layer and treat blank as "no steer" (a plain re-roll). The send path (`openChatStream`) refuses any body that doesn't end with a `user` or `tool` message, whoever built it.
- `message.select-version`, `message.edit` (any message, active version, in place), `message.delete` (any message).
- Optional stretch: `generation.stop` to abort an in-flight stream and keep the partial text.

**Acceptance**
- The green/blue/green scenario from Jason's brief: regenerate the latest reply with "say it's blue", then with "say it's green". `prompt.preview` for the next turn shows **no trace** of either steer, only the active version's text.
- Edit a user message 3 turns back and an assistant message 2 turns back. The next `prompt.preview` shows the edited text.
- Regenerating a message that is not the last one is rejected with a clear error.

**Frontend scope:** Per-message actions. Edit swaps rendered Markdown for a raw Markdown textarea with Save/Cancel. Delete asks for confirmation. The last brain message gets "Regenerate…" with an optional steer box, plus a version pager (`‹ 2/3 ›`) showing the steer that produced each version.
- **From T02 frontend:** the slots are there. `MessageItem` (`web/src/features/chat/`) has header/body/footer; actions go in `MessageFooter`'s `actions`, which is always visible on the last message. `useChat` merges saved messages by id (`upsertMessage`), so a regenerate's `done.message` replaces the old one in place. Relay `message.regenerate` through `gen.relay` (as `turn` does) and `generation.follow` covers reloads for free. The live reply currently renders at the end of the list; a regenerate should render it in the regenerated message's slot (its id is the `start` event's `messageId`).
- **From T03 engineer** (the commands are in; add them to `web/src/api/types.ts`):
  - `message.regenerate {conversation, message?, steer?}` (stream). Its `start` event carries `regenerate: true` and the `steer`, also when replayed by `generation.follow`, so a reloaded tab can tell a regenerate from a turn and render it in the message's slot. `done.message` is the whole message with the new version active.
  - `prompt.preview {conversation, regenerate: true, steer?}` is the exact steered request, for a "show payload" next to the steer box. Its result has `regenerate: {messageId, newVersion, steer?, steeredFrom?}`.
  - `message.select-version {conversation, message, version}`: **`version` is 1-based** (what the pager shows), while the document's `activeVersion` is 0-based. Each version has `steer` and `steeredFrom` (0-based index of the version it revised) for the pager: "steer: … (on version 2)".
  - `message.edit {conversation, message, content}` (blank refused), `message.delete {conversation, message}`. Both, and select-version, are a **409 while a reply is being generated**: disable them during a reply, or show the 409 message.
  - `generation.stop {conversation}` → `{stopped, message, error?}`, returning once the stopped reply is saved: a Stop button for the live reply. What had arrived is kept as the message (turn) or a new version (regenerate), with `stopped: true` (show "stopped"). When nothing had arrived, the stream ends with an error of code `stopped` (HTTP 499 if it ended before the first event): show its message calmly, not as a failure. For a turn stopped before its `message` event, the player message wasn't saved: put the text back in the composer, as for any failed send.
- **From T03 triage:**
  - **The Stop button's copy must be honest: a stop saves waiting, not money.** Venice still writes and bills the whole reply. `generation.stop` now returns `note` (`STOP_BILL_NOTE`: "Stopping saves waiting, not money: Venice still writes and bills the whole reply, so its cost is added to the conversation once Venice reports it."). Show it near the button (tooltip or caption) and with the stop result, rather than writing your own wording.
  - A stopped version gets its `usage` and `costUsd` a little *after* the stop, from the server's drain (live: seconds). Until then, show "stopped · cost pending" rather than nothing. The header total is `conversation.spentUsd`, and `conversationCost` in `web/src/lib/format.ts` already reads it. A stop doesn't send an event when the cost lands, so re-fetch `conversation.get` a few seconds after a stop, or on the next focus or load.
  - `conversation.update` now refuses a template without its placeholder (400 `bad_args`, with the message on `templates.<name>`): show it inline in the templates editor. Each template's help line says which placeholder it needs.
  - The running total only grows: deleting a message keeps its cost. If the delete confirmation mentions cost, it shouldn't promise a refund.

**Deferred in:** *(none yet)*

---

## T04: Multiple brains, setup messages and templates (CP3) · `done`

**Engineer scope**
- `brain.add` / `.update` / `.delete` / `.set-default`. Delete is refused while the ledger references the brain. (`brain.update` exists since T02 for name, color, system prompt, reasoning and reminder; T04 extends it with kind, tool text and safe mode. The default brain is `conversation.defaultBrainId`.) Kind is locked once the brain has messages. The final reminder is enabled by default on non-default brains, pre-filled with an editable `<!-- System reminder -->` example.
- `setup.add` / `.update` / `.delete` / `.move` (World Bible etc.; default pre-fill `<!-- This is the World Bible. -->`).
- `conversation.update` covers the templates. (Done in T02.)
- `turn --brain <name|id>`, sending to any brain. With empty content, it just invokes the brain. (`--brain` and name/id resolution already work in T02's `turn` and `prompt.preview`; with one brain there was nothing else to send to.)
- `message.add --as player|<brain>`: hand-authored messages, e.g. the GM's opening line.
- Regenerate always uses the message's own brain. (Done in T03: `planRegenerate` takes the brain from the message's author; there is no `--brain` on `message.regenerate`.)
- `--brain` accepts a name or an id everywhere.
- **From T03 triage:** "delete a brain, but not while a generation for it runs" must check the lock *inside* `mutateConversation` (as `assertLedgerIdle` does), and every generating command reads the conversation through `gen.load()` after `beginGeneration`, never with a bare `loadConversation` (design.md, "The lock and the read must agree"). Otherwise a delete can slip in between the lock and the read (T03 QA-1).

**Acceptance (terminal, mock, then one live pass)**
- A D&D setup: GM (default) with the system prompt "You are the GM…", a World Bible setup message, a hand-authored GM opener, and a Dice Master with a reminder.
- Player → GM → player → Dice Master → player → GM. `prompt.preview --brain "Dice Master"` shows: its own system prompt, the World Bible, GM lines as `<!-- from: Game Master -->` user messages, player lines framed, its own earlier replies as assistant, and the reminder last. `prompt.preview --brain "Game Master"` shows the Dice Master's line as a framed user message and no reminder.
- Editing a GM message changes what the Dice Master sees.
- Adding a third brain mid-conversation and editing the GM's system prompt both work without restarting the conversation.

- **From T03 frontend:** message actions (edit, delete, pager, Regenerate with a steer) work for any brain's message already: `MessageItem` takes the message's own brain, and the in-slot live reply uses it. The composer's Send becomes Stop during any reply (`status` names who is writing); with several brains, pass the replying brain's name, which `useChat`'s live reply already has. `PayloadDialog` takes `request: {kind: "turn", draft} | {kind: "regenerate", messageId, steer}`, so a per-brain payload is `{kind: "turn"}` with that brain.

- **From T04 engineer** (the commands are in; add them to `web/src/api/types.ts`):
  - `brain.add {conversation, name, systemPrompt, color?, kind?, reasoning?, finalReminder?, safeMode?, tool?}` → `Brain`. Without `color` it gets the first unused badge color; without `finalReminder` it is `{enabled: true, content: REMINDER_EXAMPLE}`, so the editor opens with an example to edit. `REMINDER_EXAMPLE`, `DEFAULT_TOOL`, `DEFAULT_SETUP_LABEL` and `setupPrefill` are in `src/conversations/wording.ts` (dependency-free, like `STOP_BILL_NOTE`), so the web can import the server's own text instead of copying it.
  - `brain.update` also takes `kind`, `safeMode`, `tool: Partial<BrainTool>`. Errors to show inline: 409 `kind_locked` (the brain has messages: disable the kind picker when `messageCount > 0`), 400 when safe mode or tool text is sent for a text brain, 409 `conflict` for a duplicate name, 400 for the reserved name `player`.
  - `brain.delete {conversation, brain}` → `{conversationId, deleted, name, brains}`. 409 `brain_in_use` (it has messages: show delete only when unused, as the scope says), 409 `default_brain`, and 409 `conflict` while that brain is writing a reply. `brain.set-default {conversation, brain}` → `Brain`: set `conv.defaultBrainId` to its id.
  - `brain.list {conversation}` → `{conversationId, defaultBrainId, brains: (Brain & {messageCount})[]}`: the easy way to know which brains may be deleted or change kind.
  - `setup.list|add|update|move|delete` all return `{conversationId, setup: SetupMessage[], changed?, deleted?}`: replace `conv.setup` with it. `setup.add {conversation, label?, content?, position?}` with no content pre-fills `<!-- This is the <label>. -->` (label default "World Bible"); `setup.move {conversation, setup, position}` is 1-based, so up/down arrows send `index` / `index + 2`. They work mid-reply.
  - `message.add {conversation, as: "player" | <brain name or id>, content}` → `MessageView`: "write as…" for the GM's opener. 409 while a reply is being generated, like edit.
  - `turn {conversation, brain, content?}` with empty content just invokes the brain, and a brain with its reminder on always has something to answer. The `start` event's `brainName` says who is writing.
  - Image brains can be created and edited now, but `turn`, `message.add` and regenerate refuse them (`not_supported`) until T05.

- **From T04 triage:**
  - **Retry must keep the brain.** Today `ChatView` retries with `chat.send("")`, which goes to the default brain: with per-brain Send buttons, a failed Dice Master reply would be retried by the GM (T04 QA-1). A broken reply's error now carries the exact retry request: `retryOf(err)` (`web/src/api/errors.ts`) gives `{command: "turn", args: {conversation, brain}}` or `{command: "message.regenerate", args: {conversation, message, steer?}}` (`RetryRequest`). Keep it on the failed live reply and replay it on Retry (for a turn, `send("", retry.args.brain)`); `live.brainId` from `start` names the same brain.
  - Brain names are now one line of visible text (no line breaks, tabs, control characters or zero-width-only names): `brain.add` / `.update` answer 400 `bad_args` with a per-field message, so show `errorMessage(err)` inline. A blank `message.add --as` or `--brain` is a 400 too, not "the default brain": omit the field for the default.

**Frontend scope (T02 built the base: `SettingsPanel`, `BrainEditor`, `TemplatesEditor`, `PayloadDialog`, per-brain `Composer` buttons, `BrainBadge`):** A conversation settings drawer: title, text and image model pickers from `models.list`, reasoning effort, a templates editor, a setup-messages editor (add, reorder, edit, delete), and a brains editor (name, color, kind, system prompt, reasoning on/off + effort, reminder checkbox + text, default, delete only when unused). The composer gets a big Send to the default brain plus a button per other brain. Messages get colored author badges. An "Exact payload" modal per brain renders `prompt.preview`.

**Deferred in:** *(none yet)*

---

## T05: Image brains (CP4) · `done`

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
- **From T03 frontend:** `MessageItem`'s `BrainBody` is where an image card goes, and `MessageEditor` already edits the active version's `content` (the prompt, for an image message). A steered regenerate of an image message streams into the message's slot through `LiveReply` with `slot`; add `tool_args` (the prompt) and the image events to `useChat`'s one reducer (`apply`, which ignores them today). Edit/delete of image messages are refused by the server until T05 (`not_supported`); the browser shows that message inline.

- **From T04 frontend:** the brain editor already edits an image brain's safe mode and all four tool texts (`BrainEditor`, under Brains in settings), and its payload braces show the forced tool call. What is still off until T05, each marked "T05" in the code:
  - the image brain's send chip in the composer (`BrainChip`, `disabled={image}`) and its "Write as…" entry (`WriteAsMenu`, `disabled={b.kind !== "text"}`): turn them on once `turn` and `message.add` accept image brains;
  - the "image replies arrive in T05" wording in `BrainEditor` (kind hint), `AddBrainForm`, `ConversationTab` (image model) and the chip tooltip;
  - the image model picker is in the Conversation tab (`ConversationTab`, `ModelPicker`); the image size and options (`settings.image`) belong next to it.
  `useChat` keeps `retry` (the error's `details.retry`) on a failed live reply, and `chat.retry()` replays it; T05's image errors can use the same path.
- **From T04 engineer:** image brains can already be created (`brain.add --kind image`, with `DEFAULT_TOOL` text and `safeMode: true`) and edited (`--tool.*`, `--safe-mode`), and `prompt.preview --brain` shows their forced tool call. `turn`, `message.add --as <image brain>` and `message.regenerate` refuse them with `not_supported`: lift those. Call `gen.forBrain(plan.brain.id)` right after planning in any new generating path, or `assertBrainIdle` keeps every brain "busy" (undeletable) for the whole generation.

- **From T05 engineer** (the commands are in; `web/src/api/types.ts` already has the new event shapes, `image.retry`, `ImageMessageView` and `Preview.image`):
  - **Events.** An image turn or regenerate streams `start` (with `kind: "image"`), then `prompt` deltas (the prompt as words, decoded server-side: render them as the prompt streaming in; there is no `tool_args`), then `image_pending {messageId, imageId, model, message}` (the prompt is saved: upsert `message`, show the loader), then `image_done {image, message}` or `image_error {error, image, message, retry}`, then `done {message, spentUsd}`. An image error still ends with `done`: the message is saved, only its image failed. `start.imageOnly: true` marks a generation with no text at all (`image.retry`, or the image a `message.edit` / `message.add` started), so there is no prompt to stream.
  - **The record** is `MessageVersion.image: ImageRecord` (`src/conversations/types.ts`): `status` pending/done/error, `error`, `mime`, `blurred`, `contentViolation`, `costUsd`, `safeMode`, `model`, and `previous`: while a replacement is pending (or failed), the last finished image, which is what to show dimmed under the spinner, or beside the error. Show `<img src={api.binaryUrl("image.get", {id})}>` for `image.id` when done, else for `previous.id` if there is one. A blurred image says safe mode blurred it, with a way to turn safe mode off and retry.
  - **Editing the prompt** is `message.edit` (it answers at once with `painting: {imageId, model}`, image pending, `previous` set), then follow the image with `generation.follow`, which ends with `done`. `message.add --as <image brain>` works the same way: turn on the image brain's "Write as…" entry. Turn on the image brain's composer chip: `turn` works.
  - **Retry** for a failed image is `image.retry {conversation, message}` (stream). `image_error.retry` carries that exact request, so `useChat`'s existing retry path can replay it. A broken prompt stream (`no_prompt` or `venice_error`) carries `details.retry` as before (a `turn` or `message.regenerate`).
  - **A message stuck pending can't happen**: a pending image no generation owns (the server died) is read back as an error ("wasn't finished… Retry it"), or as done if its file reached disk. Treat `pending` as "being made right now"; a reload mid-image re-attaches with `generation.follow` as for text.
  - **Stop** during the prompt keeps the prompt with an error image ("Stopped before the image was made"); during the image it waits for it and returns `imageFinished: true` with the message: say the image was already being made and billed, so it was kept.
  - **Settings.** `conversation.update {settings: {image: {width, height, aspectRatio, resolution, format, hideWatermark, negativePrompt}}}` (`null` unsets; `ConversationUpdate` in types.ts has it). The server refuses a size the current model can't take (400 with the reason): z-image-turbo is width × height in multiples of 8; Nano Banana is a listed resolution and aspect ratio. Use the model's `constraints` from `models.list` to offer the right controls. `prompt.preview` for an image brain has `image: {path, params, notes}`: show it in the payload view under the chat body ("then POST /image/generate with the prompt from the call"), with its notes.
  - The "T05" wording to remove is listed under **From T04 frontend** above.

- **From T05 triage** (this replaces the engineer's notes above where they differ: the lock, `generation.follow` for images, Stop, Retry):
  - **The conversation is free while an image is made.** An image brain's generation ends at `image_pending` (the prompt is saved). Jason's loop is "the painter paints, I send the next line to the GM at once, the image fades in": so at `image_pending` the composer must go back to Send and the chips come back, while the image card keeps its loader. Never show a 409 here; there is none. The turn's own stream keeps going to `image_done` / `image_error` + `done`: either keep reading it in the background for that message, or drop it and use `image.follow`. Don't let it hold `useChat`'s single live reply (that would block the GM's send in the UI).
  - **Render a pending image from the saved record, and follow it with `image.follow {conversation, message}`** (stream: `image_pending`…, then `image_done` / `image_error`, then `done {message}` with the message as saved; `StreamCommands` has it). Do this for every version whose `image.status` is `pending` in your copy: after `conversation.get` (page load, focus), after `message.edit` / `message.add` (`painting`), and for a turn whose stream you dropped. It can't miss a result: with nothing being made it answers `done` at once with the current message (T05 QA-2). `generation.follow` is for replies; it no longer covers images made after an edit, add or retry.
  - **What waits for an image being made (409, inline in the server's words):** editing that version's prompt, its Retry, deleting the message, deleting the conversation. Everything else works meanwhile: other brains' turns, Regenerate (a new version with its own image), the pager, other messages. Hide or disable those four actions on a message whose image is pending, or show the 409 inline.
  - **Stop never touches an image.** During the prompt, Stop works as before. Once `image_pending` arrives there is nothing to stop: hide Stop for the image. `generation.stop` returns `painting: [{messageId, imageId}]` (images still being made); show `IMAGE_STOP_NOTE` (wording.ts) if Stop is ever offered then. `imageFinished` is gone.
  - **Retry.** Offer Retry on a failed, interrupted, blurred or flagged image (it replaces it). `image.retry` of a finished image now keeps it and adds a new version with the same prompt (`version.repaintOf`: the version it repaints), so an "Another image" action on a done image is safe; the pager label can say "same prompt as v1".
  - A restart (`npm run up`) now lets a running image finish first, so a reload after a restart finds it done.

**Deferred in:**
- ~~Mock: add a trigger (e.g. `MOCK_BLURRED` in the prompt, with `safe_mode` on) that answers `x-venice-is-blurred: true`~~ Done in T05 engineer: `MOCK_BLURRED`, plus `MOCK_VIOLATION`, `MOCK_IMAGE_ERROR`, `MOCK_IMAGE_FLAKY`, `MOCK_IMAGE_SLOW` (design.md, "Mock Venice").
- ~~`relayReply` glues parallel tool calls' fragments into invalid JSON (T02 QA-7)~~ Done in T05 engineer: fragments are kept per `index`, only the first call is used (a second is named in the `done` note), and `parallel_tool_calls` is still not sent. The mock's `MOCK_TWO_TOOL_CALLS` interleaves two calls.

---

## T06: Multi-user encryption hardening (CP5) · `done`

**Engineer scope**
- An audit: for an encrypted user, every file under `data/users/<u>/` except `user.json` is ciphertext, conversations and images alike. No plaintext anywhere else: logs, temp files, `.run/`, error messages.
- Wrong passwords are rejected cleanly. Sessions live only in memory, so a server restart means logging in again (the CLI tells you so). A plaintext user still works as plain JSON.
- `user.delete` (with confirmation) and the `user.list` flags (encrypted yes/no).
- A test proving an encrypted user's conversation file contains none of a known plaintext string, and the same for an image file.

**Acceptance:** Two users, one plain and one encrypted, used side by side from both the CLI and the browser. `grep -r "<known phrase>" data/users/<encrypted>` finds nothing.

**Frontend scope:** Login polish (user picker from `user.list`, a lock icon for encrypted users, error on a wrong password), logout and switching users, and a session-expired redirect to login.

- **From T06 engineer:**
  - **No new commands for the browser.** `user.delete` and `user.change-password` are terminal commands, like `user.create`; don't add them to `web/src/api/types.ts` or the UI. What the browser must handle is their effect: either one logs that user out everywhere, so an open tab's next call gets `x-ss-session: invalid` / 401 `unauthenticated`, which `api/client.ts` already treats as "session gone" (`SESSION_GONE`). A request whose key was closed by a delete says `session_ended` ("This user was deleted…"), also in `SESSION_GONE`. The session-expired redirect should cover both, and say "Log in again" without blaming the user.
  - `user.list` → `{users: [{username, encrypted, createdAt}]}` is the picker's source (unchanged; `auth: false`). A deleted user drops out of it at once; a re-created name is a new user (its old tab must not keep showing the old user's conversation: the redirect to `/` on a dead session already handles that).
  - **I added `autoComplete="off"`** to the four raw textareas (`Composer`, `SteerBox`, `MessageEditor`, the shared `TextArea`) and the title input in `ChatHeader`, like the inputs that had it, so Chrome keeps no Autofill history of content. Please check in Chrome that nothing changed for the user (spellcheck, typing, the composer's autosize).
  - **One check only Chrome can answer:** does a draft typed in the composer (not sent) reach Chrome's profile on disk? Chrome keeps a tab's form state for session restore in its `Sessions/` files; the HTML spec says `autocomplete="off"` values aren't kept for history restore, but I couldn't confirm Chrome honours that for a `<textarea>`. Type a unique phrase into the composer, wait ~30 s (and/or open a second tab and close the first), then `grep -rl "<phrase>"` the Chrome profile folder the DevTools MCP uses. Report what you find; if it is there, say which file (design.md, "Where plaintext can still appear").
  - Two users side by side from the CLI: `SS_SESSION_FILE=<path> ./ss ...` gives a terminal its own login (the browser has its own cookie, as before).
- **From T06 triage:**
  - **Sessions now end after 60 idle minutes** (design.md, "Sessions"), and the browser part of that is built, so the session-expired redirect exists: `api.onSessionLost(why)` passes `"expired"` (header `x-ss-session: expired`, or 401 `session_expired`) or `"ended"`, and the login screen says "You were logged out after 60 minutes without activity, and the server wiped your key from its memory. Log in again to carry on." `session.tsx` also looks again (`auth.whoami`, which doesn't count as activity) when `idle.secondsLeft` runs out, so an idle tab drops to login on its own (checked in Chrome with `SS_SESSION_IDLE_MINUTES=0.1`). Polish the wording and look as you like; keep the timer.
  - **An unsent composer draft is lost when the session expires** (the shell unmounts). Don't save drafts to `localStorage` (that's plaintext on disk). If you keep one, keep it in memory only and only for the same user, and drop it on logout. Probably not worth it: an hour without sending anything is rare.
  - `auth.logout` takes `{all: true}` (`./ss auth.logout --all`): this user out of every tab and terminal. A "Log out everywhere" choice beside Log out would suit "I'm stepping away".
  - `user.list` → `{users, unreadable}`: a user whose `user.json` is damaged is in `unreadable` (`{username, error}`), not in `users`. The picker can ignore it, or show it greyed with its error.
  - The "session ended" wording after a `user.delete` still says "The server restarted, or you logged out in another tab" (QA's note); word it without blaming the user, as the engineer asked.

**Deferred in:**
- ~~Encrypted users' image files show their sniffed type in the extension (`images/img_….webp` / `.png`), which hints at the model family (T05 QA-6).~~ Done in T06 engineer: encrypted users' images are `img_….bin`; `readImageFile` sniffs the decrypted bytes (`image.get`, and `settleStaleImages` for `mime`); old names are still found and `auth.login` renames them to `.bin` (names only).
- ~~`user.delete` while that user has work in flight: its last save would recreate `data/users/<u>/conversations/` with no `user.json` (T01 QA-2).~~ Done in T06 engineer: `user.delete` is a 409 `user_busy` (nothing deleted, names the reply or image running) while the user has an open key copy (`forksOpen`, vault.ts); otherwise it logs the user out, closes every copy of its key, renames the folder away and removes it. A login racing it fails, and the vault can no longer create a user's folder at all (design.md, "Who is using a user's data right now").

---

## T07: D&D acceptance, example campaign and polish · `done`

**Engineer scope**
- `examples/dnd-tavern.json` (committed) with GM (default), Dice Master, Joke Teller, Scene Painter (image) and Character Portraitist (image), a World Bible setup message, a hand-authored GM opener, and sensible templates.
- `conversation.import --file` (from an example) and `conversation.clone [--without-messages]` (start "Pathfinder" from the D&D config).
- A live playthrough from the terminal as an encrypted `dev-` user: approach the hooded figure, steer a GM reply, ask the Dice Master, roll, have the GM continue, ask the Joke Teller, generate a scene image (the GM then references a detail from the prompt), edit the image prompt to regenerate, tweak a system prompt and add a new brain mid-game, and keep playing.

**Acceptance:** Jason's final paragraph, verbatim, works end to end in the terminal **and** in the browser, with data unreadable on disk.

**Frontend scope:** The same playthrough in Chrome, plus visual polish, empty states, keyboard niceties and error toasts. Screenshots go in `reports/screens/`.

- **From T05 frontend:**
  - Image brains are fully playable in the browser: chips and "Write as…" for image brains, the image card (prompt caption, painting frame, fade-in, large view), edit/regenerate/"Paint again"/Retry, blurred and failed states, per-conversation image settings. The playthrough's "generate a scene image" and "edit the image prompt to regenerate" steps need no new UI.
  - The example campaign's image brains: with the final reminder on (the `brain.add` default), the reminder is the last message the painter sees; that is fine live, but a mock trigger in the player's note then doesn't reach the image (AGENTS.md, T04/T05 lessons).
  - Polish candidates seen in Chrome, none blocking: the scrollback's floating "Latest" button sits over the caption of an image card when you scroll up a little; the large view has no previous/next between a conversation's images; a pending image whose card is far up the scrollback gives no sign at the bottom that it landed.
- (orchestrator) The default `otherBrainImage` template says the image "is now on the player's screen". Since T05 triage, the GM can answer while the image is still painting, so make the default wording accurate (e.g. "…called generate_image with this exact prompt:"). The example campaign should do the same.

- (orchestrator) Default `hideWatermark` to **true** for new conversations and the example campaign. The T05 live image showed a Venice watermark, and this is a personal scratch pad.
- **From T06 engineer, corrected in T06 triage (QA-3):** the terminal playthrough "as an encrypted `dev-` user" is fine as written, *because the user is a throwaway `dev-` user with made-up content*: agents' shells keep no shell history, but Claude Code keeps every command an agent runs and every output it reads in plain text (`~/.claude/projects/…/*.jsonl`), decrypted `conversation.get` output and piped passwords included (design.md, "Where plaintext can still appear"). So the playthrough never uses Jason's own users or his real campaign text (AGENTS.md). The data on disk is ciphertext (check it with `grep -r` as T06 did). For Jason's own campaign from his terminal, text typed in flags (`--content "..."`) lands in `~/.zsh_history`: AGENTS.md ("Running it") says to use the browser, or `--content -`. If `conversation.import --file` reads a plaintext example into an encrypted user, the example file itself is plaintext by design (it's committed); an import of private text from a file leaves that file where it was.

- **From T06 frontend:**
  - The login is a user picker now (locks on encrypted users), and the sidebar's user card is a menu: Switch user, Change password…, Log out, Log out everywhere. Nothing in the playthrough needs more; log in as the `dev-` user by clicking it.
  - The browser can change an encrypted user's password (`user.change-password`, at the orchestrator's request); `user.create` and `user.delete` stay terminal-only.
  - Polish candidates seen in Chrome, none blocking: a visible tab asks `auth.whoami` + `health` every 30 s, which is 2 lines a minute in `.run/server.log` per open window (the server logs every request; leaving those two out of the log would quiet it). A damaged conversation can't be removed from the app (by design: every write loads first, and a damaged file may still be rescued); the page says to move it aside. With a notice, four users and a damaged one, the login card's footer ("New user? …") falls below a laptop's fold.

- **From T07 engineer** (report: `reports/T07-engineer.md`):
  - Built: `examples/dnd-tavern.json`, `examples.list`, `conversation.import --example|--campaign [--without-messages]`, `conversation.clone [--without-messages]`, the accurate image wording, `hideWatermark: true`, `SS_CONVERSATION` in the CLI, and `README.md` for Jason. The terminal playthrough ran live as an encrypted `dev-` user.
  - **For Frontend:** the browser can't start the example or clone yet. Add the three commands to `web/src/api/types.ts`; a "Start from an example" entry on the home page (`examples.list` gives title, `about`, brain names; `conversation.import --example <name>` returns the whole conversation, then navigate to it); "Clone this campaign" in the Conversation tab (title, with or without the story). Then update README.md's "Start the example campaign" and "A new campaign from this one's setup", which say to use the terminal today.
  - **For QA:** a campaign file is any `conversation.get --json`; try odd ones (missing ids, a player message with two versions, an image brain message, a `defaultBrainId` that matches nothing, huge or deeply nested JSON). The example's prompts were tuned live; judge only that each brain does its job, not style.
  - Image size is per conversation, so the Character Portraitist paints at the Scene Painter's 1024×768. A per-brain size would need a field and UI; not built.
  - **Before Jason's first login**, someone should clear the test users: `find data/users -maxdepth 1 \( -name 'dev-*' -o -name 'qa-*' \) -exec rm -rf {} +` (about 30 by now; his picker lists them all). T07 engineer removed only its own.

- **From T07 triage** (report: `reports/T07-triage.md`):
  - **Stop sequences (QA-2).** Every brain has `stop` (text brains `["<!-- from:"]`, image brains none), sent as the request's `stop`. **For Frontend:** give the BrainEditor a "Stop sequences" field (one per line or chips, at most 4, none blank, `[]` allowed), saving with `brain.update --stop` (`BrainFields.stop` is in `web/src/api/types.ts`); show it on the brain card like the reminder. The payload view already gets the body's `stop` and the notes that say what it does (`stopNote`, and `STOP_REASONING_NOTE` when reasoning is on too); check they read well there. When reasoning is turned on for a brain with stop sequences, the editor could show `STOP_REASONING_NOTE` next to `REASONING_NOTE`.
  - The example's GM now names the check and stops (QA-1): the browser playthrough should show the loop (GM names a check → Dice Master chip → "I rolled a 6" → Send with nothing typed → the GM narrates the result).
  - An empty reply cut by a stop sequence says so in its `done` note; the browser shows an empty bubble with Regenerate, which is fine.

**Deferred in:**
- T07 QA-7 → handover (orchestrator): the 28 `dev-*`/`qa-*` users in `data/users/` stay for the frontend pass, which needs `dev-` users; clear them before Jason's first login (the `find ... -exec rm -rf {} +` above). T07 triage added and removed only `dev-t07-triage`.
  - **Done in the T07 frontend handover:** every `dev-*`/`qa-*` user deleted with `./ss user.delete`; the frontend pass played in a scratch data dir (report: `reports/T07-frontend.md`).

---

## T08: Hidden notes · `done`

Jason, 2026-10-14: brains need a way to write text that every brain reads but the player only sees on purpose. The T10 Character Creator answers with nothing else: a full character sheet, secrets included, that the GM and the Character Actor work from and the player must not read by accident. Any brain may keep notes this way (a GM's plans, what a clue really means), and so may the player.

**This doesn't bend hard rule 1.** A hidden note is ordinary ledger text. It is sent verbatim to every brain, it is in `prompt.preview`, the message editor shows it raw, and the scrollback shows it one click away. It is *folded*, not secret from the user. Nothing changes in `buildRequest`.

**The convention (suggestion):** a fenced code block whose info string is `hidden`:

````markdown
```hidden
Name: ...
Secret: ...
```
````

Why a fence: models write fences reliably, Markdown parses it without HTML, and a line scanner can find it in the terminal. The alternatives fit badly here. The scrollback shows raw HTML as literal text on purpose (`remarkVisibleHtml`, T02), so `<details>` would print as tags. HTML comments are already the framing language (`<!-- from: ... -->`, which the stop sequences cut). Spoiler syntax (`||...||`) is inline only and isn't Markdown. If the code shows a better form, take it and say why. Engineer's call: whether `~~~hidden` counts too; whether an optional label after the word (```` ```hidden character sheet ````) is shown on the fold, or would spoil too much; and what a note that itself needs a code fence should do.

**Engineer scope**
- One definition of "a hidden block" that the terminal and the browser agree on: fence forms, case, and an unclosed fence, which runs to the end of the message (that is also what a streaming reply looks like). A small dependency-free module the web can import, as it imports `wording.ts`, is one way.
- The terminal folds them too. The human output of `conversation.get` and `message.get` shows a one-line marker in place of each hidden block, saying how big it is and how to see it. `turn`, `message.regenerate` and `generation.follow` print the marker instead of streaming the hidden text. A CLI-side `--reveal` shows everything, and `--json` is always the raw text.
- A mock trigger (say `MOCK_HIDDEN`) whose reply contains a hidden block, so tests and the frontend pass need no live call.
- design.md: a short "Hidden notes" section with the convention, why it is folded rather than hidden, and the fact that every brain sees it.
- One live check, one or two calls: a brain whose system prompt says to put its notes in a hidden block does so on `deepseek-v4-1-flash`.

**Acceptance**
- Mock: a brain reply with a hidden block. `conversation.get` shows the marker, `--reveal` and `--json` show the text, and a streaming `turn` never prints it.
- `prompt.preview --brain <another brain>` has the hidden text verbatim, framed as usual.
- Unit tests cover the rule's edge cases: unclosed, inside a list or a quote, two blocks in one message, a block that is the whole message.

**Frontend scope:** In the scrollback, a hidden block renders as a quiet folded bar that says it is hidden and how much (e.g. "Hidden · 14 lines"). Never show a peek at the text: a character's secrets are the point. A click (or Enter) unfolds it, rendered as Markdown, and another click folds it. Every page load starts folded. A message that is all hidden (the Character Creator's) is its badge plus the bar, not an "empty reply". A reply streaming into a hidden block shows the bar growing, never the text. Editing shows the raw source, as always, and the payload view stays raw.

- **From T08 engineer** (report: `reports/T08-engineer.md`):
  - Built: the rule in `src/conversations/hidden.ts` (design.md, "Hidden notes"): ```` ```hidden ```` or `~~~hidden`, any case, longer fences, inside lists and quotes; unclosed runs to the end of the message (or of its quote or list item); a fence with a language inside a note nests. The CLI folds `conversation.get`, `message.get`, `message.select-version` and every streamed reply (`turn`, `message.regenerate`, `generation.follow`) to `[Hidden · 5 lines]`, with a counting line on a terminal while a note streams; `--reveal` (CLI flag) shows everything, `--json` is raw. Mock: `MOCK_HIDDEN` (echo, note, visible line) and `MOCK_HIDDEN_ONLY` (one note, nothing else), both in 3-character pieces so fences split across deltas.
  - **Engineer's calls:** `~~~hidden` counts (it is Markdown's other fence). **The fold doesn't show the label** after the word: live, a Character Creator told the label is shown to the player labelled its sheet with the character's real name, which the player hadn't learned. A note that needs code: a fenced block with a language (```` ```js ````) just works inside it (it nests); a bare ```` ``` ```` closes the note, so use ```` ````hidden ```` or `~~~hidden` around one.
  - **For Frontend:** `web/src/api/types.ts` re-exports the rule. Render a message from `splitHidden(content)`: text parts as Markdown, each note as the bar (`hiddenSummary(block)`; while `block.open` and the reply is streaming, `hiddenSummary(block, {writing: true})` = "Hidden · 3 lines so far"), and `<Markdown text={block.body}>` only once it is opened. The note's words then never reach the renderer, mid-stream either, and the browser folds exactly what the terminal folds. `isAllHidden(content)` is the Character Creator's "badge plus the bar". A note inside a list or quote splits that list or quote around the bar (`block.prefix` tells you it was in one; indenting the bar to match is a nicety). Backstop: fold a Markdown `code` node whose `lang` passes `isHiddenInfo` too. Image prompts are never folded (plain captions). The payload view and the editor stay raw. `MOCK_HIDDEN_ONLY` to a brain whose reminder is off shows the all-hidden case; `MOCK_SLOW MOCK_HIDDEN` (~40 s at `up:mock`'s 250 ms) to watch the bar grow and reload mid-note.
  - **For T10:** a brain that should keep notes needs the convention in its prompt (the live prompts in the report worked first time). Tell it the player's screen folds notes and every brain reads them; don't promise that a label is shown.

- **From T08 triage** (report: `reports/T08-triage.md`):
  - **The rule now leans to hiding** (design.md, "Hidden notes", rewritten). The API and the recipe are unchanged, but three behaviours differ from the engineer's notes above. **A quote or list item that ends no longer ends its note**: it runs to its closing fence or to the end of the message, so `block.open` is now always `!closed`. **A ```` ```hidden ```` line opens a note even inside another code block**, because the scanner no longer tracks other code blocks. **Backticks in the label are fine.** Guarantee: whatever remark + GFM would parse as a `hidden` code block, `splitHidden` hides too, so the `isHiddenInfo` backstop should never fire. Keep it anyway.
  - **One rendering wrinkle, not a spill.** When an example of the convention sits inside a ```` ````md ```` block, the split cuts that block in two. The text part after the bar then starts with the outer block's closing fence, which Markdown reads as a new code block running to the end of that part. It is rare, it shows only text that was visible anyway, and nothing needs fixing.
  - **Show the label when a note is opened (QA-5).** The fold never shows `block.label`, but an opened note should show it as a small caption above the rendered `block.body`, as `--reveal` shows the opening line in the terminal.
  - **Reasoning folds in the terminal now (QA-3).** The browser already collapses it, so nothing changes there. Keep it collapsed by default, mid-stream too: a brain that reads a sheet reasons about its secrets.
  - **For T10:** a brain's reasoning no longer prints in the terminal unless `--reveal`, so a reasoning-on Character Actor doesn't spill a sheet onto the screen. Whether to turn reasoning on is still T10's call, and the T07 trap still applies: Venice stops the reasoning at `<!-- from:` too. When a note needs code, the safe advice to put in prompts is still "use `~~~hidden`".

- **From T08 frontend** (report: `reports/T08-frontend.md`):
  - Built: every text message renders through `MessageText` (`messageParts` = `splitHidden` minus blank gaps; `web/src/lib/hiddenParts.ts`), each note a `HiddenNote` bar (`Hidden · 14 lines`, dashed and faintly hatched, "Show"); opened in place with its label as a caption and its body as Markdown, rendered only while open; a sticky header to fold a long note. Streaming: the bar counts up ("so far"), a partial opening fence is held back so it never flashes, notes open only once the reply is saved. All-note replies are the badge plus the bar. Notes in a list or quote keep the marker or the quote bar. Opening a note at the bottom of the scrollback no longer scrolls its top away (`web/src/lib/scrollPin.ts`). Backstop in `Markdown`'s code block renderer. No new commands.
  - **For T10:** the Character Creator's sheet will show as its badge and a bar; nothing more is needed in the browser. A preset that keeps notes needs nothing from the web either.

**Deferred in:** *(none yet)*

---

## T09: Dice rolls · `frontend`

Jason, 2026-10-14: a button that rolls a real d20 and sends it to a brain. The server's random number generator rolls it, never a model. The result goes into the ledger as a message every brain reads, and then the brain the player picked answers the conversation. Here is the loop it serves, with T10's Show Me the Odds brain:
1. The player sends "I try to talk the hooded figure down to half price" to Show Me the Odds.
2. Show Me the Odds answers with one sentence: "Roll a d20: 15 or higher succeeds, 19 or higher is a hard success, under 15 fails."
3. The player clicks roll-and-send to the GM. The roll shows in the scrollback ("🎲 d20: 10"), then the GM narrates the failure.

Any brain can be sent a roll, image brains included (Jason: "sure, why not"). It works in every conversation, not only presets, and its wording is editable like everything else.

**It runs on the honor system.** The roll is an ordinary player message: edit it, delete it, regenerate the odds. Nothing guards it, because players don't want to spoil their own fun.

**Engineer scope**
- Roll a d20 and send it to any brain in one command (e.g. `turn --brain "Game Master" --roll`). The command rolls, saves the roll message and shows it (a CLI line, a stream event before the reply), then the brain answers the whole ledger as in any `turn`. Rolling without asking anyone, just adding the roll to the ledger, is cheap too.
- d20 only (Jason: "only D20s because that's easy"). Whether the command takes other dice is the engineer's call. The roll is uniform 1-20 from `node:crypto`.
- The roll is a player message, so every brain sees it framed like any player line. Its wording reaches every model, so it must be editable text (hard rule 1). One way is a new conversation template with a placeholder for the number, defaulting to something like `🎲 I rolled a d20: **{{roll}}**`, edited in the templates editor like the rest. A new template means a `schemaVersion` bump and an upgrade on load, as T07 triage did for `stop`, and campaign files take it too (absent = the default). Keep the roll itself on the message as well (the die and the number), so the scrollback can show it as a roll.
- If the player typed text too, a roll-and-send can send the text first and then the roll, in one action, or do something simpler: the engineer's call.
- `prompt.preview` can't know the number before the roll. Decide how a roll-and-send previews honestly (e.g. a sample number and a note saying so), and write it in design.md.
- Tests:
  - the rolls are in range, and every face turns up over many rolls;
  - the roll is framed in every brain's preview;
  - roll-and-send works with an image brain;
  - editing the roll's text changes what the next brain sees.

**Acceptance**
- Mock: `turn --brain "Game Master" --roll` prints the roll, then the reply. Afterwards `prompt.preview --brain "Dice Master"` shows the roll framed as a player line.
- Live, 2-3 text calls, on a clone of the Gilded Goat:
  1. The GM names a check.
  2. The Dice Master gives the target.
  3. A roll-and-send to the GM gets a narrated outcome that matches the roll.

**Frontend scope:** A d20 control in the composer that works with every send, the big Send and each brain's chip alike. One way is a "🎲 Roll d20" toggle that the next send uses and then switches off. The roll appears in the scrollback at once, before the brain's reply streams in. It looks like a roll (a die and the number), so it stands apart from typed lines. Editing it works like any message, and the new template is in the templates editor.

- **From T09 engineer** (report: `reports/T09-engineer.md`):
  - Built: `turn --roll` (roll-and-send: your text first, if any, then the roll as a second player message, then the brain answers), `message.roll` (just roll, no brain), `templates.roll` (default `🎲 I rolled a d20: **{{roll}}**`, needs `{{roll}}`; schema 3, older files and campaign files get it), `prompt.preview --roll`. The server rolls with `crypto.randomInt`. The roll's version keeps `roll: {die: "d20", result}` for display; its `content` is the template's line, which is what every brain reads, framed as a player line. Nothing in `buildRequest` changed.
  - **Engineer's calls:** the template is applied **once, when the server rolls** (the message holds its line, so a changed template shows in later rolls; earlier ones keep their text), not at build time: a roll's content is then exactly what the brains read, and editing it is editing that line. **Text and roll are two messages**, text first. **The preview leaves `{{roll}}` in place** (no sample number, which would look like a roll that happened) with `ROLL_PREVIEW_NOTE` as its first note. A refusal up front saves no roll, as it saves no text; a broken reply keeps the roll, and the retry never rolls again. d20 only.
  - **For Frontend:** `turn` takes `roll: true` (in `web/src/api/types.ts` already, with `message.roll`, `prompt.preview`'s `roll`, `Roll`, `rollLabel` and `ROLL_PREVIEW_NOTE`). The roll arrives as a `message` event before `start`, after your text's; `useChat` already upserts every `message` event, so it shows at once. A version with `roll` is a roll: show `rollLabel(roll)` ("🎲 d20: 14") and the die, set apart from typed lines; its `content` is what the brains read (show it, or at least when `edited`). The templates editor needs a fifth row, `roll`. The payload view: `prompt.preview --roll` when the toggle is on. Mock: no trigger needed (rolls are real on the mock too); to break a roll-and-send, put a trigger in the roll template (`MOCK_SLOW {{roll}}`), since the roll's line is the last message. README's browser paragraphs (the example campaign's loop, Play) still describe telling the Dice Master your roll: update them with the control.
  - **For T10:** the Gilded Goat's prompts worked unchanged with a roll (live: the GM added the Dice Master's modifier and narrated success on 18, failure on an edited 3). Its Dice Master still offers to roll for the player if asked ("roll fairly"); a preset's Show Me the Odds should say the player rolls with the app and never roll itself. A GM should treat a `🎲` line after an odds sentence as settling the action.

- **From T09 triage** (report: `reports/T09-triage.md`):
  - **An edited roll shows its text, never the die's number as the roll (QA-1).** The version keeps `roll.result` (history), but once `edited` the `content` is the roll every brain was told. Unedited: the die plus `rollLabel(roll)` ("🎲 d20: 14"). Edited: the `content` is the face; the die's number only as quiet history beside the "edited" mark, `rollLabel(roll, true)` ("🎲 d20 said 12"). This replaces "show it, or at least when `edited`" above; design.md's browser recipe says the same.
  - **A stop before any reply text now says how to get a reply without sending twice (QA-2):** "… Your roll is saved; the reply isn't. To get a reply, send again to Game Master with no new message and no new roll: turn --brain b_… without --content or --roll." The browser shows it as the stop notice (`stoppedEarly` in `useChat`); after such a stop, the roll toggle should be off, so the brain's chip with an empty composer is exactly that resend.
  - `ROLL_PREVIEW_NOTE` now says the number goes into the roll's line only (QA-3); the payload view shows it from `notes` as before.

**Deferred in:** *(none yet)*

---

## T10: Presets · `todo`

Jason, 2026-10-14: typing in a campaign's brains by hand is the slow part. A **preset** is a ready-made kit of brains with good default instructions and no world: no World Bible, no story. You can start a new conversation from one ("Chinatown, film noir": pick the tabletop preset, write the World Bible, play). You can also add any one of a preset's brains to a conversation you already have.

Presets are committed files, edited in the repo like `examples/`. A T07 campaign file already holds everything a preset needs (brains, templates, settings), so a preset is probably a campaign file with no setup or messages, checked by the same `toConversation`. Whether presets get their own folder or are examples flagged as presets is the engineer's call. The browser offers them as "start from a preset" (an empty world), apart from the example campaigns (ready to play).

**Where the words come from.** Sassy Text (`../sassy-text`, Jason's large product) already worked out how to coach models on running a game, acting a character and writing image prompts. **`docs/sassy-text-source.md` holds that text verbatim**: 75 excerpts with source paths, lifted 2026-10-14 from sassy-text `430c28d33`. Adapt it, don't paste it. The current Sassy GM writes JavaScript `actions([...])` of XML bubbles, so keep the coaching and drop the machinery. The older Sassy pipeline (deleted 2026-09-18, quoted from git) was single-job brains writing plain prose, and maps onto this app almost one to one. Where to start:
- **GM:** §1.1, the charter's "The loop", "Seven turns" and "House law"; also §1.2's "GM advice that *might* apply".
- **Co-GM:** §2.1 Part one, the old Gatekeeper ("do not answer a question by advancing the plot"), plus §2.2–2.4.
- **Show Me the Odds:** §2.1 Part two ("When a roll earns its place", "How to design a roll"), without the engine's dice.
- **Character sheet:** §3.1 `create-character.md` and §4.2 `brief-the-actor.md` (wants / holds / knows).
- **Acting:** §4.1 `actor.md`.
- **Images:** §5.1–5.4 ("abundant positives", the "smile-iest smile"), plus §5.9, the image bench's laws (hands, objects in hands, "empty" backfiring).
- **What to write ourselves:** the **Gaps** list at the end.

**The first preset: "Tabletop RPG"**, genre-free: the World Bible makes it noir or fantasy. Seven brains:

1. **Game Master** (default, text). Narrates in the second person ("You step into the rain"). It narrates only up to the next moment where the player has an interesting choice, or narrates the consequence of the choice the player just made, then stops. It doesn't lead the player, doesn't end every reply with "What do you do?", and never acts, speaks or decides for the player's character. When the last lines are an odds sentence and a roll (T09), it narrates the outcome the roll earned, and never rolls, rerolls or second-guesses it. When the player tries something uncertain without a roll, use the simplest rule that works (e.g. narrate up to the moment before the outcome and stop, as the Gilded Goat's GM does).
2. **Co-GM** (text). It "sits in the chair next to the GM": it answers the player's questions and fills in details ("That looks like about a 40-foot drop"), and does nothing else. It doesn't move the plot, introduce events or narrate the player doing anything, and it doesn't reveal what the player's character couldn't know.
3. **Show Me the Odds** (text). Given the player's latest action, it answers with one plain sentence, no tool call and no narration. The sentence is one of three: no chance ("There's no chance of that"), no roll needed, or a d20 target with its bands ("Roll a d20: 15 or higher succeeds, 19 or higher is a hard success, under 15 fails"). The player then rolls with T09's button and sends the roll to the GM.
4. **Character Creator** (text). It answers only with one hidden block (T08): the full sheet of the most recently introduced character, or of the one the player's note points to (an empty turn means the most recent). The sheet covers name, age, appearance (detailed enough to paint), race or ancestry, religion or beliefs, personality, flaws, hopes and fears, voice and speech habits, what they want right now, what they know and don't, secrets and relationships. Sassy's shipped card is smaller: surface, underneath and observable "tells", plus the actor's wants / holds / knows (§3.1, §4.2; Gaps 3). Blend the two, and judge the sheet by how well the Character Actor plays from it. It stays consistent with the World Bible and the story so far.
5. **Character Actor** (text). It fully embodies the character the player is talking to or dealing with, whether named in the note or implied. It rereads that character's hidden sheet, knowing the player hasn't seen it. It weighs what the character wants, fears and hopes for, what the character knows that the player doesn't, and the reverse. Then it answers **in the first person, as that character only**, and makes clear who is speaking. It never narrates the world or the player's character. Jason wants it to "think hard". Reasoning on is the obvious way, but mind the T07 triage lesson: Venice applies stop sequences to the reasoning too, so a brain that thinks about the framing can end with no reply. Decide on live evidence, and say why.
6. **Scene Painter** (image). Paints the scene just described, taking the people's looks from their sheets. A scene with several people in it is a gap in the source (Gaps 1), so write that part.
7. **Character Portraitist** (image). Paints the most recently mentioned character, or the one the player's note points to, from their sheet.

Rules for every brain:
- It knows the hidden-note convention: sheets are there and the player hasn't seen them, so use them, don't recite them. Text brains may keep their own notes the same way.
- It never writes `<!-- from: ... -->` itself (T07 lesson), and text brains keep their stop sequences.
- **An image brain's prompt is shown to the player as the image caption**, so it describes only what can be seen, never a secret from a sheet.
- Image prompts follow the craft in the source: an abundance of positives, no negatives (a model paints whatever you name), and balanced expressions (ask for "happy" and you get "the happiest happy that ever happied"), plus the rest of what the source teaches.

**Secrets can leak, and that's accepted** (Jason, 2026-10-14: this is the light version). Every brain reads every hidden sheet, whereas in Sassy an actor saw only its own brief. Use Sassy's craft to keep leaks rare, and build nothing to stop them. The key piece of craft: write holds as what is kept, what would open it and why, never as "never mention X", which puts X on the tip of the actor's tongue (§4.2).

**Engineer scope**
- The preset file and three abilities:
  - list presets (no login, like `examples.list`);
  - start a conversation from one (with a title; no setup, no messages);
  - add one brain from a preset to an existing conversation: the whole brain, meaning prompt, reminder, kind, reasoning, stop, tool text and safe mode. A name clash is the usual 409, and a rename flag fixes it. Letting the same command add a brain from an example campaign too (the Gilded Goat's Dice Master) is cheap and useful.
- Adding one brain doesn't bring the preset's templates. Write the brains so they work under any conversation's templates, or have the add say what it leaves behind.
- Tune the seven prompts live against a made-up scenario, as an encrypted `dev-` user, using T07's method from the lessons (preview, then one non-streaming POST, nothing saved). Budget, approved by Jason: up to ~30 live text calls, plus the usual 3 images and the $4 floor.
- Tests: the committed preset imports cleanly (as `test/campaigns.test.ts` does for the example); add-from-preset works and refuses a clash.
- README: starting from a preset and adding a preset brain. design.md and AGENTS.md as usual.
- Out of scope: saving your own conversation as a preset. Presets are files in the repo, and any `conversation.get --json` is already a campaign file.

**Acceptance**
- Mock: the preset list shows the preset. Starting "Chinatown" from it gives seven brains, no setup and no messages. Adding the Character Actor to a clone of the Gilded Goat works, and adding it twice is refused until it is renamed.
- Live, from the terminal, as an encrypted `dev-` user, with a three-line made-up World Bible. This is Jason's loop:
  1. "I approach the hooded figure" goes to the GM, which answers in the second person and stops at a choice.
  2. The Character Creator writes the figure's sheet as one hidden block (folded in `conversation.get`).
  3. The Character Actor answers in the first person, true to the sheet.
  4. "I try to talk him down to half price" goes to Show Me the Odds, which answers with one sentence and a d20 target.
  5. A roll-and-send to the GM (T09) gets the outcome the roll earned.
  6. The Co-GM answers "how far is the drop?" without moving the story.
  7. The Portraitist paints the figure from the sheet, with no secret in the prompt.

  Judge whether each brain does its job, not its style.

**Frontend scope:** The new-conversation page offers the presets (title, about, the brains as badges) next to the example campaigns and the from-scratch form. Pick one, give it a title, and the new conversation opens with a pointer to write its World Bible (the Setup tab), since a preset has none. "Add a brain" in settings gets a "From a preset" choice: the preset brains (and the example brains, if the engineer added them), each with one line on its job. The name can be edited before adding, and the new brain's card opens. README to match.

**Deferred in:** *(none yet)*
