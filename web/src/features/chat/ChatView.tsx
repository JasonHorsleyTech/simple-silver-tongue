import { BookOpen, PenLine, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import { Button } from "../../components/Button.tsx";
import { Notice } from "../../components/Notice.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { cx } from "../../lib/cx.ts";
import { drafts } from "../../lib/drafts.ts";
import { Link } from "../../lib/router.tsx";
import { readLocal, writeLocal } from "../../lib/storage.ts";
import { useMediaQuery } from "../../lib/useMediaQuery.ts";
import { DEFAULT_SETUP_LABEL, type Brain, type Conversation } from "../../api/types.ts";
import { BrainTags } from "../conversations/Cast.tsx";
import { PayloadDialog, type PayloadRequest } from "../payload/PayloadDialog.tsx";
import { SETTINGS_TABS, SettingsPanel, type SettingsTab } from "../settings/SettingsPanel.tsx";
import { BrainBadge } from "./BrainBadge.tsx";
import { ChatHeader } from "./ChatHeader.tsx";
import { DamagedFile } from "./DamagedFile.tsx";
import { AS_PLAYER, Composer } from "./Composer.tsx";
import { Scrollback } from "./Scrollback.tsx";
import { useChat } from "./useChat.ts";

const SETTINGS_OPEN_KEY = "ss.settingsOpen";
const SETTINGS_TAB_KEY = "ss.settingsTab";

function savedTab(): SettingsTab {
  const t = readLocal(SETTINGS_TAB_KEY);
  return SETTINGS_TABS.some((x) => x.id === t) ? (t as SettingsTab) : "brains";
}

/** /c/<id>: header, scrollback and composer, with the settings beside it (docked when wide, a drawer when not). */
export function ChatView({ id }: { id: string }) {
  const chat = useChat(id);
  const { conv, loadError } = chat;
  const [draft, setDraftState] = useState(() => drafts.get(id) ?? "");
  const [settingsOpen, setSettingsOpen] = useState(() => readLocal(SETTINGS_OPEN_KEY) === "1");
  const [tab, setTabState] = useState<SettingsTab>(savedTab);
  /** Bumped to open a tab's add form from outside it (the empty conversation's "Add a brain"). */
  const [addNonce, setAddNonce] = useState({ brain: 0, setup: 0 });
  /** A setup message to open, cursor in it, once the Setup tab shows (T10: the World Bible just added). */
  const [focusSetup, setFocusSetup] = useState<string | null>(null);
  const setupFocused = useCallback(() => setFocusSetup(null), []);
  /** The composer adds words as this brain (or you) instead of sending. */
  const [writeAs, setWriteAsState] = useState<string | null>(null);
  /** T09: the die is armed: the next send rolls a d20 after the composer's words, and then switches it off. */
  const [roll, setRoll] = useState(false);
  const [payload, setPayload] = useState<{ kind: "turn"; brainId: string | null } | Extract<PayloadRequest, { kind: "regenerate" }> | null>(null);
  const previewRegenerate = useCallback((messageId: string, steer: string) => setPayload({ kind: "regenerate", messageId, steer }), []);
  const docked = useMediaQuery("(min-width: 1180px)");

  const setDraft = useCallback(
    (v: string) => {
      setDraftState(v);
      if (v) drafts.set(id, v);
      else drafts.delete(id);
    },
    [id],
  );

  const toggleSettings = useCallback((open?: boolean) => {
    setSettingsOpen((was) => {
      const next = open ?? !was;
      writeLocal(SETTINGS_OPEN_KEY, next ? "1" : null);
      return next;
    });
  }, []);

  const setTab = useCallback((t: SettingsTab) => {
    setTabState(t);
    writeLocal(SETTINGS_TAB_KEY, t);
  }, []);

  const openSettings = useCallback(
    (t: SettingsTab, add?: "brain" | "setup") => {
      toggleSettings(true);
      setTab(t);
      if (add) setAddNonce((n) => ({ ...n, [add]: n[add] + 1 }));
    },
    [toggleSettings, setTab],
  );

  /**
   * T10: a table with no world (a preset has none) gets its World Bible in one click: setup.add pre-fills it with
   * "<!-- This is the World Bible. -->", and the Setup tab opens on it with the cursor after that line.
   */
  async function writeWorldBible(): Promise<string | null> {
    try {
      const r = await api.call("setup.add", { conversation: id, label: DEFAULT_SETUP_LABEL });
      chat.patch((c) => ({ ...c, setup: r.setup }));
      setFocusSetup(r.changed ?? null);
      openSettings("setup");
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  }

  /** Writing as someone adds words with no roll: choosing to do so puts the die down. */
  const setWriteAs = useCallback((as: string | null) => {
    setWriteAsState(as);
    if (as) setRoll(false);
  }, []);

  // Another conversation: back to sending, with no roll armed.
  useEffect(() => {
    setWriteAsState(null);
    setRoll(false);
  }, [id]);

  // Escape closes the drawer (not the docked panel, which is part of the layout).
  useEffect(() => {
    if (!settingsOpen || docked) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && toggleSettings(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, docked, toggleSettings]);

  async function send(brainId?: string) {
    const text = draft;
    const withRoll = roll;
    setDraft("");
    setRoll(false); // the die is for one send
    const back = await chat.send(text, brainId, { roll: withRoll });
    // Nothing saved (refused up front, or stopped before Venice answered): give back the text, unless you've typed
    // on, and the die. Once the roll is saved, it stays down: sending again must not roll twice (T09 QA-2).
    if (back?.text && !drafts.get(id)) setDraft(back.text);
    if (back?.roll) setRoll(true);
  }

  /** "Just roll": the die goes in as your message, no brain is asked (message.roll). The composer's words stay. */
  async function justRoll(): Promise<string | null> {
    const problem = await chat.roll();
    if (!problem) setRoll(false);
    return problem;
  }

  /** The composer's text, added as `writeAs` (message.add): back to sending once it is in. */
  async function addAs(): Promise<string | null> {
    if (!writeAs) return null;
    const problem = await chat.add(writeAs, draft);
    if (!problem) {
      setDraft("");
      setWriteAs(null);
    }
    return problem;
  }

  if (loadError?.code === "unreadable_file") return <DamagedFile error={loadError} />;
  if (loadError) {
    return (
      <div className="flex min-h-full items-center justify-center px-6 py-16 text-center">
        <div className="max-w-sm">
          <h1 className="text-lg font-semibold">{loadError.code === "not_found" ? "No such conversation" : "Couldn't open this conversation"}</h1>
          <p className="mt-2 text-sm leading-6 text-muted">{loadError.message}</p>
          <Link to="/" className="mt-5 inline-block text-sm text-silver underline decoration-line-strong underline-offset-4 hover:decoration-silver">
            Start a new one
          </Link>
        </div>
      </div>
    );
  }

  if (!conv) {
    return (
      <div className="flex h-full items-center justify-center text-faint" aria-busy="true">
        <Spinner className="size-5" />
      </div>
    );
  }

  const brain = conv.brains.find((b) => b.id === conv.defaultBrainId) ?? conv.brains[0]!;
  const brainOf = (messageId: string) => {
    const m = conv.messages.find((x) => x.id === messageId);
    return (m?.author.type === "brain" && conv.brains.find((b) => b.id === (m.author as { brainId: string }).brainId)) || brain;
  };
  const live = chat.live;
  const liveBrain = live?.brainName ?? brain.name;
  const status =
    live?.kind === "regenerate" && live.messageId
      ? `${liveBrain} is writing version ${(conv.messages.find((m) => m.id === live.messageId)?.versions.length ?? 0) + 1}${live.image ? "'s prompt" : ""}`
      : live?.image
        ? `${liveBrain} is writing an image prompt`
        : `${liveBrain} is replying`;
  const notice = chat.notice;
  const panel = (
    <SettingsPanel
      conv={conv}
      tab={tab}
      onTab={setTab}
      busy={chat.busy}
      writingBrainId={chat.busy ? (live?.brainId ?? null) : null}
      addBrainNonce={addNonce.brain}
      addSetupNonce={addNonce.setup}
      focusSetupId={focusSetup}
      onSetupFocused={setupFocused}
      onClose={() => toggleSettings(false)}
      onConversation={chat.replaceConversation}
      onBrain={chat.replaceBrain}
      onPatch={chat.patch}
      onPayload={(brainId) => setPayload({ kind: "turn", brainId })}
    />
  );

  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          conv={conv}
          onRenamed={chat.replaceConversation}
          onOpenPayload={() => setPayload({ kind: "turn", brainId: null })}
          settingsOpen={settingsOpen}
          onToggleSettings={() => toggleSettings()}
        />
        <Scrollback
          conv={conv}
          chat={chat}
          onRetry={() => void chat.retry()}
          onPreviewRegenerate={previewRegenerate}
          empty={
            <EmptyConversation
              conv={conv}
              brain={brain}
              onSettings={openSettings}
              onWriteWorldBible={writeWorldBible}
              onWriteOpening={() => setWriteAs(brain.kind === "text" ? brain.id : (conv.brains.find((b) => b.kind === "text")?.id ?? AS_PLAYER))}
            />
          }
        />
        {notice && (
          <div className="mx-auto w-full max-w-3xl px-4 pb-2 sm:px-6">
            <Notice tone={notice.tone}>
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <p className={notice.tone === "info" ? "text-fg" : undefined}>{notice.message}</p>
                  {notice.note && <p className="mt-0.5 text-faint">{notice.note}</p>}
                </div>
                <button type="button" onClick={chat.dismissNotice} aria-label="Dismiss" className="-m-0.5 rounded p-0.5 opacity-70 hover:opacity-100">
                  <X aria-hidden className="size-3.5" />
                </button>
              </div>
            </Notice>
          </div>
        )}
        <Composer
          value={draft}
          onChange={(v) => {
            setDraft(v);
            if (chat.notice) chat.dismissNotice();
          }}
          onSend={(b) => void send(b)}
          onAdd={addAs}
          writeAs={writeAs}
          onWriteAs={setWriteAs}
          brains={conv.brains}
          defaultBrainId={conv.defaultBrainId}
          busy={chat.busy}
          status={status}
          onStop={() => void chat.stop()}
          stopping={chat.stopping}
          roll={roll}
          onRoll={setRoll}
          onJustRoll={justRoll}
          autoFocus
        />
      </div>

      {settingsOpen &&
        (docked ? (
          <aside aria-label="Settings" className="w-[420px] shrink-0 border-l border-line">
            {panel}
          </aside>
        ) : (
          <div className="fixed inset-0 z-40">
            <div className="absolute inset-0 bg-black/55" onClick={() => toggleSettings(false)} />
            <aside aria-label="Settings" className="absolute inset-y-0 right-0 w-[min(440px,92vw)] border-l border-line shadow-2xl shadow-black/60">
              {panel}
            </aside>
          </div>
        ))}

      {payload && (
        <PayloadDialog
          conversationId={conv.id}
          brains={conv.brains}
          brainId={payload.kind === "regenerate" ? brainOf(payload.messageId).id : (payload.brainId ?? brain.id)}
          // In "write as" mode the composer's text isn't a message to anyone, so it isn't in the preview. An armed
          // die is (T09): the preview then has the roll's line, with {{roll}} where the number will go.
          request={payload.kind === "regenerate" ? payload : { kind: "turn", draft: writeAs ? "" : draft, roll: roll && !writeAs }}
          onClose={() => setPayload(null)}
        />
      )}
    </div>
  );
}

/**
 * A fresh conversation: who is listening and what the default brain was told, so nothing about it is hidden,
 * then the three things a campaign is set up with: the brains, the setup messages, and an opening in a brain's
 * own words. Each opens where it is done. A plain chat can ignore all of it and just type. A table of brains
 * with no world yet (T10: every conversation started from a preset) is pointed at its World Bible first.
 */
function EmptyConversation({
  conv,
  brain,
  onSettings,
  onWriteWorldBible,
  onWriteOpening,
}: {
  conv: Conversation;
  brain: Brain;
  onSettings(tab: SettingsTab, add?: "brain" | "setup"): void;
  /** Adds the World Bible and opens it; resolves to a problem to show, or null. */
  onWriteWorldBible(): Promise<string | null>;
  onWriteOpening(): void;
}) {
  const row = "flex items-center gap-3 px-4 py-3";
  const link = "shrink-0 rounded-md px-2 py-1 text-[12.5px] text-muted transition-colors hover:bg-hover hover:text-fg";
  const several = conv.brains.length > 1;
  const noWorld = several && conv.setup.length === 0;
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function writeWorld() {
    if (pending) return;
    setPending(true);
    setProblem(null);
    const p = await onWriteWorldBible();
    setPending(false);
    setProblem(p);
  }

  return (
    <div className="mx-auto mt-[9vh] max-w-xl">
      <div className="text-center">
        <BrainBadge name={brain.name} color={brain.color} />
        <p className="mt-4 text-[13px] text-faint">{several ? `${brain.name}'s system prompt (the default brain)` : "System prompt"}</p>
        <blockquote className="mx-auto mt-2 line-clamp-5 max-w-lg text-[14.5px] leading-6 whitespace-pre-wrap text-muted">{brain.systemPrompt}</blockquote>
        <button
          type="button"
          onClick={() => onSettings("brains")}
          className="mt-3 text-[12.5px] text-faint underline decoration-line-strong underline-offset-4 hover:text-muted"
        >
          Edit in settings
        </button>
      </div>

      {noWorld && (
        <section aria-labelledby="no-world" className="mt-9 rounded-xl border border-focus/35 bg-focus/[0.06] px-4 py-4 sm:px-5">
          <div className="flex items-start gap-3">
            <BookOpen aria-hidden className="mt-0.5 size-4.5 shrink-0 text-focus" />
            <div className="min-w-0 flex-1">
              <h2 id="no-world" className="text-[14px] font-semibold text-silver-hi">
                Write the World Bible first
              </h2>
              <p className="mt-1 text-[13px] leading-5 text-muted">
                These brains know how to play, not where. Say what kind of story it is, who you play, and where tonight begins: every brain reads it before
                anything else, word for word.
              </p>
              {problem && (
                <Notice tone="error" className="mt-3">
                  {problem}
                </Notice>
              )}
              <Button variant="primary" size="sm" className="mt-3.5" loading={pending} onClick={() => void writeWorld()}>
                <BookOpen aria-hidden className="size-4" /> Write the World Bible
              </Button>
            </div>
          </div>
        </section>
      )}

      <div className={cx("divide-y divide-line rounded-xl border border-line bg-panel/60 text-[13px]", noWorld ? "mt-4" : "mt-9")}>
        <div className={row}>
          <span className="w-24 shrink-0 text-faint">Brains</span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
            {conv.brains.map((b) => (
              <span key={b.id} className="inline-flex max-w-full items-center gap-1">
                <BrainBadge name={b.name} color={b.color} />
                <BrainTags kind={b.kind} reasoning={b.reasoning.enabled ? b.reasoning.effort : null} />
              </span>
            ))}
          </span>
          <button type="button" className={link} onClick={() => onSettings("brains", "brain")}>
            <Plus aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />
            Add a brain
          </button>
        </div>
        <div className={row}>
          <span className="w-24 shrink-0 text-faint">Setup</span>
          <span className="min-w-0 flex-1 truncate text-muted">
            {conv.setup.length ? conv.setup.map((s) => s.label).join(" · ") : <span className="text-faint">Nothing every brain reads first, yet</span>}
          </span>
          <button type="button" className={link} onClick={() => onSettings("setup", conv.setup.length ? undefined : "setup")}>
            {conv.setup.length ? (
              "Edit"
            ) : (
              <>
                <Plus aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />
                {noWorld ? "Add a setup message" : "Add a World Bible"}
              </>
            )}
          </button>
        </div>
        <div className={row}>
          <span className="w-24 shrink-0 text-faint">Opening</span>
          <span className="min-w-0 flex-1 text-faint">
            {several && brain.kind === "text"
              ? `Write the first scene yourself, or press Send with nothing typed and ${brain.name} opens it.`
              : "Write the first scene yourself, or just send a message below."}
          </span>
          <button type="button" className={link} onClick={onWriteOpening}>
            <PenLine aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />
            Write as {brain.kind === "text" ? brain.name : "…"}
          </button>
        </div>
      </div>
    </div>
  );
}
