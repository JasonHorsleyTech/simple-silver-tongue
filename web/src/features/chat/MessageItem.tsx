import { Check, Copy } from "lucide-react";
import { memo, useState, type ReactNode } from "react";
import type { Brain, LedgerMessage, MessageVersion } from "../../api/types.ts";
import { Markdown } from "../../components/Markdown.tsx";
import { copyText } from "../../lib/clipboard.ts";
import { cx } from "../../lib/cx.ts";
import { activeVersion, clockTime, formatUsd, fullTime } from "../../lib/format.ts";
import { BrainBadge } from "./BrainBadge.tsx";
import { Reasoning } from "./Reasoning.tsx";

/**
 * One ledger message, showing its active version. The layout has fixed slots so later tickets add to it
 * rather than rewrite it:
 *   header  author badge (T04: one color per brain) and time
 *   body    rendered Markdown (T03: swapped for a raw-Markdown textarea while editing)
 *   footer  actions and meta (T03: edit, delete, regenerate with a steer, the ‹ 2/3 › version pager)
 */
export const MessageItem = memo(function MessageItem({ message, brain, isLast }: { message: LedgerMessage; brain?: Brain; isLast: boolean }) {
  const v = activeVersion(message);
  if (message.author.type === "player") {
    return (
      <PlayerBubble footer={<MessageFooter version={v} actions={<CopyAction text={v.content} />} align="end" />}>
        <Markdown text={v.content} />
      </PlayerBubble>
    );
  }
  return (
    <BrainMessageFrame
      name={brain?.name ?? "Unknown brain"}
      color={brain?.color ?? "#9aa3b0"}
      time={v.createdAt}
      reasoning={v.reasoning ? <Reasoning text={v.reasoning} tokens={v.usage?.reasoningTokens} /> : null}
      footer={<MessageFooter version={v} actions={<CopyAction text={v.content} />} meta={<UsageMeta version={v} />} pinned={isLast} />}
    >
      {v.content.trim() ? (
        <>
          <Markdown text={v.content} />
          {v.finishReason === "length" && <CutOffNote />}
        </>
      ) : (
        <EmptyReply version={v} />
      )}
    </BrainMessageFrame>
  );
});

/** The player's message: a quiet bubble on the right. Its footer floats in the gap below, shown on hover. */
export function PlayerBubble({ children, footer, pending }: { children: ReactNode; footer?: ReactNode; pending?: boolean }) {
  return (
    <div className="group relative flex flex-col items-end">
      <div
        className={cx(
          "max-w-[min(85%,40rem)] rounded-2xl rounded-br-md border border-line bg-raised px-4 py-2.5 [&_.md]:text-[15px]",
          pending && "opacity-60",
        )}
      >
        {children}
      </div>
      {footer && <div className="absolute top-full right-0">{footer}</div>}
    </div>
  );
}

/** A brain's message: badge on top, then the body at full column width. Live replies use the same frame. */
export function BrainMessageFrame({
  name,
  color,
  time,
  reasoning,
  children,
  footer,
}: {
  name: string;
  color: string;
  time?: string;
  reasoning?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="group">
      <div className="mb-2 flex items-center gap-2">
        <BrainBadge name={name} color={color} />
        {time && (
          <time dateTime={time} title={fullTime(time)} className="text-[11.5px] text-faint tabular-nums">
            {clockTime(time)}
          </time>
        )}
      </div>
      {reasoning}
      {children}
      {footer}
    </div>
  );
}

function MessageFooter({
  version,
  actions,
  meta,
  align = "start",
  pinned,
}: {
  version: MessageVersion;
  actions: ReactNode;
  meta?: ReactNode;
  align?: "start" | "end";
  pinned?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex items-center gap-1 text-[11.5px] text-faint transition-opacity",
        align === "end" ? "mt-0.5 h-6" : "mt-1.5 h-7",
        align === "end" && "flex-row-reverse",
        pinned ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100",
      )}
    >
      {actions}
      {version.edited && <span className="px-1">edited</span>}
      {meta}
      {align === "end" && (
        <time dateTime={version.createdAt} title={fullTime(version.createdAt)} className="px-1 tabular-nums">
          {clockTime(version.createdAt)}
        </time>
      )}
    </div>
  );
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy the Markdown"
      aria-label={copied ? "Copied" : "Copy the Markdown"}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
      className="grid size-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-fg"
    >
      {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
    </button>
  );
}

function UsageMeta({ version: v }: { version: MessageVersion }) {
  if (!v.usage && v.costUsd === undefined) return null;
  const bits: string[] = [];
  if (v.usage) bits.push(`${v.usage.promptTokens} in`, `${v.usage.completionTokens} out`);
  if (v.costUsd !== undefined) bits.push(formatUsd(v.costUsd));
  const title = [v.model, v.finishReason && `finish: ${v.finishReason}`, v.usage?.reasoningTokens && `${v.usage.reasoningTokens} reasoning tokens`]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="px-1 tabular-nums" title={title || undefined}>
      {bits.join(" · ")}
    </span>
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
