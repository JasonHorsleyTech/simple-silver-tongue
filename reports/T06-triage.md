# T06 triage: multi-user encryption hardening (CP5)

**Fixed 5, deferred 0, dismissed 0.** The orchestrator decided QA-1. Every finding was reproduced first with QA's own commands, except the `kdf.N = 2^24` login, which QA said swapped the Mac. I ran that one only after the bound was in place, where it is refused in 0.1 s. Every fix was then confirmed with the same commands.

## Decisions

| Finding | Decision | What changed / why |
|---|---|---|
| **QA-1** · major · a login never expires; `kill -USR1` opens the inspector | **FIX** (orchestrator's call) | **Idle timeout, 60 minutes by default.** `SST_SESSION_IDLE_MINUTES` changes it (0 = never; it can go in the environment or in `.env` for live mode). A session nobody has used for that long ends, and its key is zeroed. It ends at the next request that carries its token, or at a sweep (every minute, `unref`ed) when no request comes. "Used" means a command that needs the login (`auth: true`): sending, editing, opening a campaign or an image. `auth.whoami`, `health`, `help` and `user.list` don't count, so looking never keeps a session alive. Running work holds its own fork and finishes (tested). **Clients are told why.** A timed-out token gets `x-sst-session: expired` and a 401 `session_expired`: "Your session expired: nothing used it for 60 minutes, so the server logged it out and wiped its key from memory." The CLI drops its token and adds `Log in again: ./sst auth.login --username <name>`. `auth.login` / `auth.whoami` now return `idle: {minutes, secondsLeft}`, and the CLI prints it. **The browser**: the login screen says "You were logged out after 60 minutes without activity…", and `session.tsx` re-checks (whoami) when `secondsLeft` runs out. An idle tab therefore drops to the login screen by itself instead of leaving the campaign on screen (checked in Chrome). **Debugger**: `npm run up` starts the server with `--disable-sigusr1`, and `main.ts` also listens for SIGUSR1, which covers a server started by hand. Both were tested on Node 26: no inspector on 9229, and the server stays up. **Also** `auth.logout --all` (QA's optional item, about 6 lines): this user out of every tab and terminal, for "I'm stepping away". |
| **QA-2** · minor · an undecryptable file is a 500 "Internal server error"; a truncated one is called "plaintext" | **FIX** | The vault now throws 500 `unreadable_file`, naming the file and why. The reasons are: "can't be decrypted with this user's key: it is damaged, or it is another user's file", "damaged: cut short" (an `SSENC1` file shorter than the header), "empty", "not encrypted, but every file of an encrypted user is", "encrypted, but this user is unencrypted", and "not valid JSON". `conversation.get`, `image.get` and `conversation.list` all say the same thing. The log keeps only the code (`failed: 500 unreadable_file`), with no stack and never any content. `listConversations` and `settleStaleImages` treat it as "unreadable", as before. |
| **QA-3** · minor · Claude Code's transcripts are the biggest plaintext copy | **FIX** (docs) | The orchestrator added the AGENTS.md rule. design.md's audit table has a new row naming the transcripts, the mitigation (agents only use `qa-*`/`dev-*` users with made-up content) and the **residual risk**. If Jason asks Claude Code to look at, debug or play in a real campaign, that text sits in `~/.claude/projects/…/*.jsonl` in the clear until Claude Code's cleanup removes it (`cleanupPeriodDays`, 30 by default) or he deletes it. So debug with a `dev-` copy. The shell-history row no longer implies that agents leave nothing behind. The T07 note in TICKETS.md is corrected. A paragraph under the table also says what encryption can't cover: a session in use. |
| **QA-4** · nit · one conversation file can stand in for another | **FIX** (the cheap half) | `loadConversation` checks `conv.id` against the file name. A copy now lists as unreadable ("holds conversation c_A, not c_B (a copy of another file?)"), is never listed twice, and is never written into. I did not bind the ciphertext to its path with GCM additional data: that needs an `SSENC2` format and a migration of Jason's real files, for an attack that needs write access and reveals nothing. A swapped *image* file still shows the other picture. design.md says so. |
| **QA-5** · nit · a damaged `user.json` is a silent drop or a 500; inflated KDF settings swapped the Mac | **FIX** | **`checkKdf`** (crypto.ts) runs before any scrypt. It refuses params that aren't positive integers with N a power of two, or that cost more than 8× the defaults in memory (1 GiB) or work (about 1.6 s). That leaves room to raise `KDF_DEFAULTS` later; QA's suggested `N ≤ 2^20, r ≤ 16` would still have allowed 2 GiB. **`loadUser`** also checks the file's shape and that its `username` matches the folder. A bad one is an `unreadable_file` such as "users/X/user.json: damaged: it is not valid JSON. So X can't log in. Put back a good copy if you have one…, or remove the user with ./sst user.delete". `user.list` lists it under "Users whose user.json is damaged" instead of dropping it, and `user.delete` can still remove it. |

QA's notes that weren't findings: the Time Machine `user.json` point is already documented and nothing needs doing now. The "server restarted" wording after a `user.delete`, and an unsent draft lost on expiry, are passed to the frontend pass in TICKETS.md.

## Is an hour right?

Yes, for play. The clock runs from the last *action*, not from login, so a long evening never logs Jason out. An hour covers reading rules, thinking or eating between moves. When it does end, the cost is one password.

Three things it is not:
- **It isn't a screen lock.** During the hour after Jason walks away, the open tab shows his campaign to anyone at the unlocked Mac. The timeout bounds that window; the macOS screen lock closes it. design.md says so, and also mentions `auth.logout --all` and `npm run down`.
- **It costs an unsent draft.** If he types a message, leaves for over an hour and comes back, the tab is at the login screen and the draft is gone. Saving drafts to `localStorage` would put plaintext on disk, so I left it. The frontend pass has a note.
- **It ends agent sessions.** A long agent pass that pauses for an hour has to log in again.

If he finds 60 too short or too long, `SST_SESSION_IDLE_MINUTES` in `.env` changes it without code.

## Files

- Sessions: `src/server/sessions.ts` (rewritten), `src/server/app.ts` (lookup, header, touch), `src/registry.ts`, `src/config.ts` (`sessionIdleMinutes`), `src/server/main.ts` (SIGUSR1, the setting logged at startup), `scripts/up.ts` (`--disable-sigusr1`, prints the setting), `src/commands/auth.ts` (`idle`, `--all`), `src/cli/main.ts`.
- Errors: `src/lib/errors.ts` (`sessionExpired`, `unreadableFile`, `isUnreadable`), `src/storage/vault.ts`, `src/storage/crypto.ts` (`hasMagic`, `checkKdf`), `src/storage/users.ts`, `src/commands/users.ts`, `src/conversations/store.ts`, `src/conversations/images.ts`.
- Web: `web/src/api/client.ts` (`onSessionLost(why)`), `web/src/api/types.ts`, `web/src/app/session.tsx` (the notice and the re-check timer).
- Tests: new `test/sessions.test.ts` (7) and `test/damaged.test.ts` (5). Updated the expected `whoami`/`login` shapes and messages in `e2e`, `users`, `web-api`, `chat` and `crypto`. **130 pass** (118 before). Mutation-checked: without `touch`, or with a whoami that touches, 3 session tests fail.
- Docs: design.md (Encryption: KDF bounds, unreadable files, the id check; the audit table: transcripts, server memory, CLI token; Sessions: the idle timeout; HTTP error codes; web session; the T06 command list), AGENTS.md ("Running it", 3 lessons), TICKETS.md (T06 → `frontend`, notes for the frontend pass, the T07 correction).

## Re-verification (trimmed)

QA-1, with `SST_SESSION_IDLE_MINUTES=0.1 npm run up:mock` (6 s):
```
$ ps -o command= -p $(cat .run/server.pid)
node --disable-sigusr1 src/server/main.ts
$ printf 'qa-enc-pw-7731\n' | ./sst auth.login --username qa-t06-enc --password -
Logged in as qa-t06-enc (encrypted).
The session ends after 0.1 minutes without activity, and the server wipes its key.
$ env -i PATH="$PATH" HOME="$HOME" ./sst conversation.get --id c_3x7vzng2h3 | head -1      # at once: still QA's hole
ZQENCTitle campaign (c_3x7vzng2h3) · deepseek-v4-1-flash · 9 messages · $0.02
$ sleep 7; env -i PATH="$PATH" HOME="$HOME" ./sst conversation.get --id c_3x7vzng2h3
error: Your session expired: nothing used it for 0.1 minutes, so the server logged it out and wiped its key from memory.
Log in again: ./sst auth.login --username qa-t06-enc                                       (exit 1; session file gone)
$ curl -si -H 'content-type: application/json' -H "cookie: sst_session=$TOKEN" -d '{}' .../api/conversation.list
HTTP/1.1 401 Unauthorized
x-sst-session: expired
{"error":{"code":"session_expired","message":"Your session expired: nothing used it for 0.1 minutes, ..."}}
$ kill -USR1 $(cat .run/server.pid); lsof -iTCP:9229 -sTCP:LISTEN
(nothing; server alive)      # before the fix: "Debugger listening on ws://127.0.0.1:9229/…"
```
Chrome (isolated context, `qa-t06-enc` logged in, campaign open, tab focused, no input):
```
0.0s: campaign on screen
2.5s: campaign gone | login form | You were logged out after 0.1 minutes without activity, and the server wiped your key from its memory. Log in again to carry on.
```
Then, logged in again, a command every 3 s for 15 s ("play") kept it alive against the 6 s limit, and it dropped 8 s after the last one:
```
0.0s played (200) · 3.0s played · 6.0s played · 9.1s played · 12.1s played · 15.1s stopped playing · 20.1s login form
```
QA-2 / QA-4 (default 60 min):
```
$ ./sst conversation.get --id c_3x7vzng2h3          # a flipped byte
error: conversations/c_3x7vzng2h3.json: can't be decrypted with this user's key: it is damaged, or it is another user's file
$ ./sst conversation.list                           # cut to 20 bytes
  c_3x7vzng2h3: damaged: cut short, too small to be an encrypted file
$ ./sst conversation.get --id c_3x7vzng2h3          # emptied
error: conversations/c_3x7vzng2h3.json: empty, so it is damaged (an encrypted file never is)
$ ./sst image.get --id img_igrad6bx8h --out x.png   # a flipped image
error: images/img_igrad6bx8h.bin: can't be decrypted with this user's key: it is damaged, or it is another user's file
$ cp c_3x7vzng2h3.json c_zmdlvf652d.json; ./sst conversation.list; ./sst conversation.update --id c_zmdlvf652d --title Renamed
c_3x7vzng2h3  ZQENCTitle campaign  9  ...           (once)
Unreadable conversation files (1):
  c_zmdlvf652d: holds conversation c_3x7vzng2h3, not c_zmdlvf652d (a copy of another file?), so it isn't used
error: conversations/c_zmdlvf652d.json: holds conversation c_3x7vzng2h3, not c_zmdlvf652d (a copy of another file?), so it isn't used
$ grep -c ERROR .run/server.log
0                                                  (lines say "conversation.get failed: 500 unreadable_file")
```
QA-5:
```
$ head -c 120 … > qa-t06-enc2/user.json; ./sst user.list
Users whose user.json is damaged (1):
  qa-t06-enc2: damaged: it is not valid JSON. So qa-t06-enc2 can't log in. Put back a good copy if you have one (…), or remove the user with ./sst user.delete --username qa-t06-enc2.
$ (kdf.N = 2^24) time ./sst auth.login --username qa-t06-enc2 --password -
error: users/qa-t06-enc2/user.json: damaged: its key-derivation settings (N=16777216, r=8, p=1) are far above this app's (N=131072, r=8, p=1), so they aren't run. …
real 0.10          server RSS 247 MB
```
Acceptance, plain and encrypted side by side (two session files), after the fixes:
```
ZQTRIEnc:   files in enc=0 plain=0 .run=0     (the owner's conversation.get shows it)
ZQTRIPlain: files in enc=0 plain=1 .run=0
$ grep -r "ZQTRIEncPhrase" data/users/qa-t06-enc; echo $?
1
```
`npm run typecheck`: clean (server, CLI, tests, web). `npm test`: 130/130.

## Cleanup

Deleted with `./sst user.delete`: `qa-t06-enc`, `qa-t06-enc2`, `qa-t06-plain`, `dev-t06-enc`, `dev-t06-plain`. No `.deleted-*` folders are left. My scratch copies of their files are removed. The server is stopped (`npm run down`).
