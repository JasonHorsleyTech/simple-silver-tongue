import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");

export const DEFAULT_PORT = 4747;
export const MOCK_VENICE_PORT = 4748;
export const LIVE_VENICE_BASE_URL = "https://api.venice.ai/api/v1";

export const DEFAULT_TEXT_MODEL = "deepseek-v4-1-flash";
export const DEFAULT_IMAGE_MODEL = "z-image-turbo";

export type Mode = "live" | "mock";

/**
 * A login nobody has used for this long ends, and its key is wiped from memory (T06 triage, QA-1): the server runs
 * for days, so a session that never ended was the easy way in for anyone at the Mac. SST_SESSION_IDLE_MINUTES
 * changes it (in the environment, or in .env for npm run up); 0 means sessions never time out.
 */
export const DEFAULT_SESSION_IDLE_MINUTES = 60;

export type Config = {
  host: string;
  port: number;
  mode: Mode;
  dataDir: string;
  runDir: string;
  webDist: string;
  veniceBaseUrl: string;
  /** Minutes without activity before a session ends. 0 = never. */
  sessionIdleMinutes: number;
};

/** Everything except the API key, which stays out of this object so it can't leak into output. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode: Mode = env.SST_MODE === "mock" ? "mock" : "live";
  return {
    host: "127.0.0.1",
    port: Number(env.SST_PORT || DEFAULT_PORT),
    mode,
    dataDir: resolve(env.SST_DATA_DIR || join(ROOT, "data")),
    runDir: resolve(env.SST_RUN_DIR || join(ROOT, ".run")),
    webDist: resolve(env.SST_WEB_DIST || join(ROOT, "web", "dist")),
    veniceBaseUrl: (env.VENICE_BASE_URL || LIVE_VENICE_BASE_URL).replace(/\/+$/, ""),
    sessionIdleMinutes: idleMinutes(env.SST_SESSION_IDLE_MINUTES),
  };
}

/** A number of minutes, 0 or more (fractions are fine, for a quick check by hand). Anything else: the default. */
export function idleMinutes(v: string | undefined): number {
  const n = v === undefined || v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SESSION_IDLE_MINUTES;
}

export function veniceApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.VENICE_ADMIN_KEY || env.VENICE_API_KEY || "";
}
