# T06 frontend: multi-user encryption in the browser (CP5)

No design concern. One backend adjustment made the browser (and the CLI) honest about *why* a session ended. It is below and in design.md.

## What I built

**Login: a user picker** (`features/auth/LoginScreen.tsx`)
- "Who's playing?" lists the users from `user.list`. Each row shows a lock and "Encrypted", or an amber open lock and "Unencrypted". The last user is preselected. It is a real radio group, so Tab, Space and the arrow keys work.
- Picking an encrypted user puts the caret in "Password for dev-x". A wrong password is said under the field ("Wrong password for dev-x. Try again."), the field turns red, and the text is selected for retyping. Caps Lock is noticed.
- An unencrypted user has no password field: one click logs it in, and a line says its files are readable JSON on disk.
- A user whose `user.json` is damaged is listed greyed: "Can't log in", the first sentence of the server's reason, and "What to do" behind a disclosure.
- No users: the `./ss user.create` command, large. If `user.list` fails, a plain username field stands in.

**Why you are at the login screen.** A calm notice with an icon, a title and one or two sentences:
- **Idle timeout:** "Logged out after 60 minutes without activity. The server ended the session and wiped the key from its memory. Log in again to pick up where you left off." The URL is kept, and so is the unsent draft. This is right even after a reload: `health` now reports the limit.
- **Restart:** "The server restarted since you logged in, and a restart logs everyone out."
- **Logged out everywhere elsewhere:** "Every session of dev-x was ended from another tab or terminal."
- **Your own Log out everywhere:** "This browser and 3 other sessions (other browsers or terminals) were logged out, and the server wiped the key from its memory."
- **Password changed, here or elsewhere.**
- **User deleted:** "dev-x was deleted".
- **Another tab of this browser logged out.**
- None of them blames the user (T06 engineer and QA asked for that).

**The user menu** (`features/shell/UserMenu.tsx`): the user card at the foot of the sidebar opens upward with:
- The idle limit in words.
- **Switch user:** logs out; the picker opens with nobody chosen.
- **Change password…:** encrypted users only.
- **Log out:** just this browser.
- **Log out everywhere:** every tab and terminal of this user, "before you step away".

**Change password** (`features/shell/ChangePasswordDialog.tsx`)
- Current, new, and new again, with a mismatch hint.
- A wrong current password is said under its field ("Wrong password for dev-x. Nothing was changed.").
- It says honestly what changes and what doesn't: only `user.json` changes, and an older backup of it still opens with the old password.
- It calls the same `user.change-password` as the CLI. That logs out everywhere, so the login screen then says "Password changed", with the user preselected.

**Logging out reaches every window**
- Other tabs of the same browser drop at once (a `BroadcastChannel`; they share the cookie).
- Any visible tab looks again every 30 s (whoami and health, which never count as activity), so `./ss auth.logout --all` in a terminal blanks an open window within half a minute. Before, the window kept the campaign on screen until someone touched it.

**Drafts** (`lib/drafts.ts`, memory only)
- Kept across an idle logout or a restart for the same user: log back in and the draft is where it was.
- Dropped by any deliberate logout, a password change, or another user logging in. This is the triage's "memory only, same user, dropped on logout".

**Damaged files** (`features/chat/DamagedFile.tsx`, `ImageCard.tsx`, `ConversationList.tsx`)
- An unreadable conversation is a "Damaged conversation" row in the sidebar. It opens a page with:
  - what is wrong, in the server's words;
  - "Nothing was changed", and that the other conversations aren't affected;
  - what to do: put back a backup, or move the file aside, with its path and a copy button.
- There is no delete for it: every write loads first, and a damaged encrypted file may still be rescued by hand.
- An image whose file is damaged now says so in its frame ("This image's file is damaged, so it can't be shown. Can't be decrypted with this user's key… put back a good copy of images/img_….bin from a backup, or paint it again."). Before, it said only "couldn't be loaded". The `<img>` can't read an error, so `api.binaryError` asks the same GET why.

**Fixes found on the way**
- **Disabled primary buttons looked clickable.** `bg-silver` beat the inactive `bg-hover` by stylesheet order. `Button` now replaces the colors. This affects every disabled primary button, as the component's comment always intended.
- **`Dialog`** takes a `width` (an added width class lost the same way) and focuses a `data-autofocus` field. React's `autoFocus` fires before `showModal()` and never landed.

## Commands added or changed (the CLI gets all of it)

- **Sessions say why they ended.** `sessions.ts` remembers the last 200 ended tokens with an `EndReason`:
  - `expired`, as before;
  - `logged-out` (`auth.logout --all`), `password-changed` and `deleted` (new).
  - The `x-ss-session` header carries the reason. `invalid` is left for unknown tokens, which in practice means a restart.
  - A command that needs the login gets a 401 `session_ended` that says it in words.
  - **Why:** the browser could only say "the server restarted, or you logged out in another tab" for all of these. That was wrong after a delete (QA's note) and vague after a password change.
- **The CLI** prints the reason too: "(Saved CLI session for dev-t06-enc ended: this user was logged out everywhere (auth.logout --all, or Log out everywhere in the browser).)". It no longer says "Log in again" for a deleted user.
- **`health`** adds `sessionIdleMinutes`.
- **The browser now calls `user.change-password`.** This was the orchestrator's request; the engineer had proposed keeping it terminal-only. `user.create` and `user.delete` stay in the terminal, and the UI points to `./ss user.create`.

## Verified in Chrome (DevTools MCP, `npm run up:mock`)

I used a scratch data dir (`SS_DATA_DIR`), so the picker only ever listed my `dev-t06-*` users, never Jason's. The users were `dev-t06-enc`, `dev-t06-plain`, `dev-t06-alt` and `dev-t06-broken` (damaged `user.json`).

- **Plain and encrypted side by side.** Two isolated contexts:
  - `dev-t06-enc` logged in with its password and saw its 3 conversations.
  - `dev-t06-plain` had no password field and logged in with one click, seeing its own 2.
- **Wrong password.** It was refused in place, as above. Done by keyboard only: Tab, Space, type, Enter. The old password was also refused after the change.
- **Logout everywhere, browser → CLI.** `dev-t06-enc` was logged in in 2 tabs of one context, another context, and 2 CLI session files.
  - "Log out everywhere" reported 4 other sessions.
  - The same-context tab dropped at once. The other context dropped by itself 15 s later, with "Logged out everywhere".
  - Terminal 1: `error: dev-t06-enc was logged out everywhere (…)` + `Log in again: …`. Terminal 2: the dim reason line, and its token was dropped.
- **Logout everywhere, CLI → browser.** `./ss auth.logout --all` was run while an untouched window was visible. It blanked itself 23 s later.
- **Password change in the browser:**
  - The wrong current password was refused ("Nothing was changed").
  - The real change led to "Password changed (2 sessions)" with the user preselected.
  - The CLI session said "The password for dev-t06-enc was changed…".
  - The old password was refused and the new one worked.
- **Switch user.** The plain user's menu had no "Change password". Switch user opened the picker with nobody chosen, and I logged in as `dev-t06-alt`.
- **Deleted user.** `./ss user.delete --username dev-t06-alt` was run while its tab was open. The tab dropped 28 s later with "dev-t06-alt was deleted", and the picker no longer listed it.
- **Idle expiry.** I used `SS_SESSION_IDLE_MINUTES=0.25` (15 s).
  - Logged in, typed a draft, touched nothing: the tab dropped at 16.4 s with "Logged out after 15 seconds without activity…", the user preselected and the caret in the password field.
  - After logging in again: the same URL, and the draft was restored.
  - After a deliberate Log out: the draft was gone.
  - A reload after expiry still says "15 seconds", not "a while".
  - The restart showed "Your session ended / The server restarted…".
- **Damaged files.** I flipped a byte in the middle of `dev-t06-enc`'s "Smugglers of Mirefen" file and in a mock-painted image.
  - The sidebar shows a "Damaged conversation" row, and its page explains the problem.
  - The image card says its file is damaged, and why.
  - The other conversations work.
- **Narrow (390 px).** The picker fits, and the drawer's user menu opens upward with room.
- **The engineer's `autocomplete="off"` check.** Typing three lines with Shift+Enter in the composer grew it from 42 to 90 px. Spellcheck is on. Nothing changed for the user. QA already answered the "draft on disk" question with a normal Chrome profile (design.md, browser row, now updated).
- **Console:** only the expected 401 (wrong password) and 500s (the damaged files). **Network:** only `POST /api/<command>` and `GET /api/image.get`.

Screenshots:
- `reports/screens/T06-login-picker-wrong-password.png`: picker, locks, damaged user, wrong-password state.
- `reports/screens/T06-user-menu.png`: the menu over a campaign with an image brain.
- `reports/screens/T06-idle-expired.png`: the timeout notice.
- `reports/screens/T06-damaged-conversation.png`: the damaged-file page and its sidebar row.

## Tests

- `test/sessions.test.ts`: a new test. A browser client and two terminals hear each reason (logged out everywhere from the CLI, a password change from the browser, a delete), in the header, in the 401 and in the CLI's text. The expired test now expects one session-lost signal per response, not two.
- `test/damaged.test.ts`: `binaryError` returns `unreadable_file` for a damaged image.
- `npm test`: **131 pass**. `npm run typecheck`: clean (server, CLI, tests, web). The web build succeeds.

## Known UI gaps

- A visible tab asks whoami + health every 30 s, so `.run/server.log` gains 2 lines per 30 s per open window. It's harmless, but noisy for anyone reading the log. Noted for T07.
- A damaged conversation can't be removed from the app (by design, see above). The page says how to set it aside.
- With a notice, four users and a damaged one, the login card's footer falls below a laptop fold. The Log in button stays visible.
- The damaged-file page shows the path as `data/users/<u>/…`. That is right for Jason's setup, but not when `SS_DATA_DIR` points elsewhere (tests only).
- Session notices name the user when the tab knew it. After a reload they say "this user".

## Cleanup

My users lived in a scratch data dir outside the repo, and I removed it afterwards. `data/` was never touched. The server is stopped (`npm run down`).
