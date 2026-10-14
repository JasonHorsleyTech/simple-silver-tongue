import { DEFAULT_SESSION_IDLE_MINUTES } from "../config.ts";
import { newToken, nowIso } from "../lib/ids.ts";
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

/** What a token is: a live session, one that timed out (remembered so clients can say so), or nothing we know. */
export type Lookup = { session: Session } | { expired: string } | null;

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
  destroyUser(username: string): number;
  /** Stop the sweep timer. */
  close(): void;
};

export type SessionOptions = {
  idleMinutes?: number;
  /** The clock, for tests. */
  now?: () => number;
};

/** Timed-out tokens remembered (token → username), so a tab left open overnight hears "expired", not "restarted". */
const MAX_EXPIRED = 200;

export function createSessionStore(opts: SessionOptions = {}): SessionStore {
  const idleMinutes = opts.idleMinutes ?? DEFAULT_SESSION_IDLE_MINUTES;
  const idleMs = idleMinutes * 60_000;
  const now = opts.now ?? Date.now;
  const sessions = new Map<string, Session>();
  const expired = new Map<string, string>();

  const wipe = (s: Session) => closeVault(s.vault);
  const isIdle = (s: Session) => idleMs > 0 && now() - s.lastUsed >= idleMs;
  const expire = (s: Session) => {
    sessions.delete(s.token);
    wipe(s);
    expired.set(s.token, s.username);
    if (expired.size > MAX_EXPIRED) expired.delete(expired.keys().next().value!);
  };

  const lookup = (token: string | undefined | null): Lookup => {
    if (!token) return null;
    const s = sessions.get(token);
    if (s && !isIdle(s)) return { session: s };
    if (s) expire(s);
    const who = expired.get(token);
    return who === undefined ? null : { expired: who };
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
    destroyUser(username) {
      let n = 0;
      for (const s of [...sessions.values()]) {
        if (s.username === username) {
          sessions.delete(s.token);
          wipe(s);
          n++;
        }
      }
      // A password change or a delete is the better explanation for that user's old tokens than "expired".
      for (const [token, who] of [...expired]) if (who === username) expired.delete(token);
      return n;
    },
    close() {
      if (timer) clearInterval(timer);
    },
  };
}
