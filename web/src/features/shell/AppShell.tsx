import { Menu } from "lucide-react";
import { useEffect, useState } from "react";
import type { User } from "../../api/types.ts";
import { Routes } from "../../app/routes.tsx";
import { Button } from "../../components/Button.tsx";
import { LogoMark, Wordmark } from "../../components/Logo.tsx";
import { usePath } from "../../lib/router.tsx";
import { Sidebar } from "./Sidebar.tsx";

/**
 * The logged-in frame: a sidebar (conversations, user, logout) and a main area for the current route.
 * At laptop width and up the sidebar is always there. Narrower, it becomes a drawer behind a menu button.
 * Views own their main area entirely (header, scrollback, composer), so a chat view can pin its composer.
 */
export function AppShell({ user }: { user: User }) {
  const [drawer, setDrawer] = useState(false);
  const path = usePath();

  useEffect(() => {
    setDrawer(false);
  }, [path]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  return (
    <div className="flex h-full">
      <div className="hidden w-64 shrink-0 border-r border-line md:block">
        <Sidebar user={user} />
      </div>

      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line shadow-2xl shadow-black/60">
            <Sidebar user={user} onClose={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-2 md:hidden">
          <Button variant="ghost" size="icon" aria-label="Open sidebar" onClick={() => setDrawer(true)}>
            <Menu aria-hidden className="size-[18px]" />
          </Button>
          <LogoMark size={20} />
          <Wordmark className="text-[15px]" />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Routes />
        </main>
      </div>
    </div>
  );
}
