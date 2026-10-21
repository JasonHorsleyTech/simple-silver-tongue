# T06 QA: multi-user encryption hardening (CP5)

**Verdict:** Acceptance passes. 0 blockers, 1 major (a design gap: sessions never expire), 2 minors, 2 nits.

> **DESIGN CONCERN (QA-1).** The encryption at rest holds. I played someone at Jason's Mac with the app stopped and could not read one word of an encrypted campaign anywhere: not in `data/`, `.run/`, logs, temp dirs, npm's logs, shell history, or Chrome's on-disk profile. The gap is that the app is rarely stopped. `npm run up` detaches and runs until a reboot or `npm run down`, and a login never expires. So the easy way in is the live session, not the files. I recommend a 30-minute idle timeout in `sessions.ts`, which also wipes the key from memory, plus `--disable-sigusr1` on the server. Details are under QA-1.

Run on mock (`npm run up:mock`) with fresh users `qa-t06-enc` (encrypted), `qa-t06-plain` and `qa-t06-enc2` (encrypted), plus throwaway users for the delete tests (since removed). No live calls. `npm test`: 118 pass.

## Acceptance checklist

| Bullet | Result | Evidence |
|---|---|---|
| For an encrypted user, every file except `user.json` is ciphertext, conversations and images alike. No plaintext in logs, temp files, `.run/` or errors | **pass** | Three users ran one script at the same time from three session files (`SST_SESSION_FILE`). Each kind of text carried its own marker: title, system prompt, setup label and text, brain name and prompt, reminder, painter prompt, tool description, negative prompt, player template, message, steer, image prompt, words in a brain's mouth, second message, edit. Every marker turned up in the plaintext control's file (`ZQPLN*`: 17/17). The encrypted users' markers (`ZQENC*`, `ZQTWO*`) turned up in 0 files under `data/` and `.run/`, and the passwords did too. Files start with `SSENC1`; `file` says `data`. A decrypted image is 34 bytes shorter than its `.bin` (magic + IV + tag), and none of its 16-byte windows appears in the ciphertext. Later grep of `.run/*` (both server logs, mock logs, session file) for every phrase and password I used: 0. Also clean: `$TMPDIR`, `/tmp`, `/private/var/tmp`, `~/.npm/_logs` (empty), `~/.zsh_history`. Tests leave no `ss-test-*` dirs behind. |
| Wrong passwords rejected cleanly; sessions in memory only, a restart means logging in again (the CLI says so); a plaintext user is plain JSON | **pass** | An empty, a trailing-space and a wrong password all give `Wrong password for qa-t06-enc.` (exit 1, log `401 wrong_password`, never the password). A password for the plain user gets a clear refusal. An unknown user gets a clear 404. A failed login leaves the caller's existing session alone. The browser shows "Wrong password for qa-t06-enc." inline. After `npm run up:mock`, all three session files print `(Saved CLI session … is no longer valid …)` / `Not logged in.`. An image painting at restart time (`MOCK_IMAGE_SLOW`) was finished and saved as `.bin` before exit. |
| `user.delete` with confirmation; `user.list` flags | **pass** | Deletes need `--confirm <name>`. Refused with 409 `user_busy`, nothing touched, while a reply streams, while an image is painting, and while a stopped reply drains. The CLI and browser sessions are logged out (`Logged out 2 sessions`), and no `.deleted-*` folder is left. The name is free at once. Re-created users, plain and encrypted, see nothing of the old one. The old ciphertext copied back under the reused name is refused (`encrypted file in a plaintext user's folder`). `user.list` shows `ENCRYPTED yes/no`. |
| A test proves no known plaintext in an encrypted user's conversation file or image file | **pass** | `test/encryption.test.ts` (17 kinds of text with a plaintext control, image windows, run dir, log). 118/118 pass. |
| **Acceptance:** two users, one plain and one encrypted, side by side from the CLI and the browser; `grep -r "<phrase>" data/users/<enc>` finds nothing | **pass** | CLI as above. Browser: two isolated Chrome contexts, `qa-t06-enc` and `qa-t06-plain`, each typed a message into the composer and pressed Enter. `ZQPLNBrowsersent` is in the plain user's JSON. `ZQENCBrowsersent` is in no file under `data/` or `.run/`, yet `conversation.get` shows it. The plain user's tab can't open the encrypted user's conversation or image by id (404, `no-store`). |

## Things I tried as the intruder (app stopped) that held

- **Tampering fails loudly, never as garbage.** I flipped a byte in the body, the GCM tag and the IV, changed the magic to `SSENC2`, truncated the file to 1000, 34 and 20 bytes, emptied it, and appended bytes. Every case is refused. A damaged conversation shows as "unreadable" in `conversation.list` while the others still list. A damaged image fails `image.get`. Nothing is overwritten, because every write goes through a load that fails first. The error wording is QA-2.
- **Copying between users.** Encrypted A's file into encrypted B's folder, under a new name or over B's own file, gives `decryption failed`. A's image under B's image name does the same. Encrypted into plain gives `encrypted file in a plaintext user's folder`. Plain into encrypted gives `expected an encrypted file, found plaintext`, so nobody can plant readable text in an encrypted user. The same user's own files can be swapped (QA-4).
- **Restoring an old `user.json` after `user.change-password`.** The old password opens it again, and that includes a message written after the change. This is documented in the help and in design.md. On this Mac it matters less: no Time Machine destination, no local snapshots, and FileVault is on. If Jason turns on Time Machine, every backed-up `user.json` keeps its old password working for all later files, and `user.delete` doesn't reach backups. That is worth one line in the docs when it happens, not a fix now.
- **Change the password mid-reply.** The `MOCK_SLOW` turn finishes and saves under the real key. Its session ends, and the old password is refused.
- **Chrome's disk.** This answers the open question the engineer passed to the frontend pass. The DevTools MCP's Chrome writes **no** `Sessions/` files (an automation profile), so a check there comes back falsely clean. I drove a normal, headed Chrome with a throwaway profile over CDP instead: log in as `qa-t06-enc`, open the campaign, type a draft into the composer, navigate away, close Chrome cleanly. Then I grepped the whole profile in UTF-8 and UTF-16LE:
  - The composer draft: **not on disk.**
  - Control 1, a formless `<textarea>` without `autocomplete="off"` on the same page: **found** in `Sessions/Session_*` and `Tabs_*` (UTF-16).
  - Control 2, the same textarea with `autocomplete="off"`: **not found.**
  - So the engineer's `autocomplete="off"` is what keeps drafts out of Chrome 155's session files. Every content `<input>`/`<textarea>` in `web/src` has it now. Only the numeric width and height fields lack it.
  - Otherwise the disk cache holds only the shell (`/`, `/c/<id>`, JS, CSS, favicon), never `/api`. History has `/c/<id>` with title "simple silver". `sst_session` is in `Cookies` as an encrypted (`v10`) session cookie, which dies with the server.
  - The frontend pass doesn't need to repeat this check.

## Findings

### QA-1 · major (design) · A login never expires, and the app is usually running, so a live session is the way in

**Repro** (server up, Jason logged in once from the CLI):
```
printf 'qa-enc-pw-7731\n' | ./sst auth.login --username qa-t06-enc --password -
# later, someone else at the Mac, no password, fresh environment:
env -i PATH="$PATH" HOME="$HOME" ./sst conversation.get --id c_3x7vzng2h3     # the whole campaign, decrypted
curl -s -H 'content-type: application/json' -H "cookie: sst_session=$(jq -r .token .run/cli-session.json)" -d '{}' \
  http://127.0.0.1:4747/api/conversation.list                                # same, from anywhere on the Mac
```
- Logging out in the browser (`auth.logout` from the tab) leaves the CLI session alive (`./sst auth.whoami` → `qa-t06-enc (encrypted)`), and the reverse is true too. There is no "log out everywhere" short of a password change or a restart.
- Even with no token, `kill -USR1 $(cat .run/server.pid)` opens the Node inspector on `127.0.0.1:9229`. I evaluated an expression inside the running server with it (`process.pid`, the env var count). That is every logged-in session's key, and the Venice key, for anyone at the keyboard.

**Expected:** under Jason's threat model, a person who sits down at the Mac shouldn't get the campaign just because the server was left up, which is its normal state. **Actual:** sessions live until logout or restart (`src/server/sessions.ts:33`, no expiry), and `npm run up` keeps the server running indefinitely.

**Is it a real gap?** Yes, but a bounded one. It needs the Mac unlocked and a user logged in. Nothing can protect a tab that is open on screen, and a skilled intruder at an unlocked Mac has other ways in. Still, it is the path that takes no skill at all: open Chrome or a terminal and look. It is also the case Jason described: someone at his Mac while he's away.

**Cheapest sensible answer (about 20 lines):**
- An idle timeout in `sessions.ts`. Each session gets a `lastUsed`. `get()` destroys a session that has been idle past the limit and returns null, so the client already gets `x-sst-session: invalid` / 401, which the CLI handles and the frontend's planned session-expired redirect will handle. A `setInterval(sweep, 60_000).unref()` wipes idle keys from memory even when no request comes.
- Default 30 minutes, with an env override (`SST_SESSION_IDLE_MINUTES`, 0 = never).
- Running work holds its own `forkVault`, so expiry mid-reply is already safe.
- The web app doesn't poll; it re-checks only on focus. So the timeout really fires, and the tab drops to login at the next focus.
- Add `--disable-sigusr1` to the server spawn in `scripts/up.ts:57`. Node 26 has the flag.
- Optional: `auth.logout --all`.

### QA-2 · minor · An undecryptable file is a 500 "Internal server error" on `conversation.get` / `image.get`, and a truncated one is called "plaintext"

**Repro:**
```
cp data/users/qa-t06-enc/conversations/c_3x7vzng2h3.json /tmp/x
python3 -c "import sys;p=sys.argv[1];b=bytearray(open(p,'rb').read());b[len(b)//2]^=1;open(p,'wb').write(b)" data/users/qa-t06-enc/conversations/c_3x7vzng2h3.json
./sst conversation.get --id c_3x7vzng2h3     # error: Internal server error (see .run/server.log)   (+ an ERROR stack in the log)
./sst conversation.list                      # Unreadable conversation files (1): c_3x7vzng2h3: decryption failed (wrong key or corrupted file)
head -c 20 /tmp/x > data/users/qa-t06-enc/conversations/c_3x7vzng2h3.json; ./sst conversation.list   # "...: expected an encrypted file, found plaintext"
```
The same 500 comes from `image.get` on a flipped, truncated or foreign image, and from a foreign conversation copied in.

**Expected:** a clear error that names the file as damaged or not this user's, as `conversation.list` already does. A truncated or empty encrypted file should not be described as "plaintext".

**Actual:** the get commands give a generic 500. The list says "found plaintext" for a 0- to 33-byte file, even when it starts with `SSENC1`. It fails safe (loud, nothing written, no content in the log), so minor.

**Cause:** `vault.ts:108/112/116` throw plain `Error`s, which `toErrorBody` turns into `internal`. `isEncryptedBlob` (`crypto.ts`) is false for anything shorter than the header. A `CommandError` (e.g. 500 `unreadable_file`) carrying the vault's own message would fix both. An `SSENC1` prefix that is too short should read as "damaged".

### QA-3 · minor · The audit misses the biggest plaintext copy on the Mac: Claude Code's own transcripts

**Repro:** `grep -rl Velzaroth ~/.claude/projects/-Users-jasonhorsley-code-simple-silver` → 2 files. `grep -rl comet-tavern-pw …` → 3. The folder holds 23 transcripts, 191 MB.

**Expected:** design.md's "Where plaintext can still appear" lists every place. **Actual:** the table and the T07 note (TICKETS.md:226: "agents' shells are non-interactive and keep no history") imply agents leave nothing behind. In fact Claude Code stores every command an agent ran and every output it read in `~/.claude/projects/<project>/*.jsonl`, as plain text. That includes decrypted `conversation.get` output and passwords piped to `auth.login`.

For `dev-`/`qa-` users this is harmless. It matters for T07's encrypted playthrough and for any time an agent is pointed at Jason's own user. **Fix (docs):**
- Add a row to the table.
- Correct the T07 note.
- Add a rule in AGENTS.md: agents never log in as Jason's real users.

### QA-4 · nit · Ciphertext isn't bound to its file name, so one file of a user can stand in for another

**Repro:**
```
./sst conversation.create --title second --system-prompt x                # c_zmdlvf652d
cp data/users/qa-t06-enc/conversations/c_3x7vzng2h3.json data/users/qa-t06-enc/conversations/c_zmdlvf652d.json
./sst conversation.list                                                    # c_3x7vzng2h3 listed twice
./sst conversation.update --id c_zmdlvf652d --title Renamed                # says "Updated c_3x7vzng2h3", writes into c_zmdlvf652d.json
```
Images can be swapped the same way.

**Expected vs actual:** swapping a user's own files still decrypts, and the app doesn't notice. This needs write access and stays within one user, so there is no confidentiality impact. Restoring an older copy of the same file can't be detected either; that is fine for this threat model.

**Fix:** use the magic plus the relative path (`conversations/<id>.json`) as the GCM additional data in `vault.ts`, which needs a version bump for existing files. Or, cheaper, check `conv.id === id` in `loadConversation` (`store.ts:21`).

### QA-5 · nit · A damaged or tampered `user.json` isn't handled gently

**Repro:**
- `head -c 120` of `qa-t06-enc2/user.json`: the user silently drops out of `user.list` (`users.ts:81` swallows the error), and its login is a 500 with a stack (`users.ts:44`).
- `kdf.N` set to `2^24`: login calls scrypt with `maxmem: 256*N*r` (`crypto.ts:51`), so nothing is capped. The server grew past 2 GB RSS and swapped this 16 GB Mac for minutes until I stopped it.
- A flipped `wrappedKey` byte is a clean "Wrong password". Good.

**Fix:** refuse KDF params outside a sane range (e.g. N ≤ 2^20, r ≤ 16, p ≤ 4) before deriving the key. Make an unreadable `user.json` a clear 500 or 409 ("qa-t06-enc2/user.json is damaged"). Write access is needed, so it's a nit.

## Notes for triage and the frontend pass

- After a `user.delete`, the login screen says "The server restarted, or you logged out in another tab". The engineer already asked the frontend pass to word this without blaming the user. The tab does drop to login on its next focus, and the deleted user's campaign stays on screen until then.
- A stopped `MOCK_SLOW MOCK_MARKDOWN` reply keeps `user.delete` refused for minutes ("2 requests are still using its data …"). That is correct and says why. Live, Venice drains at normal speed.
- The DevTools MCP's Chrome restarted once during my run, and the stale T05 pages vanished. No effect on the results.
- Users left for triage: `qa-t06-enc` (`qa-enc-pw-7731`), `qa-t06-enc2` (`qa-enc2-THIRD-pw`, after two password changes), `qa-t06-plain`. The throwaway delete users are gone, with no `.deleted-*` folders left. The server is stopped.
