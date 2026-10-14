import { Braces, PanelRight } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import type { Conversation } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { toast } from "../../components/toasts.tsx";
import { cx } from "../../lib/cx.ts";
import { conversationCost, formatUsd } from "../../lib/format.ts";
import { patchConversation, refreshConversations } from "../conversations/store.ts";

/**
 * Title (click to rename), the text model, what the conversation has cost so far (every version ever
 * generated), and the two panels: the exact payload and the settings.
 */
export function ChatHeader({
  conv,
  onRenamed,
  onOpenPayload,
  settingsOpen,
  onToggleSettings,
}: {
  conv: Conversation;
  onRenamed(c: Conversation): void;
  onOpenPayload(): void;
  settingsOpen: boolean;
  onToggleSettings(): void;
}) {
  const [editing, setEditing] = useState(false);
  const cost = conversationCost(conv);
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4 sm:px-5">
      <div className="min-w-0 flex-1">
        {editing ? (
          <TitleEditor conv={conv} onDone={() => setEditing(false)} onRenamed={onRenamed} />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Rename"
            className="-mx-1.5 block max-w-full truncate rounded-md px-1.5 py-0.5 text-left text-[15px] font-semibold tracking-tight text-silver-hi transition-colors hover:bg-hover"
          >
            {conv.title}
          </button>
        )}
      </div>
      <div className="hidden items-center gap-2 text-[12px] text-faint sm:flex">
        <span className="truncate font-mono text-[11.5px]" title="Text model (one per conversation)">
          {conv.settings.textModel}
        </span>
        <span aria-hidden>·</span>
        <span className="tabular-nums" title="Spent on this conversation so far, every generated version included">
          {formatUsd(cost)}
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="sm" onClick={onOpenPayload} title="The exact request the next Send would make">
          <Braces aria-hidden className="size-4" />
          <span className="hidden lg:inline">Payload</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleSettings}
          aria-pressed={settingsOpen}
          title="System prompt, reasoning and templates"
          className={cx(settingsOpen && "bg-hover text-fg")}
        >
          <PanelRight aria-hidden className="size-4" />
          <span className="hidden lg:inline">Settings</span>
        </Button>
      </div>
    </header>
  );
}

function TitleEditor({ conv, onDone, onRenamed }: { conv: Conversation; onDone(): void; onRenamed(c: Conversation): void }) {
  const [title, setTitle] = useState(conv.title);
  const [saving, setSaving] = useState(false);
  const cancelled = useRef(false); // Escape, then the blur of the input going away, must not save

  async function save(e?: FormEvent) {
    e?.preventDefault();
    const next = title.trim();
    if (saving || cancelled.current) return;
    if (!next || next === conv.title) return onDone();
    setSaving(true);
    try {
      const updated = await api.call("conversation.update", { id: conv.id, title: next });
      patchConversation(conv.id, { title: updated.title });
      void refreshConversations();
      onRenamed(updated);
      onDone();
    } catch (err) {
      toast.error(`Couldn't rename it. ${errorMessage(err)}`);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      <input
        aria-label="Conversation title"
        autoFocus
        value={title}
        maxLength={200}
        disabled={saving}
        onChange={(e) => setTitle(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          cancelled.current = true;
          onDone();
        }}
        className="-mx-1.5 h-8 w-full max-w-md rounded-md border border-focus/50 bg-raised px-1.5 text-[15px] font-semibold tracking-tight text-fg ring-3 ring-focus/15 outline-none"
      />
    </form>
  );
}
