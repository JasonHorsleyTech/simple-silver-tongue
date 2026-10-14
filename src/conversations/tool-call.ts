/**
 * The prompt inside an image brain's generate_image call (T05). The arguments arrive as JSON fragments
 * ({"prompt": "A ta" ... "vern"}), so the prompt is decoded as it streams, for the `prompt` events the CLI and
 * the browser show live, and parsed whole at the end.
 *
 * One call per reply. The tool is forced, so a model makes one call; should it make parallel calls anyway,
 * their fragments are kept apart by `index` (T02 QA-7: they used to be glued into invalid JSON) and only the
 * first call is used. `parallel_tool_calls: false` is not sent: no live call has shown that Venice honours it.
 */

export type ToolCallParts = { index: number; id?: string; name?: string; args: string };

/** What a finished (or stopped) reply's first call gives: the prompt, and whether it is all there. */
export type CallPrompt = { prompt: string; complete: boolean; calls: number };

/**
 * The prompt as far as it has arrived: the value of the top-level "prompt" key, decoded, stopping before an
 * escape that isn't complete yet. The text only ever grows as fragments arrive, so its new tail is the delta.
 * `complete` is true once the string's closing quote has arrived. Null while no "prompt" value has started.
 */
export function partialPrompt(json: string): { text: string; complete: boolean } | null {
  let i = 0;
  const ws = () => {
    while (i < json.length && /\s/.test(json[i]!)) i++;
  };
  ws();
  if (json[i] !== "{") return null;
  i++;
  for (;;) {
    ws();
    if (json[i] !== '"') return null; // "}" (no prompt), or more is still to come
    const key = readString();
    if (!key.complete) return null;
    ws();
    if (json[i] !== ":") return null;
    i++;
    ws();
    if (key.text === "prompt") {
      if (json[i] !== '"') return null; // a prompt that isn't a string is no prompt
      return readString();
    }
    if (!skipValue()) return null;
    ws();
    if (json[i] !== ",") return null;
    i++;
  }

  // At an opening quote: read to the closing one, or to the end of what has arrived.
  function readString(): { text: string; complete: boolean } {
    i++;
    let text = "";
    while (i < json.length) {
      const ch = json[i]!;
      if (ch === '"') {
        i++;
        return { text, complete: true };
      }
      if (ch !== "\\") {
        text += ch;
        i++;
        continue;
      }
      const esc = json[i + 1];
      if (esc === undefined) break; // the escape's second half hasn't arrived
      if (esc === "u") {
        const hex = json.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { text, complete: false };
        text += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      const simple: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
      if (!(esc in simple)) return { text, complete: false };
      text += simple[esc];
      i += 2;
    }
    return { text, complete: false };
  }

  // Skip one complete JSON value (another key's), strings and nesting included. False if it isn't all here.
  function skipValue(): boolean {
    if (json[i] === '"') return readString().complete;
    let depth = 0;
    while (i < json.length) {
      const ch = json[i]!;
      if (ch === '"') {
        if (!readString().complete) return false;
        continue;
      }
      if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        if (depth === 0) return true; // the end of the enclosing object
        depth--;
        if (depth === 0) {
          i++;
          return true;
        }
      } else if (ch === "," && depth === 0) return true;
      i++;
    }
    return false;
  }
}

/**
 * The prompt of the reply's first tool call. Whole JSON is parsed for real; if it doesn't parse (a stop, a cut
 * by max_tokens, or a model that never closed the object), whatever of the prompt string arrived is kept, and
 * `complete` says whether its closing quote did.
 */
export function promptOf(calls: ToolCallParts[]): CallPrompt {
  const first = calls[0];
  if (!first) return { prompt: "", complete: false, calls: 0 };
  try {
    const parsed = JSON.parse(first.args) as { prompt?: unknown };
    if (parsed && typeof parsed === "object" && typeof parsed.prompt === "string") return { prompt: parsed.prompt, complete: true, calls: calls.length };
    return { prompt: "", complete: false, calls: calls.length };
  } catch {
    const p = partialPrompt(first.args);
    return { prompt: p?.text ?? "", complete: p?.complete ?? false, calls: calls.length };
  }
}
