import { existsSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { commands } from "../commands/index.ts";
import { loadConfig, ROOT, veniceApiKey } from "../config.ts";
import { finishInFlight, stopTakingWork } from "../conversations/store.ts";
import { nowIso } from "../lib/ids.ts";
import { createVeniceClient } from "../venice/client.ts";
import { minutes } from "../lib/errors.ts";
import { consoleLogger as log, createApp } from "./app.ts";
import { createSessionStore } from "./sessions.ts";

// Live mode reads the Venice key from .env at runtime. Mock mode never loads it, so the real key
// can't reach the mock server.
if (process.env.SST_MODE !== "mock") {
  const envFile = join(ROOT, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

/**
 * SIGUSR1 would open Node's inspector on 127.0.0.1:9229 for anyone at the Mac, and with it every logged-in session's
 * key and the Venice key (T06 QA-1). npm run up starts us with --disable-sigusr1, which ignores the signal outright.
 * For a server started by hand, this listener keeps the inspector shut instead, and logs the try (both tested on
 * Node 26). Only the first ~100 ms of such a server, before this line runs, would still open it.
 */
process.on("SIGUSR1", () => log("SIGUSR1 ignored: the debugger is disabled on this server"));

const config = loadConfig();
const apiKey = veniceApiKey();
if (!apiKey) log("WARNING: VENICE_ADMIN_KEY is not set; Venice commands will fail until it is in .env");
const idleRaw = process.env.SST_SESSION_IDLE_MINUTES;
if (idleRaw && Number(idleRaw) !== config.sessionIdleMinutes) {
  log(`WARNING: SST_SESSION_IDLE_MINUTES must be a number of minutes, 0 or more (0 = never); using ${config.sessionIdleMinutes}`);
}
const sessions = createSessionStore({ idleMinutes: config.sessionIdleMinutes });

const app = createApp(
  {
    config,
    sessions,
    venice: createVeniceClient({ baseUrl: config.veniceBaseUrl, apiKey }),
    startedAt: nowIso(),
  },
  commands,
);

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  log(`simple-silver listening on http://${config.host}:${info.port} (${config.mode} Venice: ${config.veniceBaseUrl})`);
  log(sessions.idleMinutes > 0 ? `sessions end after ${minutes(sessions.idleMinutes)} without activity (SST_SESSION_IDLE_MINUTES)` : "sessions never time out (SST_SESSION_IDLE_MINUTES=0)");
});

server.on("error", (err: NodeJS.ErrnoException) => {
  log(`FATAL: ${err.code === "EADDRINUSE" ? `port ${config.port} is already in use` : err.message}`);
  process.exit(1);
});

process.on("unhandledRejection", (err) => log(`unhandled rejection: ${err instanceof Error ? err.stack : String(err)}`));

/**
 * A restart (npm run up / down sends SIGTERM) waits for the work in flight, so a paid reply or image is saved,
 * not lost (T05 QA-1): no new connections, no new work (503), and up to SHUTDOWN_WAIT_MS for what is running.
 * scripts/proc.ts waits a little longer than that before it kills. A second signal exits at once.
 */
const SHUTDOWN_WAIT_MS = 60_000;
let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    if (stopping) process.exit(0);
    stopping = true;
    log(`${sig}: shutting down`);
    stopTakingWork();
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    const left = await finishInFlight(SHUTDOWN_WAIT_MS, (n) => log(`waiting for ${n} running repl${n === 1 ? "y or image" : "ies or images"} to finish and save`));
    if (left) log(`gave up waiting after ${SHUTDOWN_WAIT_MS / 1000} s: ${left} still running`);
    // Let the streams that just ended reach their clients (their done event), briefly.
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 1000))]);
    process.exit(0);
  });
}
