# simple-silver

## What this is

A personal, local-only chat interface for the [Venice AI](https://venice.ai) API. The aim is to be a slightly better scratch pad than Venice's classic chat (`venice.ai/chat/classic/<uuid>`). It is not a product: no deployment, no monetization, no cloud, no users but Jason. Git is used locally for checkpoints only. **Nothing is ever pushed. There is no remote.**

On top of a normal streaming chat, it adds:

1. **Steered regeneration.** Regenerate the latest AI message with a one-off direction ("make it iambic pentameter", "say it's blue"). The steer is sent once and leaves no trace in later prompts. Repeat as often as you like.
2. **Edit or delete anything.** Any earlier message, user or AI, at any depth. Edits become what the history "always was".
3. **Multiple brains per conversation.** Several named AI personas share one ledger (e.g. Game Master, Dice Master, Joke Teller). Each brain sees its own past replies as `assistant` and everyone else's as framed `user` messages. Brains can be added or edited mid-conversation.
4. **Image brains.** A brain that answers with a forced `generate_image(prompt)` tool call. The prompt goes to the conversation's image model and the image shows in the chat. Every other brain sees the exact prompt text, so the story stays consistent with the picture.
5. **Per-user encryption.** Users are created from the terminal. A user with a password has all their data (conversations and images) encrypted on disk. A user with an empty password stays plaintext for debugging.

The motivating use case is lightweight tabletop RPG play: a tavern, a hooded figure, a GM brain, a Dice Master brain, a scene-painter brain.

## Hard requirements (do not violate)

- **Every word sent to any model is visible and editable by the user.** That covers system prompts, setup messages (World Bible, ...), framing templates (the `<!-- from: ... -->` comments), final reminders, tool descriptions, tool-result text and steer text. There are no hidden wrappers, no hidden instructions and no Venice-injected system prompt (`include_venice_system_prompt: false`, always). A "show exact payload" view (`prompt.preview`) shows the literal request body.
- **The whole app works from the terminal.** Every action the browser can take is a registered command that `./ss` can run. The web UI is a skin over those commands.
- **Local only.** The server binds to `127.0.0.1`. User data lives in `data/`, which is gitignored. `.env` is gitignored.
- **Markdown everywhere.** Users type Markdown and models reply in Markdown. The scrollback renders it nicely. Editing a message shows the raw Markdown source.
- **No live API in automated tests.** Tests use pure functions or the mock Venice server.
- **Keep it simple.** No database server, no Docker, no auth providers, no heavy test suites.

The full data model and prompt-assembly rules are in **[docs/design.md](docs/design.md)**. Read it before touching code.

## Stack

> **APPROVED by Jason on 2026-10-13.** The goals are fixed. The specific libraries are strong defaults: if one fights you, swap it, and say why in your report.

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Node 26 + TypeScript**, run natively (Node strips types itself; no build step for server or CLI). `tsc --noEmit` type-checks. | Already installed. No transpiler in the loop. TS keeps the subagents honest. |
| HTTP | **Hono** on `@hono/node-server`, bound to `127.0.0.1:4747` | Tiny, with streaming helpers and static serving. |
| Commands | One **command registry** (`src/commands/*`), each command having a **zod** args schema. Exposed as `POST /api/<name>` and as the `./ss` CLI, which is a thin HTTP client to the same endpoints. | The CLI and the browser use the same path, so a passing CLI check proves the browser's plumbing. `./ss help` comes free from the schemas. |
| Streaming | NDJSON over `fetch` (browser and CLI). Upstream Venice SSE is parsed by hand. | Works for POST, easy to print in a terminal. |
| Venice client | Plain `fetch`, no SDK | We build every byte of the payload. Nothing sneaks in. |
| Storage | **Flat JSON files** per user under `data/`. One file per conversation, images as files. | Encrypting a whole file is trivial. Debug users are readable JSON. No migrations. |
| Crypto | `node:crypto`: scrypt KDF + AES-256-GCM per file | Built in, standard. |
| Web | **React 19 + Vite + Tailwind v4**, `react-markdown` + `remark-gfm`. Dark mode only. Built to `web/dist` and served by the same server. | The agents know it well. Handles streaming, inline editing and version pagers cleanly. |
| Tests | `node:test` (built in). A handful: prompt assembly, crypto, registry, CLI end-to-end against the mock. | Light, as requested. |

## Defaults

- Text model: `deepseek-v4-1-flash` (private, $0.30/M in, $1.20/M out). One per conversation.
- Image model: `z-image-turbo` (private, $0.01/image, ~3s). One per conversation. Jason picked it over Nano Banana, which is $0.10 and only "anonymized".
- **Per brain:** a reasoning on/off toggle, with an effort level when the model supports one. **Default off**: with reasoning on, the provider adds ~25 hidden prompt tokens (T02 QA-1), which breaks the "nothing else" rule. On is an explicit, labeled opt-in, at effort `low` by default. Reasoning is shown collapsed and never sent back.
- **Per image brain:** a safe-mode toggle, **on by default**. It maps to Venice `safe_mode`, which blurs adult content.
- All Venice models (text and image) come from `GET /models` and are shown in the per-conversation model pickers.

## Running it

```bash
npm run up         # build the web app, (re)start the server in the background → http://localhost:4747
npm run up:mock    # same, but against the local mock Venice on :4748 (free, deterministic)
npm run down       # stop everything
npm run logs       # tail .run/server.log
npm run web:dev    # Vite hot reload on :5173, forwarding /api to the server on :4747 (start one with up:mock first)
./ss help          # every command (also: npm run ss -- help)
./ss help user.create                  # one command's flags (or ./ss user.create --help)
./ss user.create --username jason      # prompts for a password (hidden); empty = unencrypted
./ss auth.login --username jason       # prompts; or --password '' / --password - (stdin)
./ss auth.whoami
./ss models.list --type image          # text and image models with price and privacy
./ss venice.balance
./ss conversation.create --title "Haiku bot" --system-prompt "You answer only in haiku."   # prints the c_... id
./ss turn --conversation c_... --content "Tell me about the sea."   # streams the reply; reasoning to stderr
./ss generation.follow --conversation c_...   # watch a reply that is streaming right now (another terminal, a browser tab)
./ss prompt.preview --conversation c_... [--content "next message"] [--json]   # the exact body turn would send
./ss conversation.get --id c_...       # the whole ledger (--json for versions, reasoning, usage, cost)
npm test           # node:test, never hits the live API
npm run typecheck  # server, CLI and tests, then web/ (needs web/node_modules: npm run up installs it)
```

- `up` is idempotent: it stops whatever is running (only our own processes, found by pid file or by port), builds the web app, starts the server detached, waits for `/api/health` and prints the URL. If a foreign program holds port 4747 it says so and stops. The previous log is kept as `.run/server.log.1`.
- **Web build contract:** if the root `package.json` has a `build:web` script, `up` runs it. Otherwise, if `web/package.json` has a `build` script, `up` runs `npm install` in `web/` (when `web/node_modules` is missing or older than the manifest) and then `npm run build` there. With neither, the server shows a placeholder page. The server serves `web/dist` with an SPA fallback.
- CLI output: human text by default, `--json` for the raw result (or raw NDJSON for streams). Exit codes: 0 ok, 1 command failed, 2 usage error, 3 server not running. Flags: `--x-y` or `--xY`; booleans `--flag` / `--no-flag`; nested `--settings.text-model m`; text from `@file.md` or `-` (stdin). Secret flags such as `--password` are literal (no `@file`), except that `-` reads stdin. Without a TTY and without `--password`, the CLI reads the first stdin line. Empty stdin is refused, so a script can't make an unencrypted user by accident.
- Sessions live in server memory, so every restart (`npm run up*`) logs everyone out. The CLI notices and tells you to log in again.
- Env overrides (mostly for tests): `SS_URL` (CLI target), `SS_PORT`, `SS_DATA_DIR`, `SS_RUN_DIR`, `MOCK_VENICE_PORT`, `MOCK_DELAY_MS`.

## Terminal-first development strategy

1. **Build every feature as commands first.** Prove it with `./ss` against `npm run up:mock`, then against the live API once, briefly.
2. **The web UI only calls `POST /api/<command>`.** If the UI needs something, add a command. Never add a UI-only endpoint.
3. **Use `./ss prompt.preview --brain <name>` to inspect what a brain will see.** This is how you verify framing, reminders and steering. It is the same function that builds the real request.
4. **Mock replies echo structure** (which brain, how many messages, the last message). That lets QA verify multi-brain routing without spending tokens.
5. **Browser checks use the Chrome DevTools MCP** (`mcp__chrome-devtools__*`, loaded via ToolSearch) against `http://localhost:4747`.
6. **Keep improving this strategy.** When you find a better way to test something, add it under *Lessons learned* below.

## How we delegate (read this, every agent)

We run on *Auftragstaktik*: you get the **goal and the deliverable**, not orders on method.

- The tickets and design.md describe intent plus a current best guess at the design. Where they name a library, a field name or an algorithm, treat it as a suggestion that explains the goal. If you can see a better way once you're in the code, take it, update design.md, and explain why in your report.
- **Escape valve:** if the design is actually *wrong* in a way that will hurt later tickets (a bad data shape, a flawed assembly rule, a ticket split that doesn't work), you don't have to plow ahead. Do what's sensible, then raise it at the top of your final reply under **DESIGN CONCERN**, with your recommendation. That counts as a successful outcome, not a failure.
- Only the **hard requirements** above are non-negotiable.

## Work loop (every ticket)

Tickets live in **[TICKETS.md](TICKETS.md)**. The orchestrator (the main Claude session, acting as CTO) writes no product code. It delegates, reviews the results and keeps these docs and skills sharp. It normally runs each ticket through four passes, but may re-plan, merge or redo passes when something isn't working. Each pass is a separate Opus subagent that reads its role skill first:

| Pass | Skill file | Output |
|---|---|---|
| 1. Engineer | `.claude/skills/engineer/SKILL.md` | Implements the ticket's terminal/backend scope and proves it via CLI. One commit including `reports/TNN-engineer.md`. |
| 2. QA | `.claude/skills/qa/SKILL.md` | Exercises the work through the terminal and hunts for bugs. Changes no code. One commit with `reports/TNN-qa.md`. |
| 3. Triage & fix | `.claude/skills/triage/SKILL.md` | For each finding: **fix** (in scope), **defer** (moved into a later ticket in TICKETS.md) or **dismiss** (nitpick or by design, with a reason). One commit with `reports/TNN-triage.md`. |
| 4. Frontend | `.claude/skills/frontend/SKILL.md` | Builds or updates the browser UI on top of the existing commands and verifies it in Chrome via the DevTools MCP. One commit with `reports/TNN-frontend.md`. |

Rules for every pass:
- Work directly on `main`. Make **one commit per pass**, message `TNN <pass>: <summary>`. Never push. Never add a remote.
- Before committing, `npm run typecheck` and `npm test` must pass.
- Update TICKETS.md status, plus docs/design.md and this file if anything changed.
- End the pass with the server stopped (`npm run down`) or freshly restarted on current code. Never leave a stale server running.

## Spending rules (Venice balance was $8.04 on 2026-10-13)

- Default to the mock. Live calls only prove the real integration works.
- Per pass: at most ~15 live text calls and at most **3 live image generations**. Use `z-image-turbo` ($0.01) for live image checks unless you are specifically testing another model.
- Check `./ss venice.balance` (once it exists) at the start and end of a pass that spends. **If the balance drops below $4, stop making live calls** and say so in your report.
- Never judge or benchmark output quality. We only check that the plumbing works.

## Conventions

- ESM TypeScript with native type stripping: use `import ... from "./x.ts"` with explicit `.ts` extensions, and only erasable syntax (no `enum`, no `namespace`, no constructor parameter properties).
- Small files, plain functions, no class hierarchies. Comments only where the *why* is non-obvious.
- IDs: short random strings with a prefix (`c_`, `b_`, `m_`, `s_`, `img_`).
- Use test usernames like `qa-t03`. QA and engineers may wipe `data/users/qa-*` and `data/users/dev-*` freely. **Never touch any other user's data.**
- Commit messages end with the co-author trailer the orchestrator gives you.

## Lessons learned

*(Append-only. One bullet per lesson, newest last. Note anything that would have saved the next agent time.)*

- **T01: adding a command.** Use `command()` / `streamCommand()` / `binaryCommand()` from `src/registry.ts`, add it to `src/commands/index.ts`, and `./ss` picks it up with no CLI changes: the CLI fetches the catalog from `help` and parses flags against each command's JSON Schema. Give it a `format()` for readable CLI text. Use `ctx.requireSession().vault` with `src/storage/vault.ts` for user data, which handles encryption.
- **T01: test harness.** `startTestServer()` in `test/helpers.ts` gives you an in-process server, an in-process mock Venice, temp data/run dirs and `cli(argv, {stdin, secrets})`, which runs the real CLI code in-process. Pass `commands: [...]` to test a command set on its own.
- **T01: the mock shows the real upstream body.** `curl -s localhost:4748/_mock/requests` lists the last 20 request bodies the server sent to "Venice". It's the easiest way to check that `prompt.preview` equals the real send. The mock also rejects any chat call missing `include_venice_system_prompt: false`.
- **T01: Venice API facts.** `GET /models` with no `type` returns only text models, so ask for `?type=image` explicitly. Image prices come in three shapes: flat `generation`, per `resolutions`, or per `quality` × resolution. Model capabilities include `supportsReasoningEffort`, `reasoningEffortOptions` (`deepseek-v4-1-flash`: none/low/high/max) and `defaultReasoningEffort`. The balance is at `GET /api_keys/rate_limits` → `data.balances.USD`, and every response also carries an `x-venice-balance-usd` header. Errors are `{"error": "<string>"}`.
- **T01: tooling.** `npm install -D typescript` now installs TypeScript 7 (the Go port). It's fast and works with the tsconfig as is. Node 26 runs the `.ts` files with no flags and no warnings. Remember `import type` for type-only imports (`verbatimModuleSyntax` enforces it); a value-style import of a type crashes at runtime under type stripping.
- **T01 triage: the vault you get is yours for this request only.** `ctx.requireSession().vault` is a per-request copy of the key, closed when the handler or stream finishes. That is what lets logout mid-`turn` finish and save safely. If you start work that outlives the request (a detached promise), `forkVault()` your own copy and `closeVault()` it in a `finally`. Otherwise the work fails loudly with `session_ended`, which is the intended failure.
- **T01 triage: raw HTTP needs the JSON content type.** `POST /api/*` without `Content-Type: application/json` is a 415 (CSRF guard), even with an empty body. Use `curl -H 'content-type: application/json' -d '{}' ...`.
- **T01 frontend: where web code goes.** `web/src/api/` is the only code that talks to the server: `api.call(name, args)`, `api.stream(name, args)` (NDJSON, yields events, throws `ApiError` on an `error` event, a dropped connection or a missing `done`) and `api.binaryUrl()` for `<img src>`. Give the UI a new command by adding one line to the `Commands` / `StreamCommands` maps in `web/src/api/types.ts`; names and args are then type-checked. Views go in `web/src/features/<area>/`, routes in `web/src/app/routes.tsx` (a tiny History router in `web/src/lib/router.tsx`: `usePath`, `matchPath("/c/:id")`, `navigate`, `<Link>`), shared bits in `web/src/components/` (Button, TextField, Notice, `toast.error()` for errors with no inline home). Colors are semantic Tailwind tokens from `web/src/index.css` (`bg-canvas`, `bg-panel`, `bg-raised`, `border-line`, `text-muted`, ...).
- **T01 frontend: the API client is DOM-free on purpose.** `web/src/api/*.ts` use only fetch, streams and TextDecoder, with explicit `.ts` imports, so `test/web-api.test.ts` imports them straight into `node:test` and runs them against `startTestServer()`. Keep `window`/`document` out of that folder.
- **T01 frontend: Chrome checks.** Open pages with `new_page({isolatedContext: "<name>"})` for a clean cookie jar; a second page in the same context shares the session (good for cross-tab cases). The app re-checks `auth.whoami` when the tab gains focus; trigger that with `evaluate_script(() => window.dispatchEvent(new Event("focus")))`. Chrome logs every 4xx fetch as a console error, so a wrong-password 401 there is expected.
- **T02: undici drops unread response bodies on GC.** If a `fetch` Response is garbage-collected before its body is read or locked, undici cancels the body, and a cancelled body reads as a clean, *empty* end: no error, just no data. It hit `turn` about one run in three, because the player message is saved between opening the Venice stream and reading it. When you hand a body on to be read later, lock it at once (`res.body.getReader()`, as `openChatStream` does) or keep the Response itself referenced. `test/venice-chat.test.ts` forces a GC (`v8.setFlagsFromString("--expose-gc")` + `vm.runInNewContext("gc")`) to catch it.
- **T02: conversation code map.** Types `src/conversations/types.ts`, defaults `defaults.ts`, the pure builder `prompt.ts` (`buildRequest`, `render`, `resolveBrain`, `assertSendable`), `turn.ts` (`planTurn`, the one path shared by `prompt.preview` and `turn`; `relayReply`, which streams Venice events as NDJSON and returns the whole reply via `yield*`), `store.ts` (`mutateConversation` for every write, `beginGeneration` for the 409 lock). The Venice SSE client is `src/venice/chat.ts`. A new generating command (regenerate, image brains) should reuse `openChatStream` + `relayReply` + `mutateConversation` and add its own `plan*` beside `planTurn`, so its preview can't drift either.
- **T02: proving preview == send.** `test/chat.test.ts` asks `prompt.preview --content X --json` first, runs `turn --content X`, then `deepEqual`s the preview body with `t.mock.state.requests[0].body`. By hand: `cmp` the `.body` of the preview with the newest `/chat/completions` entry of `curl -s localhost:4748/_mock/requests`.
- **T02: live behaviour worth knowing.** A request ending with the brain's own `assistant` message makes deepseek continue or repeat it and leak `</think>` into the content, so `turn` refuses it. And a steer only works if the reply being revised is in the request (design.md, "Turns, regeneration and edits"). Probing with a scratch script is cheap: import `buildRequest` and `openChatStream`, `process.loadEnvFile(".env")`, and never print the key.
- **T02 triage: stream work never waits on the client.** The HTTP adapter queues NDJSON writes instead of awaiting them, because @hono/node-server never reads or cancels a response whose client left before it started: an awaited write there blocks forever (the generator parks at its first `yield`, holding the 409 lock and its key copy). Don't reintroduce `await s.write()`. To test "gone before the first event": by hand, `kill -STOP $(cat .run/mock.pid)`, start a `turn`, kill it, `kill -CONT`; in tests, see the `test.slow-start` case in `test/e2e.test.ts` (`http.request` + `req.destroy()` against a command gated on a promise).
- **T02 triage: every plan gets `reviewBody`.** `reviewBody(brain, body, model)` (`turn.ts`) gives a plan its `refusal` (a body must end with a `user` or `tool` message) and its payload-view `notes` (reasoning on). `openChatStream` re-checks the refusal (`assertAnswerable`), so a plan that forgets still can't send it.
- **T02 frontend: the chat view's seams.** `web/src/features/chat/useChat.ts` owns a conversation in the browser: the saved ledger plus one *live reply*. Every generating stream goes through its one reducer (`apply`), and saved messages merge by id (`upsertMessage`), so T03's regenerate is "stream `message.regenerate`, upsert the returned message" and T04's per-brain send is `send(text, brainId)` (the `Composer` already renders one button per extra brain). `MessageItem` has fixed header/body/footer slots: T03's edit swaps the body for a raw-Markdown `TextArea`, and its actions and `‹ 2/3 ›` pager go in the footer, which is always visible on the last message. `SettingsPanel` maps over `conv.brains` with one `BrainEditor` each; `PayloadDialog` takes a `brain`.
- **T02 frontend: re-attaching to a stream.** A generating command should relay its events through `gen.relay(...)` from `beginGeneration` (see `turn` in `src/commands/chat.ts`); then `generation.follow` replays it for a reloaded tab or another terminal, and the browser's reload-mid-reply just works. To see it by hand: send `MOCK_MARKDOWN` (a ~7 s Markdown reply) and reload; to reload *before* the first token, `kill -STOP $(cat .run/mock.pid)`, send, reload, then `kill -CONT`.
- **T02 frontend: Chrome MCP tips.** `wait_for` returns a full a11y snapshot, which is huge on a long chat; poll with `evaluate_script` instead (`for (...) await new Promise(r => setTimeout(r, 250))`). `take_snapshot` can't write into the scratchpad (outside the MCP's roots). Rebuilding only the web app (`npm --prefix web run build`) and reloading keeps the server, the session and any running reply; a server-side change needs `npm run up:mock` and a fresh login. An absolutely positioned element inside a scroll box whose positioned ancestor is *outside* it overflows the page (remark-gfm's hidden footnotes heading scrolled the whole shell): give `.md` `position: relative`.
