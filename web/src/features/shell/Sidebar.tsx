import { X } from "lucide-react";
import type { User } from "../../api/types.ts";
import { useSession } from "../../app/session.tsx";
import { Button } from "../../components/Button.tsx";
import { LogoMark, Wordmark } from "../../components/Logo.tsx";
import { ModeBadge } from "../../components/ModeBadge.tsx";
import { Link } from "../../lib/router.tsx";
import { ConversationList } from "../conversations/ConversationList.tsx";
import { UserMenu } from "./UserMenu.tsx";

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
        <ConversationList username={user.username} />
      </nav>

      <div className="shrink-0 space-y-2 border-t border-line p-3">
        {health && <ModeBadge mode={health.mode} className="ml-1.5" />}
        <UserMenu user={user} />
      </div>
    </aside>
  );
}
