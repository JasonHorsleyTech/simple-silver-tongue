import { DEFAULT_SESSION_IDLE_MINUTES } from "../config.ts";
import { newToken, nowIso } from "../lib/ids.ts";
import { CommandError, sessionEnded, sessionExpired, USER_DELETED } from "../lib/errors.ts";
import { closeVault, type Vault } from "../storage/vault.ts";

/**
 * Sessions live only in server memory, so a restart logs everyone out and the keys are gone with it.
 * The session's vault is the master copy. Requests never use it directly: the HTTP adapter gives each
 * request its own forkVault() copy, so destroying a session can't wipe a key that running work holds.
 *
 * Idle timeout (T06 triage, QA-1): `npm run up` runs for days, so a session that never ended let anyone at the Mac
 * read a campaign through the open tab or the CLI's saved token. A session nobody has used for `idleMinutes` ends:
 * the next lookup ends it, and a sweep ends it anyway when no request comes, so its key doesn't sit in memory.
 * Work already running holds its own fork and finishes. "Used" means a command that needs the login (the adapter
 * calls touch); auth.whoami, health and help don't count, so a client that only looks never keeps a session alive.
 */
export type Session = {
  token: string;
  username: string;
  encrypted: boolean;
  vault: Vault;
  createdAt: string;
  /** Date.now() when a command last used this login. */
  lastUsed: number;
};

/**
 * Why a session a client may still hold is over (T06 frontend). Each is also the `x-ss-session` header a request with
 * that token gets, so a tab or a terminal can say what happened instead of guessing. "invalid" (not here) is a token
 * the server never knew or no longer remembers: in practice, one from before a restart.
 */
export type EndReason = "expired" | "logged-out" | "password-changed" | "deleted";

/** What a token is: a live session, one that ended for a reason we remember, or nothing we know. */
export type Lookup = { session: Session } | { ended: EndReason; username: string } | null;

export type SessionStore = {
  /** Minutes without use before a session ends. 0 = never. */
  readonly idleMinutes: number;
  create(username: string, encrypted: boolean, vault: Vault): Session;
  /** A session idle past the limit ends here (its key wiped) and reads as expired. */
  lookup(token: string | undefined | null): Lookup;
  get(token: string | undefined | null): Session | null;
  /** A command used this login: its idle clock starts again. */
  touch(session: Session): void;
  /** Seconds before this session ends if nothing uses it; null when sessions never time out. */
  secondsLeft(session: Session): number | null;
  /** End every session idle past the limit. Runs by itself about every minute; returns how many ended. */
  sweep(): number;
  destroy(token: string): boolean;
  /** End every session of a user (logout --all, a password change, a delete), remembering why for their clients. */
  destroyUser(username: string, why: Exclude<EndReason, "expired">): number;
  /** Stop the sweep timer. */
  close(): void;
};

export type SessionOptions = {
  idleMinutes?: number;
  /** The clock, for tests. */
  now?: () => number;
};

/** Ended tokens remembered (token → who and why), so a tab left open overnight hears "expired", not "restarted". */
const MAX_ENDED = 200;

export function createSessionStore(opts: SessionOptions = {}): SessionStore {
  const idleMinutes = opts.idleMinutes ?? DEFAULT_SESSION_IDLE_MINUTES;
  const idleMs = idleMinutes * 60_000;
  const now = opts.now ?? Date.now;
  const sessions = new Map<string, Session>();
  const ended = new Map<string, { username: string; why: EndReason }>();

  const wipe = (s: Session) => closeVault(s.vault);
  const isIdle = (s: Session) => idleMs > 0 && now() - s.lastUsed >= idleMs;
  const end = (s: Session, why: EndReason) => {
    sessions.delete(s.token);
    wipe(s);
    ended.delete(s.token);
    ended.set(s.token, { username: s.username, why });
    if (ended.size > MAX_ENDED) ended.delete(ended.keys().next().value!);
  };
  const expire = (s: Session) => end(s, "expired");

  const lookup = (token: string | undefined | null): Lookup => {
    if (!token) return null;
    const s = sessions.get(token);
    if (s && !isIdle(s)) return { session: s };
    if (s) expire(s);
    const was = ended.get(token);
    return was === undefined ? null : { ended: was.why, username: was.username };
  };

  const sweep = () => {
    let n = 0;
    for (const s of [...sessions.values()]) {
      if (isIdle(s)) {
        expire(s);
        n++;
      }
    }
    return n;
  };

  // Fine-grained enough for any limit (a 60-minute one ends within a minute of it), and never keeps the process up.
  const timer = idleMs > 0 ? setInterval(sweep, Math.min(60_000, Math.max(1_000, idleMs / 4))) : null;
  timer?.unref();

  return {
    idleMinutes,
    create(username, encrypted, vault) {
      const s: Session = { token: newToken(), username, encrypted, vault, createdAt: nowIso(), lastUsed: now() };
      sessions.set(s.token, s);
      return s;
    },
    lookup,
    get(token) {
      const r = lookup(token);
      return r && "session" in r ? r.session : null;
    },
    touch(session) {
      if (sessions.get(session.token) === session) session.lastUsed = now();
    },
    secondsLeft(session) {
      return idleMs > 0 ? Math.max(0, Math.ceil((session.lastUsed + idleMs - now()) / 1000)) : null;
    },
    sweep,
    destroy(token) {
      const s = sessions.get(token);
      if (!s) return false;
      sessions.delete(token);
      wipe(s);
      return true;
    },
    destroyUser(username, why) {
      // The newest reason is the better explanation for that user's older tokens too ("deleted" beats "expired").
      for (const was of ended.values()) if (was.username === username) was.why = why;
      let n = 0;
      for (const s of [...sessions.values()]) {
        if (s.username === username) {
          end(s, why);
          n++;
        }
      }
      return n;
    },
    close() {
      if (timer) clearInterval(timer);
    },
  };
}

/** The 401 a command that needs the login gets for a token that ended (rather than a bare "Not logged in"). */
export function endedError(why: EndReason, username: string, idleMinutes: number): CommandError {
  switch (why) {
    case "expired":
      return sessionExpired(idleMinutes);
    case "deleted":
      return sessionEnded(USER_DELETED);
    case "password-changed":
      return sessionEnded(`The password for ${username} was changed, which logs it out everywhere. Log in again with the new password.`);
    case "logged-out":
      return sessionEnded(`${username} was logged out everywhere (Log out everywhere in the browser, or auth.logout --all).`);
  }
}
