import { Check, Copy, FileWarning } from "lucide-react";
import { useState } from "react";
import type { ApiError } from "../../api/errors.ts";
import { useUser } from "../../app/session.tsx";
import { copyText } from "../../lib/clipboard.ts";
import { Link } from "../../lib/router.tsx";

/**
 * A conversation whose file the server can't read (500 unreadable_file, T06 QA-2): damaged, cut short, empty, another
 * user's, or a copy of another conversation. Said plainly, in the server's words, with what was (not) changed and
 * what Jason can do about it. The app can't repair or delete it: every write loads the file first, and a damaged
 * encrypted file may still be recoverable by hand, so removing it is a deliberate step in Finder or the terminal.
 */
export function DamagedFile({ error }: { error: ApiError }) {
  const { username } = useUser();
  const [copied, setCopied] = useState(false);
  // "conversations/c_x.json: can't be decrypted with this user's key: it is damaged, or it is another user's file"
  const cut = error.message.indexOf(": ");
  const file = cut > 0 ? error.message.slice(0, cut) : null;
  const why = cut > 0 ? error.message.slice(cut + 2) : error.message;
  const path = file ? `data/users/${username}/${file}` : null;

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg">
        <div className="text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-xl bg-amber-300/[0.07] ring-1 ring-amber-300/20">
            <FileWarning aria-hidden className="size-5 text-amber-300/90" />
          </span>
          <h1 className="mt-4 text-lg font-semibold">This conversation's file can't be read</h1>
          <p className="mt-2 text-sm leading-6 text-muted">{why.charAt(0).toUpperCase() + why.slice(1)}.</p>
        </div>

        <div className="mt-7 space-y-4 rounded-xl border border-line bg-panel/60 px-5 py-4 text-[13.5px] leading-6">
          <p className="text-muted">
            <span className="text-fg">Nothing was changed.</span> simple silver never writes over a file it can't read, and
            every conversation is a file of its own, so your others aren't affected.
          </p>
          <div>
            <p className="text-fg">What you can do</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted marker:text-faint">
              <li>Put back a good copy of the file from a backup, if you have one. It opens again as it was.</li>
              <li>Or move the file out of its folder, and it leaves the sidebar. Keep it if the conversation matters: a damaged file can sometimes still be rescued by hand.</li>
            </ul>
          </div>
          {path && (
            <div className="flex items-center gap-2 rounded-lg bg-raised px-3 py-2">
              <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-silver" title={path}>
                {path}
              </code>
              <button
                type="button"
                onClick={async () => {
                  if (await copyText(path)) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }
                }}
                className="grid size-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-fg"
                aria-label="Copy the path"
                title="Copy the path"
              >
                {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
              </button>
            </div>
          )}
        </div>

        <p className="mt-6 text-center">
          <Link to="/" className="text-sm text-silver underline decoration-line-strong underline-offset-4 hover:decoration-silver">
            Start a new conversation
          </Link>
        </p>
      </div>
    </div>
  );
}
