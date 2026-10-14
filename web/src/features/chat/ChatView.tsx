import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Notice } from "../../components/Notice.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { Link } from "../../lib/router.tsx";
import { readLocal, writeLocal } from "../../lib/storage.ts";
import { useMediaQuery } from "../../lib/useMediaQuery.ts";
import { PayloadDialog, type PayloadRequest } from "../payload/PayloadDialog.tsx";
import { SettingsPanel } from "../settings/SettingsPanel.tsx";
import { BrainBadge } from "./BrainBadge.tsx";
import { ChatHeader } from "./ChatHeader.tsx";
import { Composer } from "./Composer.tsx";
import { Scrollback } from "./Scrollback.tsx";
import { useChat } from "./useChat.ts";

/**
 * Unsent text per conversation, kept while you move between conversations. Memory only: for an encrypted
 * user, a draft must not land in the browser's storage on disk.
 */
const drafts = new Map<string, string>();

const SETTINGS_OPEN_KEY = "ss.settingsOpen";

/** /c/<id>: header, scrollback and composer, with the settings beside it (docked when wide, a drawer when not). */
export function ChatView({ id }: { id: string }) {
  const chat = useChat(id);
  const { conv, loadError } = chat;
  const [draft, setDraftState] = useState(() => drafts.get(id) ?? "");
  const [settingsOpen, setSettingsOpen] = useState(() => readLocal(SETTINGS_OPEN_KEY) === "1");
  const [payload, setPayload] = useState<{ kind: "turn" } | Extract<PayloadRequest, { kind: "regenerate" }> | null>(null);
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

  // Escape closes the drawer (not the docked panel, which is part of the layout).
  useEffect(() => {
    if (!settingsOpen || docked) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && toggleSettings(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, docked, toggleSettings]);

  async function send(brainId?: string) {
    const text = draft;
    setDraft("");
    const back = await chat.send(text, brainId);
    if (back !== null && !drafts.get(id)) setDraft(back); // not saved: give it back, unless you've typed on
  }

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
      ? `${liveBrain} is writing version ${(conv.messages.find((m) => m.id === live.messageId)?.versions.length ?? 0) + 1}`
      : `${liveBrain} is replying`;
  const notice = chat.notice;
  const panel = (
    <SettingsPanel
      conv={conv}
      busy={chat.busy}
      onClose={() => toggleSettings(false)}
      onConversation={chat.replaceConversation}
      onBrain={chat.replaceBrain}
    />
  );

  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          conv={conv}
          onRenamed={chat.replaceConversation}
          onOpenPayload={() => setPayload({ kind: "turn" })}
          settingsOpen={settingsOpen}
          onToggleSettings={() => toggleSettings()}
        />
        <Scrollback
          conv={conv}
          chat={chat}
          onRetry={() => void chat.send("")}
          onPreviewRegenerate={previewRegenerate}
          empty={<EmptyConversation name={brain.name} color={brain.color} systemPrompt={brain.systemPrompt} onEdit={() => toggleSettings(true)} />}
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
          brains={conv.brains}
          defaultBrainId={conv.defaultBrainId}
          busy={chat.busy}
          status={status}
          onStop={() => void chat.stop()}
          stopping={chat.stopping}
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
          brain={payload.kind === "regenerate" ? brainOf(payload.messageId) : brain}
          request={payload.kind === "regenerate" ? payload : { kind: "turn", draft }}
          onClose={() => setPayload(null)}
        />
      )}
    </div>
  );
}

/** A fresh conversation: show who is listening and what they were told, so nothing about it is hidden. */
function EmptyConversation({ name, color, systemPrompt, onEdit }: { name: string; color: string; systemPrompt: string; onEdit(): void }) {
  return (
    <div className="mx-auto mt-[12vh] max-w-xl text-center">
      <BrainBadge name={name} color={color} />
      <p className="mt-4 text-[13px] text-faint">System prompt</p>
      <blockquote className="mx-auto mt-2 line-clamp-6 max-w-lg text-[14.5px] leading-6 whitespace-pre-wrap text-muted">{systemPrompt}</blockquote>
      <button type="button" onClick={onEdit} className="mt-3 text-[12.5px] text-faint underline decoration-line-strong underline-offset-4 hover:text-muted">
        Edit in settings
      </button>
    </div>
  );
}
