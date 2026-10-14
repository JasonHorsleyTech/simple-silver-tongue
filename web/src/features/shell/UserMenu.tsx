import { ChevronsUpDown, Clock, KeyRound, Lock, LockOpen, LogOut, MonitorSmartphone, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/errors.ts";
import type { User } from "../../api/types.ts";
import { useSession } from "../../app/session.tsx";
import { toast } from "../../components/toasts.tsx";
import { cx } from "../../lib/cx.ts";
import { idleDuration } from "../../lib/format.ts";
import { ChangePasswordDialog } from "./ChangePasswordDialog.tsx";

type Action = "switch" | "logout" | "everywhere";

/**
 * Who is logged in (with the lock), and a menu that opens upward: switch user, change password (encrypted users),
 * log out, and log out everywhere (every tab and terminal of this user: auth.logout --all, "I'm stepping away").
 * Creating and deleting users stays in the terminal.
 */
export function UserMenu({ user }: { user: User }) {
  const { logout } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [changing, setChanging] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    box.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  async function run(action: Action) {
    setBusy(action);
    try {
      await logout({ everywhere: action === "everywhere", switching: action === "switch" }); // unmounts the shell
    } catch (err) {
      toast.error(`Couldn't log out. ${errorMessage(err)}`);
      setBusy(null);
    }
  }

  const item =
    "flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-fg transition-colors enabled:hover:bg-hover focus-visible:bg-hover disabled:cursor-wait disabled:opacity-60";
  const icon = "mt-0.5 size-4 shrink-0 text-muted";
  const idle = user.idle?.minutes;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={user.encrypted ? `${user.username}: encrypted on disk` : `${user.username}: unencrypted (debug)`}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-lg py-1.5 pr-2 pl-1.5 text-left transition-colors",
          open ? "bg-hover" : "hover:bg-hover/60",
        )}
      >
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-hover text-[13px] font-semibold text-silver ring-1 ring-line-strong"
        >
          {user.username.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{user.username}</span>
          <span className="mt-0.5 flex items-center gap-1 text-xs text-faint">
            {user.encrypted ? (
              <>
                <Lock aria-hidden className="size-3.5" strokeWidth={2.25} /> Encrypted
              </>
            ) : (
              <>
                <LockOpen aria-hidden className="size-3.5 text-amber-300/70" strokeWidth={2.25} /> Unencrypted
              </>
            )}
          </span>
        </span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-faint" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={`${user.username}`}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const items = [...(box.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];
            const i = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
          }}
          className="absolute right-0 bottom-full left-0 z-30 mb-2 rounded-xl border border-line-strong bg-panel p-1.5 shadow-2xl shadow-black/60"
        >
          {idle !== undefined && (
            <p className="flex items-start gap-2 px-2 pt-1 pb-2 text-[11.5px] leading-4 text-faint">
              <Clock aria-hidden className="mt-px size-3.5 shrink-0" />
              <span>
                Logs out by itself after {idleDuration(idle)} without activity{user.encrypted ? ", and the server wipes the key" : ""}.
              </span>
            </p>
          )}
          <button type="button" role="menuitem" className={item} disabled={busy !== null} onClick={() => void run("switch")}>
            <Users aria-hidden className={icon} />
            <span>Switch user</span>
          </button>
          {user.encrypted && (
            <button
              type="button"
              role="menuitem"
              className={item}
              disabled={busy !== null}
              onClick={() => {
                setOpen(false);
                setChanging(true);
              }}
            >
              <KeyRound aria-hidden className={icon} />
              <span>Change password…</span>
            </button>
          )}
          <div className="my-1 border-t border-line" />
          <button type="button" role="menuitem" className={item} disabled={busy !== null} onClick={() => void run("logout")}>
            <LogOut aria-hidden className={icon} />
            <span>
              Log out
              <span className="block text-[11.5px] leading-4 text-faint">Just this browser</span>
            </span>
          </button>
          <button type="button" role="menuitem" className={item} disabled={busy !== null} onClick={() => void run("everywhere")}>
            <MonitorSmartphone aria-hidden className={icon} />
            <span>
              Log out everywhere
              <span className="block text-[11.5px] leading-4 text-faint">Every tab and terminal, before you step away</span>
            </span>
          </button>
        </div>
      )}

      {changing && <ChangePasswordDialog user={user} onClose={() => setChanging(false)} />}
    </div>
  );
}
