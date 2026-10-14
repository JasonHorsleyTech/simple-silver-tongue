import { Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import type { Brain, Conversation } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Notice } from "../../components/Notice.tsx";
import { navigate } from "../../lib/router.tsx";
import { refreshConversations } from "../conversations/store.ts";
import { BrainEditor } from "./BrainEditor.tsx";
import { useTextModels } from "./models.ts";
import { TemplatesEditor } from "./TemplatesEditor.tsx";

/**
 * The conversation's settings: every text that reaches a model is editable here (hard requirement 1).
 * Sections, top to bottom: brains (T02: the one default brain), framing templates, then the conversation
 * itself. T04 grows it: model pickers and max tokens under Conversation, a setup-messages section, and the
 * brains section becomes a list with add, reorder and delete.
 */
export function SettingsPanel({
  conv,
  onClose,
  onConversation,
  onBrain,
  busy,
}: {
  conv: Conversation;
  onClose(): void;
  onConversation(c: Conversation): void;
  onBrain(b: Brain): void;
  busy: boolean;
}) {
  const { models, error: modelsError } = useTextModels();
  const model = models ? (models.find((m) => m.id === conv.settings.textModel) ?? null) : undefined;

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line pr-3 pl-5">
        <h2 className="flex-1 text-[14px] font-semibold tracking-tight text-silver-hi">Settings</h2>
        <Button variant="ghost" size="icon" aria-label="Close settings" onClick={onClose}>
          <X aria-hidden className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="border-b border-line px-5 py-3 text-[12.5px] leading-5 text-faint">
          Everything here is sent to the model word for word. <span className="text-muted">Payload</span> in the header shows the exact request.
        </p>

        <Section title={conv.brains.length === 1 ? "Brain" : "Brains"}>
          {modelsError && <Notice tone="error" className="mb-4">Couldn't load the model list. {modelsError}</Notice>}
          <div className="space-y-10">
            {conv.brains.map((b) => (
              <BrainEditor key={b.id} conversationId={conv.id} brain={b} isDefault={b.id === conv.defaultBrainId} model={model} onSaved={onBrain} />
            ))}
          </div>
        </Section>

        <Section title="Framing templates">
          <TemplatesEditor conv={conv} onSaved={onConversation} />
        </Section>

        <Section title="Conversation">
          <dl className="space-y-1 text-[13px]">
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-faint">Model</dt>
              <dd className="min-w-0">
                <span className="font-mono text-[12.5px] text-fg">{conv.settings.textModel}</span>
                {model && <span className="block text-[12px] text-faint">{`${model.price} · ${model.privacy}`}</span>}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-faint">Id</dt>
              <dd className="font-mono text-[12.5px] text-muted select-all">{conv.id}</dd>
            </div>
          </dl>
          <DeleteConversation conv={conv} busy={busy} />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-5 pt-5 pb-6 last:border-b-0">
      <h3 className="mb-4 text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">{title}</h3>
      {children}
    </section>
  );
}

function DeleteConversation({ conv, busy }: { conv: Conversation; busy: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await api.call("conversation.delete", { id: conv.id });
      await refreshConversations();
      navigate("/");
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <div className="mt-6">
      {error && <Notice tone="error" className="mb-3">{error}</Notice>}
      {confirming ? (
        <div ref={(el) => el?.scrollIntoView({ block: "nearest", behavior: "smooth" })} className="rounded-lg border border-red-400/25 bg-red-400/[0.06] p-3">
          <p className="text-[13px] text-red-100">
            Delete “{conv.title}” and its {conv.messages.length} message{conv.messages.length === 1 ? "" : "s"} for good?
          </p>
          <div className="mt-2.5 flex gap-2">
            <Button size="sm" variant="danger" loading={pending} onClick={() => void remove()}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="-ml-2 text-red-200/80 hover:bg-red-400/10 hover:text-red-100"
          disabled={busy}
          title={busy ? "Wait for the reply to finish" : undefined}
          onClick={() => setConfirming(true)}
        >
          <Trash2 aria-hidden className="size-3.5" /> Delete conversation
        </Button>
      )}
    </div>
  );
}
