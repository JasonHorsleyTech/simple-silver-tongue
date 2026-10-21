import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdaptorServer } from "@hono/node-server";
import { run } from "../src/cli/main.ts";
import { commands as allCommands } from "../src/commands/index.ts";
import { loadConfig, ROOT } from "../src/config.ts";
import { startMockVenice, type MockOptions, type MockVenice } from "../src/dev/mock-venice.ts";
import { nowIso } from "../src/lib/ids.ts";
import type { AnyCommand } from "../src/registry.ts";
import { createApp } from "../src/server/app.ts";
import { createSessionStore, type SessionOptions } from "../src/server/sessions.ts";
import { createVeniceClient } from "../src/venice/client.ts";

export type CliResult = { code: number; stdout: string; stderr: string };

/** An in-process server (temp data dir) against an in-process mock Venice, plus an in-process CLI. */
/** `log` receives every line the server would write to .run/server.log (the T06 audit greps them). */
/** `sessions` sets the idle timeout and the sessions' clock (T06 triage: tests move a fake clock, then sweep). */
/** `modelsFile`: the model list models.list reads. Default: the committed example, never anyone's own models.ini. */
export async function startTestServer(
  opts: { commands?: AnyCommand[]; mock?: MockOptions; log?: (line: string) => void; sessions?: SessionOptions; modelsFile?: string } = {},
) {
  const tmp = await mkdtemp(join(tmpdir(), "sst-test-"));
  const mock: MockVenice = await startMockVenice({ delayMs: 0, slowDelayMs: 20, imageDelayMs: 0, ...opts.mock });
  const config = {
    ...loadConfig({ SST_MODE: "mock" }),
    dataDir: join(tmp, "data"),
    runDir: join(tmp, "run"),
    webDist: join(tmp, "no-web"),
    veniceBaseUrl: mock.url,
    modelsFile: opts.modelsFile ?? join(ROOT, "models.example.ini"),
  };
  const sessions = createSessionStore({ idleMinutes: config.sessionIdleMinutes, ...opts.sessions });
  const app = createApp(
    {
      config,
      sessions,
      venice: createVeniceClient({ baseUrl: mock.url, apiKey: "test-key" }),
      startedAt: nowIso(),
    },
    opts.commands ?? allCommands,
    opts.log ?? (() => {}),
  );
  const server = createAdaptorServer({ fetch: app.fetch });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  /** Files the CLI's --open would have shown (T07 triage); its copies go under <tmp>/os-tmp. */
  const opened: string[] = [];
  async function cli(argv: string[], io: { stdin?: string; secrets?: string[]; env?: Record<string, string> } = {}): Promise<CliResult> {
    let stdout = "";
    let stderr = "";
    const secrets = [...(io.secrets ?? [])];
    const code = await run(argv, {
      env: { SST_URL: url, SST_RUN_DIR: config.runDir, ...io.env },
      cwd: tmp,
      stdout: { write: (s) => void (stdout += typeof s === "string" ? s : Buffer.from(s).toString("utf8")) },
      stderr: { write: (s) => void (stderr += s) },
      stdinIsTTY: io.secrets !== undefined,
      readStdin: async () => io.stdin ?? "",
      promptSecret: async () => secrets.shift() ?? "",
      openFile: async (path) => void opened.push(path),
      tmpDir: join(tmp, "os-tmp"),
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
    sessions,
    cli,
    opened,
    async close() {
      sessions.close();
      server.close();
      (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      await mock.close();
      await rm(tmp, { recursive: true, force: true });
    },
  };
}
