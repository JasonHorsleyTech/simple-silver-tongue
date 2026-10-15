import { RotateCw, X } from "lucide-react";
import { isMuse, type Brain } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { expectedAspect, LiveImage } from "./ImageCard.tsx";
import { BrainMessageFrame, SteerNote } from "./MessageFrame.tsx";
import { MessageText } from "./MessageText.tsx";
import { Reasoning } from "./Reasoning.tsx";
import type { LiveReply as Live } from "./useChat.ts";

/**
 * The reply being generated, in the same frame a saved brain message uses, so nothing jumps when it is saved.
 * Waiting: three dots. Reasoning: a collapsed "Thinking…". Writing: Markdown, token by token, with a caret;
 * a hidden note (T08) is its fold, counting up, never its words ("Hidden · 3 lines so far"), and it can be
 * opened once the reply is saved. Failed: the partial text (not saved), the server's error, Retry and Dismiss.
 *
 * A regenerate renders in the regenerated message's own slot (`slot`): its header says which version is
 * being written and with what steer (or "fresh take": T17, the Muse's note it answers is already in its place
 * above), and a failure leaves the message's saved versions as they were.
 *
 * The Muse's own turn (T17) is written in the Muse's note frame, as it will be saved.
 *
 * An image brain's reply (`live.image`) is its prompt: the frame the picture will fill, and the prompt
 * streaming in under it as plain text. It ends when the prompt is saved; the saved message then shows the
 * image being painted, and the composer is free.
 */
export function LiveReply({
  live,
  brain,
  slot,
  onRetry,
  onDismiss,
}: {
  live: Live;
  brain?: Brain;
  slot?: { nextVersion: number; fromVersion: number | null };
  onRetry(): void;
  onDismiss(): void;
}) {
  const failed = live.phase === "failed";
  if (!slot && !brain && !live.brainName && !failed) {
    // Re-attached (generation.follow) before Venice accepted the request: who will answer isn't known yet.
    return (
      <div aria-live="polite" aria-busy className="flex items-center gap-3 text-[13px] text-faint">
        <TypingDots />
        Waiting for Venice to start the reply…
      </div>
    );
  }
  const status = slot ? (
    <span className={failed ? "shrink-0 text-[11.5px] text-red-200/80" : "shimmer shrink-0 text-[11.5px] font-medium"}>
      {failed ? `version ${slot.nextVersion} wasn't saved` : `writing version ${slot.nextVersion}…`}
    </span>
  ) : undefined;
  return (
    <div aria-live="polite" aria-busy={!failed}>
      <BrainMessageFrame
        name={brain?.name ?? live.brainName ?? "Reply"}
        color={brain?.color ?? "#9aa3b0"}
        status={status}
        muse={brain && isMuse(brain) ? { for: null } : undefined}
        origin={
          slot && live.thought !== null ? (
            <SteerNote freshTake image={live.image} />
          ) : slot && live.steer ? (
            <SteerNote steer={live.steer} fromVersion={slot.fromVersion} />
          ) : null
        }
        reasoning={live.reasoning ? <Reasoning text={live.reasoning} live={live.phase === "reasoning"} /> : null}
        footer={failed ? null : FOOTER_SPACE}
      >
        {live.image ? (
          <LiveImage prompt={live.content} aspect={expectedAspect(brain)} color={brain?.color} failed={failed} />
        ) : live.content ? (
          <div className={failed ? "opacity-55" : "ss-caret"}>
            <MessageText text={live.content} writing={!failed} empty={<TypingDots />} color={brain?.color} />
          </div>
        ) : !failed && live.phase !== "reasoning" ? (
          <TypingDots />
        ) : null}
        {failed && (
          <div role="alert" className="mt-3 rounded-lg border border-red-400/25 bg-red-400/[0.07] px-3.5 py-3 text-[13px] leading-5 text-red-100">
            <p>
              {live.content ? (live.image ? "The prompt above is partial and was not saved, so no image was made. " : "The text above is partial and was not saved. ") : ""}
              {live.error}
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button size="sm" variant="secondary" onClick={onRetry}>
                <RotateCw aria-hidden className="size-3.5" /> Retry
              </Button>
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                <X aria-hidden className="size-3.5" /> {slot ? "Show the saved version" : "Dismiss"}
              </Button>
            </div>
          </div>
        )}
      </BrainMessageFrame>
    </div>
  );
}

/** As tall as a saved message's footer, so nothing jumps when the reply is saved. */
const FOOTER_SPACE = <div aria-hidden className="mt-1.5 h-7" />;

function TypingDots() {
  return (
    <div className="flex h-7 items-center gap-1" aria-label="Waiting for the reply">
      {[0, 150, 300].map((d) => (
        <span key={d} className="size-1.5 animate-pulse rounded-full bg-faint" style={{ animationDelay: `${d}ms` }} />
      ))}
    </div>
  );
}
