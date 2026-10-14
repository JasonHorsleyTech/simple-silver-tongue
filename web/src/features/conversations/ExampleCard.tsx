import { ArrowRight, Dices } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import type { ExampleInfo } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Notice } from "../../components/Notice.tsx";
import { navigate } from "../../lib/router.tsx";
import { Cast } from "./Cast.tsx";
import { refreshConversations } from "./store.ts";

/**
 * T07: a committed example campaign (examples.list), one click from play (conversation.import --example). The
 * import is the user's own copy, encrypted like the rest of their data; the example file itself is never changed.
 */
export function ExampleCard({ example: e }: { example: ExampleInfo }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(e.error ? `It can't be imported: ${e.error}` : null);

  async function start() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const conv = await api.call("conversation.import", { example: e.name });
      void refreshConversations();
      navigate(`/c/${conv.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  const setup = [
    ...e.setup.map((label) => `the ${label}`),
    e.messages ? (e.messages === 1 ? "an opening scene" : `${e.messages} opening messages`) : null,
  ].filter(Boolean);

  return (
    <article aria-labelledby={`ex-${e.name}`} className="rounded-xl border border-line bg-panel/70 p-4 sm:p-5">
      <div className="flex items-start gap-3.5">
        <div aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg border border-line-strong bg-raised text-muted">
          <Dices className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 id={`ex-${e.name}`} className="text-[15.5px] font-semibold text-silver-hi">
            {e.title}
          </h3>
          {e.about && <p className="mt-1 text-[13.5px] leading-[1.55] text-muted">{e.about}</p>}
        </div>
      </div>

      <Cast brains={e.brains} />

      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="primary" size="sm" loading={pending} disabled={!!e.error} onClick={() => void start()}>
          Start this campaign
          {!pending && <ArrowRight aria-hidden className="size-4" />}
        </Button>
        {setup.length > 0 && <p className="text-[12.5px] text-faint">Comes with {setup.join(", ").replace(/, ([^,]*)$/, " and $1")}. Every word is yours to edit.</p>}
      </div>
    </article>
  );
}
