import { ArrowRight, Lock, LockOpen } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import { useUser } from "../../app/session.tsx";
import { Button } from "../../components/Button.tsx";
import { LogoMark } from "../../components/Logo.tsx";
import { Notice } from "../../components/Notice.tsx";
import { TextArea } from "../../components/TextArea.tsx";
import { TextField } from "../../components/TextField.tsx";
import { navigate } from "../../lib/router.tsx";
import { refreshConversations } from "./store.ts";

/** Pre-filled so starting is one click, but it is only a suggestion: it is sent exactly as it reads here. */
export const DEFAULT_SYSTEM_PROMPT = "You are a thoughtful, concise assistant. Format your answers in Markdown.";

/**
 * "/" when logged in: start a conversation. The system prompt is required (design.md hard rule 1: never
 * send a request without a user-written system message) and is sent verbatim; nothing else is added.
 */
export function NewConversationView() {
  const user = useUser();
  const [title, setTitle] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blank = systemPrompt.trim() === "";

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (pending) return;
    if (blank) {
      setError("Write a system prompt first. It is the first message every request starts with.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const conv = await api.call("conversation.create", { systemPrompt, ...(title.trim() ? { title: title.trim() } : {}) });
      void refreshConversations();
      navigate(`/c/${conv.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  const submitOnModEnter = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-5 py-12 sm:px-8">
      <div className="mb-8">
        <LogoMark size={36} />
        <h1 className="mt-5 text-[22px] font-semibold tracking-tight text-silver-hi">New conversation</h1>
        <p className="mt-1.5 text-[14px] leading-6 text-muted">
          Write the system prompt yourself. It is sent exactly as written, as the first message of every request, and nothing else is
          added.
        </p>
      </div>

      <form onSubmit={submit} onKeyDown={submitOnModEnter} noValidate className="space-y-5">
        {error && <Notice tone="error">{error}</Notice>}
        <TextField
          id="new-title"
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New conversation"
          maxLength={200}
          autoComplete="off"
          hint="Optional. You can rename it any time."
        />
        <TextArea
          id="new-system-prompt"
          label="System prompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          autoFocus
          maxPx={360}
          aria-invalid={blank || undefined}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-xs text-faint">
            <kbd className="font-sans">⌘</kbd> <kbd className="font-sans">Enter</kbd> to start
          </p>
          <Button type="submit" variant="primary" loading={pending}>
            Start conversation
            {!pending && <ArrowRight aria-hidden className="size-4" />}
          </Button>
        </div>
      </form>

      <p className="mt-10 inline-flex items-center gap-1.5 self-start rounded-full border border-line bg-panel px-3 py-1 text-xs text-faint">
        {user.encrypted ? (
          <>
            <Lock aria-hidden className="size-3" /> Encrypted on disk with your password
          </>
        ) : (
          <>
            <LockOpen aria-hidden className="size-3" /> Unencrypted user: stored as plain JSON
          </>
        )}
      </p>
    </div>
  );
}
