import { ArrowRight, Dices, Lock, LockOpen, PenLine, UsersRound } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import { useUser } from "../../app/session.tsx";
import { Button } from "../../components/Button.tsx";
import { LogoMark } from "../../components/Logo.tsx";
import { Notice } from "../../components/Notice.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { TextArea } from "../../components/TextArea.tsx";
import { TextField } from "../../components/TextField.tsx";
import { cx } from "../../lib/cx.ts";
import { navigate } from "../../lib/router.tsx";
import { readLocal, writeLocal } from "../../lib/storage.ts";
import { ExampleCard } from "./ExampleCard.tsx";
import { useExamples, usePresets } from "./library.ts";
import { PresetCard } from "./PresetCard.tsx";
import { refreshConversations } from "./store.ts";

/** Pre-filled so starting is one click, but it is only a suggestion: it is sent exactly as it reads here. */
export const DEFAULT_SYSTEM_PROMPT = "You are a thoughtful, concise assistant. Format your answers in Markdown.";

type Way = "example" | "preset" | "scratch";
const WAY_KEY = "sst.newFrom";
const WAYS: { id: Way; label: string; line: string; Icon: typeof Dices }[] = [
  { id: "example", label: "Ready to play", line: "A world, its brains and an opening scene", Icon: Dices },
  { id: "preset", label: "From a preset", line: "Brains with no world: you write it", Icon: UsersRound },
  { id: "scratch", label: "From scratch", line: "Your own system prompt", Icon: PenLine },
];

/**
 * "/" when logged in: start a conversation three ways, one shown at a time so the page stays calm: an example campaign
 * (T07), a preset (T10), or from scratch. The choice is remembered in this browser. A way with nothing in it (no
 * committed examples or presets) isn't offered.
 */
export function NewConversationView() {
  const user = useUser();
  const examples = useExamples();
  const presets = usePresets();
  const offered = WAYS.filter((w) => (w.id === "example" ? examples.items?.length !== 0 : w.id === "preset" ? presets.items?.length !== 0 : true));
  const [chosen, setChosen] = useState<Way>(() => {
    const saved = readLocal(WAY_KEY);
    return WAYS.some((w) => w.id === saved) ? (saved as Way) : "example";
  });
  const way = offered.some((w) => w.id === chosen) ? chosen : offered[0]!.id;
  const panels = useRef<HTMLDivElement>(null);

  const choose = (w: Way) => {
    setChosen(w);
    writeLocal(WAY_KEY, w);
  };

  // Ready to type in the way shown (the preset's title, the system prompt), without scrolling the page.
  useEffect(() => {
    panels.current?.querySelector<HTMLElement>(`[data-way="${way}"] [data-autofocus]`)?.focus({ preventScroll: true });
  }, [way, presets.items]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-5 py-12 sm:px-8">
      <div className="mb-6">
        <LogoMark size={36} />
        <h1 className="mt-5 text-[22px] font-semibold tracking-tight text-silver-hi">New conversation</h1>
        <p className="mt-1.5 text-[14px] leading-6 text-muted">Play a ready-made campaign, start from a preset and write the world yourself, or begin with a system prompt of your own.</p>
      </div>

      <div role="tablist" aria-label="Start from" className="mb-6 grid grid-cols-3 gap-2">
        {offered.map((w) => {
          const on = w.id === way;
          return (
            <button
              key={w.id}
              id={`way-${w.id}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={`way-panel-${w.id}`}
              onClick={() => choose(w.id)}
              onKeyDown={(e) => {
                const i = offered.findIndex((x) => x.id === w.id);
                const next = e.key === "ArrowRight" ? offered[(i + 1) % offered.length] : e.key === "ArrowLeft" ? offered[(i - 1 + offered.length) % offered.length] : null;
                if (!next) return;
                e.preventDefault();
                choose(next.id);
                document.getElementById(`way-${next.id}`)?.focus();
              }}
              tabIndex={on ? 0 : -1}
              className={cx(
                "flex flex-col justify-start rounded-xl border px-3 py-2.5 text-left transition-colors sm:px-3.5 sm:py-3",
                on ? "border-silver/35 bg-raised text-silver-hi" : "border-line bg-panel/40 text-muted hover:border-line-strong hover:text-fg",
              )}
            >
              <span className="flex items-center gap-2 text-[13.5px] font-medium sm:text-[14px]">
                <w.Icon aria-hidden className={cx("size-4 shrink-0", on ? "text-silver" : "text-faint")} />
                {w.label}
              </span>
              <span className="mt-1 hidden text-[12.5px] leading-[1.4] text-faint sm:block">{w.line}</span>
            </button>
          );
        })}
      </div>

      <div ref={panels}>
        <WayPanel way="example" shown={way}>
          <LibraryList what="the example campaigns" list={examples}>
            {(examples.items ?? []).map((e) => (
              <ExampleCard key={e.name} example={e} />
            ))}
          </LibraryList>
        </WayPanel>
        <WayPanel way="preset" shown={way}>
          <p className="mb-4 text-[13.5px] leading-6 text-muted">
            Brains with good instructions and no world. Name it and start it; then write its World Bible, which every brain reads first, and play.
          </p>
          <LibraryList what="the presets" list={presets}>
            {(presets.items ?? []).map((p, i) => (
              <PresetCard key={p.name} preset={p} autoFocus={i === 0} />
            ))}
          </LibraryList>
        </WayPanel>
        <WayPanel way="scratch" shown={way}>
          <ScratchForm />
        </WayPanel>
      </div>

      <p className="mt-10 inline-flex items-center gap-1.5 self-start rounded-full border border-line bg-panel px-3 py-1 text-xs text-faint">
        {user.encrypted ? (
          <>
            <Lock aria-hidden className="size-3" /> Encrypted on disk with your password
          </>
        ) : (
          <>
            <LockOpen aria-hidden className="size-3" /> Unencrypted user: stored as plain JSON
          </>
        )}
      </p>
    </div>
  );
}

/** Kept mounted while hidden, so a half-written system prompt or title survives a look at the other ways. */
function WayPanel({ way, shown, children }: { way: Way; shown: Way; children: ReactNode }) {
  return (
    <div id={`way-panel-${way}`} role="tabpanel" aria-labelledby={`way-${way}`} data-way={way} hidden={way !== shown}>
      {children}
    </div>
  );
}

function LibraryList({ what, list, children }: { what: string; list: { items: unknown[] | null; error: string | null }; children: ReactNode }) {
  if (list.error) return <Notice tone="error">Couldn't list {what}. {list.error}</Notice>;
  if (!list.items) {
    return (
      <p className="flex items-center gap-2 py-6 text-[13px] text-faint" aria-busy="true">
        <Spinner className="size-4" /> Loading {what}…
      </p>
    );
  }
  return <div className="space-y-3">{children}</div>;
}

/**
 * From scratch: the system prompt is required (design.md hard rule 1: never send a request without a user-written
 * system message) and is sent verbatim; nothing else is added.
 */
function ScratchForm() {
  const [title, setTitle] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blank = systemPrompt.trim() === "";

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (pending) return;
    if (blank) {
      setError("Write a system prompt first. It is the first message every request starts with.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const conv = await api.call("conversation.create", { systemPrompt, ...(title.trim() ? { title: title.trim() } : {}) });
      void refreshConversations();
      navigate(`/c/${conv.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  const submitOnModEnter = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <>
      <p className="mb-5 text-[13.5px] leading-6 text-muted">
        Write the system prompt yourself. It is sent exactly as written, as the first message of every request, and nothing else is added.
      </p>
      <form onSubmit={submit} onKeyDown={submitOnModEnter} noValidate className="space-y-5">
        {error && <Notice tone="error">{error}</Notice>}
        <TextField
          id="new-title"
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New conversation"
          maxLength={200}
          autoComplete="off"
          hint="Optional. You can rename it any time."
        />
        <TextArea
          id="new-system-prompt"
          label="System prompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          data-autofocus
          maxPx={360}
          aria-invalid={blank || undefined}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-xs text-faint">
            <kbd className="font-sans">⌘</kbd> <kbd className="font-sans">Enter</kbd> to start
          </p>
          <Button type="submit" variant="primary" loading={pending}>
            Start conversation
            {!pending && <ArrowRight aria-hidden className="size-4" />}
          </Button>
        </div>
      </form>
    </>
  );
}
