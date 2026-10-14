import { Lock, LockOpen, LogOut, X } from "lucide-react";
import { useState } from "react";
import { errorMessage } from "../../api/errors.ts";
import type { User } from "../../api/types.ts";
import { useSession } from "../../app/session.tsx";
import { Button } from "../../components/Button.tsx";
import { LogoMark, Wordmark } from "../../components/Logo.tsx";
import { ModeBadge } from "../../components/ModeBadge.tsx";
import { toast } from "../../components/toasts.tsx";
import { Link } from "../../lib/router.tsx";
import { ConversationList } from "../conversations/ConversationList.tsx";

export function Sidebar({ user, onClose }: { user: User; onClose?: () => void }) {
  const { health } = useSession();
  return (
    <aside className="flex h-full flex-col bg-panel">
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <Link to="/" className="-mx-1 flex items-center gap-2.5 rounded-md px-1 py-1">
          <LogoMark size={22} />
          <Wordmark className="text-[15px]" />
        </Link>
        {onClose && (
          <Button variant="ghost" size="icon" className="ml-auto" aria-label="Close sidebar" onClick={onClose}>
            <X aria-hidden className="size-4" />
          </Button>
        )}
      </div>

      <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3">
        <ConversationList />
      </nav>

      <div className="shrink-0 space-y-2 border-t border-line p-3">
        {health && <ModeBadge mode={health.mode} className="ml-1.5" />}
        <UserCard user={user} />
      </div>
    </aside>
  );
}

function UserCard({ user }: { user: User }) {
  const { logout } = useSession();
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    setBusy(true);
    try {
      await logout(); // unmounts the shell
    } catch (err) {
      toast.error(`Couldn't log out. ${errorMessage(err)}`);
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2.5 rounded-lg py-1 pl-1.5">
      <div
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-full bg-hover text-[13px] font-semibold text-silver ring-1 ring-line-strong"
      >
        {user.username.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-fg" title={user.username}>
          {user.username}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-xs text-faint">
          {user.encrypted ? (
            <>
              <Lock aria-hidden className="size-3.5" strokeWidth={2.25} /> Encrypted
            </>
          ) : (
            <>
              <LockOpen aria-hidden className="size-3.5" strokeWidth={2.25} /> Unencrypted
            </>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onLogout}
        loading={busy}
        aria-label="Log out"
        title={user.encrypted ? "Log out (wipes your key from server memory)" : "Log out"}
      >
        {!busy && <LogOut aria-hidden className="size-4" />}
      </Button>
    </div>
  );
}
