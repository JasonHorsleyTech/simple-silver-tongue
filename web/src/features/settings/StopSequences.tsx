import { Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { FRAMING_STOP, MAX_STOPS, type Brain } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Spinner } from "../../components/Spinner.tsx";

/**
 * T07: a brain's stop sequences (brain.update --stop, the whole list each time). Venice ends the reply just
 * before any of them, so a text brain that stops at "<!-- from:" can't write a framing line for someone else.
 * A request setting rather than words the model reads, but it is in the request, so it is shown and edited
 * here and in the payload view. Each is shown quoted, so leading or trailing spaces are visible (they count).
 * An add or a remove saves at once, like a switch.
 */
export function StopSequences({
  brain,
  busy,
  onSave,
}: {
  brain: Brain;
  busy: boolean;
  /** Saves the whole list. Its error is shown by the editor. */
  onSave(stop: string[]): void;
}) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const stops = brain.stop;
  const full = stops.length >= MAX_STOPS;
  const id = `stop-${brain.id}`;

  function add(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    if (draft.trim() === "") return setProblem("A stop sequence can't be blank.");
    if (stops.includes(draft)) return setProblem("It is already in the list.");
    setProblem(null);
    onSave([...stops, draft]);
    setDraft("");
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <span id={`${id}-label`} className="text-[13px] font-medium text-fg">
          Stop sequences
        </span>
        {busy && <Spinner className="size-3.5 text-faint" />}
        <span className="ml-auto text-[11.5px] text-faint tabular-nums">
          {stops.length} of {MAX_STOPS}
        </span>
      </div>
      <p className="mt-0.5 mb-2.5 text-[12.5px] leading-5 text-faint">
        {brain.kind === "image"
          ? "Venice ends the reply just before any of these. An image brain answers with a tool call, so it usually needs none."
          : "Venice ends the reply just before any of these, so this brain can't write a line framed as someone else. Sent as the request's stop, not as text the model reads."}
      </p>

      {stops.length > 0 ? (
        <ul aria-labelledby={`${id}-label`} className="mb-2.5 flex flex-wrap gap-1.5">
          {stops.map((s) => (
            <li key={s} className="inline-flex max-w-full items-center rounded-md border border-line-strong bg-canvas/60 pl-2 font-mono text-[12px] text-muted">
              <span className="truncate whitespace-pre">{JSON.stringify(s)}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onSave(stops.filter((x) => x !== s))}
                aria-label={`Remove the stop sequence ${JSON.stringify(s)}`}
                title="Remove"
                className="ml-0.5 grid size-6 shrink-0 place-items-center rounded-md text-faint transition-colors enabled:hover:bg-hover enabled:hover:text-fg disabled:opacity-50"
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2.5 text-[12.5px] leading-5 text-muted">
          None{brain.kind === "text" ? `: ${brain.name} can write lines framed as another speaker.` : "."}
        </p>
      )}

      {!full && (
        <form onSubmit={add} noValidate className="flex items-center gap-1.5">
          <label htmlFor={`${id}-new`} className="sr-only">
            New stop sequence
          </label>
          <input
            id={`${id}-new`}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (problem) setProblem(null);
            }}
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            placeholder="Add a stop sequence…"
            aria-invalid={problem ? true : undefined}
            className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2.5 font-mono text-[12.5px] text-fg outline-none placeholder:font-sans placeholder:text-faint focus:border-focus/60 focus:ring-3 focus:ring-focus/15 aria-[invalid=true]:border-red-400/60"
          />
          <Button size="sm" variant="secondary" type="submit" disabled={busy || draft === ""} className="h-8">
            <Plus aria-hidden className="size-3.5" /> Add
          </Button>
        </form>
      )}
      {problem && <p className="mt-1.5 text-[12.5px] text-red-200">{problem}</p>}
      {brain.kind === "text" && !stops.includes(FRAMING_STOP) && !full && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onSave([...stops, FRAMING_STOP])}
          className="mt-2 text-[12.5px] text-muted underline decoration-line-strong underline-offset-4 hover:text-fg disabled:opacity-50"
        >
          Add the default, <code className="font-mono text-[11.5px]">{FRAMING_STOP}</code>
        </button>
      )}
    </div>
  );
}
