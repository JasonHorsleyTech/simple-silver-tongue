import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type SessionLoss } from "../api/client.ts";
import { errorMessage } from "../api/errors.ts";
import type { Health, User } from "../api/types.ts";
import { toast } from "../components/toasts.tsx";
import { clearDrafts, draftsBelongTo } from "../lib/drafts.ts";
import { idleDuration } from "../lib/format.ts";
import { navigate } from "../lib/router.tsx";
import { writeLocal } from "../lib/storage.ts";

/**
 * Who is logged in, as the server sees it. The truth is the server's httpOnly session cookie, so this only
 * mirrors auth.whoami: at boot, after login and logout, whenever the tab regains focus or comes back into view,
 * every 30 s while it is visible (so a logout from the terminal blanks an open window), and when the server's idle
 * limit would end the session (T06 triage). auth.whoami doesn't count as activity, so looking never keeps a session
 * alive. Other tabs of this browser hear about a logout here at once (BroadcastChannel).
 * Losing the session keeps the URL, so logging in again lands where you were.
 */

/** Why the login screen is showing, said calmly at its top. */
export type LoginNotice = { kind: NoticeKind; title: string; body: string };
type NoticeKind = Exclude<SessionLoss, "no-cookie"> | "other-tab" | "password-changed-here" | "logged-out-here";

export type SessionState =
  | { phase: "booting" }
  | { phase: "unreachable"; error: string }
  /** `pick`: the user to preselect on the login screen; null for none (switching user); absent for the last one. */
  | { phase: "out"; notice: LoginNotice | null; pick?: string | null }
  | { phase: "in"; user: User };

type SessionValue = {
  state: SessionState;
  /** Server status (live or mock Venice). Null until the first health check answers. */
  health: Health | null;
  /** Throws an ApiError (wrong password, no such user, ...) for the login form to show. */
  login(username: string, password: string): Promise<void>;
  /**
   * Throws an ApiError if the server can't be reached; the user stays logged in. `everywhere`: every tab and terminal
   * of this user (auth.logout --all). `switching`: land on the user picker with nobody chosen.
   */
  logout(opts?: { everywhere?: boolean; switching?: boolean }): Promise<void>;
  /** user.change-password, which logs this user out everywhere. Throws an ApiError (wrong password, ...) for the form. */
  changePassword(current: string, next: string): Promise<void>;
  /** Re-run the boot check (used by the "can't reach the server" screen). */
  retry(): void;
};

export const LAST_USERNAME_KEY = "ss.lastUsername";

/** setTimeout's longest delay (about 24.8 days); a longer idle limit is checked again then. */
const MAX_DELAY_MS = 2 ** 31 - 1;
/** How often a visible, logged-in tab looks again, so a logout elsewhere (the CLI, another browser) blanks it. */
const POLL_MS = 30_000;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const minutesText = (m: number | null) => (m === null ? "a while" : idleDuration(m));

/** Every reason the login screen can give. `user` is who was logged in, when we know. */
function noticeFor(kind: NoticeKind, user: User | null, extra: { minutes?: number | null; sessions?: number } = {}): LoginNotice {
  // After a reload the tab no longer knows who it was (whoami only says "nobody"): word it without a name then.
  const name = user?.username ?? "this user";
  const key = user?.encrypted ? " and wiped the key from its memory" : "";
  switch (kind) {
    case "expired":
      return {
        kind,
        title: `Logged out after ${minutesText(extra.minutes ?? null)} without activity`,
        body: `The server ended the session${key}. Log in again to pick up where you left off.`,
      };
    case "ended":
      return { kind, title: "Your session ended", body: "The server restarted since you logged in, and a restart logs everyone out. Log in again to carry on." };
    case "other-tab":
      return { kind, title: "Logged out in another tab", body: "Every tab of this browser shares one login. Log in again to carry on." };
    case "logged-out":
      return { kind, title: "Logged out everywhere", body: `Every session of ${name} was ended from another tab or terminal. Log in again to carry on.` };
    case "logged-out-here": {
      const n = extra.sessions ?? 1;
      const others = n > 1 ? `This browser and ${plural(n - 1, "other session")} (other browsers or terminals) were` : "This browser was its only session, and it is";
      return { kind, title: "Logged out everywhere", body: `${others} logged out, and the server ${user?.encrypted ? "wiped the key from its memory" : "forgot the login"}.` };
    }
    case "password-changed":
      return { kind, title: "Your password was changed", body: `Changing it logs ${name} out everywhere. Log in with the new password.` };
    case "password-changed-here":
      return {
        kind,
        title: "Password changed",
        body: `${name} was logged out everywhere${extra.sessions && extra.sessions > 1 ? ` (${plural(extra.sessions, "session")})` : ""}, as a password change does. Log in with your new password.`,
      };
    case "deleted":
      return { kind, title: user ? `${user.username} was deleted` : "This user was deleted", body: "Its conversations and images were removed from this computer (./ss user.delete)." };
  }
}

/** Kept after the session is gone: a timeout or a restart; the same user will log back in. Anything else drops them. */
const KEEPS_DRAFTS: ReadonlySet<NoticeKind> = new Set(["expired", "ended"]);

/** What one tab tells the others of this browser when it logs out (they share the cookie). */
type TabSignal = { out: "other-tab" | "logged-out" | "password-changed"; username: string };
const tabs: BroadcastChannel | null = typeof BroadcastChannel === "function" ? new BroadcastChannel("ss-session") : null;

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ phase: "booting" });
  const [health, setHealth] = useState<Health | null>(null);
  // When the server would end the session if nothing uses it (Date.now() ms), and its idle limit (T06 triage).
  const [dueAt, setDueAt] = useState<number | null>(null);
  const idleMinutes = useRef<number | null>(null);
  const noteIdle = useCallback((u: User) => {
    idleMinutes.current = u.idle?.minutes ?? null;
    const left = u.idle?.secondsLeft;
    setDueAt(left === null || left === undefined ? null : Date.now() + left * 1000);
  }, []);

  /** Logged in → out, saying why. Only from "in" (or the boot check): a second reason never replaces the first. */
  const dropTo = useCallback((kind: NoticeKind) => {
    setState((s) => {
      if (s.phase !== "in" && s.phase !== "booting") return s;
      if (!KEEPS_DRAFTS.has(kind)) clearDrafts();
      return { phase: "out", notice: noticeFor(kind, s.phase === "in" ? s.user : null, { minutes: idleMinutes.current }) };
    });
    setDueAt(null);
  }, []);

  // Any command can learn that our cookie is dead, and why (x-ss-session, or the 401's code).
  // No cookie at all, while we thought we were in: another tab of this browser logged out (they share it).
  useEffect(() => api.onSessionLost((why) => dropTo(why === "no-cookie" ? "other-tab" : why)), [dropTo]);

  // Another tab of this browser logged out: the cookie we share is gone, so don't leave this one on screen.
  useEffect(() => {
    if (!tabs) return;
    const onMessage = (e: MessageEvent<TabSignal>) => dropTo(e.data.out);
    tabs.addEventListener("message", onMessage);
    return () => tabs.removeEventListener("message", onMessage);
  }, [dropTo]);

  const boot = useCallback(async () => {
    setState({ phase: "booting" });
    try {
      // health first: it says the server's idle limit, so a cookie that expired while this tab was closed is
      // explained in minutes ("after 60 minutes without activity"), not "after a while".
      const h = await api.call("health");
      setHealth(h);
      if (idleMinutes.current === null && h.sessionIdleMinutes > 0) {
        idleMinutes.current = h.sessionIdleMinutes;
        // health's own answer already carried the stale cookie's "expired", before its body said the limit.
        setState((s) => (s.phase === "out" && s.notice?.kind === "expired" ? { ...s, notice: noticeFor("expired", null, { minutes: h.sessionIdleMinutes }) } : s));
      }
      const who = await api.call("auth.whoami");
      if (who.username !== null) {
        noteIdle(who);
        draftsBelongTo(who.username);
      }
      // If the session-lost listener already moved us to "out" (a stale cookie), keep its notice.
      setState((s) => (who.username !== null ? { phase: "in", user: who } : s.phase === "out" ? s : { phase: "out", notice: null }));
    } catch (err) {
      setState({ phase: "unreachable", error: errorMessage(err) });
    }
  }, [noteIdle]);

  useEffect(() => {
    void boot();
  }, [boot]);

  // While logged in, look again on focus, when the tab comes into view, and every 30 s while it is visible.
  // Cheap (two local calls), throttled, and never while hidden.
  const me = state.phase === "in" ? state.user.username : null;
  useEffect(() => {
    if (me === null) return;
    let last = Date.now();
    const check = async () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 2000) return;
      last = Date.now();
      try {
        const [who, h] = await Promise.all([api.call("auth.whoami"), api.call("health")]);
        toast.clear("connection");
        setHealth(h);
        if (who.username === null) {
          dropTo("other-tab"); // a cookie the server knows nothing of says so in its header first (onSessionLost)
        } else if (who.username !== me) {
          navigate("/");
          noteIdle(who);
          draftsBelongTo(who.username);
          setState({ phase: "in", user: who });
          toast.info(`You are now logged in as ${who.username} (from another tab).`);
        } else {
          noteIdle(who);
        }
      } catch (err) {
        toast.error(errorMessage(err), { key: "connection" });
      }
    };
    const poll = setInterval(check, POLL_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(poll);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [me, noteIdle, dropTo]);

  // The server ends a session nobody has used for its idle limit, and nothing tells an open tab. So look again when
  // it would end (auth.whoami doesn't count as use, so this never keeps it alive): the tab then drops to the login
  // screen instead of leaving the campaign on screen after its key is gone. Activity meanwhile moves the time on.
  useEffect(() => {
    if (me === null || dueAt === null) return;
    const t = setTimeout(async () => {
      try {
        const who = await api.call("auth.whoami"); // an expired cookie moves us out through onSessionLost
        if (who.username === null) dropTo("other-tab");
        else if (who.username === me) noteIdle(who);
      } catch {
        // can't reach the server: the focus check says so when the tab is next used
      }
    }, Math.min(Math.max(dueAt - Date.now(), 0) + 1500, MAX_DELAY_MS));
    return () => clearTimeout(t);
  }, [me, dueAt, noteIdle, dropTo]);

  const login = useCallback(
    async (username: string, password: string) => {
      const user = await api.call("auth.login", { username, password });
      writeLocal(LAST_USERNAME_KEY, user.username);
      toast.clear("connection");
      noteIdle(user);
      draftsBelongTo(user.username);
      setState({ phase: "in", user });
    },
    [noteIdle],
  );

  /** We left on purpose: forget this user's drafts, tell the other tabs, and show the login screen. */
  const leave = useCallback((user: User | null, signal: TabSignal["out"], next: Extract<SessionState, { phase: "out" }>) => {
    clearDrafts();
    if (user) tabs?.postMessage({ out: signal, username: user.username } satisfies TabSignal);
    navigate("/"); // the next user shouldn't land on this user's conversation URL
    setDueAt(null);
    setState(next);
  }, []);

  const current = state.phase === "in" ? state.user : null;

  const logout = useCallback(
    async (opts: { everywhere?: boolean; switching?: boolean } = {}) => {
      const r = await api.call("auth.logout", opts.everywhere ? { all: true } : {});
      if (opts.everywhere) leave(current, "logged-out", { phase: "out", notice: noticeFor("logged-out-here", current, { sessions: r.sessions }) });
      else leave(current, "other-tab", { phase: "out", notice: null, pick: opts.switching ? null : undefined });
    },
    [current, leave],
  );

  const changePassword = useCallback(
    async (password: string, newPassword: string) => {
      if (!current) return;
      const r = await api.call("user.change-password", { username: current.username, password, newPassword });
      leave(current, "password-changed", { phase: "out", notice: noticeFor("password-changed-here", current, { sessions: r.loggedOut }), pick: current.username });
    },
    [current, leave],
  );

  const value = useMemo<SessionValue>(
    () => ({ state, health, login, logout, changePassword, retry: () => void boot() }),
    [state, health, login, logout, changePassword, boot],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession must be used inside <SessionProvider>");
  return v;
}

/** The logged-in user. Only for views inside the app shell, which renders only when logged in. */
export function useUser(): User {
  const { state } = useSession();
  if (state.phase !== "in") throw new Error("useUser must be used inside the logged-in app shell");
  return state.user;
}
