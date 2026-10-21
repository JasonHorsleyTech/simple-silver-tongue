import { GitBranchPlus } from "lucide-react";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import { Button } from "../../components/Button.tsx";
import { drafts } from "../../lib/drafts.ts";
import { navigate } from "../../lib/router.tsx";
import { refreshConversations } from "../conversations/store.ts";
import { useModels } from "../settings/models.ts";
import { FooterMenu } from "./MessageLinks.tsx";

/**
 * What a message's "Clone from here" needs of its conversation (kept small and stable, so MessageItem's memo holds).
 * T18: `ownText`, the brains with a text model of their own, which they keep in the copy.
 */
export type CloneSource = { id: string; title: string; textModel: string; count: number; ownText: Array<{ name: string; model: string }> };

/**
 * "Clone from here" on a message (conversation.clone --through): a new conversation with the story up to and
 * including this message, every version and image of it, the same brains and setup; this one stays as it is. For
 * comparing models at one point of the story: the title is pre-filled "<title> - " with the cursor after it, the
 * text model is the one to play the copy with, and Enter clones and opens the copy. Nothing typed after the dash
 * names the copy after its model ("Tavern - GLM 5.3"). From the last message, the composer's unsent text goes along,
 * so one action can be played under several models: type it, then clone, clone, clone.
 *
 * T18: the model picked is the copy's conversation model, for every brain without one of its own; a brain with its
 * own keeps it (conversation.clone --text-model), and the menu says which.
 */
export function CloneMenu({ source, position, messageId, onOpenChange }: { source: CloneSource; position: number; messageId: string; onOpenChange(open: boolean): void }) {
  return (
    <FooterMenu label="Clone from here" icon={<GitBranchPlus aria-hidden className="size-3.5" />} role="dialog" onOpenChange={onOpenChange}>
      {() => <CloneForm source={source} position={position} messageId={messageId} />}
    </FooterMenu>
  );
}

function CloneForm({ source, position, messageId }: { source: CloneSource; position: number; messageId: string }) {
  const prefix = `${source.title} - `;
  const [title, setTitle] = useState(prefix);
  const [model, setModel] = useState(source.textModel);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const { models, error: modelsError } = useModels("text");
  const last = position === source.count;
  const draft = last ? (drafts.get(source.id) ?? "") : "";
  const modelName = models?.find((m) => m.id === model)?.name ?? model;
  /** Nothing after the dash: the copy is named after its model. */
  const unnamed = title.trim() === prefix.trim() || title.trim() === "";
  const finalTitle = (unnamed ? `${prefix}${modelName}` : title.trim()).slice(0, 200);

  // The cursor after the dash, so only the rest is typed (FooterMenu focuses the field after this, keeping the caret).
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  async function clone(e?: FormEvent) {
    e?.preventDefault();
    if (pending) return;
    setPending(true);
    setProblem(null);
    try {
      const copy = await api.call("conversation.clone", {
        id: source.id,
        through: messageId,
        title: finalTitle,
        ...(model !== source.textModel ? { textModel: model } : {}),
      });
      if (draft) drafts.set(copy.id, draft);
      void refreshConversations();
      navigate(`/c/${copy.id}`);
    } catch (err) {
      setProblem(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void clone(e)} className="space-y-2.5 p-1.5">
      <p className="text-[11.5px] leading-4 text-faint">
        A new conversation with {last ? `the whole story so far (${source.count} message${source.count === 1 ? "" : "s"})` : `messages 1–${position} of ${source.count}`}, every
        version and image, and the same brains and setup. This one stays as it is.
      </p>
      <div>
        <label htmlFor={`clone-title-${messageId}`} className="mb-1 block text-[12.5px] font-medium text-fg">
          Title
        </label>
        <input
          ref={field}
          id={`clone-title-${messageId}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          autoComplete="off"
          className="h-8 w-full rounded-md border border-line-strong bg-raised px-2 text-[13px] text-fg outline-none focus:border-focus/60 focus:ring-3 focus:ring-focus/15"
        />
        {unnamed && <p className="mt-1 text-[11.5px] leading-4 break-words text-faint">Named after its model: “{finalTitle}”</p>}
      </div>
      <div>
        <label htmlFor={`clone-model-${messageId}`} className="mb-1 block text-[12.5px] font-medium text-fg">
          Text model
        </label>
        <select
          id={`clone-model-${messageId}`}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="h-8 w-full rounded-md border border-line-strong bg-raised px-1.5 text-[13px] text-fg outline-none focus:border-focus/60 focus:ring-3 focus:ring-focus/15"
        >
          {!models?.some((m) => m.id === source.textModel) && <option value={source.textModel}>{source.textModel}</option>}
          {(models ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.id === source.textModel ? " (current)" : ""}
              {m.privacy !== "private" ? ` · ${m.privacy}` : ""}
            </option>
          ))}
        </select>
        {source.ownText.length > 0 && (
          <p className="mt-1 text-[11.5px] leading-4 text-faint">
            For every brain but{" "}
            {source.ownText.map((o, i) => (
              <span key={o.name}>
                {i > 0 && (i === source.ownText.length - 1 ? " and " : ", ")}
                <span className="text-muted">{o.name}</span>
              </span>
            ))}
            , which {source.ownText.length === 1 ? "keeps its own" : "keep their own"} (
            {source.ownText.map((o) => models?.find((m) => m.id === o.model)?.name ?? o.model).join(", ")}).
          </p>
        )}
        {modelsError && <p className="mt-1 text-[11.5px] text-amber-200/85">Couldn't load Venice's model list: the copy keeps this one's model.</p>}
      </div>
      {draft.trim() && <p className="text-[11.5px] leading-4 text-faint">Your unsent message goes along, ready to send there.</p>}
      {problem && <p className="text-[12.5px] text-red-200">{problem}</p>}
      <Button type="submit" size="sm" variant="secondary" loading={pending} className="w-full">
        {!pending && <GitBranchPlus aria-hidden className="size-3.5" />} Clone and open it
      </Button>
    </form>
  );
}
