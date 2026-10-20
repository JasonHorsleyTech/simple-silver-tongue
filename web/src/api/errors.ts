import type { ChatDiagnostics, RetryRequest } from "./types.ts";

/**
 * Every failure the API client reports is an ApiError, so a view can always show `message`.
 * `code` is the server's error code (bad_args, wrong_password, conflict, image_busy, venice_error, ...) or one of the
 * client's own: network, stream_broken, bad_stream, http_<status>.
 * `status` is the HTTP status, or 0 when there was none (network failure, or an error event mid-stream).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * The request that retries a reply whose stream broke, from the error itself: the same brain for a turn, the
 * same message and steer for a regenerate (T04 QA-1). Null for any other error. Retry should replay this
 * rather than a bare `turn`, which would go to the default brain.
 */
export function retryOf(err: unknown): RetryRequest | null {
  const retry = err instanceof ApiError ? (err.details as { retry?: RetryRequest } | undefined)?.retry : undefined;
  return retry && typeof retry === "object" ? retry : null;
}

/**
 * A failed chat request's diagnostics, from the error itself (`details.diagnostics`): everything about the request
 * but its words, for a Details disclosure (formatDiagnostics). Null for any other error.
 */
export function diagnosticsOf(err: unknown): ChatDiagnostics | null {
  const d = err instanceof ApiError ? (err.details as { diagnostics?: ChatDiagnostics } | undefined)?.diagnostics : undefined;
  return d && typeof d === "object" && d.request ? d : null;
}

/** True for the error fetch throws when its AbortSignal fires. Callers that cancel usually want to ignore it. */
export function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

/**
 * A readable message for anything a view catches. For bad_args it uses the per-field messages from the
 * server's schema ("Username must be ...") rather than the CLI-style "Invalid arguments for x: ..." line.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "bad_args") {
    const issues = (err.details as { issues?: { message?: unknown }[] } | undefined)?.issues;
    const msgs = (issues ?? []).map((i) => i.message).filter((m): m is string => typeof m === "string" && m !== "");
    if (msgs.length > 0) return [...new Set(msgs)].join(" ");
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
