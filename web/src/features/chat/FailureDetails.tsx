import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { formatDiagnostics, type ChatDiagnostics } from "../../api/types.ts";
import { copyText } from "../../lib/clipboard.ts";

/**
 * A failed chat request's diagnostics under its error, folded: everything about the request but its words (the
 * model and every knob sent, each message's role and size, what is unusual about their order, what arrived, the
 * timing, what Venice said and its request-id headers). The text is the block the CLI prints, word for word, and
 * Copy takes all of it, to paste into a bug report or a note to Venice support.
 */
export function FailureDetails({ diagnostics }: { diagnostics: ChatDiagnostics }) {
  const text = useMemo(() => {
    try {
      return formatDiagnostics(diagnostics);
    } catch {
      return null; // a shape from another version of the server: the error above still says what failed
    }
  }, [diagnostics]);
  const [copied, setCopied] = useState(false);
  if (text === null) return null;
  return (
    <details className="mt-2.5 min-w-0 max-w-full">
      <summary className="w-fit cursor-pointer select-none text-[12.5px] text-red-100/80 hover:text-red-50">
        Details: everything about the request but its words
      </summary>
      <div className="mt-2 rounded-md border border-red-400/15 bg-canvas/60">
        <div className="flex justify-end border-b border-red-400/10 px-1.5 py-1">
          <button
            type="button"
            onClick={async () => {
              if (await copyText(text)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            }}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-fg"
          >
            {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="max-h-80 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-[1.45] whitespace-pre text-muted">{text}</pre>
      </div>
    </details>
  );
}
