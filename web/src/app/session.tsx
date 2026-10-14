import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client.ts";
import { errorMessage } from "../api/errors.ts";
import type { Health, User } from "../api/types.ts";
import { toast } from "../components/toasts.tsx";
import { navigate } from "../lib/router.tsx";
import { writeLocal } from "../lib/storage.ts";

/**
 * Who is logged in, as the server sees it. The truth is the server's httpOnly session cookie, so this only
 * mirrors auth.whoami: at boot, after login and logout, and again whenever the tab regains focus (the server
 * may have restarted, which logs everyone out, or another tab may have logged out or switched user).
 * Losing the session keeps the URL, so logging in again lands where you were.
 */

export type SessionState =
  | { phase: "booting" }
  | { phase: "unreachable"; error: string }
  | { phase: "out"; notice: string | null }
  | { phase: "in"; user: User };

type SessionValue = {
  state: SessionState;
  /** Server status (live or mock Venice). Null until the first health check answers. */
  health: Health | null;
  /** Throws an ApiError (wrong password, no such user, ...) for the login form to show. */
  login(username: string, password: string): Promise<void>;
  /** Throws an ApiError if the server can't be reached; the user stays logged in. */
  logout(): Promise<void>;
  /** Re-run the boot check (used by the "can't reach the server" screen). */
  retry(): void;
};

export const LAST_USERNAME_KEY = "ss.lastUsername";

const ENDED = "Your session ended. The server restarted, or you logged out in another tab. Log in again to carry on.";

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ phase: "booting" });
  const [health, setHealth] = useState<Health | null>(null);

  // Any command can learn that our cookie is dead (x-ss-session: invalid, or a 401 unauthenticated).
  useEffect(
    () =>
      api.onSessionLost(() =>
        setState((s) => (s.phase === "in" || s.phase === "booting" ? { phase: "out", notice: ENDED } : s)),
      ),
    [],
  );

  const boot = useCallback(async () => {
    setState({ phase: "booting" });
    try {
      const [who, h] = await Promise.all([api.call("auth.whoami"), api.call("health")]);
      setHealth(h);
      // If the session-lost listener already moved us to "out" (a stale cookie), keep its notice.
      setState((s) => (who.username !== null ? { phase: "in", user: who } : s.phase === "out" ? s : { phase: "out", notice: null }));
    } catch (err) {
      setState({ phase: "unreachable", error: errorMessage(err) });
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  // While logged in, re-check on focus. Cheap (two local calls), throttled, and only when visible.
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
          setState((s) => (s.phase === "in" ? { phase: "out", notice: ENDED } : s));
        } else if (who.username !== me) {
          navigate("/");
          setState({ phase: "in", user: who });
          toast.info(`You are now logged in as ${who.username} (from another tab).`);
        }
      } catch (err) {
        toast.error(errorMessage(err), { key: "connection" });
      }
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [me]);

  const login = useCallback(async (username: string, password: string) => {
    const user = await api.call("auth.login", { username, password });
    writeLocal(LAST_USERNAME_KEY, user.username);
    toast.clear("connection");
    setState({ phase: "in", user });
  }, []);

  const logout = useCallback(async () => {
    await api.call("auth.logout");
    navigate("/"); // the next user shouldn't land on this user's conversation URL
    setState({ phase: "out", notice: null });
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ state, health, login, logout, retry: () => void boot() }),
    [state, health, login, logout, boot],
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
