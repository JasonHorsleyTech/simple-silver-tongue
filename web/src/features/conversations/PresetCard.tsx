import { ArrowRight, UsersRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import type { PresetInfo } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Notice } from "../../components/Notice.tsx";
import { navigate } from "../../lib/router.tsx";
import { Cast } from "./Cast.tsx";
import { refreshConversations } from "./store.ts";

/**
 * T10: a committed preset (presets.list): a kit of brains with good instructions and no world. Name the
 * conversation, start it (conversation.import --preset), and it opens on a pointer to write its World Bible.
 */
export function PresetCard({ preset: p, autoFocus }: { preset: PresetInfo; autoFocus?: boolean }) {
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(e: FormEvent) {
    e.preventDefault();
    if (pending || p.error) return;
    setPending(true);
    setError(null);
    try {
      const conv = await api.call("conversation.import", { preset: p.name, ...(title.trim() ? { title: title.trim() } : {}) });
      void refreshConversations();
      navigate(`/c/${conv.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <article aria-labelledby={`pr-${p.name}`} className="rounded-xl border border-line bg-panel/70 p-4 sm:p-5">
      <div className="flex items-start gap-3.5">
        <div aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg border border-line-strong bg-raised text-muted">
          <UsersRound className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 id={`pr-${p.name}`} className="text-[15.5px] font-semibold text-silver-hi">
            {p.title}
          </h3>
          {p.about && <p className="mt-1 text-[13.5px] leading-[1.55] text-muted">{p.about}</p>}
        </div>
      </div>

      <Cast brains={p.brains} />

      {p.error ? (
        // A committed file an import would refuse: listed, so it isn't silently missing, but not pickable.
        <Notice tone="error" className="mt-4">
          This preset can't be used: {p.error}
        </Notice>
      ) : (
        <form onSubmit={start} noValidate className="mt-4">
          {error && (
            <Notice tone="error" className="mb-3">
              {error}
            </Notice>
          )}
          <label htmlFor={`pr-${p.name}-title`} className="mb-1.5 block text-[13px] font-medium text-muted">
            Title
          </label>
          <div className="flex flex-wrap items-center gap-2.5">
            <input
              id={`pr-${p.name}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Chinatown"
              aria-describedby={`pr-${p.name}-hint`}
              maxLength={200}
              autoComplete="off"
              data-autofocus={autoFocus || undefined}
              className="block h-9 min-w-[12rem] flex-1 rounded-lg border border-line-strong bg-raised px-3 text-[14.5px] text-fg outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-focus/60 focus:ring-3 focus:ring-focus/15"
            />
            <Button type="submit" variant="primary" size="sm" className="h-9" loading={pending}>
              Start from this preset
              {!pending && <ArrowRight aria-hidden className="size-4" />}
            </Button>
          </div>
          <p id={`pr-${p.name}-hint`} className="mt-2 text-[12.5px] text-faint">
            Optional: blank keeps “{p.title}”. You can rename it any time, and every word of its brains is yours to edit.
          </p>
        </form>
      )}
    </article>
  );
}
