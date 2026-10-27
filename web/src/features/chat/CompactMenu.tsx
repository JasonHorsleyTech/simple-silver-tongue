import { Braces, Plus, RefreshCw, ScrollText } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import { compactionCut, isCompactor, type Conversation } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { compactOffer } from "../../lib/compaction.ts";
import { cx } from "../../lib/cx.ts";
import { usePresets } from "../conversations/library.ts";
import { BrainBadge } from "./BrainBadge.tsx";
import { FooterMenu } from "./MessageLinks.tsx";
import type { MessageActions, Problem } from "./useChat.ts";

/**
 * T20, "Compact through here" on a message (message.compact --message): a compaction brain sums up the story up to and
 * including this message, and its summary goes in right after it; from then on every brain reads the summary instead
 * of the messages before it. The menu says so in a line, with what happens this time (the server's rule, mirrored by
 * `compactOffer` and tested against planCompact): a new compaction, a new version of the one right below, or refused
 * (above the newest compaction). With several compaction brains it asks which; with none, it offers a preset's.
 * Payload opens prompt.preview --compact; the size line is that preview's estimate, which says it is one.
 *
 * `again`: the newest compaction's own "Compact again" (a new version of it, through the message right before it),
 * with its own brain: the one way to re-roll a compaction that isn't the last message.
 */
export function CompactMenu({
  messageId,
  getConv,
  busy,
  busyHint,
  actions,
  onPreview,
  onOpenChange,
  onProblem,
  again,
}: {
  /** The message to compact through. */
  messageId: string;
  getConv(): Conversation;
  busy: boolean;
  busyHint: string;
  actions: Pick<MessageActions, "compact" | "importBrain">;
  onPreview(messageId: string, brainId: string): void;
  onOpenChange(open: boolean): void;
  /** A refusal that came back after the menu closed (the compaction didn't start). */
  onProblem(p: string | Problem): void;
  /** "Compact again" on the newest compaction: its brain, fixed. */
  again?: { brainId: string };
}) {
  return (
    <FooterMenu
      label={again ? "Write this compaction again, as a new version" : "Compact through here"}
      icon={<ScrollText aria-hidden className="size-3.5" />}
      role="dialog"
      onOpenChange={onOpenChange}
      trigger={
        again
          ? (open, toggle) => (
              <button
                type="button"
                aria-expanded={open}
                onClick={toggle}
                title="Write this compaction again from the same messages, as a new version (the pager keeps this one)"
                className={cx(
                  "mr-0.5 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors",
                  open ? "bg-hover text-fg" : "text-muted hover:bg-hover hover:text-fg",
                )}
              >
                <RefreshCw aria-hidden className="size-3.5" /> Compact again
              </button>
            )
          : undefined
      }
    >
      {(close) => (
        <CompactForm
          messageId={messageId}
          conv={getConv()}
          busy={busy}
          busyHint={busyHint}
          actions={actions}
          fixedBrain={again?.brainId}
          onPreview={(brainId) => {
            close();
            onPreview(messageId, brainId);
          }}
          onStart={async (brainId, version) => {
            close();
            const p = await actions.compact(messageId, brainId, version);
            if (p) onProblem(p);
          }}
        />
      )}
    </FooterMenu>
  );
}

function CompactForm({
  messageId,
  conv,
  busy,
  busyHint,
  actions,
  fixedBrain,
  onPreview,
  onStart,
}: {
  messageId: string;
  conv: Conversation;
  busy: boolean;
  busyHint: string;
  actions: Pick<MessageActions, "importBrain">;
  fixedBrain?: string;
  onPreview(brainId: string): void;
  onStart(brainId: string, version?: string): void;
}) {
  const compactors = conv.brains.filter(isCompactor);
  // Several compaction brains: the one that wrote the newest compaction is the likely one.
  const [picked, setPicked] = useState<string | undefined>(() => {
    if (fixedBrain) return fixedBrain;
    const cut = conv.messages[compactionCut(conv, conv.messages)];
    return cut?.author.type === "brain" ? cut.author.brainId : undefined;
  });
  const offer = compactOffer(conv, messageId, picked);
  const message = conv.messages.find((m) => m.id === messageId);
  const last = conv.messages.at(-1)?.id === messageId;
  const sendable = offer.kind === "new" || offer.kind === "version";
  const brainId = sendable ? offer.brain.id : undefined;
  // The Compact button takes the keys at once (Enter compacts, Escape closes), without scrolling the scrollback to it.
  const go = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (window.matchMedia("(hover: hover)").matches) go.current?.focus({ preventScroll: true });
  }, [sendable]);

  // What it would cost: prompt.preview --compact's estimate (the same request message.compact sends).
  const [size, setSize] = useState<{ tokens: number } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    if (!brainId) return;
    let live = true;
    setSize(null);
    setRefusal(null);
    api.call("prompt.preview", { conversation: conv.id, compact: true, message: messageId, brain: brainId }).then(
      (p) => live && (setSize(p.size), setRefusal(p.refusal ?? null)),
      (err) => live && setRefusal(errorMessage(err)),
    );
    return () => {
      live = false;
    };
  }, [conv.id, messageId, brainId]);

  return (
    <div className="space-y-2.5 p-1.5 text-[12.5px] leading-[1.45] text-muted">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
        <ScrollText aria-hidden className="size-3.5 text-faint" /> {fixedBrain ? "Compact again" : "Compact through here"}
      </p>

      {offer.kind === "none" ? (
        <NoCompactor importBrain={actions.importBrain} />
      ) : (
        <>
          {compactors.length > 1 && !fixedBrain && (
            <div role="radiogroup" aria-label="Which brain writes the compaction" className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-faint">Written by</span>
              {compactors.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={picked === b.id}
                  onClick={() => setPicked(b.id)}
                  className={cx("rounded-full transition-opacity", picked === b.id ? "opacity-100" : "opacity-50 hover:opacity-85")}
                >
                  <BrainBadge name={b.name} color={b.color} className={picked === b.id ? "ring-1 ring-white/25" : undefined} />
                </button>
              ))}
            </div>
          )}
          {offer.kind === "pick" && <p>Several brains here write compactions: which one sums up the story?</p>}
          {offer.kind === "compaction" && <p>This message is a compaction itself, so there is nothing new to compact through it.</p>}
          {offer.kind === "above" && (
            <p>
              The newest compaction, below, already sums up the story past this message: a compaction here would be left out of every request at once. Compact a
              later message, or delete that compaction first.
            </p>
          )}
          {offer.kind === "version" && (
            <p>
              <Name brain={offer.brain} /> writes {fixedBrain ? "this compaction" : "the compaction right below"} again, from the same {offer.count} message
              {offer.count === 1 ? "" : "s"}, as its version {offer.version}. The pager keeps the one it has now.
            </p>
          )}
          {offer.kind === "new" && (
            <>
              <p>
                <Name brain={offer.brain} /> sums up the story up to and including this message ({offer.count} message{offer.count === 1 ? "" : "s"}), and its
                summary goes in right after it. From then on every brain reads the summary instead of them
                {offer.after > 0 ? `; the ${offer.after === 1 ? "message" : `${offer.after} messages`} after it stay${offer.after === 1 ? "s" : ""} as ${offer.after === 1 ? "it is" : "they are"}` : ""}.
              </p>
              <p className="text-faint">Nothing is deleted: they fold away here, and deleting the compaction brings them back.</p>
              {last && message?.author.type === "player" && (
                <p className="text-faint">Your message here is then only in the summary: the next reply reads it there, not word for word.</p>
              )}
            </>
          )}
          {sendable && (
            <p className="min-h-4 text-[12px] text-faint" title="prompt.preview --compact's estimate: about 4.4 characters a token, plus 4 a message. Venice counts it once it is sent.">
              {refusal ? (
                <span className="text-amber-200/85">{refusal}</span>
              ) : size ? (
                `${offer.brain.name} reads about ${size.tokens.toLocaleString("en-US")} tokens (an estimate).`
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner className="size-3" /> Measuring the request…
                </span>
              )}
            </p>
          )}
          {sendable && busy && <p className="text-amber-200/85">{busyHint}</p>}
          {sendable && (
            <div className="flex items-center gap-1.5 pt-0.5">
              <Button size="sm" variant="ghost" className="-ml-1 h-7 px-2 text-[12.5px]" onClick={() => onPreview(offer.brain.id)} title="The exact request it would send">
                <Braces aria-hidden className="size-3.5" /> Payload
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto h-7 px-2.5 text-[12.5px]"
                ref={go}
                disabled={busy || !!refusal}
                onClick={() => onStart(offer.brain.id, offer.kind === "version" ? offer.compaction : undefined)}
              >
                <ScrollText aria-hidden className="size-3.5" /> {offer.kind === "version" ? `Write version ${offer.version}` : "Compact"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const Name = ({ brain }: { brain: { name: string; color: string } }) => (
  <span className="font-medium" style={{ color: `color-mix(in oklab, ${brain.color} 62%, white)` }}>
    {brain.name}
  </span>
);

/**
 * No brain here writes compactions: say what one does, and offer a preset's (brain.import), or the setting on one of
 * your own brains. The browser knows no preset by name: it offers whichever preset brains have the setting.
 */
function NoCompactor({ importBrain }: { importBrain: MessageActions["importBrain"] }) {
  const { items } = usePresets();
  const offers = (items ?? []).flatMap((p) => p.brains.filter((b) => b.compacts).map((b) => ({ preset: p.name, title: p.title, brain: b })));
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <>
      <p>
        No brain here writes compactions yet. A compaction brain sums up the story so far in one message, and from then on every brain reads that summary
        instead of the messages before it: smaller requests, for every brain.
      </p>
      {offers.map((o) => (
        <button
          key={`${o.preset}/${o.brain.name}`}
          type="button"
          disabled={pending !== null}
          title={o.brain.about}
          onClick={async () => {
            setPending(o.brain.name);
            setProblem(null);
            const p = await importBrain(o.preset, o.brain.name);
            setPending(null);
            setProblem(p);
          }}
          className="flex w-full items-start gap-1.5 rounded-md border border-line-strong bg-raised px-2.5 py-1.5 text-left text-[12.5px] text-fg transition-colors hover:bg-hover disabled:cursor-wait"
        >
          {pending === o.brain.name ? <Spinner className="mt-0.5 size-3.5 shrink-0" /> : <Plus aria-hidden className="mt-0.5 size-3.5 shrink-0" />}
          <span>
            Add the {o.title} preset's <span className="font-medium">{o.brain.name}</span>
          </span>
        </button>
      ))}
      {problem && <p className="text-red-200">{problem}</p>}
      <p className="text-faint">Or switch “Its messages are compactions” on in one of your brains' cards (Settings → Brains).</p>
    </>
  );
}
