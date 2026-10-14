/** The one error type commands throw. The HTTP adapter maps it to a status code and a JSON body. */
export class CommandError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "CommandError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new CommandError(400, "bad_request", message, details);
export const unauthenticated = (message = "Not logged in. Run ./ss auth.login --username <name>.") =>
  new CommandError(401, "unauthenticated", message);
export const wrongPassword = (message: string) => new CommandError(401, "wrong_password", message);
/** Thrown by a closed vault: the session that owned this work logged out or logged in again. */
export const sessionEnded = (message = "Your session ended (you logged out or logged in again) before this work could use your data.") =>
  new CommandError(401, "session_ended", message);
export const USER_DELETED = "This user was deleted (user.delete), so its data is gone and its session has ended.";
export const notFound = (message: string) => new CommandError(404, "not_found", message);
export const conflict = (message: string) => new CommandError(409, "conflict", message);
/**
 * T05 frontend: a change that would replace or remove an image Venice is still making (409). Its own code, so a
 * client can tell "wait for this image" from "wait for the reply being written" (conflict) without reading words.
 */
export const imageBusy = (message: string) => new CommandError(409, "image_busy", message);
export const upstreamError = (message: string, details?: unknown) =>
  new CommandError(502, "venice_error", message, details);

export type ErrorBody = { code: string; message: string; details?: unknown };

/** Safe, client-facing view of any thrown value. Internal errors get a generic message (details go to the log). */
export function toErrorBody(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof CommandError) {
    const body: ErrorBody = { code: err.code, message: err.message };
    if (err.details !== undefined) body.details = err.details;
    return { status: err.status, body };
  }
  return { status: 500, body: { code: "internal", message: "Internal server error (see .run/server.log)" } };
}
