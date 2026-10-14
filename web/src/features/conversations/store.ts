import { useSyncExternalStore } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import type { ConversationSummary, UnreadableConversation } from "../../api/types.ts";

/**
 * The sidebar's copy of conversation.list. Anything that changes the list (create, rename, a reply that
 * bumps updatedAt, delete) calls refreshConversations(); the sidebar re-renders from here. It lives in memory
 * only and is dropped on logout (nothing about a user's conversations is stored in the browser).
 */
export type ListState = {
  status: "idle" | "loading" | "ready" | "error";
  conversations: ConversationSummary[];
  unreadable: UnreadableConversation[];
  error: string | null;
};

const EMPTY: ListState = { status: "idle", conversations: [], unreadable: [], error: null };
let state: ListState = EMPTY;
let inflight: Promise<void> | null = null;
let again = false;
const listeners = new Set<() => void>();

function set(next: Partial<ListState>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

/** Fetch the list. Calls made while one is running coalesce into a single follow-up fetch. */
export function refreshConversations(): Promise<void> {
  if (inflight) {
    again = true;
    return inflight;
  }
  if (state.status === "idle") set({ status: "loading" });
  inflight = (async () => {
    try {
      do {
        again = false;
        const r = await api.call("conversation.list");
        set({ status: "ready", conversations: r.conversations, unreadable: r.unreadable, error: null });
      } while (again);
    } catch (err) {
      set({ status: state.status === "ready" ? "ready" : "error", error: errorMessage(err) });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** After a logout or a user switch: forget the previous user's list. */
export function resetConversations() {
  state = EMPTY;
  listeners.forEach((fn) => fn());
}

/** Patch one row locally (e.g. a new title) until the next refresh arrives. */
export function patchConversation(id: string, patch: Partial<ConversationSummary>) {
  set({ conversations: state.conversations.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export function useConversations(): ListState {
  return useSyncExternalStore(subscribe, () => state);
}
