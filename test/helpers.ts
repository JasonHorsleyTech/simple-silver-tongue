import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdaptorServer } from "@hono/node-server";
import { run } from "../src/cli/main.ts";
import { commands as allCommands } from "../src/commands/index.ts";
import { loadConfig } from "../src/config.ts";
import { startMockVenice, type MockVenice } from "../src/dev/mock-venice.ts";
import { nowIso } from "../src/lib/ids.ts";
import type { AnyCommand } from "../src/registry.ts";
import { createApp } from "../src/server/app.ts";
import { createSessionStore } from "../src/server/sessions.ts";
import { createVeniceClient } from "../src/venice/client.ts";

export type CliResult = { code: number; stdout: string; stderr: string };

/** An in-process server (temp data dir) against an in-process mock Venice, plus an in-process CLI. */
export async function startTestServer(opts: { commands?: AnyCommand[] } = {}) {
  const tmp = await mkdtemp(join(tmpdir(), "ss-test-"));
  const mock: MockVenice = await startMockVenice({ delayMs: 0, slowDelayMs: 20, imageDelayMs: 0 });
  const config = {
    ...loadConfig({ SS_MODE: "mock" }),
    dataDir: join(tmp, "data"),
    runDir: join(tmp, "run"),
    webDist: join(tmp, "no-web"),
    veniceBaseUrl: mock.url,
  };
  const app = createApp(
    {
      config,
      sessions: createSessionStore(),
      venice: createVeniceClient({ baseUrl: mock.url, apiKey: "test-key" }),
      startedAt: nowIso(),
    },
    opts.commands ?? allCommands,
    () => {},
  );
  const server = createAdaptorServer({ fetch: app.fetch });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function cli(argv: string[], io: { stdin?: string; secrets?: string[] } = {}): Promise<CliResult> {
    let stdout = "";
    let stderr = "";
    const secrets = [...(io.secrets ?? [])];
    const code = await run(argv, {
      env: { SS_URL: url, SS_RUN_DIR: config.runDir },
      cwd: tmp,
      stdout: { write: (s) => void (stdout += typeof s === "string" ? s : Buffer.from(s).toString("utf8")) },
      stderr: { write: (s) => void (stderr += s) },
      stdinIsTTY: io.secrets !== undefined,
      readStdin: async () => io.stdin ?? "",
      promptSecret: async () => secrets.shift() ?? "",
    });
    return { code, stdout, stderr };
  }

  return {
    url,
    /** The Hono app itself. Call app.fetch(new Request(...)) for concurrency tests: Node's fetch can queue a
     * second request to the same server behind a still-open stream. */
    app,
    tmp,
    config,
    mock,
    cli,
    async close() {
      server.close();
      (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      await mock.close();
      await rm(tmp, { recursive: true, force: true });
    },
  };
}
