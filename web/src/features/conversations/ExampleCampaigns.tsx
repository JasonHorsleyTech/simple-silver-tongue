import { ArrowRight, Dices, ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import { BRAIN_COLORS, type ExampleInfo } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Notice } from "../../components/Notice.tsx";
import { navigate } from "../../lib/router.tsx";
import { BrainBadge } from "../chat/BrainBadge.tsx";
import { refreshConversations } from "./store.ts";

/**
 * T07: the committed example campaigns (examples.list), each one click from play (conversation.import
 * --example). The import is the user's own copy, encrypted like the rest of their data; the example file
 * itself is never changed. Renders nothing until the list is in, and nothing if there are no examples.
 */
export function ExampleCampaigns() {
  const [examples, setExamples] = useState<ExampleInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.call("examples.list").then(
      (r) => live && setExamples(r.examples),
      (err) => live && setError(errorMessage(err)),
    );
    return () => {
      live = false;
    };
  }, []);

  if (error) return <Notice tone="error">Couldn't list the example campaigns. {error}</Notice>;
  if (!examples?.length) return null;
  return (
    <div className="space-y-3">
      {examples.map((e) => (
        <ExampleCard key={e.name} example={e} />
      ))}
    </div>
  );
}

function ExampleCard({ example: e }: { example: ExampleInfo }) {
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

      {e.brains.length > 0 && (
        <ul aria-label="Brains" className="mt-3.5 flex flex-wrap items-center gap-1.5">
          {e.brains.map((b, i) => (
            <li key={b.name} className="inline-flex items-center gap-1" title={b.kind === "image" ? `${b.name} answers with a picture` : undefined}>
              <BrainBadge name={b.name} color={b.color ?? BRAIN_COLORS[i % BRAIN_COLORS.length]!} />
              {b.kind === "image" && <ImageIcon aria-label="(image)" className="size-3.5 text-faint" />}
            </li>
          ))}
        </ul>
      )}

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
