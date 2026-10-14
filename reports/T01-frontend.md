# T01 frontend report: the web app shell

## What I built

`web/`: React 19 + Vite 8 + Tailwind v4 (`@tailwindcss/vite`), TypeScript 7, `lucide-react` for icons. It is dark only. `npm run up` installs its dependencies when needed and builds it into `web/dist` through the existing web build contract (`web/package.json` `build` = `tsc --noEmit && vite build`), and the server serves it. No server code changed and no command was added: T01 needs only `auth.login`, `auth.logout`, `auth.whoami` and `health`.

```
web/src/
  api/          the only code that talks to the server (DOM-free, so node:test can import it)
    client.ts     createClient(): call(), stream() (NDJSON), binaryUrl(), onSessionLost(); `api` singleton
    ndjson.ts     readNdjson(): one JSON value per complete line, chunk- and UTF-8-safe
    errors.ts     ApiError {status, code, message, details}, isAbortError, errorMessage
    types.ts      Commands / StreamCommands maps (name → args, result), StreamEvent union from design.md
  app/          App root, SessionProvider/useSession/useUser, routes.tsx, boot + unreachable screens
  components/   Button, TextField, Notice, Spinner, LogoMark/Wordmark, ModeBadge, toasts
  features/     auth/LoginScreen, shell/AppShell + Sidebar, conversations/ConversationList (placeholder), home/HomeView
  lib/          router.tsx (History API: usePath, matchPath, navigate, Link), storage.ts, cx.ts
  index.css     Tailwind import + semantic color tokens (canvas, panel, raised, line, fg, muted, faint, silver)
```

- **API client.** `api.call("auth.login", {username, password})` is typed from the `Commands` map, so a wrong command name or argument is a compile error (checked with `@ts-expect-error` probes). No-argument commands can omit args. `api.stream(name, args)` is an async generator over NDJSON events. It throws an `ApiError` on a server `error` event, on a dropped connection (`stream_broken`) and on a stream that ends without `done`, so `for await … catch` sees every failure while the caller keeps any text already received. Every error is an `ApiError` with the server's status, code and message. `network` means the server can't be reached. `errorMessage()` turns `bad_args` into the schema's field message ("Username must be …") rather than the CLI-style line. `onSessionLost` fires on `x-ss-session: invalid` (except on login and logout) and on 401 `unauthenticated`/`session_ended`.
- **Login screen.** It has a username and a password, with the hint "Leave empty for an unencrypted user". The button reads "Unlocking…" while scrypt runs for an encrypted user, and "Logging in…" otherwise. Server errors show inline, and after a wrong password the password field is selected so it can be retyped. A footer explains that users are created in the terminal (`./ss user.create`), plus a Mock/Live Venice badge. The last username is remembered in localStorage, and the password field gets focus. Every `npm run up` logs everyone out, so this saves typing.
- **Session handling.** Boot calls `auth.whoami` and `health`. A stale cookie after a server restart shows the login screen with a calm "Your session ended…" notice. The URL is kept, so logging in again returns there. While logged in, the app re-checks whoami when the tab gains focus. It catches a server restart, a logout in another tab, and a login as another user in another tab (it switches to that user, goes to `/` and says so). Logout calls `auth.logout` and goes to `/`. If it fails (server down), a sticky error toast says why and you stay logged in.
- **App shell.** A 256 px sidebar holds the wordmark, a "Conversations" section (an empty state for now; T02 replaces `ConversationList`), the Mock/Live Venice badge, and a user card: initial, name, a lock or open-lock with Encrypted or Unencrypted, and a logout icon button with a tooltip. The main area renders the current route: a quiet "Hello, <user>" home for `/`, and "Nothing here" for unknown paths. Below `md` width the sidebar becomes a drawer behind a menu button. Escape and the backdrop close it.
- **Toasts.** `toast.error(msg)` is sticky until dismissed, and `toast.info(msg)` fades after 4 s. Keyed toasts replace each other, which is how the connection error clears itself.
- **Root scripts.** `npm run typecheck` now also type-checks `web/`, and `npm run web:dev` gives Vite hot reload on :5173 with `/api` forwarded to :4747.
- **Tests.** `test/web-api.test.ts` (8 tests) imports the real web client into `node:test` and runs it against `startTestServer()`. It covers NDJSON chunking (a line split mid-JSON and mid-UTF-8, blank lines, no final newline, a bad line), login, whoami and logout with a browser-like cookie jar (plain and encrypted), ApiError mapping (401 `wrong_password`, `bad_args` field message), the session-lost signal (a dead cookie and a 401 fire it; a wrong password doesn't), a stream that ends with done, a 409 before the first event, a mid-stream error event (earlier events still delivered), a missing `done`, and an unreachable server.

## Flows verified in Chrome (DevTools MCP, `npm run up:mock`, then `npm run up`)

| Flow | Result |
|---|---|
| Plain user `dev-t01-plain`, empty password | Logged in. Shell shows "Unencrypted" and the home pill "Unencrypted user: data is stored as plain JSON". |
| Encrypted user `dev-t01-enc`, wrong password | Inline error "Wrong password for dev-t01-enc.", password text selected. Network shows a 401 on `/api/auth.login`. |
| Encrypted user, right password (typed over the selection, Enter) | Logged in. Shows "Encrypted" with a lock and "Your data is encrypted on disk with your password". |
| Logout | Back to the login screen with no notice and the username remembered. `auth.whoami` from the page says `{username: null}`, sends no cookie, and `document.cookie` is empty (httpOnly). |
| Reload after a server restart (`npm run up:mock` while logged in) | whoami came back `{"username":null}` with `x-ss-session: invalid` (checked in the network panel). The login screen shows the "Your session ended…" notice with the username prefilled and the password field focused. |
| Restart *without* reloading, then focus the tab | Back to the login screen with the notice. The URL `/c/c_doesnotexist` was kept, and logging in again returned to it. |
| Deep link `/c/<id>` as a full page load while logged in | SPA fallback served the app with the session intact, showing "Nothing here". The "Back to the start" link and browser Back route in-app with no document reload. |
| Logout while the server is down | Sticky error toast "Couldn't log out. Can't reach the simple-silver server. Start it with npm run up, then try again." The user stays logged in. |
| Cross-tab: a second tab logs out, then the first tab gains focus | The first tab goes back to login with the notice. |
| Cross-tab: a second tab logs in as `dev-t01-enc`, then the first tab (`dev-t01-plain`) gains focus | The first tab switches to `dev-t01-enc` and shows an info toast. |
| Narrow width (400 px) | Top bar with a menu button. The drawer opens over a dimmed backdrop, and Escape closes it, returning focus to the menu button. |
| Live: `npm run up`, reload, log in as the encrypted user | Works, with the badge reading "Live Venice". No Venice calls were made: login, whoami and health are local. **Spend: $0.** |

- **Console:** the only entries were Chrome's own "Failed to load resource" lines, for the deliberate wrong-password 401 and for the logout attempted while the server was down. There were no app errors and no React warnings.
- **Network:** every app call was `POST /api/auth.whoami`, `/api/health`, `/api/auth.login` or `/api/auth.logout`, plus static assets. Nothing else was fetched.
- **Secrets:** the server log has only method, path, status and timing. A grep for both test passwords over `.run/` and `data/` finds nothing.

Screenshots (I looked at each one; I fixed issues before saving):
- `reports/screens/T01-login-wrong-password.png`: the login card with the wrong-password error.
- `reports/screens/T01-session-ended.png`: the login screen after a server restart, with the notice and remembered username.
- `reports/screens/T01-shell-encrypted.png`: the app shell for an encrypted user.
- `reports/screens/T01-narrow-drawer.png`: the sidebar as a drawer at 400 px.

Fixed after looking at my own screenshots:
- The username was cut off ("dev-t01-...") because a labelled "Log out" button took the width. It is now an icon button with a tooltip and an aria-label.
- The lock icon rendered as a dot. It is bigger now, with a heavier stroke.
- The Mock badge crowded the wordmark, so it moved to the sidebar footer.
- The disabled primary button was a grey slab. It now goes quiet, and keeps its normal look while loading so login doesn't flicker.
- The "session ended" notice was an amber warning, which felt alarmist for a routine restart. It now uses the neutral info tone.

## Commands added

None.

## Known UI gaps

- A user picker from `user.list`, a lock icon per user on login, and the session-expired redirect polish belong to T06. The basics (wrong-password error, session-ended notice, logout and switching) work now.
- `UnreachableScreen` (whoami or health failing at boot) is rendered by code but wasn't seen in Chrome. The server that serves the page is the one the API calls go to, so it only shows if the server dies between those two requests, or under `npm run web:dev` with no server running.
- Chrome refetches `/favicon.svg` on each in-app navigation. That's harmless: the response is tiny and not an API call.
- `ApiError.status` is 0 for an error event inside a stream, since the HTTP status was 200. Consumers should branch on `code`.

## Docs changed

- `docs/design.md`: a new "Web app" section covering the client contract, errors, streams and session mirroring.
- `AGENTS.md`: `npm run web:dev` and the wider `typecheck` under "Running it", plus three Lessons-learned bullets (where web code goes, the DOM-free client tested from `node:test`, Chrome MCP tips).
- `TICKETS.md`: T01 → `done`.

Test users `dev-t01-plain` and `dev-t01-enc` remain in `data/users/` (`dev-*`, free to wipe).
