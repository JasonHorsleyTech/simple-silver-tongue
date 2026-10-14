import { Lock, LockOpen } from "lucide-react";
import { useUser } from "../../app/session.tsx";
import { LogoMark } from "../../components/Logo.tsx";
import { Link } from "../../lib/router.tsx";

/** "/" when logged in: a quiet welcome. T02 turns it into the "start a conversation" screen. */
export function HomeView() {
  const user = useUser();
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-16">
      <div className="max-w-sm text-center">
        <LogoMark size={48} className="mx-auto" />
        <h1 className="mt-5 text-xl font-semibold tracking-tight text-fg">Hello, {user.username}</h1>
        <p className="mt-2 text-sm leading-6 text-muted">Your conversations will show up in the sidebar.</p>
        <p className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1 text-xs text-faint">
          {user.encrypted ? (
            <>
              <Lock aria-hidden className="size-3" /> Your data is encrypted on disk with your password
            </>
          ) : (
            <>
              <LockOpen aria-hidden className="size-3" /> Unencrypted user: data is stored as plain JSON
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export function NotFoundView() {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-16 text-center">
      <div>
        <h1 className="text-lg font-semibold">Nothing here</h1>
        <p className="mt-2 text-sm text-muted">This page doesn't exist.</p>
        <Link to="/" className="mt-5 inline-block text-sm text-silver underline decoration-line-strong underline-offset-4 hover:decoration-silver">
          Back to the start
        </Link>
      </div>
    </div>
  );
}
