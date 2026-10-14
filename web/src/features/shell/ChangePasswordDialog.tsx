import { useRef, useState, type FormEvent } from "react";
import { ApiError, errorMessage } from "../../api/errors.ts";
import type { User } from "../../api/types.ts";
import { useSession } from "../../app/session.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { Notice } from "../../components/Notice.tsx";
import { TextField } from "../../components/TextField.tsx";

/**
 * user.change-password from the browser (T06 frontend): the same command as ./ss user.change-password. The current
 * password unwraps the data key and the new one rewraps it, so no file is touched. It logs the user out everywhere,
 * this tab included; the login screen then says so, with the user already chosen.
 */
export function ChangePasswordDialog({ user, onClose }: { user: User; onClose(): void }) {
  const { changePassword } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ field: "current" | null; message: string } | null>(null);
  const currentRef = useRef<HTMLInputElement>(null);

  const mismatch = again !== "" && next !== again;
  const ready = current !== "" && next !== "" && next === again;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!ready || pending) return;
    setPending(true);
    setError(null);
    try {
      await changePassword(current, next); // logs this user out everywhere: the login screen replaces the app
    } catch (err) {
      const wrong = err instanceof ApiError && err.code === "wrong_password";
      setError({ field: wrong ? "current" : null, message: errorMessage(err) });
      setPending(false);
      if (wrong) requestAnimationFrame(() => currentRef.current?.select());
    }
  }

  return (
    <Dialog
      title={`Change the password for ${user.username}`}
      subtitle={`Only user.json changes: your files keep their key, which the new password unlocks from now on. Every session of ${user.username} ends, this one too.`}
      onClose={onClose}
      width="w-[min(30rem,calc(100vw-2rem))]"
      footer={
        <>
          <p className="mr-auto text-[11.5px] leading-4 text-faint">There is no recovery: a lost password means lost data.</p>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="change-password" variant="primary" size="sm" loading={pending} disabled={!ready}>
            Change password
          </Button>
        </>
      }
    >
      <form id="change-password" onSubmit={submit} noValidate className="space-y-4">
        {error && !error.field && <Notice tone="error">{error.message}</Notice>}
        {/* A hidden username lets the browser's password manager file the new password under the right user. */}
        <input type="text" name="username" value={user.username} autoComplete="username" readOnly hidden />
        <TextField
          id="cp-current"
          ref={currentRef}
          label="Current password"
          type="password"
          value={current}
          onChange={(e) => {
            setCurrent(e.target.value);
            if (error?.field === "current") setError(null);
          }}
          autoComplete="current-password"
          data-autofocus
          aria-invalid={error?.field === "current" || undefined}
          hint={error?.field === "current" ? <span className="text-red-300">{error.message}</span> : undefined}
        />
        <TextField id="cp-new" label="New password" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        <TextField
          id="cp-again"
          label="New password again"
          type="password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          autoComplete="new-password"
          aria-invalid={mismatch || undefined}
          hint={
            mismatch ? (
              <span className={tried ? "text-red-300" : "text-amber-300"}>The two new passwords don't match.</span>
            ) : (
              "Typed twice, since a typo here would lock you out."
            )
          }
        />
        <p className="text-[11.5px] leading-4 text-faint">
          A copy of user.json made before the change (a backup) still opens with the old password, because the key itself
          stays the same.
        </p>
      </form>
    </Dialog>
  );
}
