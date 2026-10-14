import { ApiError } from "./errors.ts";

/**
 * Yields one parsed JSON value per line of an NDJSON body, as soon as each line is complete.
 * Chunks may split a line anywhere, even inside a multi-byte character. Blank lines are skipped and a
 * final line without a trailing newline still counts. Stopping early (break, return) cancels the body.
 */
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (let nl = buf.indexOf("\n"); nl !== -1; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim() !== "") yield parseLine(line);
      }
    }
    buf += decoder.decode();
    if (buf.trim() !== "") yield parseLine(buf);
    finished = true;
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    throw new ApiError(0, "bad_stream", `The server sent a stream line that isn't JSON: ${line.slice(0, 80)}`);
  }
}
