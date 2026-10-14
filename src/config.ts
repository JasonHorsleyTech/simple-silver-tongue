import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");

export const DEFAULT_PORT = 4747;
export const MOCK_VENICE_PORT = 4748;
export const LIVE_VENICE_BASE_URL = "https://api.venice.ai/api/v1";

export const DEFAULT_TEXT_MODEL = "deepseek-v4-1-flash";
export const DEFAULT_IMAGE_MODEL = "z-image-turbo";

export type Mode = "live" | "mock";

export type Config = {
  host: string;
  port: number;
  mode: Mode;
  dataDir: string;
  runDir: string;
  webDist: string;
  veniceBaseUrl: string;
};

/** Everything except the API key, which stays out of this object so it can't leak into output. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode: Mode = env.SS_MODE === "mock" ? "mock" : "live";
  return {
    host: "127.0.0.1",
    port: Number(env.SS_PORT || DEFAULT_PORT),
    mode,
    dataDir: resolve(env.SS_DATA_DIR || join(ROOT, "data")),
    runDir: resolve(env.SS_RUN_DIR || join(ROOT, ".run")),
    webDist: resolve(env.SS_WEB_DIST || join(ROOT, "web", "dist")),
    veniceBaseUrl: (env.VENICE_BASE_URL || LIVE_VENICE_BASE_URL).replace(/\/+$/, ""),
  };
}

export function veniceApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.VENICE_ADMIN_KEY || env.VENICE_API_KEY || "";
}
