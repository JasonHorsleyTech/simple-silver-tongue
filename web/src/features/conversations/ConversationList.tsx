import { FileWarning, MessagesSquare, Plus, RotateCw } from "lucide-react";
import { useEffect, useLayoutEffect } from "react";
import { Button } from "../../components/Button.tsx";
import { cx } from "../../lib/cx.ts";
import { relativeTime } from "../../lib/format.ts";
import { Link, matchPath, navigate, usePath } from "../../lib/router.tsx";
import { refreshConversations, resetConversations, useConversations } from "./store.ts";

/**
 * The sidebar: "New conversation", then every conversation (newest first) linking to /c/<id>. Files the
 * server can't read are listed greyed out with the reason (T02 QA-4) rather than silently missing.
 * Refreshes when the user changes and whenever the tab regains focus (the CLI may have changed things).
 */
let listOwner: string | null = null;

export function ConversationList({ username }: { username: string }) {
  const list = useConversations();
  const path = usePath();
  const activeId = matchPath("/c/:id", path)?.id ?? null;

  // Before paint, so another user's titles never flash up after a switch. (Two lists can be mounted at
  // once, the sidebar and the narrow-screen drawer, so the reset is keyed to the user, not to unmounting.)
  useLayoutEffect(() => {
    if (listOwner !== username) {
      listOwner = username;
      resetConversations();
    }
    void refreshConversations();
  }, [username]);

  useEffect(() => {
    const onFocus = () => document.visibilityState === "visible" && void refreshConversations();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return (
    <section>
      <Button variant="secondary" size="sm" className="mb-4 w-full justify-start" onClick={() => navigate("/")}>
        <Plus aria-hidden className="size-4" />
        New conversation
      </Button>

      <h2 className="px-2 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">Conversations</h2>

      {list.status === "loading" || list.status === "idle" ? (
        <ul aria-busy="true" className="space-y-1 px-1">
          {[0.7, 0.5, 0.62].map((w) => (
            <li key={w} className="h-8 rounded-md px-2 py-2">
              <div className="h-3.5 animate-pulse rounded bg-hover" style={{ width: `${w * 100}%` }} />
            </li>
          ))}
        </ul>
      ) : list.status === "error" ? (
        <div className="rounded-lg border border-red-400/25 bg-red-400/[0.06] px-3 py-3 text-[13px] text-red-100">
          <p>Couldn't load your conversations. {list.error}</p>
          <Button variant="ghost" size="sm" className="mt-2 -ml-1" onClick={() => void refreshConversations()}>
            <RotateCw aria-hidden className="size-3.5" /> Try again
          </Button>
        </div>
      ) : list.conversations.length === 0 && list.unreadable.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-3 py-7 text-center">
          <MessagesSquare aria-hidden className="mx-auto size-5 text-faint" />
          <p className="mt-2 text-[13px] text-muted">No conversations yet</p>
        </div>
      ) : (
        <ul className="space-y-px">
          {list.conversations.map((c) => {
            const active = c.id === activeId;
            return (
              <li key={c.id}>
                <Link
                  to={`/c/${c.id}`}
                  aria-current={active ? "page" : undefined}
                  title={c.title}
                  className={cx(
                    "group flex h-8 items-center gap-2 rounded-md px-2 text-[13.5px] transition-colors",
                    active ? "bg-hover text-fg" : "text-muted hover:bg-hover/60 hover:text-fg",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className={cx("shrink-0 text-[11px] tabular-nums", active ? "text-muted" : "text-faint")}>
                    {relativeTime(c.updatedAt)}
                  </span>
                </Link>
              </li>
            );
          })}
          {list.unreadable.map((u) => (
            <li key={u.id} title={`${u.id}: ${u.error}`} className="flex cursor-not-allowed gap-2 rounded-md px-2 py-1.5 opacity-70">
              <FileWarning aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-300/80" />
              <div className="min-w-0">
                <div className="truncate font-mono text-[12px] text-faint">{u.id}</div>
                <div className="text-[11.5px] leading-4 text-faint">Can't read this file: {u.error}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.status === "ready" && list.error && (
        <p role="alert" className="mt-2 px-2 text-[12px] text-red-200">
          Couldn't refresh the list. {list.error}
        </p>
      )}
    </section>
  );
}
