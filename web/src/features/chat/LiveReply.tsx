import { RotateCw, X } from "lucide-react";
import type { Brain } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { BrainMessageFrame } from "./MessageItem.tsx";
import { Reasoning } from "./Reasoning.tsx";
import type { LiveReply as Live } from "./useChat.ts";

/**
 * The reply being generated, in the same frame a saved brain message uses, so nothing jumps when it is saved.
 * Waiting: three dots. Reasoning: a collapsed "Thinking…". Writing: Markdown, token by token, with a caret.
 * Failed: the partial text (not saved), the server's error, and Retry (a turn with no new message).
 */
export function LiveReply({ live, brain, onRetry, onDismiss }: { live: Live; brain?: Brain; onRetry(): void; onDismiss(): void }) {
  const failed = live.phase === "failed";
  if (!brain && !live.brainName && !failed) {
    // Re-attached (generation.follow) before Venice accepted the request: who will answer isn't known yet.
    return (
      <div aria-live="polite" aria-busy className="flex items-center gap-3 text-[13px] text-faint">
        <TypingDots />
        Waiting for Venice to start the reply…
      </div>
    );
  }
  return (
    <div aria-live="polite" aria-busy={!failed}>
      <BrainMessageFrame
        name={brain?.name ?? live.brainName ?? "Reply"}
        color={brain?.color ?? "#9aa3b0"}
        reasoning={live.reasoning ? <Reasoning text={live.reasoning} live={live.phase === "reasoning"} /> : null}
      >
        {live.content ? (
          <div className={failed ? "opacity-55" : "ss-caret"}>
            <Markdown text={live.content} />
          </div>
        ) : !failed && live.phase !== "reasoning" ? (
          <TypingDots />
        ) : null}
        {failed && (
          <div role="alert" className="mt-3 rounded-lg border border-red-400/25 bg-red-400/[0.07] px-3.5 py-3 text-[13px] leading-5 text-red-100">
            <p>
              {live.content ? "The text above is partial and was not saved. " : ""}
              {live.error}
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button size="sm" variant="secondary" onClick={onRetry}>
                <RotateCw aria-hidden className="size-3.5" /> Retry
              </Button>
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                <X aria-hidden className="size-3.5" /> Dismiss
              </Button>
            </div>
          </div>
        )}
      </BrainMessageFrame>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex h-7 items-center gap-1" aria-label="Waiting for the reply">
      {[0, 150, 300].map((d) => (
        <span key={d} className="size-1.5 animate-pulse rounded-full bg-faint" style={{ animationDelay: `${d}ms` }} />
      ))}
    </div>
  );
}
