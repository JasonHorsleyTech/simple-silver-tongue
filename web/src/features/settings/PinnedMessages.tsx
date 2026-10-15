import { LocateFixed, X } from "lucide-react";
import { useState } from "react";
import { errorMessage } from "../../api/errors.ts";
import { hiddenSummary, PIN_AS_WORDS, PIN_ROLES, splitHidden, type Brain, type LedgerMessage, type PinRole } from "../../api/types.ts";
import { Spinner } from "../../components/Spinner.tsx";
import { activeVersion } from "../../lib/format.ts";
import { BrainBadge } from "../chat/BrainBadge.tsx";

/** How each way of sending a pin reads in the picker; PIN_AS_WORDS (the server's) is its tooltip. */
const ROLE_LABEL: Record<PinRole, string> = {
  ledger: "as in the story",
  system: "as a system message",
  assistant: "as its own words",
};

/**
 * One line of a message, for a list: its visible text, and a hidden note as its fold ("[Hidden · 15 lines]"), never
 * the note's words (T08: a note is read on purpose, in the scrollback).
 */
export function messageSnippet(m: LedgerMessage): string {
  const text = activeVersion(m).content;
  if (m.kind === "image") return text.replace(/\s+/g, " ").trim();
  return splitHidden(text)
    .map((p) => (p.type === "hidden" ? `[${hiddenSummary(p.block)}]` : p.text.replace(/\s+/g, " ").trim()))
    .filter(Boolean)
    .join(" ");
}

/**
 * T16: a brain's pinned messages, in its card: each one's author and first line, how it is sent (as it would be in
 * the story, as a system message, or as the brain's own words), Jump (to it in the scrollback) and Unpin. They are
 * sent right after the setup messages, in story order, as they stand now. Pinning is done from the message.
 */
export function PinnedMessages({
  brain,
  messages,
  brains,
  onPin,
  onUnpin,
  onJumpTo,
}: {
  brain: Brain;
  messages: LedgerMessage[];
  brains: Brain[];
  onPin(messageId: string, as: PinRole): Promise<void>;
  onUnpin(messageId: string): Promise<void>;
  onJumpTo(messageId: string): void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const order = new Map(messages.map((m, i) => [m.id, i]));
  const pins = [...brain.pins].sort((a, b) => (order.get(a.messageId) ?? 0) - (order.get(b.messageId) ?? 0));
  const run = async (key: string, fn: () => Promise<void>) => {
    setPending(key);
    setProblem(null);
    try {
      await fn();
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  return (
    <div>
      <h4 className="text-[13px] font-medium text-fg">Pinned messages</h4>
      <p className="mt-0.5 text-[12.5px] leading-5 text-faint">
        {pins.length
          ? `Sent right after the setup messages, in story order, as they stand now (an edit or another version reaches ${brain.name} too), and not again at their place.`
          : `None. Pin any message to ${brain.name} with the pin under it: it is then sent right after the setup messages, as it stands, and not at its place.`}
      </p>
      {pins.length > 0 && (
        <ul className="mt-2.5 space-y-2">
          {pins.map((p) => {
            const m = messages.find((x) => x.id === p.messageId);
            const author = m?.author.type === "brain" ? brains.find((b) => b.id === (m.author as { brainId: string }).brainId) : undefined;
            return (
              <li key={p.messageId} className="rounded-lg border border-line bg-canvas/40 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  {m?.author.type === "brain" ? (
                    <BrainBadge name={author?.name ?? "Unknown brain"} color={author?.color ?? "#9aa3b0"} className="max-w-[45%] shrink-0" />
                  ) : (
                    <span className="shrink-0 text-[12.5px] font-medium text-muted">You</span>
                  )}
                  {brain.madeFrom === p.messageId && <span className="shrink-0 text-[11.5px] text-faint">made from it</span>}
                  <span className="ml-auto flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => onJumpTo(p.messageId)}
                      title="Show it in the conversation"
                      className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-faint transition-colors hover:bg-hover hover:text-fg"
                    >
                      <LocateFixed aria-hidden className="size-3.5" /> Jump to it
                    </button>
                    <button
                      type="button"
                      disabled={pending !== null}
                      onClick={() => void run(`un:${p.messageId}`, () => onUnpin(p.messageId))}
                      aria-label={`Unpin ${p.messageId}`}
                      title={`Unpin: ${brain.name} sees it at its place in the story again`}
                      className="grid size-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-fg"
                    >
                      {pending === `un:${p.messageId}` ? <Spinner className="size-3.5" /> : <X aria-hidden className="size-3.5" />}
                    </button>
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-[12px] text-muted" title={m ? undefined : p.messageId}>
                  {m ? messageSnippet(m) || "(empty)" : `${p.messageId} (not in the conversation)`}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <label htmlFor={`pin-as-${brain.id}-${p.messageId}`} className="text-[12px] text-faint">
                    Sent
                  </label>
                  <select
                    id={`pin-as-${brain.id}-${p.messageId}`}
                    value={p.as}
                    disabled={pending !== null}
                    title={PIN_AS_WORDS[p.as]}
                    onChange={(e) => void run(`as:${p.messageId}`, () => onPin(p.messageId, e.target.value as PinRole))}
                    className="h-7 rounded-md border border-line-strong bg-raised px-1.5 text-[12.5px] text-fg outline-none focus:border-focus/60"
                  >
                    {PIN_ROLES.map((r) => (
                      <option key={r} value={r} title={PIN_AS_WORDS[r]}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  {pending === `as:${p.messageId}` && <Spinner className="size-3.5 text-faint" />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {problem && <p className="mt-2 text-[12.5px] text-red-200">{problem}</p>}
    </div>
  );
}
