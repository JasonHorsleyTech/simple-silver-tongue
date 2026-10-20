import { BrainCircuit, ImagePlus, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { isMuse, type Brain, type LedgerMessage, type MessageVersion, type PinRole } from "../../api/types.ts";
import { cx } from "../../lib/cx.ts";
import { activeVersion, clockTime, fullTime } from "../../lib/format.ts";
import { rollView } from "../../lib/rolls.ts";
import { readLocal, writeLocal } from "../../lib/storage.ts";
import { mergedThought, type FreshTakeTarget } from "../../lib/thought.ts";
import { CloneMenu, type CloneSource } from "./CloneMenu.tsx";
import { expectedAspect, ImageBody } from "./ImageCard.tsx";
import { LiveReply } from "./LiveReply.tsx";
import { MessageEditor } from "./MessageEditor.tsx";
import { BrainMessageFrame, PlayerBubble, SteerNote } from "./MessageFrame.tsx";
import { CopyAction, DeleteConfirm, IconAction, MessageFooter, VersionMeta, VersionPager } from "./MessageFooter.tsx";
import { AuthorMenu, LinksBand, PinMenu } from "./MessageLinks.tsx";
import { MessageText } from "./MessageText.tsx";
import { Reasoning } from "./Reasoning.tsx";
import { RollBubble } from "./RollCard.tsx";
import { SteerBox, type RegenerateMode } from "./SteerBox.tsx";
import { IMAGE_BUSY, imagePending, type LiveReply as Live, type MessageActions, type Problem, type RegenerateAsk } from "./useChat.ts";

export { BrainMessageFrame, PlayerBubble } from "./MessageFrame.tsx";

/** Said in place when an action meets a reply in progress (the server would answer 409). */
const BUSY_HINT = "A reply is being written. Change messages once it's done, or stop it.";

type Mode = "view" | "edit" | "delete" | "steer";

/** The regenerate box's last tab (Revise or Fresh take), remembered in this browser. */
const REGEN_MODE_KEY = "ss.regenerateMode";

/**
 * One ledger message, showing its active version, with its actions:
 *   any message   edit (raw Markdown in place), delete (confirmed inline), copy
 *   brain message the ‹ 2/3 › pager when it has versions, and the steer behind the version shown
 *   last reply    Regenerate…: Revise (an optional steer) or Fresh take (your idea as a note from the Muse, right
 *                 before it, T17); the new version streams into this same slot (`live`)
 *   Muse's note   T17: a message by the Muse (the brain called Muse) has a look of its own (MessageFrame's `muse`):
 *                 a note, not a speaker, saying whose reply it is for; its actions are any message's
 *   image message the picture and its prompt (ImageCard); edit changes the prompt and paints it again, and
 *                 "Paint again" makes another image of a finished one, as a new version (both are kept)
 * A text message's hidden notes (T08) show folded (MessageText); the editor and Copy have the raw text.
 * A roll (T09) is the player's message with the die beside its line (RollBubble); edited, its line is the roll,
 * and the die's own number is only history in the footer ("🎲 d20 said 12").
 * T16: under the body, the brain this message made (Rename) and the brains it is pinned to (Unpin) (LinksBand); in
 * the footer, Pin to a brain, Said by… (change who said it), and "Make a brain" on a maker's message that has none.
 * Clone from here (CloneMenu): a new conversation with the story up to and including this message.
 * Actions show on hover or keyboard focus, and stay shown on the last message. During a reply they explain
 * why they can't run instead of failing with the server's 409, and so do those that would replace or remove
 * an image still being made (its prompt edit, its retry, the message's delete).
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
  thoughtTemplate,
  freshTarget,
  noteFor,
  thoughtBeside,
  brains,
  made,
  pins,
  freshMade,
  onOpenBrain,
  cloneSource,
  position,
}: {
  message: LedgerMessage;
  brain?: Brain;
  /** T16: every brain (Pin to, Said by). */
  brains: Brain[];
  /** T16: the brain made from this message, if it is still here. */
  made: Brain | null;
  /** T16: the brains this message is pinned to. */
  pins: Array<{ brain: Brain; as: PinRole }>;
  /** T16: `made` was made while you watched: its name field opens. */
  freshMade: boolean;
  /** T16: open a brain's card in Settings → Brains. */
  onOpenBrain(brainId: string): void;
  /** "Clone from here": the conversation this message is in, and the message's place in it (1-based). */
  cloneSource: CloneSource;
  position: number;
  /** The last thing in the scrollback: its footer stays shown. */
  isLast: boolean;
  /** The last ledger message, a brain's text: it can be regenerated. */
  canRegenerate: boolean;
  /** A regenerate of this message, streaming (or failed) in its place. */
  live?: Live;
  busy: boolean;
  actions: MessageActions;
  onPreviewRegenerate(messageId: string, ask: RegenerateAsk): void;
  onDismissLive(): void;
  /** The conversation's templates.thought, for the last message's Fresh take box (T15). */
  thoughtTemplate?: string;
  /** T17, the last message: what a fresh take on it does with the Muse's note (freshTakeTarget). */
  freshTarget?: FreshTakeTarget;
  /** T17, a Muse's note: the brain whose message comes right after it, whose reply the idea is for. */
  noteFor?: Brain | null;
  /** T17, an image version made by a fresh take: its idea is in no message above it (T15, or its note is gone), so it shows above the picture. */
  thoughtBeside?: boolean;
}) {
  const v = activeVersion(message);
  const [mode, setMode] = useState<Mode>("view");
  const [steer, setSteer] = useState("");
  const [regenMode, setRegenModeState] = useState<RegenerateMode>(() => (readLocal(REGEN_MODE_KEY) === "fresh" ? "fresh" : "revise"));
  const setRegenMode = (m: RegenerateMode) => {
    setRegenModeState(m);
    writeLocal(REGEN_MODE_KEY, m);
  };
  const [thought, setThought] = useState("");
  const [steerError, setSteerError] = useState<string | Problem | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [pending, setPending] = useState(false);
  /** "Paint again" is on its way (image.retry of a finished image). */
  const [painting, setPainting] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  /** T16: a footer menu (Pin to, Said by) is open: the footer stays shown. */
  const [menuOpen, setMenuOpen] = useState(false);
  /** T16: "Make a brain from this" is open under the body. */
  const [making, setMaking] = useState(false);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 6000);
    return () => clearTimeout(t);
  }, [hint]);
  useEffect(() => {
    if (!busy) setHint((h) => (h === BUSY_HINT ? null : h));
  }, [busy]);
  const paintingAny = imagePending(message);
  // The image landed: "wait for it" no longer applies.
  useEffect(() => {
    if (!paintingAny) setHint((h) => (h === IMAGE_BUSY ? null : h));
  }, [paintingAny]);
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
        // A fresh take's retry is a plain re-roll (T17): its note is in the ledger now, and the re-roll answers it.
        onRetry={() => void actions.regenerate(message.id, { steer: live.steer ?? "" })}
        onDismiss={onDismissLive}
      />
    );
  }

  const unlessBusy = (fn: () => void) => () => (busy ? setHint(BUSY_HINT) : fn());
  const image = message.kind === "image";
  /** Its prompt can't change, nor its image be repainted, while the image on show is being made. */
  const paintingShown = imagePending(message, "active");
  const unlessPainting = (painting: boolean, fn: () => void) => () => (painting ? setHint(IMAGE_BUSY) : fn());
  const editor = (compact?: boolean) => (
    <MessageEditor
      initial={v.content}
      busy={busy}
      compact={compact}
      kind={image ? "image" : "text"}
      versionNote={
        message.versions.length > 1
          ? `Editing version ${message.activeVersion + 1} of ${message.versions.length}`
          : v.roll
            ? "Your roll's line: every brain reads what you save"
            : undefined
      }
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
  const pinned = isLast || mode === "delete" || mode === "steer" || menuOpen;
  const pinnedTo = new Map(pins.map((p) => [p.brain.id, p.as]));
  const pinMenu = (
    <PinMenu
      brains={brains}
      pinnedTo={pinnedTo}
      onPin={(b) => actions.pin(message.id, b)}
      onUnpin={(b) => actions.unpin(message.id, b)}
      onOpenChange={setMenuOpen}
    />
  );
  const authorMenu = (
    <AuthorMenu message={message} brains={brains} busy={busy} busyHint={BUSY_HINT} onSet={(as) => actions.setAuthor(message.id, as)} onOpenChange={setMenuOpen} />
  );
  const cloneMenu = <CloneMenu source={cloneSource} position={position} messageId={message.id} onOpenChange={setMenuOpen} />;
  /** A maker's message with no brain of its own (written before the setting, or with it off): "Make a brain". */
  const canMake = !!brain?.makes && !made;
  const links = (
    <LinksBand
      made={made}
      maker={brain?.makes ? brain : null}
      pins={pins}
      fresh={freshMade}
      making={making && canMake}
      brains={brains}
      onOpenBrain={onOpenBrain}
      onRename={actions.renameBrain}
      onUnpin={(b) => actions.unpin(message.id, b)}
      onMake={async (name) => {
        const p = await actions.make(message.id, name);
        if (!p) setMaking(false);
        return p;
      }}
      onCancelMake={() => setMaking(false)}
    />
  );
  const hintLine = hint && (
    <p role="status" className={cx("text-[12.5px] leading-5 text-amber-200/85", message.author.type === "player" ? "mt-7 text-right" : "mt-1")}>
      {hint}
    </p>
  );

  if (message.author.type === "player") {
    const roll = rollView(v);
    const footer = (
      <MessageFooter align="end" pinned={mode === "delete" || menuOpen}>
        {mode === "delete" ? (
          <DeleteConfirm versions={1} pending={pending} onConfirm={() => void remove()} onCancel={() => setMode("view")} />
        ) : (
          <>
            <CopyAction text={v.content} />
            <IconAction label={roll ? "Edit the roll's line" : "Edit"} onClick={() => setMode("edit")}>
              <Pencil aria-hidden className="size-3.5" />
            </IconAction>
            {pinMenu}
            {!roll && authorMenu}
            {cloneMenu}
            <IconAction label={roll ? "Delete the roll" : "Delete"} blocked={busy} onClick={unlessBusy(() => setMode("delete"))}>
              <Trash2 aria-hidden className="size-3.5" />
            </IconAction>
            {v.edited && <span className="px-1">edited</span>}
            {roll?.history && (
              <span
                title={`What the server's die rolled. The line was edited since, and every brain reads the edited line: the honor system.`}
                className="cursor-help px-1 whitespace-nowrap"
              >
                {roll.history}
              </span>
            )}
            <time dateTime={v.createdAt} title={fullTime(v.createdAt)} className="px-1 tabular-nums">
              {clockTime(v.createdAt)}
            </time>
          </>
        )}
      </MessageFooter>
    );
    return (
      <div>
        {mode === "edit" ? (
          <div className="flex justify-end">{editor(true)}</div>
        ) : roll ? (
          <RollBubble key={v.edited ? "edited" : "rolled"} version={v} footer={footer} />
        ) : (
          <PlayerBubble footer={footer}>
            <MessageText key={message.activeVersion} text={v.content} />
            {pins.length > 0 && <div className="border-t border-line pt-1 [&_[data-links]]:mt-1.5">{links}</div>}
          </PlayerBubble>
        )}
        {hintLine}
      </div>
    );
  }

  const count = message.versions.length;
  const shownImage = v.image;
  /** T17: the Muse's message (a note), which a fresh take can't be taken on. */
  const muse = !!brain && isMuse(brain);
  const regenTab: RegenerateMode = freshTarget?.kind === "own" ? "revise" : regenMode;
  const canPaintAgain = image && shownImage?.status === "done" && !shownImage.blurred && !shownImage.contentViolation;
  const paintAgain = async () => {
    if (paintingShown) return setHint(IMAGE_BUSY);
    setPainting(true);
    const problem = await actions.repaint(message.id);
    setPainting(false);
    if (problem) setHint(problem);
  };
  /** What the box asks for: Revise sends the steer (blank: a re-roll), Fresh take the thought exactly as it stands. */
  const ask = (): RegenerateAsk => (regenTab === "fresh" ? { thought } : { steer });
  const regenerate = async () => {
    if (regenerating) return;
    if (busy) return setSteerError(BUSY_HINT);
    if (regenTab === "fresh" && !thought.trim()) return;
    setSteerError(null);
    setRegenerating(true);
    const problem = await actions.regenerate(message.id, ask());
    setRegenerating(false);
    if (problem) return setSteerError(problem); // refused up front: the box stays open with the steer or thought
    setMode("view");
    setSteer("");
    setThought("");
  };

  return (
    <>
      <BrainMessageFrame
        name={brain?.name ?? "Unknown brain"}
        color={brain?.color ?? "#9aa3b0"}
        time={v.createdAt}
        authored={v.source === "authored"}
        muse={muse ? { for: noteFor ?? null } : undefined}
        origin={
          count > 1 ? (
            <SteerNote
              steer={v.steer}
              fromVersion={v.steeredFrom !== undefined ? v.steeredFrom + 1 : null}
              repaintOf={v.repaintOf !== undefined ? v.repaintOf + 1 : null}
              freshTake={v.thought === undefined ? undefined : image ? (thoughtBeside ? "beside" : "note") : mergedThought(v) ? "merged" : "note"}
              image={image}
              // A version you wrote (T17: a fresh take's next idea for the Muse's note) was never rolled.
              reroll={message.activeVersion > 0 && v.source === "generated" && v.steer === undefined && v.repaintOf === undefined && v.thought === undefined}
            />
          ) : null
        }
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
                <DeleteConfirm versions={count} images={image} pending={pending} onConfirm={() => void remove()} onCancel={() => setMode("view")} />
              ) : (
                <>
                  {canRegenerate && !busy && (
                    <button
                      type="button"
                      aria-expanded={mode === "steer"}
                      onClick={() => setMode((m) => (m === "steer" ? "view" : "steer"))}
                      title={
                        muse
                          ? "Write this note again, as a new version: revise it with a steer, or re-roll it"
                          : image
                            ? "A new prompt and a new image, as a new version: revise it with a steer, or a fresh take from an idea of yours (a note from the Muse)"
                            : "Write this reply again: revise it with a steer, or a fresh take from an idea of yours (a note from the Muse)"
                      }
                      className={cx(
                        "mr-0.5 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors",
                        mode === "steer" ? "bg-hover text-fg" : "text-muted hover:bg-hover hover:text-fg",
                      )}
                    >
                      <RefreshCw aria-hidden className="size-3.5" /> Regenerate
                    </button>
                  )}
                  {canMake && !making && (
                    <button
                      type="button"
                      onClick={() => setMaking(true)}
                      title={`Make a brain from this message with ${brain!.name}'s blueprint, this message pinned to it (as a new message from ${brain!.name} would)`}
                      className="mr-0.5 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted transition-colors hover:bg-hover hover:text-fg"
                    >
                      <BrainCircuit aria-hidden className="size-3.5" /> Make a brain
                    </button>
                  )}
                  {canPaintAgain && (
                    <IconAction label="Paint this prompt again, as a new version (both images are kept)" blocked={paintingShown || painting} onClick={() => void paintAgain()}>
                      <ImagePlus aria-hidden className="size-3.5" />
                    </IconAction>
                  )}
                  <CopyAction text={v.content} label={image ? "Copy the prompt" : undefined} />
                  <IconAction label={image ? "Edit the prompt" : "Edit"} blocked={image && paintingShown} onClick={image ? unlessPainting(paintingShown, () => setMode("edit")) : () => setMode("edit")}>
                    <Pencil aria-hidden className="size-3.5" />
                  </IconAction>
                  {pinMenu}
                  {authorMenu}
                  {cloneMenu}
                  <IconAction label="Delete" blocked={busy || paintingAny} onClick={unlessBusy(unlessPainting(paintingAny, () => setMode("delete")))}>
                    <Trash2 aria-hidden className="size-3.5" />
                  </IconAction>
                  <VersionMeta version={v} />
                </>
              )}
            </MessageFooter>
          )
        }
      >
        {image ? (
          <>
            {/* T15: a fresh take's thought isn't in an image prompt (that goes to the image model word for word): it was kept
                beside it. T17: it is the Muse's note right above, so it shows here only when no note above has it. */}
            {thoughtBeside && v.thought !== undefined && mode !== "edit" && (
              <div key={message.activeVersion} className="mb-3">
                <p className="mb-1.5 text-[11.5px] text-faint">The fresh take's idea (display only: it is in no message above)</p>
                <MessageText text={v.thought} color={brain?.color} />
              </div>
            )}
          <ImageBody
            version={v}
            brain={brain}
            aspect={expectedAspect(brain)}
            versionLabel={count > 1 ? `version ${message.activeVersion + 1} of ${count}` : undefined}
            editor={mode === "edit" ? editor() : undefined}
            onRepaint={(o) => actions.repaint(message.id, o)}
            onEdit={unlessPainting(paintingShown, () => setMode("edit"))}
          />
          {mode !== "edit" && links}
          </>
        ) : mode === "edit" ? (
          editor()
        ) : (
          <>
            {/* Keyed by version: another version's notes start folded. */}
            <BrainBody key={message.activeVersion} version={v} color={brain?.color} />
            {links}
          </>
        )}
      </BrainMessageFrame>
      {hintLine}
      {mode === "steer" && canRegenerate && (
        <SteerBox
          mode={regenTab}
          onMode={(m) => {
            setRegenMode(m);
            setSteerError(null);
          }}
          steer={steer}
          onSteer={(s) => {
            setSteer(s);
            setSteerError(null);
          }}
          thought={thought}
          onThought={(s) => {
            setThought(s);
            setSteerError(null);
          }}
          thoughtTemplate={thoughtTemplate ?? ""}
          onSubmit={() => void regenerate()}
          onCancel={() => {
            setMode("view");
            setSteerError(null);
          }}
          onPreview={() => onPreviewRegenerate(message.id, ask())}
          error={steerError}
          image={image}
          brainName={brain?.name ?? "The brain"}
          target={freshTarget ?? { kind: "new", muse: null }}
          nextVersion={count + 1}
          fromVersion={count > 1 ? message.activeVersion + 1 : null}
          pending={regenerating}
        />
      )}
    </>
  );
});

/** A brain's text: Markdown, with its hidden notes folded. A reply that is all note is just its fold, not "No reply text". */
function BrainBody({ version: v, color }: { version: MessageVersion; color?: string }) {
  if (!v.content.trim()) return <EmptyReply version={v} />;
  return (
    <>
      <MessageText text={v.content} color={color} />
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
