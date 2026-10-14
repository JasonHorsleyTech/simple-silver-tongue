# T06 engineer: multi-user encryption hardening (CP5)

Jason's bar: "If someone else comes to my computer and manually opens the flat files where we're saving these conversations, all of the messages back and forth would be garbled nonsense", images included. Encryption has existed since T01, so this pass was mostly an end-to-end audit. It closed the two deferred items, the leaks the audit found, and the "prove it" test.

## What I audited, and what I found

| Where text could land | Found | Now |
|---|---|---|
| `data/users/<enc>/conversations/*.json` | Ciphertext (`SSENC1` + IV + tag + AES-256-GCM), titles, steers and setup included | Proven by test, every kind of text |
| `data/users/<enc>/images/*` | Ciphertext, but **typed names** (`img_….webp`) gave away the format, a hint at the model (T05 QA-6) | `img_….bin`; old names found, renamed at login |
| Temp files from atomic writes | Ciphertext (encrypted before writing), same folder, cleaned up | Unchanged |
| `user.json` | Username, flag, createdAt, scrypt params + salt, wrapped data key. No password, no raw key | Unchanged; asserted key by key |
| `.run/server.log` | Method, path, status, ms and error codes. Internal errors log stacks, but no error message carries content: Venice's errors go to the client only, `JSON.parse` errors are replaced | Asserted in the test, failing requests included |
| `.run/cli-session.json` (0600) | Token, username, URL. The token dies with the server or a logout | Unchanged |
| `.run/mock.log` | Method, path, status | Unchanged |
| Error messages | Content-free in the log; to clients they may name things the user typed (a brain name), which is fine | Unchanged |
| Browser HTTP cache | Every `/api` answer is `Cache-Control: no-store` | Now tested for JSON, JSON error, bad args, stream, image GET, image 404, not logged in |
| Browser storage, history | localStorage: last username + panel state only. URLs `/c/<id>`, page title "simple silver". No service worker | Unchanged |
| Chrome Autofill | One content input (conversation title) and the 4 raw textareas had no `autocomplete="off"` | Added (5 attributes, no UI change) |
| **Process args (`ps`)** | `./ss auth.login --password x` and `--content "..."` showed in `ps` for the whole run | `process.title = "ss"`: `ps` shows `ss` (tested, macOS) |
| **Shell history** | macOS `/etc/zshrc` saves interactive history to `~/.zsh_history`: a `--password` flag lands there in plain text, which defeats the encryption | CLI warns on a password flag; encrypted login prints a one-line note about `--content -`; docs |
| **npm debug logs** | `npm run ss -- auth.login --password x` wrote the password to `~/.npm/_logs/*-debug-0.log` (verified) | Project `.npmrc` (`logs-max=0`, `logs-dir` in `.run/`); docs say use `./ss` |
| `user.delete` with work running (T01 QA-2) | Didn't exist; running work's last save would re-create the folder without `user.json` | 409 `user_busy`; the vault can't create a user's folder any more |
| Login racing a delete | Would hand out a key for a user that is gone | `unlockUser` re-reads `user.json` after scrypt |

What stays visible, by design: usernames, the encrypted flag, how many conversations and images, file sizes, timestamps and ids.

## What I built

- **`user.delete --username [--confirm]`.** You confirm by typing the username again: the prompt asks in the clear, or `--confirm`, or a stdin line. No password is needed, because anyone at the computer can `rm` the folder anyway, and a user whose password is lost should still be removable. It is **refused (409 `user_busy`, nothing deleted) while the user has work running**, and the message says what: `a reply is being written (c_…)` / `an image is being made (c_…), which Venice is already billing` / `a request is still using its data`. Otherwise, in the same tick as the check, it destroys the user's sessions and closes every open copy of its key, renames the folder to `users/.deleted-…` (atomic), and removes it. Then it closes sessions and keys once more and sweeps any older leftovers. If the caller was that user, the CLI drops its saved session.
- **A registry of open vaults** (`vault.ts`): `openVault` (a session's master) and `forkVault` register, `closeVault` unregisters. `forksOpen(dir, except)` is "work running on this user's data". `closeVaultsOf(dir)` marks keys `deleted`, so a late use says "This user was deleted…".
- **The vault never creates a user's own folder.** `writeBytes` makes only the subfolders below it, non-recursively, and calls `writeFileAtomic(..., {makeDirs: false})`. A write after deletion fails instead of re-creating `users/<u>/conversations/`. `user.json` writes don't create folders either.
- **The login re-check**: after scrypt, `unlockUser` refuses if `user.json` is gone, was re-created (`createdAt` differs), or its password changed meanwhile.
- **Image names**: `saveImageFile` writes `.bin` for encrypted users. `findImageFile` finds `.bin` and old typed names, `readImageFile` sniffs the decrypted bytes (`image.get` and `settleStaleImages` use it), and `neutralizeImageNames` renames old ones at `auth.login` (names only).
- **`user.change-password --username`** (my call: the T01 envelope made it ~40 lines). It unwraps the data key with the current password, rewraps it with the new one under a fresh salt at today's `KDF_DEFAULTS`, and writes `user.json` atomically. **No file is touched.** The user is logged out everywhere. It refuses a plaintext user, an empty new password, and a wrong current one. `crypto.ts` gained `wrapKey`.
- **CLI**:
  - `.meta({ask: true})`: a prompt that shows what you type, for confirmations.
  - Each prompted answer is the next stdin line without a terminal (`printf 'old\nnew\n' | ./ss user.change-password …`). If a flag's `-` already took stdin, a prompt is a usage error rather than a silent re-read of the same line.
  - A warning for a non-empty secret given as a flag.
  - `process.title = "ss"`.
  - `SS_SESSION_FILE`, which gives a terminal its own login, so two terminals can be two users at once.
  - The "session no longer valid" line now names logout, password change and delete.
- **`.npmrc`** with `logs-max=0` and `logs-dir=.run/npm-logs`, so `npm run …` here writes no argv log and doesn't prune other projects' logs.

## Commands added or changed

- New: `user.delete`, `user.change-password`.
- Changed:
  - `auth.login`: renames pre-T06 encrypted image files; its CLI text for an encrypted user adds the shell-history note; it fails cleanly if the user was deleted or its password changed mid-login.
  - `user.create`'s help mentions shell history.
  - `image.get`: same output, now typed by sniffing only.
- CLI: `ask` meta, multi-line stdin answers, the secret-flag warning, `process.title`, `SS_SESSION_FILE`.

## Terminal transcript (trimmed; `npm run up:mock`, then `npm run up` for the live part)

Two users side by side (terminal B has its own session file):
```
$ printf 'gilded-goat-pw\n' | ./ss user.create --username dev-t06-enc
Created dev-t06-enc (encrypted). Log in with: ./ss auth.login --username dev-t06-enc
$ ./ss user.create --username dev-t06-plain --password ''
Created dev-t06-plain (unencrypted). ...
$ ./ss user.list
USERNAME          ENCRYPTED  CREATED
dev-t06-enc       yes        2026-10-14T12:27:27.997Z
dev-t06-plain     no         2026-10-14T12:27:28.304Z
$ ./ss auth.login --username dev-t06-enc --password wrong
warning: --password on the command line is saved in your shell history (and shows in ps while ./ss runs). Leave it out to be asked for it, or pass --password - and pipe it in.
error: Wrong password for dev-t06-enc.
exit 1
$ printf 'gilded-goat-pw\n' | ./ss auth.login --username dev-t06-enc --password -
Logged in as dev-t06-enc (encrypted).
Note: text you type on the ./ss command line (--content "...", --steer "...") is saved in your shell history as plain text. For private text, use --content - and type or paste it (Ctrl-D ends it), or use the browser.
$ SS_SESSION_FILE=terminal-b.json ./ss auth.login --username dev-t06-plain --password ''
Logged in as dev-t06-plain (unencrypted).
$ ./ss auth.whoami; SS_SESSION_FILE=terminal-b.json ./ss auth.whoami
dev-t06-enc (encrypted)
dev-t06-plain (unencrypted)
```
Each user, from its own terminal, then played the same script (conversation, setup "World Bible of Mirefen", a Scene Painter, a turn about "Velzaroth", a regenerate steered "…brine riddles", a prompt "A violet comet over the Gilded Goat tavern" in the painter's mouth, a painter turn):
```
$ ls -R data/users/dev-t06-enc              $ ls data/users/dev-t06-plain/images
conversations/c_9lp1dgaus5.json             img_b4sdzfcvgg.png
images/img_hfkgw9ss0r.bin                   img_vqlzcskvmh.png
images/img_hq5ky80otv.bin
user.json

Velzaroth          enc: 0 files   plain: 1 files   .run: 0 files
Mirefen            enc: 0 files   plain: 1 files   .run: 0 files
Quillmouth         enc: 0 files   plain: 1 files   .run: 0 files
brine riddles      enc: 0 files   plain: 1 files   .run: 0 files
violet comet       enc: 0 files   plain: 1 files   .run: 0 files
soot and saffron   enc: 0 files   plain: 1 files   .run: 0 files
Glasshollow        enc: 0 files   plain: 1 files   .run: 0 files
silver thimble     enc: 0 files   plain: 1 files   .run: 0 files
gilded-goat-pw     enc: 0 files   plain: 0 files   .run: 0 files
$ grep -r "Velzaroth" data/users/dev-t06-enc; echo "exit $?"
exit 1
$ file data/users/dev-t06-enc/*/*
conversations/c_9lp1dgaus5.json: data
images/img_hfkgw9ss0r.bin:       data
images/img_hq5ky80otv.bin:       data
$ xxd data/users/dev-t06-enc/conversations/*.json | head -2
00000000: 5353 454e 4331 9de3 ad0c 0419 3c64 eb57  SSENC1......<d.W
00000010: 8dd7 dbe2 cc15 a57d b89c 80c0 c895 7611  .......}......v.
$ ./ss conversation.get --id c_9lp1dgaus5 | head -6       # the owner reads it fine
Velzaroth at the Gilded Goat (c_9lp1dgaus5) · deepseek-v4-1-flash · 5 messages · $0.02
...
── Assistant · m_n9lnsja5rh · version 2/2 ... · steer "Make Velzaroth whisper in brine riddles." on version 1 · $0.000078 ──
```
Cache headers, `ps`, logs:
```
$ curl -si ... /api/conversation.get | /api/image.get?id= (GET) | /api/generation.follow | 404
HTTP/1.1 200 OK / cache-control: no-store
HTTP/1.1 200 OK / cache-control: no-store / content-type: image/png
HTTP/1.1 200 OK / cache-control: no-store
HTTP/1.1 404 Not Found / cache-control: no-store
$ ./ss turn --conversation c_9lp1dgaus5 --content "MOCK_SLOW whisper the Velzaroth secret" &   then ps
13200 ss
$ grep -ciE "Velzaroth|Mirefen|Quillmouth|brine|comet|saffron|Glasshollow|thimble|bell tower|Doomed|goat-pw|tavern-pw" .run/*.log*
.run/mock.log:0  .run/mock.log.1:0  .run/server.log.1:0  .run/server.log:0
$ grep -E "failed|ERROR" .run/server.log.1
auth.login failed: 401 wrong_password
conversation.get failed: 404 not_found
user.delete failed: 409 user_busy
user.delete failed: 400 bad_request
conversation.list failed: 401 unauthenticated
```
`user.delete` (a throwaway encrypted user, mock holding its image 6 s):
```
$ ./ss message.add --conversation c_ezi76p8v1m --as "Scene Painter" --content "MOCK_IMAGE_SLOW a drowned bell tower"
Added m_s30x7pv378 (an image prompt in Scene Painter's mouth). ... Making its image img_qdsddjw9jp with z-image-turbo. ...
$ ./ss user.delete --username dev-t06-del --confirm dev-t06-del
error: Can't delete dev-t06-del yet: an image is being made (c_ezi76p8v1m), which Venice is already billing. Wait for it to finish, or stop the reply (generation.stop), then try again. Nothing was deleted.
$ echo dev-t06-dle | ./ss user.delete --username dev-t06-del
error: Not deleted: the confirmation must be the username, dev-t06-del, typed exactly.
$ echo dev-t06-del | ./ss user.delete --username dev-t06-del          (after the image landed)
Deleted dev-t06-del (encrypted) with 1 conversation and 1 image, for good. Logged out 1 session.
$ ls -a data/users | grep -c "dev-t06-del\|^\.deleted"
0
$ SS_SESSION_FILE=terminal-d.json ./ss conversation.list
(Saved CLI session for dev-t06-del is no longer valid: ...)
error: Not logged in. ...
```
(Since then, an image-only 409 no longer suggests `generation.stop`, which never touches images.)

Restart, then the password change:
```
$ npm run up:mock && ./ss auth.whoami
(Saved CLI session for dev-t06-enc is no longer valid: the server restarted, or it was ended elsewhere by a logout, a password change or user.delete.)
Not logged in.
$ printf 'wrong\nnew-pw\n' | ./ss user.change-password --username dev-t06-enc
error: Wrong password for dev-t06-enc. Nothing was changed.
$ printf 'gilded-goat-pw\ncomet-tavern-pw\n' | ./ss user.change-password --username dev-t06-enc
Changed the password for dev-t06-enc. Log in with: ./ss auth.login --username dev-t06-enc
$ printf '\ny\n' | ./ss user.change-password --username dev-t06-plain
error: dev-t06-plain is unencrypted, so it has no password to change. ...
$ printf 'gilded-goat-pw\n' | ./ss auth.login --username dev-t06-enc --password -
error: Wrong password for dev-t06-enc.
$ printf 'comet-tavern-pw\n' | ./ss auth.login --username dev-t06-enc --password - && ./ss conversation.list
Logged in as dev-t06-enc (encrypted).
c_9lp1dgaus5  Velzaroth at the Gilded Goat  7  $0.02 ...
```

## Live check (`npm run up`, encrypted `dev-t06-enc`)

One painter turn at 512×512: the real path stores Venice's **WebP** (the mock only ever sends PNG).
```
$ ./ss turn --conversation c_jcon0v809i --brain "Scene Painter" --content "A lantern-lit Quillmouth ferry at dusk."
[Scene Painter]
A lantern-lit Quillmouth ferry at dusk, seen from a low angle on the water. ... cinematic.
(making image img_r52wfjz80t with z-image-turbo... the conversation is free meanwhile)
[Scene Painter · 318 in / 247 out · $0.00039 · image img_r52wfjz80t done (z-image-turbo, webp, $0.01)]
$ ls -l data/users/dev-t06-enc/images/img_r52wfjz80t*     →  65208 img_r52wfjz80t.bin   (file: data)
$ ./ss image.get --id img_r52wfjz80t --out live.webp      →  Wrote 65174 bytes (image/webp)
$ grep -rlE "Quillmouth|ferryman|lantern" data/users/dev-t06-enc .run | wc -l   →  0
```
65208 − 65174 = 34 bytes: exactly the magic, IV and tag.

**Spend:** balance **$7.90066551 → $7.89027371 = $0.0104** (1 text call, $0.00039; 1 z-image-turbo image, $0.01). That is 1 of 15 text calls and 1 of 3 images.

## Tests

- **`test/encryption.test.ts`** (new):
  - **The audit test.** One scenario is played by a plaintext user and an encrypted user, with a unique phrase in each of 17 kinds of text: title, system prompt, reminder, setup label and text, brain name and prompt, painter name and prompt, tool description, player template, negative prompt, message, steer, edit, image prompt, and words in a brain's mouth. The **plaintext user is the control**: every phrase must turn up in its files.
  - For the encrypted user: `conversation.get` returns every phrase. Every file but `user.json` starts with `SSENC1`, and there are no `.tmp` files. No phrase or password appears in any file. `user.json` has exactly its six keys. Images are `<id>.bin`, `image.get` still says `image/png`, and no 16-byte window (start, middle, end) nor the 8-byte signature of the real image is on disk.
  - Nothing outside the control's folder holds a phrase: the data dir, the run dir with `cli-session.json`, and the captured server log, including two requests that fail with text of their own.
  - Old typed names are found, then renamed at login.
  - Mutation-checked: skipping encryption for images makes it fail, and so does removing `process.title`.
  - Also: `no-store` on all seven kinds of `/api` answer. And a real `./ss` child process shows `ss` in `ps`, never its arguments.
- **`test/users.test.ts`** (new):
  - `user.delete`'s confirmation: flag, prompt, stdin, a mismatch, and no answer.
  - 409 while a streaming reply runs (browser-style `app.fetch`) and while a detached image is made; then a delete of yourself, which drops the CLI session and leaves no leftovers, and the name is free again.
  - A stale key can't re-create the folder, and a login racing a delete fails.
  - `user.change-password`: wrong / empty / plaintext refused; the file bytes are unchanged; a fresh salt at N = 2^17; the old password is out; the user is logged out; multi-line stdin works.
  - The secret-flag warning, the encrypted-login note, and `SS_SESSION_FILE`.
- `test/images.test.ts`: the encrypted image is `.bin` now.
- `npm test`: **118 pass** (110 before). `npm run typecheck`: clean, server and web. The timing-sensitive tests ran 6–8 times each without a failure, after I fixed a check of mine that flaked: a 3-byte `PNG` can turn up by chance in random ciphertext.

## Known gaps

- **A live session is a way in.** Encryption protects data at rest: with the server stopped, or nobody logged in. While a user is logged in, anyone at the unlocked computer can read their data through the app: the open tab, or `./ss`, which uses the token in `.run/cli-session.json`. Sessions don't expire until logout or a restart. Recommendation (not built, not in the brief): an optional idle timeout, or just "log out or `npm run down` when you step away".
- **A password change doesn't rotate the data key.** A copy of `user.json` taken earlier still opens with the old password, and that key also decrypts files written later. The help says so. Real re-keying means re-encrypting every file.
- **Shell history** is the shell's. The CLI warns and the docs advise `--content -` or the browser, but `./ss turn --content "…"` typed in Jason's own terminal still lands in `~/.zsh_history`. Agents' non-interactive shells keep no history.
- **`ps`**: the first few ms of a `./ss` run, before the title is set, still show its arguments. `npm run ss --` shows them in npm's own process for the whole run; the docs say to use `./ss`.
- **Chrome's session-restore form state** (a draft typed in the composer, not sent): not verified. It goes to the frontend pass with a concrete grep-the-profile check (TICKETS.md, T06 "From T06 engineer").
- Pre-T06 image names are renamed at the user's next login; a user who never logs in again keeps them (only dev and qa users today). A rename racing a delete of the same image could leave one unreferenced ciphertext file.
- No password strength rule. scrypt (N = 2^17, about 200 ms and 128 MB per guess) slows guessing; it doesn't fix a weak password.
- Deleting a plaintext user unlinks its files; it doesn't scrub the free blocks (FileVault covers the disk). An encrypted user's leftovers are ciphertext.
- **Side effect while testing:** probing npm's `logs-max=0`, I found it prunes the global `~/.npm/_logs`. It removed the up-to-10 rotating npm debug logs there, all from today's npm runs. They are diagnostics npm rotates anyway, not user data. The committed `.npmrc` sets `logs-dir` so it can't do that again.

## Changes to design.md

- Storage layout: `.bin` image names for encrypted users; `users/.deleted-…` while a delete runs.
- Encryption:
  - Neutral image names.
  - "The password is never stored", in plain terms.
  - The password change and its limit.
  - New "Who is using a user's data right now": the vault registry, `user.delete`'s rules, the login re-check, a vault that never creates a user's folder.
  - New "Where plaintext can still appear": the audit table and what stays visible.
- Sessions: delete and password change log out everywhere; `SS_SESSION_FILE`.
- Command surface: "Implemented in T06", the command list, and the `ask` meta in "Writing a command".

Also changed: AGENTS.md ("Running it": the new commands, `./ss` rather than `npm run ss --` for secrets, `SS_SESSION_FILE`; three lessons), TICKETS.md (T06 → `qa`, both deferred items done, notes for the T06 frontend pass and for T07), and `.npmrc` (new).

The server is left running on current code, in mock mode. The users `dev-t06-enc` (password `comet-tavern-pw`) and `dev-t06-plain` are kept for QA.
