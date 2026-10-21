import { Clock, FileWarning, Info, KeyRound, Lock, LockOpen, LogOut, UserX, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError, errorMessage } from "../../api/errors.ts";
import { api } from "../../api/client.ts";
import type { UnreadableUser, UserSummary } from "../../api/types.ts";
import { LAST_USERNAME_KEY, useSession, type LoginNotice } from "../../app/session.tsx";
import { Button } from "../../components/Button.tsx";
import { LogoMark, Wordmark } from "../../components/Logo.tsx";
import { ModeBadge } from "../../components/ModeBadge.tsx";
import { Notice } from "../../components/Notice.tsx";
import { TextField } from "../../components/TextField.tsx";
import { cx } from "../../lib/cx.ts";
import { readLocal } from "../../lib/storage.ts";

/**
 * Pick a user (user.list, with a lock on the encrypted ones), then auth.login. An encrypted user asks for its
 * password; an unencrypted (debug) user has none, so it logs in with one click. Users are created and deleted in the
 * terminal, so there is no sign-up here. The last username is remembered in this browser, since every server restart
 * means logging in again. If the list can't be had, a plain username field stands in for it.
 */
type Listing = { status: "loading" } | { status: "ready"; users: UserSummary[]; unreadable: UnreadableUser[] } | { status: "error"; error: string };

export function LoginScreen({ notice, pick }: { notice: LoginNotice | null; pick?: string | null }) {
  const { login, health } = useSession();
  const [list, setList] = useState<Listing>({ status: "loading" });
  const [chosen, setChosen] = useState<string | null>(() => (pick === undefined ? readLocal(LAST_USERNAME_KEY) : pick));
  const [typed, setTyped] = useState(() => readLocal(LAST_USERNAME_KEY) ?? "");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  /** A wrong password is said under the field; anything else at the top. */
  const [error, setError] = useState<{ field: boolean; message: string } | null>(null);
  const [capsLock, setCapsLock] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // A user created in the terminal shows up when you come back to the browser.
  const load = useCallback(async () => {
    try {
      const r = await api.call("user.list");
      setList({ status: "ready", users: r.users, unreadable: r.unreadable });
    } catch (err) {
      setList((l) => (l.status === "ready" ? l : { status: "error", error: errorMessage(err) }));
    }
  }, []);
  useEffect(() => {
    void load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  const users = list.status === "ready" ? list.users : [];
  // The chosen user, once the list says it exists (and whether it is encrypted). With only one user, that one.
  const user = users.find((u) => u.username === chosen) ?? (users.length === 1 && pick !== null ? users[0]! : null);
  const username = list.status === "error" ? typed.trim() : (user?.username ?? "");
  const needsPassword = list.status === "error" || user?.encrypted === true;

  // Choosing an encrypted user puts the caret in its password field.
  useEffect(() => {
    if (user?.encrypted) passwordRef.current?.focus();
  }, [user?.username, user?.encrypted]);

  function choose(name: string) {
    setChosen(name);
    setPassword("");
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending || username === "") return;
    setPending(true);
    setError(null);
    try {
      await login(username, needsPassword ? password : ""); // on success the app shell replaces this screen
    } catch (err) {
      setError({ field: err instanceof ApiError && err.code === "wrong_password", message: errorMessage(err) });
      setPending(false);
      requestAnimationFrame(() => passwordRef.current?.select());
    }
  }

  const caps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState("CapsLock"));
  const noUsers = list.status === "ready" && users.length === 0;

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-56 left-1/2 h-[560px] w-[860px] -translate-x-1/2 bg-[radial-gradient(closest-side,rgb(217_223_231/0.07),transparent)]"
      />
      <main className="relative w-full max-w-[24rem]">
        <div className="mb-7 flex flex-col items-center text-center">
          <LogoMark size={44} />
          <h1 className="mt-4 text-[26px] leading-tight">
            <Wordmark />
          </h1>
          <p className="mt-1.5 text-sm text-faint">A local scratch pad for Venice AI</p>
        </div>

        <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl border border-line bg-panel p-6 shadow-2xl shadow-black/50">
          {error && !error.field ? <Notice tone="error">{error.message}</Notice> : notice ? <SessionNotice notice={notice} /> : null}

          {list.status === "error" ? (
            <>
              <Notice tone="warn">Couldn't list the users ({list.error}). Type the username instead.</Notice>
              <TextField
                id="login-username"
                label="Username"
                name="username"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
            </>
          ) : (
            <UserPicker list={list} chosen={user?.username ?? null} onChoose={choose} />
          )}

          {user && !user.encrypted && (
            <p className="flex items-start gap-2 px-0.5 text-[12.5px] leading-5 text-faint">
              <LockOpen aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-300/70" strokeWidth={2.25} />
              <span>
                No password: {user.username}'s files are plain, readable JSON on disk (for debugging).
              </span>
            </p>
          )}

          {needsPassword && (
            <div>
              {/* The chosen user, for the browser's password manager (a radio isn't a username field). */}
              {user && <input type="text" name="username" value={user.username} autoComplete="username" readOnly hidden />}
              <label htmlFor="login-password" className="mb-1.5 block text-[13px] font-medium text-muted">
                {user ? `Password for ${user.username}` : "Password"}
              </label>
              <input
                id="login-password"
                ref={passwordRef}
                name="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error?.field) setError(null);
                }}
                onKeyDown={caps}
                onKeyUp={caps}
                autoComplete="current-password"
                aria-invalid={error?.field || undefined}
                aria-describedby="login-password-hint"
                className={cx(
                  "block h-10 w-full rounded-lg border bg-raised px-3 text-[15px] text-fg outline-none transition-[border-color,box-shadow]",
                  error?.field
                    ? "border-red-400/60 ring-3 ring-red-400/10 focus:border-red-400/70"
                    : "border-line-strong focus:border-focus/60 focus:ring-3 focus:ring-focus/15",
                )}
              />
              <p id="login-password-hint" role={error?.field ? "alert" : undefined} className="mt-1.5 min-h-4 text-xs">
                {error?.field ? (
                  <span className="text-red-300">{error.message} Try again.</span>
                ) : capsLock ? (
                  <span className="text-amber-300">Caps Lock is on.</span>
                ) : user ? (
                  <span className="text-faint">It unlocks the key to {user.username}'s files, and is never stored.</span>
                ) : (
                  <span className="text-faint">Leave empty for an unencrypted user.</span>
                )}
              </p>
            </div>
          )}

          {!noUsers && (
            <Button type="submit" variant="primary" className="w-full" loading={pending} disabled={username === ""}>
              {pending ? (needsPassword && password !== "" ? "Unlocking…" : "Logging in…") : user ? `Log in as ${user.username}` : list.status === "ready" ? "Choose a user" : "Log in"}
            </Button>
          )}
        </form>

        {!noUsers && (
          <p className="mt-5 text-center text-xs leading-5 text-faint">
            New user? Create one in the terminal:
            <br />
            <code className="font-mono text-[11.5px] text-muted">./sst user.create --username &lt;name&gt;</code>
          </p>
        )}
        {health && (
          <div className="mt-4 flex justify-center">
            <ModeBadge mode={health.mode} />
          </div>
        )}
      </main>
    </div>
  );
}

/** Why you are at the login screen: calm, with what happened and what to do. */
function SessionNotice({ notice }: { notice: LoginNotice }) {
  const Icon =
    notice.kind === "expired"
      ? Clock
      : notice.kind === "password-changed" || notice.kind === "password-changed-here"
        ? KeyRound
        : notice.kind === "deleted"
          ? UserX
          : notice.kind === "ended"
            ? Info
            : LogOut;
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-line-strong bg-raised px-3.5 py-3">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-silver" />
      <div className="min-w-0">
        <p className="text-[13.5px] leading-5 font-medium text-fg">{notice.title}</p>
        <p className="mt-0.5 text-[12.5px] leading-5 text-muted">{notice.body}</p>
      </div>
    </div>
  );
}

/** The users as a radio group (arrow keys move between them). Damaged ones are listed, greyed, with why. */
function UserPicker({ list, chosen, onChoose }: { list: Listing; chosen: string | null; onChoose(name: string): void }) {
  if (list.status === "loading") {
    return (
      <div aria-busy="true" className="space-y-1.5">
        {[0, 1].map((i) => (
          <div key={i} className="h-11 animate-pulse rounded-lg bg-hover/60" />
        ))}
      </div>
    );
  }
  if (list.status !== "ready") return null;
  if (list.users.length === 0 && list.unreadable.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
        <Users aria-hidden className="mx-auto size-5 text-faint" />
        <p className="mt-2 text-[14px] text-fg">No users yet</p>
        <p className="mt-1 text-[12.5px] leading-5 text-muted">Create one in the terminal, then come back here:</p>
        <code className="mt-2 inline-block rounded-md bg-raised px-2 py-1 font-mono text-[12px] text-silver">./sst user.create --username &lt;name&gt;</code>
        <p className="mt-2 text-[11.5px] leading-4 text-faint">With a password, everything it saves is encrypted on disk.</p>
      </div>
    );
  }
  return (
    <fieldset>
      <legend className="mb-1.5 block text-[13px] font-medium text-muted">Who's playing?</legend>
      <div className="-mx-1 max-h-[min(40vh,19rem)] space-y-0.5 overflow-y-auto px-1 py-0.5">
        {list.users.map((u) => {
          const on = u.username === chosen;
          return (
            <label
              key={u.username}
              className={cx(
                "flex h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 transition-colors",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus/60",
                on ? "border-line-strong bg-hover" : "border-transparent hover:bg-hover/50",
              )}
            >
              <input type="radio" name="user" value={u.username} checked={on} onChange={() => onChoose(u.username)} className="sr-only" />
              <span
                aria-hidden
                className={cx(
                  "grid size-7 shrink-0 place-items-center rounded-full text-[12.5px] font-semibold transition-colors",
                  on ? "bg-silver text-canvas" : "bg-raised text-silver ring-1 ring-line-strong",
                )}
              >
                {u.username.charAt(0).toUpperCase()}
              </span>
              <span className={cx("min-w-0 flex-1 truncate text-[14.5px]", on ? "text-fg" : "text-muted")}>{u.username}</span>
              {u.encrypted ? (
                <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted" title="Its conversations and images are encrypted on disk with its password">
                  <Lock aria-hidden className="size-3.5 text-silver" strokeWidth={2.25} /> Encrypted
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1 text-[12px] text-faint" title="No password: its files are readable JSON (for debugging)">
                  <LockOpen aria-hidden className="size-3.5 text-amber-300/70" strokeWidth={2.25} /> Unencrypted
                </span>
              )}
            </label>
          );
        })}
        {list.unreadable.map((u) => (
          <div key={u.username} className="flex items-start gap-3 rounded-lg px-3 py-2">
            <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-amber-300/[0.07] ring-1 ring-amber-300/20">
              <FileWarning className="size-3.5 text-amber-300/80" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[14.5px] text-faint">{u.username}</span>
                <span className="ml-auto shrink-0 text-[12px] text-amber-200/80">Can't log in</span>
              </div>
              <DamagedUser error={u.error} />
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * A damaged user.json, in the server's words, folded: what is wrong first ("Its user.json is damaged: it is not valid
 * JSON."), then what to do behind a disclosure, so one broken user doesn't outweigh the working ones.
 */
function DamagedUser({ error }: { error: string }) {
  const e = error.replace(/^users\/[^/]+\/user\.json: /, "");
  const text = e.startsWith("damaged") ? `Its user.json is ${e}` : e;
  const cut = text.indexOf(". ");
  if (cut < 0) return <p className="mt-0.5 text-[11.5px] leading-4 text-faint">{text}</p>;
  return (
    <details className="group mt-0.5 text-[11.5px] leading-4 text-faint">
      <summary className="cursor-pointer list-none marker:hidden">
        {text.slice(0, cut + 1)} <span className="text-muted underline decoration-line-strong underline-offset-2 group-open:hidden">What to do</span>
      </summary>
      <p className="mt-1">{text.slice(cut + 2)}</p>
    </details>
  );
}
