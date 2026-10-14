import { X } from "lucide-react";
import type { Brain, Conversation } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Notice } from "../../components/Notice.tsx";
import { cx } from "../../lib/cx.ts";
import { BrainsTab } from "./BrainsTab.tsx";
import { ConversationTab } from "./ConversationTab.tsx";
import { useModels } from "./models.ts";
import { SetupTab } from "./SetupTab.tsx";
import { TemplatesEditor } from "./TemplatesEditor.tsx";

export type SettingsTab = "brains" | "setup" | "templates" | "conversation";

export const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "brains", label: "Brains" },
  { id: "setup", label: "Setup" },
  { id: "templates", label: "Templates" },
  { id: "conversation", label: "Conversation" },
];

/**
 * The conversation's settings, in four tabs so a campaign's worth of configuration never reads as one wall of
 * forms: Brains (who is at the table), Setup (what every brain is told first), Templates (how they see each
 * other) and Conversation (title, models, limits, delete). Every text that reaches a model is editable here
 * (hard requirement 1); each brain's braces show its exact payload. Docked beside the chat when wide, a drawer
 * when narrow; play carries on beside it.
 */
export function SettingsPanel({
  conv,
  tab,
  onTab,
  busy,
  writingBrainId,
  addBrainNonce,
  addSetupNonce,
  focusSetupId,
  onSetupFocused,
  onClose,
  onConversation,
  onBrain,
  onPatch,
  onPayload,
}: {
  conv: Conversation;
  tab: SettingsTab;
  onTab(t: SettingsTab): void;
  busy: boolean;
  writingBrainId: string | null;
  addBrainNonce: number;
  addSetupNonce: number;
  /** A setup message to open with the cursor in it (T10: the World Bible just added from the empty conversation). */
  focusSetupId?: string | null;
  onSetupFocused?(): void;
  onClose(): void;
  onConversation(c: Conversation): void;
  onBrain(b: Brain): void;
  onPatch(fn: (c: Conversation) => Conversation): void;
  onPayload(brainId: string): void;
}) {
  const textModels = useModels("text");
  const imageModels = useModels("image");
  const model = textModels.models ? (textModels.models.find((m) => m.id === conv.settings.textModel) ?? null) : undefined;
  const count = (t: SettingsTab) => (t === "brains" ? conv.brains.length : t === "setup" ? conv.setup.length : null);

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-14 shrink-0 items-stretch gap-1 border-b border-line pr-2 pl-3">
        <div role="tablist" aria-label="Settings" className="flex min-w-0 flex-1 items-stretch">
          {SETTINGS_TABS.map((t) => {
            const n = count(t.id);
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                id={`st-${t.id}`}
                role="tab"
                type="button"
                aria-selected={on}
                aria-controls="settings-body"
                onClick={() => onTab(t.id)}
                className={cx(
                  "relative inline-flex items-center gap-1.5 px-2.5 text-[13px] transition-colors",
                  on ? "font-medium text-silver-hi" : "text-faint hover:text-muted",
                )}
              >
                {t.label}
                {n !== null && <span className={cx("text-[11.5px] tabular-nums", on ? "text-muted" : "text-faint/80")}>{n}</span>}
                {on && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-silver" />}
              </button>
            );
          })}
        </div>
        <Button variant="ghost" size="icon" aria-label="Close settings" className="self-center" onClick={onClose}>
          <X aria-hidden className="size-4" />
        </Button>
      </div>
      <div key={tab} id="settings-body" role="tabpanel" aria-labelledby={`st-${tab}`} className="min-h-0 flex-1 overflow-y-auto">
        {tab === "brains" && (
          <>
            {textModels.error && (
              <Notice tone="error" className="mx-5 mt-4">
                Couldn't load the model list. {textModels.error}
              </Notice>
            )}
            <BrainsTab
              conv={conv}
              model={model}
              writingBrainId={writingBrainId}
              addNonce={addBrainNonce}
              onBrain={onBrain}
              onPatch={onPatch}
              onPayload={onPayload}
              onImageSettings={() => {
                onTab("conversation");
                // Scroll the panel only: scrollIntoView would scroll the page itself too, and push the header off screen.
                setTimeout(() => {
                  const body = document.getElementById("settings-body");
                  const section = document.getElementById("cv-images");
                  if (!body || !section) return;
                  const top = body.scrollTop + section.getBoundingClientRect().top - body.getBoundingClientRect().top - 12;
                  body.scrollTo({ top, behavior: "smooth" });
                }, 60);
              }}
            />
          </>
        )}
        {tab === "setup" && (
          <SetupTab conv={conv} addNonce={addSetupNonce} focusId={focusSetupId} onFocused={onSetupFocused} onSetup={(setup) => onPatch((c) => ({ ...c, setup }))} />
        )}
        {tab === "templates" && (
          <div className="px-5 pt-4 pb-8">
            <p className="mb-5 text-[12.5px] leading-5 text-faint">
              How each brain sees the others: your messages, other brains' lines and pictures, a steer, and your dice rolls. Plain text, sent as written; the
              payload view shows the effect.
            </p>
            <TemplatesEditor conv={conv} onSaved={onConversation} />
          </div>
        )}
        {tab === "conversation" && (
          <ConversationTab conv={conv} textModels={textModels} imageModels={imageModels} busy={busy} onConversation={onConversation} />
        )}
      </div>
    </div>
  );
}
