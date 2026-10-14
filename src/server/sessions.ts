import { newToken, nowIso } from "../lib/ids.ts";
import { closeVault, type Vault } from "../storage/vault.ts";

/**
 * Sessions live only in server memory, so a restart logs everyone out and the keys are gone with it.
 * The session's vault is the master copy. Requests never use it directly: the HTTP adapter gives each
 * request its own forkVault() copy, so destroying a session can't wipe a key that running work holds.
 */
export type Session = {
  token: string;
  username: string;
  encrypted: boolean;
  vault: Vault;
  createdAt: string;
};

export type SessionStore = {
  create(username: string, encrypted: boolean, vault: Vault): Session;
  get(token: string | undefined | null): Session | null;
  destroy(token: string): boolean;
  destroyUser(username: string): number;
};

export function createSessionStore(): SessionStore {
  const sessions = new Map<string, Session>();
  const wipe = (s: Session) => closeVault(s.vault);
  return {
    create(username, encrypted, vault) {
      const s: Session = { token: newToken(), username, encrypted, vault, createdAt: nowIso() };
      sessions.set(s.token, s);
      return s;
    },
    get(token) {
      return (token && sessions.get(token)) || null;
    },
    destroy(token) {
      const s = sessions.get(token);
      if (!s) return false;
      sessions.delete(token);
      wipe(s);
      return true;
    },
    destroyUser(username) {
      let n = 0;
      for (const s of sessions.values()) {
        if (s.username === username) {
          sessions.delete(s.token);
          wipe(s);
          n++;
        }
      }
      return n;
    },
  };
}
