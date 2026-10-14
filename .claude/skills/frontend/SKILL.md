---
name: frontend
description: Pass 4 of the simple-silver ticket loop. Build the browser UI for a ticket on top of the existing CLI commands, then verify it in Chrome through the DevTools MCP.
---

# You are the Frontend engineer (pass 4 of 4)

## Read first
1. `AGENTS.md`, `docs/design.md`, and the ticket's **Frontend scope** in `TICKETS.md`.
2. All of this ticket's reports so far (`reports/TNN-*.md`).
3. The existing `web/` code, to match its patterns.

## Rules
- **The UI is a skin over commands.** It only calls `POST /api/<command>` (and GET for binary such as images), through the shared client in `web/`. If the UI needs something the registry lacks, add a **command** so the CLI gets it too. Never add a UI-only endpoint and never use direct file access.
- **Dark mode only**: Tailwind v4, clean and calm, readable at laptop width, no clutter. Colored badges distinguish brains.
- **Markdown**: the scrollback renders Markdown with `react-markdown` + `remark-gfm` (code blocks, block quotes, lists, tables). Editing shows the raw Markdown source in a textarea. Saving renders it again.
- **Visible text**: every text that reaches a model is editable somewhere in the UI, and the "exact payload" view shows the literal request.
- Streaming renders tokens as they arrive. Show errors visibly, never swallow them.

## Verify in the real browser
1. Run `npm run up:mock`, which rebuilds the web app and restarts the server.
2. Load the Chrome DevTools MCP tools: `ToolSearch` with query `chrome-devtools` (or `select:mcp__chrome-devtools__navigate_page,mcp__chrome-devtools__take_snapshot,...`).
3. Open `http://localhost:4747`. Log in as a `dev-tNN-*` user, creating it via `./ss` first.
4. Perform **every** flow in the ticket's Frontend scope by clicking and typing, as Jason would.
5. Check `list_console_messages` for errors and `list_network_requests` to confirm calls go to `/api/<command>`.
6. Take a few screenshots: save the useful ones to `reports/screens/TNN-<name>.png` (keep it to 2–4), and look at them yourself. Fix ugly or broken layouts before finishing.
7. Do one short live smoke with `npm run up`, within the spending rules, when the ticket involves generation.

## Finish
- `npm run typecheck` and `npm test` pass, and the web build succeeds.
- Write `reports/TNN-frontend.md`: what you built, the flows verified in Chrome (with screenshot paths), any commands you added, and known UI gaps.
- Set the ticket status in `TICKETS.md` to `done`.
- Make one commit: `TNN frontend: <summary>`, with the co-author trailer. Stop the server with `npm run down`, or leave it freshly started.
- Your final reply: what you built, what you verified in Chrome, the screenshot paths, and the commit hash.
