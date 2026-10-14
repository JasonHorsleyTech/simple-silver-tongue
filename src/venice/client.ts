import { CommandError, upstreamError } from "../lib/errors.ts";
import { normalizeModel, type ModelInfo, type ModelType } from "./models.ts";

/**
 * Plain-fetch Venice client. We build every byte of every request ourselves; there is no SDK in the way.
 * The API key lives only in this closure and in the Authorization header.
 */
export type VeniceClient = {
  baseUrl: string;
  /** Raw request (chat streams use it with timeoutMs: 0). Throws CommandError on non-2xx. */
  request(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response>;
  json<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T>;
  listModels(type: ModelType, opts?: { refresh?: boolean }): Promise<{ models: ModelInfo[]; fetchedAt: string }>;
  balance(): Promise<Balance>;
};

export type Balance = { usd: number; diem: number; bundledCredits: number; tier: string; isCharged: boolean };

const MODEL_CACHE_MS = 10 * 60 * 1000;

export function createVeniceClient(opts: { baseUrl: string; apiKey: string; fetch?: typeof fetch }): VeniceClient {
  const doFetch = opts.fetch ?? fetch;
  const host = new URL(opts.baseUrl).host;
  const modelCache = new Map<ModelType, { at: number; models: ModelInfo[] }>();

  async function request(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
    if (!opts.apiKey) {
      throw new CommandError(500, "no_api_key", "VENICE_ADMIN_KEY is not set. Add it to .env, then run npm run up.");
    }
    // timeoutMs covers the whole response, body included; 0 means none (streams manage their own timeouts).
    const { timeoutMs = 30_000, ...rest } = init;
    const headers = new Headers(rest.headers);
    headers.set("Authorization", `Bearer ${opts.apiKey}`);
    if (rest.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const signals = [rest.signal, timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined].filter((s) => s !== undefined && s !== null);
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}${path}`, { ...rest, headers, signal });
    } catch (err) {
      // Our own timeout: Venice was reached and just didn't answer in time (T05 QA-3), so don't say it wasn't.
      if ((err as Error)?.name === "TimeoutError") {
        throw upstreamError(`Venice didn't answer ${path.split("?")[0]} within ${Math.round(timeoutMs / 1000)} s.`, { timeout: true });
      }
      const why = err instanceof Error ? err.message : String(err);
      throw upstreamError(`Could not reach Venice at ${host}: ${why}`);
    }
    if (!res.ok) throw upstreamError(`Venice ${res.status} on ${path.split("?")[0]}: ${await errorMessage(res)}`, { status: res.status });
    return res;
  }

  async function json<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
    const res = await request(path, init);
    return (await res.json()) as T;
  }

  return {
    baseUrl: opts.baseUrl,
    request,
    json,
    async listModels(type, { refresh = false } = {}) {
      const hit = modelCache.get(type);
      if (hit && !refresh && Date.now() - hit.at < MODEL_CACHE_MS) {
        return { models: hit.models, fetchedAt: new Date(hit.at).toISOString() };
      }
      const body = await json<{ data?: unknown[] }>(`/models?type=${type}`);
      const models = (body.data ?? [])
        .map((m) => normalizeModel(m as Parameters<typeof normalizeModel>[0]))
        .filter((m): m is ModelInfo => m !== null && m.type === type)
        .sort((a, b) => a.id.localeCompare(b.id));
      const at = Date.now();
      modelCache.set(type, { at, models });
      return { models, fetchedAt: new Date(at).toISOString() };
    },
    async balance() {
      const body = await json<{ data?: Record<string, any> }>("/api_keys/rate_limits");
      const d = body.data ?? {};
      const b = d.balances ?? {};
      return {
        usd: Number(b.USD ?? 0),
        diem: Number(b.DIEM ?? 0),
        bundledCredits: Number(b.BUNDLED_CREDITS ?? 0),
        tier: String(d.apiTier?.id ?? "unknown"),
        isCharged: d.apiTier?.isCharged === true,
      };
    },
  };
}

/** Venice errors come as {"error": "..."} or {"error": {"message": ...}} or plain text. */
async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    const e = j?.error ?? j?.message ?? j;
    if (typeof e === "string") return e;
    if (typeof e?.message === "string") return e.message;
    return JSON.stringify(e).slice(0, 300);
  } catch {
    return text.slice(0, 300) || res.statusText;
  }
}
