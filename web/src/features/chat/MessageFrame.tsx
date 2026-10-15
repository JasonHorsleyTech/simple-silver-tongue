import { CornerDownRight, PenLine, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../../lib/cx.ts";
import { clockTime, fullTime } from "../../lib/format.ts";
import { BrainBadge } from "./BrainBadge.tsx";

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

/**
 * A brain's message: badge on top (with the time, or what is being written, and the steer behind the version
 * shown), then the body beside a thin rail in the brain's color, so who is speaking stays clear deep inside a
 * long reply and at a glance down a long campaign. Live replies use the same frame, so nothing jumps when one
 * is saved.
 *
 * T17, `muse`: the Muse's note. It is an idea for a reply, not a turn in the story, so it doesn't wear a speaker's
 * badge: a sparkle and "Muse's note for Game Master" (the brain whose message follows it), "written by you" (a fresh
 * take's, or one you wrote as the Muse) or "its own idea" (the Muse's turn), and a dotted rail. It sits close above
 * the reply it is for.
 */
export function BrainMessageFrame({
  name,
  color,
  time,
  authored,
  status,
  origin,
  reasoning,
  children,
  footer,
  muse,
}: {
  name: string;
  color: string;
  time?: string;
  /** Words you put in this brain's mouth (message.add), not generated. */
  authored?: boolean;
  /** In place of the time: "writing version 4…". */
  status?: ReactNode;
  /** Where the version shown came from (SteerNote). */
  origin?: ReactNode;
  reasoning?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** T17: a note from the Muse, for `for` (the brain whose message comes right after it), if any. */
  muse?: { for: { name: string; color: string } | null };
}) {
  if (muse) {
    return (
      <MuseNoteFrame name={name} color={color} time={time} authored={authored} status={status} origin={origin} reasoning={reasoning} footer={footer} noteFor={muse.for}>
        {children}
      </MuseNoteFrame>
    );
  }
  return (
    <div className="group">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <BrainBadge name={name} color={color} className="shrink-0" />
        {status ??
          (time && (
            <time dateTime={time} title={fullTime(time)} className="shrink-0 text-[11.5px] text-faint tabular-nums">
              {clockTime(time)}
            </time>
          ))}
        {authored && (
          <span
            title={`You wrote this in ${name}'s mouth. ${name} sees it as its own reply; the other brains see it framed with its name.`}
            className="flex shrink-0 cursor-help items-center gap-1 text-[11.5px] text-faint"
          >
            <span aria-hidden className="text-line-strong">
              ·
            </span>
            <PenLine aria-hidden className="size-3" /> written by you
          </span>
        )}
        {origin}
      </div>
      <div className="ml-[10px] border-l-2 pl-[17px]" style={{ borderColor: `color-mix(in oklab, ${color} 32%, transparent)` }}>
        {reasoning}
        {children}
      </div>
      {footer && <div className="ml-[10px] pl-[13px]">{footer}</div>}
    </div>
  );
}

function MuseNoteFrame({
  name,
  color,
  time,
  authored,
  status,
  origin,
  reasoning,
  children,
  footer,
  noteFor,
}: {
  name: string;
  color: string;
  time?: string;
  authored?: boolean;
  status?: ReactNode;
  origin?: ReactNode;
  reasoning?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  noteFor: { name: string; color: string } | null;
}) {
  const ink = `color-mix(in oklab, ${color} 62%, white)`;
  return (
    <div className="group" data-muse-note>
      <div className="mb-1.5 flex min-w-0 items-center gap-2 text-[12px]">
        <span
          title={`A note from ${name}: every brain reads it here, framed as ${name}'s, and the player sees it folded. Edit, re-version or delete it like any message.`}
          className="flex min-w-0 cursor-help items-center gap-1.5"
        >
          <Sparkles aria-hidden className="size-3.5 shrink-0" style={{ color }} />
          <span className="shrink-0 font-medium" style={{ color: ink }}>
            {name}'s note
          </span>
          <span className="min-w-0 truncate text-faint">
            for{" "}
            {noteFor ? (
              <span className="font-medium" style={{ color: `color-mix(in oklab, ${noteFor.color} 62%, white)` }}>
                {noteFor.name}
              </span>
            ) : (
              "the next reply"
            )}
          </span>
        </span>
        {status ??
          (time && (
            <time dateTime={time} title={fullTime(time)} className="shrink-0 text-[11.5px] text-faint tabular-nums">
              {clockTime(time)}
            </time>
          ))}
        {!status && (
          <span
            title={
              authored
                ? `Your idea, written as ${name}'s (a fresh take, or Write as… ${name}). Every brain reads it; the one it is for carries it out.`
                : `${name} wrote this idea on a turn of its own (its button in the composer).`
            }
            className="flex shrink-0 cursor-help items-center gap-1 text-[11.5px] text-faint"
          >
            <span aria-hidden className="text-line-strong">
              ·
            </span>
            {authored ? (
              <>
                <PenLine aria-hidden className="size-3" /> written by you
              </>
            ) : (
              "its own idea"
            )}
          </span>
        )}
        {origin}
      </div>
      <div className="ml-[6px] border-l-2 border-dotted pl-[20px]" style={{ borderColor: `color-mix(in oklab, ${color} 60%, transparent)` }}>
        {reasoning}
        {children}
      </div>
      {footer && <div className="ml-[6px] pl-[16px]">{footer}</div>}
    </div>
  );
}

/**
 * Where a version came from: the steer that produced it (and which version it revised), a fresh take (T15, T17), or
 * a plain re-roll. Display only: the steer was sent once, with the request that wrote this version, and never again.
 * A fresh take's idea isn't repeated here (it is usually a hidden note): since T17 it is the Muse's note right above
 * the message (`note`); a T15 text version starts with it (`merged`), and a T15 image version, or one whose note
 * is gone, shows it above the picture (`beside`).
 */
export function SteerNote({
  steer,
  fromVersion,
  reroll,
  repaintOf,
  freshTake,
  image,
}: {
  steer?: string | null;
  fromVersion?: number | null;
  reroll?: boolean;
  /** An image version painted again from version N's prompt (image.retry of a finished image), 1-based. */
  repaintOf?: number | null;
  /** A fresh take: `note` (T17: it answered the Muse's note above it; `true` is the same), `merged` or `beside` (T15). */
  freshTake?: boolean | "note" | "merged" | "beside";
  image?: boolean;
}) {
  if (!steer && !reroll && !repaintOf && !freshTake) return null;
  const title = freshTake
    ? freshTake === "merged"
      ? "A fresh take (from before 2026-10-15): written after a thought planted as the brain's own words. The version starts with that thought, and every later request carries it. It never saw the version before."
      : freshTake === "beside"
        ? "A fresh take: painted from the idea shown above the picture, which is in no message (a T15 fresh take, or its note was deleted since); it was sent with that request only. It never saw the version before."
        : `A fresh take: ${image ? "a new prompt" : "written"} in answer to the Muse's note right above it, your idea. It never saw the version before. Every brain reads the note, where it is, until you edit or delete it.`
    : steer
    ? `The steer behind this version${fromVersion ? `, which revised version ${fromVersion}` : ""}. It was sent once, with that request only.`
    : repaintOf
      ? `Painted again from version ${repaintOf}'s prompt, word for word: another image of the same prompt. Both images are kept.`
      : "A plain re-roll: written again from the messages before it, without a steer.";
  return (
    <span title={title} className="flex min-w-0 items-center gap-1 text-[12px] text-faint">
      <span aria-hidden className="text-line-strong">
        ·
      </span>
      {freshTake ? <Sparkles aria-hidden className="size-3.5 shrink-0" /> : <CornerDownRight aria-hidden className="size-3.5 shrink-0" />}
      {freshTake ? (
        <span>fresh take</span>
      ) : steer ? (
        <>
          <span className="shrink-0">steered</span>
          <span className="min-w-0 truncate text-muted">“{steer}”</span>
          {fromVersion ? <span className="shrink-0">on v{fromVersion}</span> : null}
        </>
      ) : repaintOf ? (
        <span>same prompt as v{repaintOf}</span>
      ) : (
        <span>re-roll</span>
      )}
    </span>
  );
}
