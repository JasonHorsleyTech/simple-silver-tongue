import { existsSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { commands } from "../commands/index.ts";
import { loadConfig, ROOT, veniceApiKey } from "../config.ts";
import { nowIso } from "../lib/ids.ts";
import { createVeniceClient } from "../venice/client.ts";
import { consoleLogger as log, createApp } from "./app.ts";
import { createSessionStore } from "./sessions.ts";

// Live mode reads the Venice key from .env at runtime. Mock mode never loads it, so the real key
// can't reach the mock server.
if (process.env.SS_MODE !== "mock") {
  const envFile = join(ROOT, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

const config = loadConfig();
const apiKey = veniceApiKey();
if (!apiKey) log("WARNING: VENICE_ADMIN_KEY is not set; Venice commands will fail until it is in .env");

const app = createApp(
  {
    config,
    sessions: createSessionStore(),
    venice: createVeniceClient({ baseUrl: config.veniceBaseUrl, apiKey }),
    startedAt: nowIso(),
  },
  commands,
);

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  log(`simple-silver listening on http://${config.host}:${info.port} (${config.mode} Venice: ${config.veniceBaseUrl})`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  log(`FATAL: ${err.code === "EADDRINUSE" ? `port ${config.port} is already in use` : err.message}`);
  process.exit(1);
});

process.on("unhandledRejection", (err) => log(`unhandled rejection: ${err instanceof Error ? err.stack : String(err)}`));

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    log(`${sig}: shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
