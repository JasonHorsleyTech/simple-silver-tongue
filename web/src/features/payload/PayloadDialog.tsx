import { Check, Copy, RotateCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import type { Brain, ChatMessage, Preview } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { Notice } from "../../components/Notice.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { copyText } from "../../lib/clipboard.ts";
import { cx } from "../../lib/cx.ts";
import { BrainBadge } from "../chat/BrainBadge.tsx";

/**
 * "Exact payload": prompt.preview for one brain, which is built by the same code path that turn sends with.
 * It includes the unsent composer text, so it shows what Send would send right now. Two views: each message
 * verbatim, or the raw JSON body. T04 opens it per brain (the `brain` prop).
 */
export function PayloadDialog({ conversationId, brain, draft, onClose }: { conversationId: string; brain: Brain; draft: string; onClose(): void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"messages" | "json">("messages");
  const [copied, setCopied] = useState(false);
  const withDraft = draft.trim() !== "";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPreview(await api.call("prompt.preview", { conversation: conversationId, brain: brain.id, ...(withDraft ? { content: draft } : {}) }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [conversationId, brain.id, draft, withDraft]);

  useEffect(() => {
    void load();
  }, [load]);

  const body = preview?.body;
  const { messages = [], ...params } = body ?? {};

  return (
    <Dialog
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          Exact payload <BrainBadge name={brain.name} color={brain.color} />
        </span>
      }
      subtitle={
        <>
          <code className="font-mono text-[11.5px] text-muted">POST /chat/completions</code>, exactly as the next Send would make it, minus the API
          key. {withDraft ? "Your unsent message is included as the last message." : "With the composer empty, Send asks the brain to answer the ledger as it stands."}
        </>
      }
      footer={
        <>
          <div role="tablist" aria-label="View" className="inline-flex rounded-lg border border-line-strong p-0.5">
            {(["messages", "json"] as const).map((v) => (
              <button
                key={v}
                role="tab"
                type="button"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cx(
                  "h-7 rounded-md px-2.5 text-[12.5px] transition-colors",
                  view === v ? "bg-hover text-fg" : "text-faint hover:text-muted",
                )}
              >
                {v === "messages" ? "Messages" : "Raw JSON"}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void load()} disabled={loading}>
            <RotateCw aria-hidden className="size-3.5" /> Refresh
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!body}
            onClick={async () => {
              if (body && (await copyText(JSON.stringify(body)))) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            }}
          >
            {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
            {copied ? "Copied" : "Copy JSON"}
          </Button>
        </>
      }
    >
      {loading && !preview ? (
        <div className="flex items-center gap-2 py-10 text-[13px] text-faint">
          <Spinner className="size-4" /> Building the request…
        </div>
      ) : error ? (
        <Notice tone="error">{error}</Notice>
      ) : preview && body ? (
        <div className="space-y-4">
          {preview.notes.map((n) => (
            <Notice key={n} tone="warn">
              {n}
            </Notice>
          ))}
          {preview.refusal && (
            <Notice tone="info">
              <strong className="font-medium text-fg">Send would refuse this as it stands.</strong> {preview.refusal}
            </Notice>
          )}
          {view === "json" ? (
            <pre className="overflow-x-auto rounded-lg border border-line bg-canvas p-4 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap text-muted">
              {JSON.stringify(body, null, 2)}
            </pre>
          ) : (
            <>
              <section>
                <h3 className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">Parameters</h3>
                <pre className="overflow-x-auto rounded-lg border border-line bg-canvas px-4 py-3 font-mono text-[12px] leading-[1.6] text-muted">
                  {JSON.stringify(params, null, 2)}
                </pre>
              </section>
              <section>
                <h3 className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
                  {messages.length} message{messages.length === 1 ? "" : "s"}, in order, verbatim
                </h3>
                <ol className="space-y-2">
                  {messages.map((m, i) => (
                    <PayloadMessage key={i} index={i} message={m} />
                  ))}
                </ol>
              </section>
            </>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}

const ROLE_TONE: Record<ChatMessage["role"], string> = {
  system: "text-amber-200/90 bg-amber-300/[0.08] border-amber-300/20",
  user: "text-sky-200/90 bg-sky-300/[0.07] border-sky-300/20",
  assistant: "text-emerald-200/90 bg-emerald-300/[0.07] border-emerald-300/20",
  tool: "text-violet-200/90 bg-violet-300/[0.08] border-violet-300/20",
};

function PayloadMessage({ index, message: m }: { index: number; message: ChatMessage }) {
  return (
    <li className="overflow-hidden rounded-lg border border-line bg-canvas">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-1.5">
        <span className="font-mono text-[11px] text-faint tabular-nums">[{index}]</span>
        <span className={cx("rounded border px-1.5 py-px font-mono text-[11px]", ROLE_TONE[m.role])}>{m.role}</span>
        {m.role === "tool" && <span className="font-mono text-[11px] text-faint">tool_call_id {m.tool_call_id}</span>}
        <span className="ml-auto text-[11px] text-faint tabular-nums">{m.content.length} chars</span>
      </div>
      {m.content !== "" && (
        <pre className="px-3.5 py-2.5 font-mono text-[12.5px] leading-[1.65] break-words whitespace-pre-wrap text-fg">{m.content}</pre>
      )}
      {m.role === "assistant" && m.tool_calls && (
        <pre className="border-t border-line px-3.5 py-2.5 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap text-muted">
          tool_calls: {JSON.stringify(m.tool_calls, null, 2)}
        </pre>
      )}
    </li>
  );
}
