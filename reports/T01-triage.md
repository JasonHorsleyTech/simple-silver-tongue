# T01 triage: foundation

**Fixed 7, deferred 1, dismissed 0** (one sub-item of QA-7 dismissed). No new design concern. One behaviour decision is recorded in design.md for the orchestrator to check: **logging out mid-generation lets the running work finish and save under the real key** (see QA-2).

## Decisions

| Finding | Decision | What changed / why |
|---|---|---|
| **QA-1** · major (design) · hidden default prompt on some models when there's no system message | **DEFER → T02** | Already recorded in design.md (hard rule 1) and assigned to T02 by the orchestrator. Left alone as instructed. |
| **QA-2** · major · logout or relogin zeroes the key a running request still holds | **FIX (structural)** | A guard on the zeroing wouldn't be enough: the bug is that sessions and requests *share one key buffer*. Now each request gets its own copy. The adapter (`app.ts`) hands every request a `forkVault()` copy of the session's vault and closes it once the work is done: after the handler for JSON and binary commands, after the generator has fully drained for streams. Logout (or logging in again) still kills the token and zeroes the *session's* key at once, but running work finishes and saves under the real key. That fits design.md's "persists even if the client disconnects", and T02's `turn` and T05's images get it for free. Two backstops: a closed vault refuses every read and write with `session_ended` (`vault.ts`), so a detached job that outlives its request fails loudly instead of writing garbage; and `encrypt()` refuses an all-zero key (`crypto.ts`). Regression tests: logout and relogin mid-stream through the real adapter (`e2e.test.ts`, which fails on the old code), plus unit tests for fork/close and the zero-key guard (`crypto.test.ts`). `startTestServer()` now exposes `app`, so concurrency tests can use `app.fetch` and avoid fetch's queuing. Follow-up deferred to T06: `user.delete` while work is in flight. |
| **QA-3** · minor · `user.json` guard bypassed by a non-normalized path | **FIX** | There was a second bypass QA didn't list: APFS here is case-insensitive (checked), so `USER.json` also reached the key envelope. So I changed the rule rather than patching the name check. `safeJoin` now refuses any `.` or `..` segment outright instead of normalizing it away. The vault only touches files in a subfolder (`conversations/`, `images/`), so no spelling of the top-level `user.json` (case or Unicode folding) is reachable. Regression test covers `conversations/../user.json`, `./user.json`, `USER.json` and `User.JSON`, and that login still works afterwards. |
| **QA-4** · minor · blind CSRF from other localhost ports | **FIX** | `POST /api/*` now needs `Content-Type: application/json`, even with an empty body; anything else gets a 415 `unsupported_media_type`. A cross-origin JSON POST needs a preflight, and the server never approves one (an OPTIONS preflight gets a 405 with no CORS headers). I skipped the exact-origin allowlist: once simple requests are refused it adds nothing, and it would get in the frontend pass's Vite proxy's way. Regression test covers text/plain, urlencoded, multipart and a missing type (all 415) and `application/json; charset=utf-8` (200). |
| **QA-5** · minor · live `up` refuses to start when a stranger holds 4748 | **FIX** | `stop()` no longer throws on a foreign listener. A new `foreignHolder()` lets `up` check only the ports its mode will use (4747 always, 4748 only for `up:mock`). `down` notes a foreign holder and exits 0, since it did stop everything of ours. These are small changes to T01's own scripts, and they make "`up` always ends with a fresh server" true. |
| **QA-6** · minor · no TTY + empty stdin quietly makes an unencrypted user | **FIX** | Encryption is a hard requirement, and agents and IDE tasks run without a TTY, so a silent downgrade is the wrong default. Empty stdin (zero bytes) is now a usage error that says to pass `--password ''` or pipe one in. An explicit empty line (`printf '\n'`) still means "no password". Regression test in `e2e.test.ts`. |
| **QA-7** · minor · mock fidelity gaps | **FIX (1–3), DISMISS (4)** | (1) The mock honors `max_tokens` (counted in content words): the reply is cut with `finish_reason: "length"`, and the last content delta shares the finish chunk, as live does. That is exactly the parser trap QA described, and it is now testable for free. design.md's "verified against live" list tells T02 to read content on every chunk. (2) The role chunk is `{role, content: ""}` for models without reasoning. (3) Image responses carry `x-venice-is-blurred` and `x-venice-is-content-violation` (always `false`). A trigger that answers `true` is deferred to T05, which will need it. (4) The image `request` echo shape: **dismissed**, since nothing reads it. Contract tests added to `mock-venice.test.ts`. |
| **QA-8** · nit · secret args go through `@file`, and the error echoes the password | **FIX** | This was 2 lines. Secret args are literal now, except `-` (stdin, which is documented and tested). So a password that starts with `@` works, and nothing gets echoed. Regression test in `cli-args.test.ts`. |

Docs: design.md (vault rules, sessions and leases, HTTP 415 contract, secret flags, the finish-chunk content rule, mock behaviour) and AGENTS.md (CLI flag note, two Lessons-learned bullets). TICKETS.md: T01 → `frontend`; Deferred-in bullets added to T05 (QA-7 blurred trigger) and T06 (QA-2 `user.delete` with work in flight).

## Re-verification

`npm run typecheck` is clean. `npm test`: **32/32 pass**, up from 25 (7 new tests). Both new QA-2 tests fail when run against the pre-fix adapter, sessions and vault.

QA's own scripts, run unchanged:
```
$ node qa-zero-key.ts          # QA-2
logout mid-turn: {"loggedOut":"qa-enc"}
turn stream: {"type":"start"} {"type":"done"}
real key reads: { title: 'SECRET-TAVERN' }        (was: real key FAILS)
DecryptError: decryption failed ...               (the script's last line: the all-zero key no longer reads it)

$ node qa-userjson.ts          # QA-3, plus variants
user.json                  -> vault files live in a subfolder; the top level (user.json) is not vault data
./user.json                -> unsafe path
conversations/../user.json -> unsafe path          (was: written, and login broken)
USER.json / User.JSON      -> vault files live in a subfolder ...
login ok
```

Against `npm run up:mock`:
```
$ ./sst user.create --username dev-tri-a --password '' && ./sst auth.login --username dev-tri-a --password '' && ./sst auth.whoami
Created dev-tri-a (unencrypted). ...
Logged in as dev-tri-a (unencrypted).
dev-tri-a (unencrypted)
$ printf 'tri-pw-1\n' | ./sst user.create --username dev-tri-b
Created dev-tri-b (encrypted). ...
$ ./sst auth.login --username dev-tri-b --password wrong      → error: Wrong password for dev-tri-b. (exit 1)
$ printf 'tri-pw-1\n' | ./sst auth.login --username dev-tri-b && ./sst auth.whoami
Logged in as dev-tri-b (encrypted).
dev-tri-b (encrypted)
$ ./sst auth.logout && ./sst auth.whoami
Logged out dev-tri-b.
Not logged in.

# QA-4, QA's exact curl commands
$ curl ... -H 'Origin: http://localhost:3000' -H 'Content-Type: text/plain' ... /api/user.create     → 415 (no user created)
$ curl -b jar ... -H 'Content-Type: text/plain' -d '{}' /api/auth.logout
{"error":{"code":"unsupported_media_type","message":"POST /api/<command> needs Content-Type: application/json."}}
$ curl -b jar -H 'content-type: application/json' -d '{}' /api/auth.whoami                         → still logged in
$ curl -X OPTIONS (preflight from localhost:3000)                                                    → 405, no Access-Control-* headers

# QA-6
$ ./sst user.create --username dev-tri-d < /dev/null
error: --password is required and there is no terminal to prompt on. Pass --password '' for none, or pipe it on stdin. Run ./sst help user.create.   (exit 2, no user)

# QA-8
$ ./sst auth.login --username dev-tri-b --password '@Horse-qa1'
error: Wrong password for dev-tri-b.             (exit 1; was: "cannot read Horse-qa1", exit 2)

# QA-7 (mock, venice-uncensored-1-2, max_tokens 5)
"delta":{"role":"assistant","content":""},"finish_reason":null
"delta":{"content":"MOCK "} ... "delta":{"content":"brain "}
"delta":{"content":"\"(no "},"finish_reason":"length"
image/generate → x-venice-is-blurred: false, x-venice-is-content-violation: false
```

QA-5, with `python3 -m http.server 4748` running:
```
$ npm run up            → simple-silver is up → http://localhost:4747 · Venice: live     (was: refused)
$ ./sst models.list --type image | head -1   → Image models (45)                        (live acceptance bullet; /models is free)
$ npm run down          → stopped the server · mock was not running · note: port 4748 is in use by another program ... Not ours, so left alone.  (exit 0; was 1)
$ npm run up:mock       → up: port 4748 is in use by another program ...  (exit 1, correct: mock mode needs it)
python3 on 4747 → up:mock still refuses and names it.
```

## Live spend

None. The only live calls were `GET /models`, which is free. No chat or image calls were made.

## Cleanup

`dev-tri-*` users removed. `dev-a` and `dev-b` (the engineer's) are untouched. The server is stopped (`npm run down`).
