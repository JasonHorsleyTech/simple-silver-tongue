import type { ImageRequest } from "../conversations/types.ts";
import { CommandError, upstreamError } from "../lib/errors.ts";
import type { VeniceClient } from "./client.ts";

/**
 * POST /image/generate. The body goes out exactly as given (buildImageRequest made it). The JSON answer carries
 * the image as base64 in images[0]; the x-venice-is-blurred and x-venice-is-content-violation headers say what
 * safe mode and the content policy did to it. Nothing here logs or quotes the prompt.
 */

export type GeneratedImage = { bytes: Buffer; blurred: boolean; contentViolation: boolean };

/** Image models can be slow (z-image-turbo takes ~3 s, others much longer), so the wait is generous. */
export const IMAGE_TIMEOUT_MS = 180_000;

export async function generateImage(venice: VeniceClient, body: ImageRequest, opts: { timeoutMs?: number } = {}): Promise<GeneratedImage> {
  const timeoutMs = opts.timeoutMs ?? IMAGE_TIMEOUT_MS;
  // Venice may well have made (and billed) an image we stopped waiting for; say so, and how to get one (T05 QA-3).
  const lateText = `Venice didn't send the image within ${Math.round(timeoutMs / 1000)} s. It may still have made (and billed) it; retry to paint the prompt again.`;
  let res: Response;
  try {
    res = await venice.request("/image/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs,
    });
  } catch (err) {
    if (err instanceof CommandError && (err.details as { timeout?: boolean } | undefined)?.timeout) throw upstreamError(lateText);
    throw err;
  }
  const blurred = res.headers.get("x-venice-is-blurred") === "true";
  const contentViolation = res.headers.get("x-venice-is-content-violation") === "true";
  let json: { images?: unknown };
  try {
    json = (await res.json()) as { images?: unknown };
  } catch (err) {
    if ((err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError") throw upstreamError(lateText);
    throw upstreamError("Venice's image answer was not valid JSON.");
  }
  const b64 = Array.isArray(json?.images) ? json.images[0] : undefined;
  if (typeof b64 !== "string" || !b64) throw upstreamError("Venice's image answer had no image in it.");
  const bytes = Buffer.from(b64, "base64");
  if (!bytes.length) throw upstreamError("Venice's image answer had an empty image in it.");
  return { bytes, blurred, contentViolation };
}
