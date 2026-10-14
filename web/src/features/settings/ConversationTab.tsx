import { Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import type { Conversation, ConversationUpdate, ModelInfo } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Notice } from "../../components/Notice.tsx";
import { SavedLine } from "../../components/SavedLine.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { navigate } from "../../lib/router.tsx";
import { compactNumber } from "../../lib/format.ts";
import { patchConversation, refreshConversations } from "../conversations/store.ts";
import { ImageSettings } from "./ImageSettings.tsx";

/**
 * The conversation itself: title, the text and image models (one each, from Venice's live list), the reply
 * limits every brain shares, how images are made (size, format, watermark, negative prompt), and delete. A
 * model change applies to the next request of every brain, and to the next image.
 */
export function ConversationTab({
  conv,
  textModels,
  imageModels,
  busy,
  onConversation,
}: {
  conv: Conversation;
  textModels: { models: ModelInfo[] | null; error: string | null };
  imageModels: { models: ModelInfo[] | null; error: string | null };
  busy: boolean;
  onConversation(c: Conversation): void;
}) {
  const save = async (patch: Omit<ConversationUpdate, "id">) => {
    const next = await api.call("conversation.update", { id: conv.id, ...patch });
    onConversation(next);
    return next;
  };
  const st = conv.settings;

  return (
    <div className="space-y-7 px-5 pt-4 pb-8">
      <SavedLine
        id="cv-title"
        label="Title"
        saved={conv.title}
        inputProps={{ maxLength: 200 }}
        validate={(v) => (v.trim() ? null : "The title can't be empty.")}
        onSave={async (title) => {
          const next = await save({ title: title.trim() });
          patchConversation(conv.id, { title: next.title });
          void refreshConversations();
        }}
      />

      <ModelPicker
        id="cv-text-model"
        label="Text model"
        description="Every brain writes with it. One per conversation; the next request of every brain uses a change."
        value={st.textModel}
        list={textModels}
        detail={(m) =>
          [
            m.price,
            m.privacy,
            m.contextLength ? `${m.contextLength >= 1e6 ? `${Number((m.contextLength / 1e6).toFixed(1))}M` : compactNumber(m.contextLength)} context` : null,
            m.reasoning?.supported ? (m.reasoning.effortOptions ? `reasoning: ${m.reasoning.effortOptions.join(", ")}` : "reasons") : "no reasoning",
          ]
            .filter(Boolean)
            .join(" · ")
        }
        onPick={async (textModel) => void (await save({ settings: { textModel } }))}
      />

      <div>
        <h4 className="text-[13px] font-medium text-fg">Reply limits</h4>
        <p className="mt-0.5 mb-2.5 text-[12.5px] leading-5 text-faint">Sent with every brain's request. Blank: not sent, so the model's own default applies.</p>
        <div className="grid grid-cols-2 gap-3">
          <SavedLine
            id="cv-max"
            label={<span className="font-normal text-muted">max_tokens</span>}
            saved={st.maxTokens === undefined ? "" : String(st.maxTokens)}
            mono
            placeholder="not sent"
            inputProps={{ inputMode: "numeric" }}
            validate={(v) => (v.trim() === "" || /^[1-9]\d*$/.test(v.trim()) ? null : "A whole number above 0, or blank.")}
            onSave={async (v) => void (await save({ settings: { maxTokens: v.trim() === "" ? null : Number(v.trim()) } }))}
          />
          <SavedLine
            id="cv-temp"
            label={<span className="font-normal text-muted">temperature</span>}
            saved={st.temperature === undefined ? "" : String(st.temperature)}
            mono
            placeholder="not sent"
            inputProps={{ inputMode: "decimal" }}
            validate={(v) => {
              const t = v.trim();
              return t === "" || (/^\d*\.?\d+$/.test(t) && Number(t) <= 2) ? null : "A number from 0 to 2, or blank.";
            }}
            onSave={async (v) => void (await save({ settings: { temperature: v.trim() === "" ? null : Number(v.trim()) } }))}
          />
        </div>
      </div>

      <section id="cv-images" className="scroll-mt-3 space-y-5 rounded-xl border border-line bg-raised/25 p-4">
        <div>
          <h4 className="text-[13px] font-semibold text-fg">Images</h4>
          <p className="mt-0.5 text-[12.5px] leading-5 text-faint">
            How image brains' prompts become pictures. Every image brain in this conversation uses these; each brain has its own safe mode (Brains).
          </p>
        </div>
        <ModelPicker
          id="cv-image-model"
          label="Image model"
          description="The prompt goes to it word for word. The next image uses a change."
          value={st.imageModel}
          list={imageModels}
          detail={(m) => [m.price, m.privacy].join(" · ")}
          onPick={async (imageModel) => void (await save({ settings: { imageModel } }))}
        />
        <ImageSettings
          conv={conv}
          model={imageModels.models ? (imageModels.models.find((m) => m.id === st.imageModel) ?? null) : undefined}
          onSave={(image) => save({ settings: { image } })}
        />
      </section>

      <dl className="text-[13px]">
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-faint">Conversation id</dt>
          <dd className="font-mono text-[12.5px] text-muted select-all">{conv.id}</dd>
        </div>
      </dl>

      <DeleteConversation conv={conv} busy={busy} />
    </div>
  );
}

/** A native select over Venice's live list, saved on change. The current model stays listed even if Venice dropped it. */
function ModelPicker({
  id,
  label,
  description,
  value,
  list,
  detail,
  onPick,
}: {
  id: string;
  label: string;
  description: string;
  value: string;
  list: { models: ModelInfo[] | null; error: string | null };
  detail(m: ModelInfo): string;
  onPick(model: string): Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const models = list.models ?? [];
  const current = models.find((m) => m.id === value);

  async function pick(model: string) {
    setSaving(true);
    setError(null);
    try {
      await onPick(model);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1 flex items-center gap-2 text-[13px] font-medium text-fg">
        {label}
        {saving && <Spinner className="size-3.5 text-faint" />}
      </label>
      <p className="mb-2 text-[12.5px] leading-5 text-faint">{description}</p>
      <select
        id={id}
        value={value}
        disabled={saving || !list.models}
        onChange={(e) => void pick(e.target.value)}
        className="h-9 w-full rounded-lg border border-line-strong bg-raised px-2.5 text-[13.5px] text-fg outline-none focus:border-focus/60 focus:ring-3 focus:ring-focus/15 disabled:opacity-60"
      >
        {!current && <option value={value}>{list.models ? `${value} (not in Venice's list)` : value}</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.privacy !== "private" ? ` · ${m.privacy}` : ""}
            {m.offline ? " · offline" : ""}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-[12px] leading-5 text-faint">
        <span className="font-mono text-[11.5px] text-muted">{value}</span>
        {current && ` · ${detail(current)}`}
      </p>
      {list.error && (
        <Notice tone="error" className="mt-2">
          Couldn't load Venice's model list. {list.error}
        </Notice>
      )}
      {error && (
        <Notice tone="error" className="mt-2">
          {error}
        </Notice>
      )}
    </div>
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
    <div className="border-t border-line pt-5">
      {error && (
        <Notice tone="error" className="mb-3">
          {error}
        </Notice>
      )}
      {confirming ? (
        <div
          ref={(el) => {
            el?.scrollIntoView({ block: "nearest", behavior: "smooth" }); // braces: Chrome returns a Promise here, and a ref may only return a cleanup
          }}
          className="rounded-lg border border-red-400/25 bg-red-400/[0.06] p-3">
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
