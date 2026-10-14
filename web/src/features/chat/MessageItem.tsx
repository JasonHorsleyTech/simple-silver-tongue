import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import { memo, useEffect, useState } from "react";
import type { Brain, LedgerMessage, MessageVersion } from "../../api/types.ts";
import { Markdown } from "../../components/Markdown.tsx";
import { cx } from "../../lib/cx.ts";
import { activeVersion, clockTime, fullTime } from "../../lib/format.ts";
import { LiveReply } from "./LiveReply.tsx";
import { MessageEditor } from "./MessageEditor.tsx";
import { BrainMessageFrame, PlayerBubble, SteerNote } from "./MessageFrame.tsx";
import { CopyAction, DeleteConfirm, IconAction, MessageFooter, VersionMeta, VersionPager } from "./MessageFooter.tsx";
import { Reasoning } from "./Reasoning.tsx";
import { SteerBox } from "./SteerBox.tsx";
import type { LiveReply as Live, MessageActions } from "./useChat.ts";

export { BrainMessageFrame, PlayerBubble } from "./MessageFrame.tsx";

/** Said in place when an action meets a reply in progress (the server would answer 409). */
const BUSY_HINT = "A reply is being written. Change messages once it's done, or stop it.";

type Mode = "view" | "edit" | "delete" | "steer";

/**
 * One ledger message, showing its active version, with its actions:
 *   any message   edit (raw Markdown in place), delete (confirmed inline), copy
 *   brain message the ‹ 2/3 › pager when it has versions, and the steer behind the version shown
 *   last reply    Regenerate…, with an optional steer; the new version streams into this same slot (`live`)
 * Actions show on hover or keyboard focus, and stay shown on the last message. During a reply they explain
 * why they can't run instead of failing with the server's 409.
 */
export const MessageItem = memo(function MessageItem({
  message,
  brain,
  isLast,
  canRegenerate,
  live,
  busy,
  actions,
  onPreviewRegenerate,
  onDismissLive,
}: {
  message: LedgerMessage;
  brain?: Brain;
  /** The last thing in the scrollback: its footer stays shown. */
  isLast: boolean;
  /** The last ledger message, a brain's text: it can be regenerated. */
  canRegenerate: boolean;
  /** A regenerate of this message, streaming (or failed) in its place. */
  live?: Live;
  busy: boolean;
  actions: MessageActions;
  onPreviewRegenerate(messageId: string, steer: string): void;
  onDismissLive(): void;
}) {
  const v = activeVersion(message);
  const [mode, setMode] = useState<Mode>("view");
  const [steer, setSteer] = useState("");
  const [steerError, setSteerError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [pending, setPending] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 6000);
    return () => clearTimeout(t);
  }, [hint]);
  useEffect(() => {
    if (!busy) setHint((h) => (h === BUSY_HINT ? null : h));
  }, [busy]);
  // Only the last message keeps a steer box (a turn may have been sent from another tab meanwhile).
  useEffect(() => {
    if (!canRegenerate) setMode((m) => (m === "steer" ? "view" : m));
  }, [canRegenerate]);

  if (live) {
    return (
      <LiveReply
        live={live}
        brain={brain}
        slot={{ nextVersion: message.versions.length + 1, fromVersion: live.steer ? message.activeVersion + 1 : null }}
        onRetry={() => void actions.regenerate(message.id, live.steer ?? "")}
        onDismiss={onDismissLive}
      />
    );
  }

  const unlessBusy = (fn: () => void) => () => (busy ? setHint(BUSY_HINT) : fn());
  const editor = (compact?: boolean) => (
    <MessageEditor
      initial={v.content}
      busy={busy}
      compact={compact}
      versionNote={message.versions.length > 1 ? `Editing version ${message.activeVersion + 1} of ${message.versions.length}` : undefined}
      onCancel={() => setMode("view")}
      onSave={async (content) => {
        const problem = await actions.edit(message.id, content);
        if (!problem) setMode("view");
        return problem;
      }}
    />
  );
  const remove = async () => {
    setPending(true);
    const problem = await actions.remove(message.id);
    if (!problem) return; // gone from the list
    setPending(false);
    setMode("view");
    setHint(problem);
  };
  const pinned = isLast || mode === "delete" || mode === "steer";
  const hintLine = hint && (
    <p role="status" className={cx("text-[12.5px] leading-5 text-amber-200/85", message.author.type === "player" ? "mt-7 text-right" : "mt-1")}>
      {hint}
    </p>
  );

  if (message.author.type === "player") {
    return (
      <div>
        {mode === "edit" ? (
          <div className="flex justify-end">{editor(true)}</div>
        ) : (
          <PlayerBubble
            footer={
              <MessageFooter align="end" pinned={mode === "delete"}>
                {mode === "delete" ? (
                  <DeleteConfirm versions={1} pending={pending} onConfirm={() => void remove()} onCancel={() => setMode("view")} />
                ) : (
                  <>
                    <CopyAction text={v.content} />
                    <IconAction label="Edit" onClick={() => setMode("edit")}>
                      <Pencil aria-hidden className="size-3.5" />
                    </IconAction>
                    <IconAction label="Delete" blocked={busy} onClick={unlessBusy(() => setMode("delete"))}>
                      <Trash2 aria-hidden className="size-3.5" />
                    </IconAction>
                    {v.edited && <span className="px-1">edited</span>}
                    <time dateTime={v.createdAt} title={fullTime(v.createdAt)} className="px-1 tabular-nums">
                      {clockTime(v.createdAt)}
                    </time>
                  </>
                )}
              </MessageFooter>
            }
          >
            <Markdown text={v.content} />
          </PlayerBubble>
        )}
        {hintLine}
      </div>
    );
  }

  const count = message.versions.length;
  const regenerate = async () => {
    if (regenerating) return;
    if (busy) return setSteerError(BUSY_HINT);
    setSteerError(null);
    setRegenerating(true);
    const problem = await actions.regenerate(message.id, steer);
    setRegenerating(false);
    if (problem) return setSteerError(problem); // refused up front: the box stays open with the steer
    setMode("view");
    setSteer("");
  };

  return (
    <>
      <BrainMessageFrame
        name={brain?.name ?? "Unknown brain"}
        color={brain?.color ?? "#9aa3b0"}
        time={v.createdAt}
        origin={count > 1 ? <SteerNote steer={v.steer} fromVersion={v.steeredFrom !== undefined ? v.steeredFrom + 1 : null} reroll={message.activeVersion > 0 && v.steer === undefined} /> : null}
        reasoning={v.reasoning ? <Reasoning text={v.reasoning} tokens={v.usage?.reasoningTokens} /> : null}
        footer={
          mode === "edit" ? null : (
            <MessageFooter
              pinned={pinned}
              pager={
                count > 1 ? (
                  <VersionPager
                    index={message.activeVersion}
                    count={count}
                    pending={pending}
                    blocked={busy}
                    onGo={async (n) => {
                      if (busy) return setHint(BUSY_HINT);
                      setPending(true);
                      const problem = await actions.selectVersion(message.id, n);
                      setPending(false);
                      if (problem) setHint(problem);
                    }}
                  />
                ) : null
              }
            >
              {mode === "delete" ? (
                <DeleteConfirm versions={count} pending={pending} onConfirm={() => void remove()} onCancel={() => setMode("view")} />
              ) : (
                <>
                  {canRegenerate && !busy && (
                    <button
                      type="button"
                      aria-expanded={mode === "steer"}
                      onClick={() => setMode((m) => (m === "steer" ? "view" : "steer"))}
                      title="Write this reply again, optionally with a steer"
                      className={cx(
                        "mr-0.5 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors",
                        mode === "steer" ? "bg-hover text-fg" : "text-muted hover:bg-hover hover:text-fg",
                      )}
                    >
                      <RefreshCw aria-hidden className="size-3.5" /> Regenerate
                    </button>
                  )}
                  <CopyAction text={v.content} />
                  <IconAction label="Edit" onClick={() => setMode("edit")}>
                    <Pencil aria-hidden className="size-3.5" />
                  </IconAction>
                  <IconAction label="Delete" blocked={busy} onClick={unlessBusy(() => setMode("delete"))}>
                    <Trash2 aria-hidden className="size-3.5" />
                  </IconAction>
                  <VersionMeta version={v} />
                </>
              )}
            </MessageFooter>
          )
        }
      >
        {mode === "edit" ? editor() : <BrainBody version={v} />}
      </BrainMessageFrame>
      {hintLine}
      {mode === "steer" && canRegenerate && (
        <SteerBox
          value={steer}
          onChange={(s) => {
            setSteer(s);
            setSteerError(null);
          }}
          onSubmit={() => void regenerate()}
          onCancel={() => {
            setMode("view");
            setSteerError(null);
          }}
          onPreview={() => onPreviewRegenerate(message.id, steer)}
          error={steerError}
          nextVersion={count + 1}
          fromVersion={count > 1 ? message.activeVersion + 1 : null}
          pending={regenerating}
        />
      )}
    </>
  );
});

function BrainBody({ version: v }: { version: MessageVersion }) {
  if (!v.content.trim()) return <EmptyReply version={v} />;
  return (
    <>
      <Markdown text={v.content} />
      {v.finishReason === "length" && <CutOffNote />}
    </>
  );
}

function CutOffNote() {
  return (
    <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-300/20 bg-amber-300/[0.05] px-2 py-0.5 text-[12px] text-amber-100/80">
      Cut off by max_tokens
    </p>
  );
}

/** A saved reply with no text (T02 QA-6): say so plainly instead of showing a blank bubble. */
function EmptyReply({ version: v }: { version: MessageVersion }) {
  const why =
    v.finishReason === "length"
      ? v.reasoning
        ? "It ran out of max_tokens while reasoning, before writing anything."
        : "It was cut off by max_tokens before writing anything."
      : "The model returned an empty reply.";
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-3.5 py-2.5 text-[13px]">
      <p className="font-medium text-muted">No reply text</p>
      <p className="mt-0.5 text-faint">{why}</p>
    </div>
  );
}
