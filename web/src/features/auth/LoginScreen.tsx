import { useRef, useState, type FormEvent } from "react";
import { errorMessage } from "../../api/errors.ts";
import { LAST_USERNAME_KEY, useSession } from "../../app/session.tsx";
import { Button } from "../../components/Button.tsx";
import { LogoMark, Wordmark } from "../../components/Logo.tsx";
import { ModeBadge } from "../../components/ModeBadge.tsx";
import { Notice } from "../../components/Notice.tsx";
import { TextField } from "../../components/TextField.tsx";
import { readLocal } from "../../lib/storage.ts";

/**
 * auth.login with a username and a password. An empty password is valid: it is how an unencrypted
 * (debug) user logs in. Users are created in the terminal, so there is no sign-up here.
 * The last username is remembered in this browser, since every server restart means logging in again.
 */
export function LoginScreen({ notice }: { notice: string | null }) {
  const { login, health } = useSession();
  const [remembered] = useState(() => readLocal(LAST_USERNAME_KEY) ?? "");
  const [username, setUsername] = useState(remembered);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = username.trim();
    if (pending || name === "") return;
    setPending(true);
    setError(null);
    try {
      await login(name, password); // on success the app shell replaces this screen
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
      requestAnimationFrame(() => passwordRef.current?.select());
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-56 left-1/2 h-[560px] w-[860px] -translate-x-1/2 bg-[radial-gradient(closest-side,rgb(217_223_231/0.07),transparent)]"
      />
      <main className="relative w-full max-w-[22rem]">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark size={44} />
          <h1 className="mt-4 text-[26px] leading-tight">
            <Wordmark />
          </h1>
          <p className="mt-1.5 text-sm text-faint">A local scratch pad for Venice AI</p>
        </div>

        <form
          onSubmit={submit}
          noValidate
          className="space-y-4 rounded-2xl border border-line bg-panel p-6 shadow-2xl shadow-black/50"
        >
          {error ? <Notice tone="error">{error}</Notice> : notice ? <Notice tone="info">{notice}</Notice> : null}
          <TextField
            id="login-username"
            label="Username"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus={remembered === ""}
          />
          <TextField
            id="login-password"
            ref={passwordRef}
            label="Password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus={remembered !== ""}
            hint="Leave empty for an unencrypted user."
          />
          <Button type="submit" variant="primary" className="mt-2 w-full" loading={pending} disabled={username.trim() === ""}>
            {pending ? (password === "" ? "Logging in…" : "Unlocking…") : "Log in"}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs leading-5 text-faint">
          New user? Create one in the terminal:
          <br />
          <code className="font-mono text-[11.5px] text-muted">./ss user.create --username &lt;name&gt;</code>
        </p>
        {health && (
          <div className="mt-5 flex justify-center">
            <ModeBadge mode={health.mode} />
          </div>
        )}
      </main>
    </div>
  );
}
