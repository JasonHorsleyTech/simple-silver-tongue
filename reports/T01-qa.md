# T01 QA report: foundation

**Verdict: Acceptance passes. 2 majors (1 of them a design issue), 5 minors, 1 nit.**

## DESIGN CONCERN (QA-1)

`include_venice_system_prompt: false` doesn't guarantee "no hidden text" on every model. `venice-uncensored-1-2` is selectable in `models.list` and is one of the mock's own entries. When a request has no non-empty system message, that model gets a default system prompt of about 550 tokens, even with the flag off. design.md:89 says "empty = no system message sent", so a brain with an empty system prompt on this model would silently send text the user can't see. The live check at design.md:163 only covered `deepseek-v4-1-flash`. Details and a recommendation are under QA-1.

## Acceptance checklist

| Bullet | Result | Evidence |
|---|---|---|
| `up:mock`, then `user.create` / `auth.login` / `auth.whoami` for a plain user | pass | `qa-t01-a`: `Created qa-t01-a (unencrypted)`, `Logged in as qa-t01-a (unencrypted).`, `qa-t01-a (unencrypted)`, all exit 0 |
| Same for an encrypted user | pass | `qa-t01-b` via piped stdin; `qa-t01-c` via a real pty. The hidden prompt doesn't echo, the confirmation prompt works and backspace works. Wrong password and empty password both give `error: Wrong password for qa-t01-b.` (exit 1). `user.json` holds only metadata, kdf (N = 131072) and `wrappedKey`. |
| `./sst models.list --type image` lists real models live (`npm run up`) | pass | 45 live image models, each with a price and privacy label (no `?` prices). `venice.balance` is live. |
| `npm run down` stops everything | pass | `stopped the server` / `stopped the mock Venice`, nothing listening on 4747 or 4748. Running it a second time reports "was not running" for both. |
| `npm test` and `npm run typecheck` | pass | 25/25 tests, tsc clean |

## What held up (tested adversarially, no finding)

- **At rest.** I wrote through the vault as an encrypted user. The conversation and image bytes on disk start with `SSENC1` and don't contain the known phrase. No temp files are left behind. Planted plaintext is refused, and so is `../other-user/...`.
- **No leaks.** Neither of my test passwords nor the Venice key (searched for by value, never printed) appears in `.run/`, `data/`, `src/`, `docs/`, `reports/` or git history. The logs carry only method, path, status and error code. In mock mode, the server and mock process environments (`ps -E`) carry `mock-key` and never the real key.
- **Sessions.**
  - A browser-style cookie session (curl jar) and a CLI session for different users run side by side.
  - Logging in again from the CLI kills the old token (`x-sst-session: invalid`).
  - Logout in the CLI leaves the browser session alone.
  - A restart invalidates both, and the CLI says why.
  - Two CLI users at once work with separate `SST_RUN_DIR`s.
  - NFC and NFD forms of a unicode password both open the account, and a trailing space fails.
- **CLI ↔ HTTP parity.** Every CLI run is `POST /api/help` plus `POST /api/<cmd>` with the same cookie the browser uses (see `.run/server.log`). The only local path is the offline `help` fallback. `--json` prints exactly the browser's response body.
- **HTTP guard.**
  - `Host: evil.example`, `127.0.0.1.nip.io`, `localhost.` and `0.0.0.0` → 403.
  - `Origin: null` and `Origin: https://evil.example` → 403.
  - Bad JSON, `[]`, `null`, a string body, `__proto__` / `constructor` keys and unknown keys → clean 400s.
  - Path traversal against a fake `web/dist` (`%2e%2e`, `..%2f`, `%00`, backslashes) → 404. The SPA fallback and immutable `assets/` caching work.
- **Process control.**
  - `up:mock` run twice, or `up:mock` then `up`, always leaves one fresh server. `up` stops the mock in live mode.
  - After a `kill -9` of the server, `down` and `up` both recover. After a `kill -9` of the mock, `./sst models.list` gives a clean `Could not reach Venice` (exit 1) and the next `up:mock` recovers.
  - A server frozen with `kill -STOP` is SIGKILLed by `up` within about 2 s.
  - A stale pid file pointing at a foreign live process doesn't kill it.
  - With a foreign program on 4747, `up` stops and names it.
  - Two `up:mock` runs at once: one wins, the other exits 1, and there are no orphans.
- **Streams.** A client that aborts after the first NDJSON event (small or large deltas) doesn't stop the generator: it runs to the end and its file is written.
- **Mock.** All 6 mock model entries match live `/models` field for field (ignoring `created` and `description`). The rate-limits shape matches. The streamed text sequence matches live: role chunk, `reasoning_content` deltas, `content` deltas, finish chunk, a final `choices: []` chunk with `usage` and `cost`, then `[DONE]`; there are no CRLF, `event:` or comment lines. So does the forced tool call: the first `tool_calls` delta carries `id`, `type`, `name` and `arguments: ""`, then come fragments, then `finish_reason: "tool_calls"`. Live also accepted an out-of-list `reasoning_effort: "medium"`, and `"none"` on a model without reasoning, just as the mock does. Gaps are listed in QA-6.

## Findings

### QA-1 · major (design) · Some models get a hidden default system prompt when the request has no non-empty system message

Repro (live, about $0.0001 per call; the key is never printed):
```bash
set -a; . ./.env; set +a
U=https://api.venice.ai/api/v1/chat/completions
q() { curl -s -H "Authorization: Bearer $VENICE_ADMIN_KEY" -H 'content-type: application/json' -d "$1" $U | jq -c .usage.prompt_tokens; }
q '{"model":"venice-uncensored-1-2","messages":[{"role":"user","content":"Hi"}],"venice_parameters":{"include_venice_system_prompt":false},"max_tokens":1}'                                        # 558
q '{"model":"venice-uncensored-1-2","messages":[{"role":"user","content":"Hi"}],"venice_parameters":{"include_venice_system_prompt":true},"max_tokens":1}'                                         # 1745
q '{"model":"venice-uncensored-1-2","messages":[{"role":"system","content":""},{"role":"user","content":"Hi"}],"venice_parameters":{"include_venice_system_prompt":false},"max_tokens":1}'       # 558
q '{"model":"venice-uncensored-1-2","messages":[{"role":"system","content":"You are terse."},{"role":"user","content":"Hi"}],"venice_parameters":{"include_venice_system_prompt":false},"max_tokens":1}'  # 10
q '{"model":"deepseek-v4-1-flash","messages":[{"role":"user","content":"Hi"}],"venice_parameters":{"include_venice_system_prompt":false},"reasoning_effort":"none","max_tokens":1}'           # 5
```
- **Expected:** with the flag off, `prompt_tokens` reflects only our own text, as it does for deepseek (5 tokens).
- **Actual:** the flag removes Venice's own prompt of about 1,190 tokens (1745 → 558). But `venice-uncensored-1-2` still adds about 550 tokens (544 of them cached, so it's a fixed prefix) unless the request has a *non-empty* system message. An empty system message doesn't stop it.
- **Why it matters:** the hard rule says every word is visible and editable. design.md:89 sends no system message for an empty brain prompt, which is exactly the case that triggers it. `prompt.preview` can't show this text, and the mock computes `prompt_tokens` from our own text, so no test can catch it. (Side note: on deepseek, reasoning mode itself adds about 26 tokens: "Hi" costs 31 tokens at `medium` and 5 at `none`. That falls under the already-acknowledged chat-template exception.)
- **Recommendation (for T02 and design.md):**
  1. Record in design.md that some models add a default prompt, and that the flag only covers Venice's own prompt.
  2. Detect it: a cheap one-off probe per model (`[{user:"Hi"}]`, `max_tokens: 1`, reasoning off). Alternatively, compare each real call's `usage.prompt_tokens` against the preview's size. Flag offending models in `models.list` and in the payload view, or require a non-empty system prompt for them.
  3. Teach the mock to add about 550 prompt tokens for `venice-uncensored-1-2` when no non-empty system message is sent, so the warning path can be tested.

### QA-2 · major · Logging out or in mid-request zeroes the key that in-flight work is still using, so the data is saved under an all-zero key

Repro: save the script below anywhere, then run `node /path/to/qa-zero-key.ts` from the repo root. It uses the real `createApp`, sessions, auth commands and vault, plus a stand-in for T02's `turn` that takes `ctx.requireSession().vault`, streams for 300 ms and then saves.
```ts
const src = `${process.cwd()}/src`;
const { createApp } = await import(`${src}/server/app.ts`);
const { createSessionStore } = await import(`${src}/server/sessions.ts`);
const { streamCommand } = await import(`${src}/registry.ts`);
const { authLogin, authLogout } = await import(`${src}/commands/auth.ts`);
const { loadConfig } = await import(`${src}/config.ts`);
const { createUser, unlockUser } = await import(`${src}/storage/users.ts`);
const { writeJson, readJson } = await import(`${src}/storage/vault.ts`);
const { decrypt } = await import(`${src}/storage/crypto.ts`);
const { mkdtempSync, readFileSync } = await import("node:fs");
const dataDir = mkdtempSync(`${(await import("node:os")).tmpdir()}/qa-zero-`);
await createUser(dataDir, "qa-enc", "pw", { N: 1024, r: 8, p: 1 });
const fakeTurn = streamCommand({ name: "fake.turn", description: "x", args: authLogout.args,
  async *handler(_a: unknown, ctx: any) {
    const { vault } = ctx.requireSession();
    yield { type: "start" };
    await new Promise((r) => setTimeout(r, 300));
    await writeJson(vault, "conversations/c_1.json", { title: "SECRET-TAVERN" });
    yield { type: "done" };
  } });
const app = createApp({ config: { ...loadConfig({ SST_MODE: "mock" }), dataDir }, sessions: createSessionStore(), venice: {} as any, startedAt: "" }, [authLogin, authLogout, fakeTurn], () => {});
const post = (cmd: string, body: unknown, cookie = "") => app.fetch(new Request(`http://localhost/api/${cmd}`, { method: "POST", headers: { host: "localhost", "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const cookie = (await post("auth.login", { username: "qa-enc", password: "pw" })).headers.getSetCookie()[0]!.split(";")[0]!;
const turn = await post("fake.turn", {}, cookie);
console.log("logout mid-turn:", await (await post("auth.logout", {}, cookie)).text());
console.log("turn stream:", (await turn.text()).trim().replace(/\n/g, " "));
const blob = readFileSync(`${dataDir}/users/qa-enc/conversations/c_1.json`);
const { vault } = await unlockUser(dataDir, "qa-enc", "pw");
await readJson(vault, "conversations/c_1.json").then((v: unknown) => console.log("real key reads:", v), (e: Error) => console.log("real key FAILS:", e.message));
console.log("all-zero key reads:", decrypt(Buffer.alloc(32), blob).toString());
```
Output:
```
logout mid-turn: {"loggedOut":"qa-enc"}
turn stream: {"type":"start"} {"type":"done"}
real key FAILS: conversations/c_1.json: decryption failed (wrong key or corrupted file)
all-zero key reads: {"title":"SECRET-TAVERN"}
```
Logging in again as the *same* user with the *right* password mid-turn does the same damage, because `auth.login` destroys the caller's previous session.
- **Expected:** the in-flight work either finishes under the real key or is refused. Either way, nothing is written under a wiped key.
- **Actual:** the stream reports `done`. The conversation can no longer be read with the user's password (data loss), yet anyone can read it with the all-zero key (confidentiality loss). In T01 this is latent, because no command writes user data yet. But T02's `turn` and T05's image path will hit it by design, since the adapter keeps draining after a disconnect (app.ts:134). Realistic triggers: clicking Logout while a reply streams, running `./sst auth.login` again in a second terminal during a `turn`, or `user.delete` in T06.
- **Cause:** sessions.ts:22 `wipe = s.vault.key?.fill(0)` zeroes the very Buffer that handlers hold through `ctx.session.vault`, and vault.ts:34 encrypts with whatever key it's given. Called from auth.ts:24 (re-login) and auth.ts:38 (logout).
- **Suggested fix:**
  - Give each job its own copy of the key (`{dir, key: Buffer.from(key)}`) and wipe the copy when the job ends.
  - Or have the vault carry a `revoked` flag that makes reads and writes throw "session ended".
  - Also make `encrypt()` refuse an all-zero key as a last-ditch guard.
  - design.md should say which behaviour logout mid-generation gets: finish with a private copy (fits "persists even if the client disconnects"), or abort without writing.

### QA-3 · minor · The vault's "never touches user.json" guard is bypassed by a non-normalized path

Repro: run `node /path/to/qa-userjson.ts` from the repo root.
```ts
const src = `${process.cwd()}/src`;
const { createUser, unlockUser } = await import(`${src}/storage/users.ts`);
const { writeJson } = await import(`${src}/storage/vault.ts`);
const dataDir = (await import("node:fs")).mkdtempSync(`${(await import("node:os")).tmpdir()}/qa-uj-`);
await createUser(dataDir, "qa-enc", "pw", { N: 1024, r: 8, p: 1 });
const { vault } = await unlockUser(dataDir, "qa-enc", "pw");
await writeJson(vault, "user.json", {}).catch((e: Error) => console.log("user.json ->", e.message));
await writeJson(vault, "conversations/../user.json", { oops: 1 }).then(() => console.log("conversations/../user.json -> written"));
await unlockUser(dataDir, "qa-enc", "pw").then(() => console.log("login ok"), (e: Error) => console.log("login now fails:", e.message.slice(0, 60)));
```
```
user.json -> user.json is not vault data
conversations/../user.json -> written
login now fails: Unexpected token 'S', "SSENC1 R…"... is not valid JSON
```
`./user.json` gets through as well.
- **Expected:** the vault refuses any path that resolves to `user.json`.
- **Actual:** the write replaces the key envelope with ciphertext. The user is locked out for good, and login becomes a 500 rather than a clear error. It's latent: it takes a later command that builds a path from an id it hasn't validated (e.g. `--conversation ../user`). But this guard is the safety net design.md promises.
- **Cause:** vault.ts:13 compares the raw `rel` before `safeJoin` normalizes it (files.ts:47). Normalize first and compare after, or reject `.` and `..` segments outright. The crypto test at test/crypto.test.ts:61 only tries the literal name.

### QA-4 · minor · Any page on any localhost port can fire cookie-carrying commands (blind CSRF)

Repro (`up:mock`):
```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: http://localhost:3000' -H 'Content-Type: text/plain' \
  -d '{"username":"qa-t01-csrf","password":""}' http://localhost:4747/api/user.create   # 200, user created
curl -s -c jar -H 'content-type: application/json' -d '{"username":"qa-t01-a","password":""}' http://localhost:4747/api/auth.login >/dev/null
curl -s -b jar -H 'Origin: http://localhost:3000' -H 'Content-Type: text/plain' -d '{}' http://localhost:4747/api/auth.logout   # {"loggedOut":"qa-t01-a"}
```
- **Expected:** only the app's own pages (and the Vite dev server) can trigger commands.
- **Actual:** a `text/plain` POST is a CORS "simple request", so the browser sends it with no preflight. `SameSite=Strict` ignores ports, so `localhost:3000` → `localhost:4747` carries the session cookie. The guard allows any loopback Origin (app.ts:34-37), and the body is parsed whatever its content type (app.ts:52-54). So any local dev server or page Jason has open can blindly run `conversation.delete` and friends once they exist. It can't read the replies (no CORS headers).
- **Fix:** answer POST `/api/*` with 415 unless the content type is `application/json`. A cross-origin JSON POST needs a preflight, and the server never approves one. Optionally, allowlist exact origins: `:4747` plus the configured dev port.

### QA-5 · minor · `npm run up` (live) refuses to start when an unrelated program holds port 4748

Repro: `python3 -m http.server 4748 --bind 127.0.0.1 &` then `npm run up`, which prints `up: port 4748 is in use by another program (...)`. Nothing ends up listening on 4747.
- **Expected:** live mode doesn't use 4748, so the server starts. Stop our own mock if it's running, but ignore a foreign listener on that port.
- **Actual:** `stop(MOCK)` throws on a foreign listener (proc.ts:87-90) and `up` aborts (up.ts:66-71). By then the old server has already been stopped. `npm run down` also exits 1 in this case.

### QA-6 · minor · `user.create` with no TTY and empty stdin silently makes an unencrypted user

Repro: `./sst user.create --username qa-t01-d < /dev/null` prints `Created qa-t01-d (unencrypted)` and exits 0.
- **Expected:** without a terminal to prompt on, the CLI should demand an explicit choice: `--password ''` for no encryption, or a password piped on stdin.
- **Actual:** EOF is read as the empty password (cli/main.ts:147-150). Agents, IDE task runners and scripts all run without a TTY, so `./sst user.create --username jason` from one of them gives a plaintext user. The output does say "unencrypted", which is why this is minor. (For `auth.login` the same path just fails safely with "Wrong password".)

### QA-7 · minor · Mock fidelity gaps that T02 and T05 could trip on

Compared against live captures from 2026-10-14 (the same request bodies sent to both):
1. **The finish reason can share a chunk with content.** Live `venice-uncensored-1-2` with `max_tokens: 5` sent the last `content` delta *and* `finish_reason: "length"` in one chunk. The mock always sends a separate `delta: {}` finish chunk (mock-venice.ts:180) and ignores `max_tokens`, so it never produces `"length"`. A T02 parser that skips the content of a finish chunk would pass every mock test and drop the last token live.
2. Live's role chunk on a model without reasoning is `{"role":"assistant","content":""}`. The mock's is `{"role":"assistant"}`.
3. Live `/image/generate` responses carry `x-venice-is-blurred` and `x-venice-is-content-violation` headers, which T05's safe-mode UX will want. The mock sends neither (mock-venice.ts:218).
4. Live's image `request` field is `{success, data: {...normalized, seed, steps}}`. The mock echoes the raw body. This is harmless unless someone reads it.

Fix: honor `max_tokens` (truncate, `finish_reason: "length"`, last content in the finish chunk), add `content: ""` to the role chunk for models without reasoning, and add the two image headers.

### QA-8 · nit · Secret args go through `@file` expansion, and the error echoes the password

Repro: `./sst auth.login --username qa-t01-b --password '@Horse-qa1'` prints `error: --password: cannot read Horse-qa1 (ENOENT)` and exits 2.
- A password that starts with `@` can't be passed as a flag, and the error message prints most of it to the terminal. The hidden prompt is unaffected.
- **Fix:** skip `@`/`-` expansion for `secret` args (args.ts:97-111), and don't print the value in the error.

## Live spend

- Balance $8.02895253 before, $8.01801863 after, so $0.0109 spent.
- 9 tiny text calls: format captures for text, tool call, out-of-list effort and a non-reasoning model, plus the 5 QA-1 token probes.
- 1 `z-image-turbo` image (256×256) to check the response shape.
- `/models` and `rate_limits` are free.

## Notes for later passes

- **In-process concurrency tests:** Node's `fetch` can queue a second request to the same server behind a still-open stream. My first QA-2 attempt only "passed" because logout didn't reach the server until the stream ended. For 409 or mid-stream tests in T02, call `app.fetch(new Request(...))` directly or use `http.request` with `agent: false`. Separate `./sst` processes aren't affected.
- **Two CLI users at once:** give each terminal its own `SST_RUN_DIR` (verified working).
- **Cleanup:** I deleted all `qa-t01-*` users. `dev-a` and `dev-b` (the engineer's) are untouched. The server is stopped.
