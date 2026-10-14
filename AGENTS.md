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
- **Per brain:** a reasoning on/off toggle, with an effort level when the model supports one. Default on at `low`, since the model's own default of `high` is slow. Reasoning is shown collapsed and never sent back.
- **Per image brain:** a safe-mode toggle, **on by default**. It maps to Venice `safe_mode`, which blurs adult content.
- All Venice models (text and image) come from `GET /models` and are shown in the per-conversation model pickers.

## Running it

```bash
npm run up         # build the web app, (re)start the server in the background → http://localhost:4747
npm run up:mock    # same, but against the local mock Venice (free, deterministic)
npm run down       # stop everything
npm run logs       # tail .run/server.log
./ss help          # every command
./ss user.create --username jason      # prompts for a password; empty = unencrypted
./ss auth.login --username jason
npm test           # node:test, never hits the live API
npm run typecheck
```

*(Planned interface. T01 makes it real. Keep this section accurate as it evolves.)*

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
