import { PanelLeftClose, PanelLeftOpen, Plus, X } from "lucide-react";
import type { User } from "../../api/types.ts";
import { useSession } from "../../app/session.tsx";
import { Button } from "../../components/Button.tsx";
import { LogoMark, Wordmark } from "../../components/Logo.tsx";
import { ModeBadge } from "../../components/ModeBadge.tsx";
import { Link } from "../../lib/router.tsx";
import { ConversationList } from "../conversations/ConversationList.tsx";
import { UserMenu } from "./UserMenu.tsx";

/** `onClose`: it is the narrow-screen drawer (×). `onCollapse`: it is docked, and folds down to the rail (T12). */
export function Sidebar({ user, onClose, onCollapse }: { user: User; onClose?: () => void; onCollapse?: () => void }) {
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
        {onCollapse && (
          <Button variant="ghost" size="icon" className="-mr-1.5 ml-auto" aria-label="Hide sidebar" title="Hide the sidebar" onClick={onCollapse}>
            <PanelLeftClose aria-hidden className="size-4" />
          </Button>
        )}
      </div>

      <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3">
        <ConversationList username={user.username} />
      </nav>

      <div className="shrink-0 space-y-2 border-t border-line p-3">
        {health && <ModeBadge mode={health.mode} className="ml-1.5" />}
        <UserMenu user={user} />
      </div>
    </aside>
  );
}

/** The sidebar folded away (T12): a slim rail with the way back and a new conversation, so the chat gets the width. */
export function SidebarRail({ onExpand }: { onExpand: () => void }) {
  const item = "grid size-8 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-fg";
  return (
    <aside className="flex h-full flex-col items-center gap-1 bg-panel pt-3">
      <button type="button" className={item} aria-label="Show sidebar" title="Show the sidebar" onClick={onExpand}>
        <PanelLeftOpen aria-hidden className="size-4" />
      </button>
      <Link to="/" className={item} aria-label="New conversation" title="New conversation">
        <Plus aria-hidden className="size-4" />
      </Link>
    </aside>
  );
}
