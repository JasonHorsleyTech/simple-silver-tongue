# T01 engineer report: foundation

## What I built

- **Runtime and tooling.** `package.json` (ESM, Node ≥ 26) and a strict `tsconfig.json` (`noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`). Dependencies: `hono`, `@hono/node-server`, `zod` (v4). Dev dependencies: `typescript` (7.0, the Go port) and `@types/node`. Node runs every `.ts` file directly, with no build step.
- **Command registry** (`src/registry.ts`): `command()`, `streamCommand()` and `binaryCommand()`. Each command has a zod args schema (made strict, so unknown keys are rejected), a description, `auth` (default: login required), examples and an optional `format()` for CLI text. `help` returns each command's JSON Schema, generated with `z.toJSONSchema`, which is how the CLI learns flag types.
- **HTTP adapter** (`src/server/app.ts`): `POST /api/<name>` takes JSON args and returns JSON. Errors come back as `{error: {code, message}}` with real status codes. Stream commands return NDJSON. The adapter pulls the first event before answering, so an early failure such as a 409 is a real HTTP status, and it keeps draining the stream after a client disconnect so the work persists. `GET` works only for binary commands and `health`. A local-only guard checks `Host` (against DNS rebinding) and `Origin` (against CSRF). Every `/api` response is `no-store`. It also serves `web/dist` with an SPA fallback, or a placeholder page when there's no build. The server binds to 127.0.0.1:4747.
- **CLI** (`./ss`, also `npm run ss -- ...`; `src/cli/`): a thin HTTP client. It fetches the catalog from `help`, parses flags against the JSON Schema (kebab or camel case, booleans and `--no-x`, numbers, arrays, JSON objects, dotted nested paths, `@file`, `-` for stdin, `@@` as an escape), and prompts with hidden input for `secret` args (`confirm` asks twice). Other features:
  - `--json` prints the raw result, or raw NDJSON for streams; `--out` saves binary output.
  - Stream events print live: text to stdout, reasoning and status to stderr.
  - Help is generated from the schemas, with an offline fallback that renders the same help from local code when the server is down.
  - Clear exit codes: 0 ok, 1 command failed, 2 usage error, 3 server not running.
- **Storage** (`src/storage/`):
  - Atomic writes (temp file, fsync, rename; files 0600, directories 0700) and path-escape protection.
  - `crypto.ts`: scrypt (N = 2^17, r = 8, p = 1, about 200 ms) plus AES-256-GCM in the `SSENC1 | IV | tag | ciphertext` format, with the magic as additional authenticated data.
  - `vault.ts`: the one gateway to user files. It encrypts when the session has a key.
  - `users.ts`: create, list, load and unlock users.
- **Users and sessions:**
  - `user.create` and `user.list`.
  - `auth.login`, `auth.logout` and `auth.whoami`.
  - Sessions live in memory (`src/server/sessions.ts`), and a key is wiped on logout.
  - The token only ever travels in the `ss_session` cookie (`HttpOnly; SameSite=Strict`). The CLI reads the same `Set-Cookie` header into `.run/cli-session.json` (0600) and sends it back as a cookie, so the browser and the CLI share one code path.
  - A stale token gets an `x-ss-session: invalid` header back, and the CLI then deletes it and tells you to log in again.
- **Venice client** (`src/venice/`): plain `fetch`, with the key held only in a closure. `models.list` returns normalized text and image models (name, price label, privacy, reasoning capabilities, image constraints, raw pricing), cached for 10 minutes per type, with `--refresh` to bypass the cache. `venice.balance` uses `/api_keys/rate_limits`. Upstream errors become 502 `venice_error` with Venice's message.
- **Mock Venice** (`src/dev/mock-venice.ts`): `/models` (real entries copied from the live API), `/api_keys/rate_limits` (with a mock balance that goes down as calls cost money), streaming and non-streaming `/chat/completions` (reasoning deltas, forced tool calls, a usage-and-cost final chunk, all matching a live capture), and `/image/generate` (a real PNG). It enforces `include_venice_system_prompt: false`. `/_mock/requests` shows the request bodies it received, and the triggers `MOCK_ERROR`, `MOCK_SLOW` and `MOCK_MIDSTREAM_ERROR` force failure cases.
- **Scripts:** `npm run up`, `up:mock`, `down` and `logs` (`scripts/up.ts`, `down.ts`, `proc.ts`).
  - `up` stops our own processes, found by pid file or by port. It never kills a foreign process; it reports it instead.
  - It builds the web app if one exists, starts everything detached (pids and logs in `.run/`, with the previous log rotated to `.1`), waits for health and prints the URL.
  - In mock mode, neither the mock nor the server sees the real key.
- **Tests** (`node:test`, 25 tests, about 1 s, never live):
  - `crypto.test.ts`: round trip, fresh IV, wrong key or tampering fails, wrong password fails, the on-disk bytes don't contain a known phrase, planted plaintext is refused.
  - `cli-args.test.ts`: flag parsing.
  - `e2e.test.ts`: the real CLI code run in-process against an in-process server and mock. It covers a plain and an encrypted user, the hidden prompt, models, balance, errors, a subprocess run of `./ss`, NDJSON streaming, a 409 before the first event, binary GET with a browser-style cookie, and the Host/Origin guard.
  - `mock-venice.test.ts`: a contract test of the mock's wire format.

## Commands added

`help`, `health`, `user.create`, `user.list`, `auth.login`, `auth.logout`, `auth.whoami`, `models.list`, `venice.balance`. Run `./ss help <name>` for flags.

## Acceptance

| Bullet | Result |
|---|---|
| `up:mock`, then `user.create` / `auth.login` / `auth.whoami` for plain `dev-a` and encrypted `dev-b` | Pass (transcript below; the encrypted user's password was given via the stdin prompt path; the hidden TTY prompt was also checked through a pty with `script`) |
| `./ss models.list --type image` lists real models against the live API | Pass: 45 live image models, with price and privacy |
| `npm run down` stops everything | Pass: both processes stopped, nothing listening on 4747 or 4748 |
| `npm test` and `npm run typecheck` | Pass (25/25; tsc clean) |
| `up` copes with `web/` absent and present | Pass: placeholder page without it. With a temporary fake `web/package.json`, `up` ran `npm install` and `npm run build` in `web/`, served `index.html` at `/` and at `/c/abc123` (SPA fallback), and served `/assets/*` with immutable caching. Missing assets return 404 and path traversal returns 404. The fake was then removed. |

### Terminal transcript (mock)

```
$ npm run up:mock 2>&1 | tail -5
simple-silver is up → http://localhost:4747
  Venice: MOCK (http://127.0.0.1:4748/api/v1)
  web:    none yet (no web/), placeholder page
  pid 95814 · log .run/server.log · stop with npm run down
  Sessions live in server memory, so log in again: ./ss auth.login --username <name>

$ ./ss health
ok · MOCK Venice (http://127.0.0.1:4748/api/v1) · http://localhost:4747 · pid 95814 · up 0s · web not built

$ ./ss user.create --username dev-a --password ''
Created dev-a (unencrypted). Log in with: ./ss auth.login --username dev-a

$ ./ss auth.login --username dev-a --password ''
Logged in as dev-a (unencrypted).

$ ./ss auth.whoami
dev-a (unencrypted)

$ printf 'hunter2\n' | ./ss user.create --username dev-b
Created dev-b (encrypted). Log in with: ./ss auth.login --username dev-b

$ ./ss auth.login --username dev-b --password wrong; echo "exit=$?"
error: Wrong password for dev-b.
exit=1

$ ./ss auth.login --username dev-b --password hunter2
Logged in as dev-b (encrypted).

$ ./ss auth.whoami
dev-b (encrypted)

$ ./ss user.list
USERNAME  ENCRYPTED  CREATED
dev-a     no         2026-10-14T05:11:14.822Z
dev-b     yes        2026-10-14T05:11:15.136Z

$ jq '{username, encrypted, kdf: .kdf.name, N: .kdf.N, wrappedKey: (.wrappedKey[0:12] + "...")}' data/users/dev-b/user.json
{
  "username": "dev-b",
  "encrypted": true,
  "kdf": "scrypt",
  "N": 131072,
  "wrappedKey": "U1NFTkMxyrP2..."
}

$ ./ss models.list --type image
Image models (3)
 ID                      NAME              PRIVACY     PRICE              SIZES
 grok-imagine-image-2-0  Grok Imagine 2.0  private     $0.05-$0.10/image  res 1K/2K
 nano-banana-2           Nano Banana 2     anonymized  $0.10-$0.19/image  res 1K/2K/4K
*z-image-turbo           Z-Image Turbo     private     $0.01/image        w×h /8

$ ./ss venice.balance
MOCK Venice balance: $10 USD · DIEM 0 · tier paid

$ npm run up:mock >/dev/null 2>&1; ./ss auth.whoami
(Saved CLI session for dev-b is no longer valid: the server restarted or you logged out elsewhere.)
Not logged in.

$ ./ss auth.login --username dev-b --password hunter2 && ./ss auth.logout && ./ss auth.whoami
Logged in as dev-b (encrypted).
Logged out dev-b.
Not logged in.

$ ./ss user.create --username dev-a --password ''; echo "exit=$?"
error: User dev-a already exists.
exit=1

$ ./ss auth.login --username dev-a --password oops
error: dev-a has no password (unencrypted user). Log in with an empty password.

$ ./ss user.list --usernme x; echo "exit=$?"
error: unknown flag --usernme. Run ./ss help user.list.
exit=2

$ npm run down

> simple-silver@0.1.0 down
> node scripts/down.ts

down: stopped the server
down: stopped the mock Venice

$ ./ss user.list; echo "exit=$?"
error: the server is not running at http://127.0.0.1:4747. Start it with: npm run up (or npm run up:mock)
exit=3
```

### Terminal transcript (live)

```
$ npm run up 2>&1 | tail -5
simple-silver is up → http://localhost:4747
  Venice: live (api.venice.ai)
  web:    none yet (no web/), placeholder page
  pid 96315 · log .run/server.log · stop with npm run down
  Sessions live in server memory, so log in again: ./ss auth.login --username <name>

$ ./ss venice.balance
Venice balance: $8.02895253 USD · DIEM 0 · tier paid

$ ./ss models.list --type image | head -4; ./ss models.list --type image | grep -E 'z-image-turbo|nano-banana-2 '
Image models (45)
 ID                          NAME                              PRIVACY     PRICE              SIZES
 chroma                      Chroma                            private     $0.01/image        w×h /8
 flux-2-max                  Flux 2 Max                        anonymized  $0.09/image        w×h /1
 nano-banana-2               Nano Banana 2                     anonymized  $0.10-$0.19/image  res 1K/2K/4K
*z-image-turbo               Z-Image Turbo                     private     $0.01/image        w×h /8

$ ./ss models.list --type text | grep -E 'Text models|deepseek-v4-1-flash'
Text models (130)
*deepseek-v4-1-flash                      DeepSeek V4.1 Flash              private     $0.30/M in, $1.20/M out     none/low/high/max               1M

$ ./ss auth.login --username dev-b --password hunter2 && ./ss auth.whoami
Logged in as dev-b (encrypted).
dev-b (encrypted)

$ ./ss venice.balance
Venice balance: $8.02895253 USD · DIEM 0 · tier paid
```

The server log contains only lines like `POST /api/auth.login 401 229ms` and `auth.login failed: 401 wrong_password`. No arguments or content are logged, and `grep` finds no test passwords anywhere in `.run/` or `data/`.

## Live spend

- Balance before: **$8.02901253**. After: **$8.02895253**. Spent: **$0.00006**.
- The only paid call was one tiny streaming chat completion on `deepseek-v4-1-flash` (40 tokens in, 40 out). I made it with curl to capture the exact SSE wire format (reasoning deltas, the final `choices: []` chunk with `usage` and `cost`) so the mock matches it. I also made two free error-shape probes (an unknown model and a bad key).
- Everything else was free: `/models` and `/api_keys/rate_limits`. No images.

## Known gaps

- No web UI (the Frontend pass) and no conversation commands yet (T02).
- The streaming and binary adapters are covered by tests with test-only commands, since no real stream or binary command exists until T02 and T05.
- `user.delete` and password change aren't built; they belong to T06. The envelope design makes password change cheap.
- Non-TTY secret prompting reads the first line of stdin. If you pipe content with `--content -` and also omit `--password`, both compete for stdin. Pass `--password` explicitly in scripts.
- The mock always returns PNG, whatever `format` asks for. T05 should sniff the image type from the bytes.
- `npm install` re-runs in `web/` on every `up` when the web app has no dependencies (there's no `node_modules/.package-lock.json` stamp). That's harmless and won't happen with a real Vite app.

## Changes to docs/design.md

- **Encryption:** the "verifier" became a key envelope. A random data key encrypts the files, and `user.json` stores only `wrappedKey`, the data key wrapped by the scrypt key. A wrong password fails GCM on the wrapped key, so this does the verifier's job. On top of that, it stores no known plaintext, and a password change only rewraps 32 bytes instead of re-encrypting every file. The KDF parameters are now pinned (N = 2^17).
- **Sessions:** the token travels only in the cookie; the CLI mirrors it from `Set-Cookie`; stale tokens get the `x-ss-session: invalid` signal.
- **New sections** "HTTP contract" and "Writing a command": error shape and codes, first-event-before-headers for streams, draining after disconnect, GET only for binary and `health`, the Host/Origin guard, `no-store`, the `x-ss-cli` envelope, `secret`/`prompt`/`confirm` meta, and reserved flag names.
- **Stream events:** `error` is now `{code, message}`; every stream ends with exactly one `done` or `error`.
- **Mock section:** what the mock implements; the last-message excerpt grew from 40 to 60 characters, because the `<!-- from: the user -->` framing used up most of 40; `/_mock/requests`; the triggers; PNG-only images.
- AGENTS.md: the "Running it" section is now accurate (no longer "planned"), with the web build contract for the Frontend pass, plus five Lessons-learned bullets.
