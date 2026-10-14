/**
 * Unsent composer text, per conversation, kept while you move between conversations. Memory only, never browser
 * storage: for an encrypted user a draft must not land on disk (T06 triage).
 *
 * It belongs to one user. It survives an idle logout or a server restart, so logging back in as the same user finds
 * the draft where it was (the URL is kept too). Any deliberate logout (this tab, everywhere, a password change) drops
 * it, and so does someone else logging in (session.tsx).
 */
export const drafts = new Map<string, string>();
let owner: string | null = null;

/** Someone logged in: keep the drafts only if they are this user's own. */
export function draftsBelongTo(username: string) {
  if (owner !== username) drafts.clear();
  owner = username;
}

export function clearDrafts() {
  drafts.clear();
  owner = null;
}
