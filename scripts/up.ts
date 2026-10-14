import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, ROOT, veniceApiKey } from "../src/config.ts";
import { minutes } from "../src/lib/errors.ts";
import { foreignHolder, MOCK, RUN_DIR, SERVER, stop, tail, waitFor, type Proc } from "./proc.ts";

/**
 * npm run up        → stop whatever is running, build the web app if there is one, start the server (live Venice)
 * npm run up:mock   → same, plus the mock Venice, with the server pointed at it
 * Always ends with a fresh server on the current code, or exits non-zero with the log tail.
 */

const mock = process.argv.includes("--mock");

function fail(msg: string): never {
  console.error(`up: ${msg}`);
  process.exit(1);
}

function run(cmd: string, args: string[], cwd: string) {
  console.log(`up: ${cwd === ROOT ? "" : `(in ${cwd.slice(ROOT.length + 1)}) `}${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} failed`);
}

const mtime = (f: string) => (existsSync(f) ? statSync(f).mtimeMs : 0);

/**
 * Web build contract (for the Frontend pass):
 *  - a root "build:web" script wins, if package.json defines one;
 *  - otherwise, if web/package.json has a "build" script, run it inside web/, installing web deps first
 *    when web/node_modules is missing or older than web/package.json or its lockfile;
 *  - otherwise there is no web app yet, and the server shows a placeholder page.
 */
function buildWeb(): string {
  const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  if (rootPkg.scripts?.["build:web"]) {
    run("npm", ["run", "build:web"], ROOT);
    return "built (npm run build:web)";
  }
  const web = join(ROOT, "web");
  const webPkgFile = join(web, "package.json");
  if (!existsSync(webPkgFile)) return "none yet (no web/), placeholder page";
  const webPkg = JSON.parse(readFileSync(webPkgFile, "utf8"));
  if (!webPkg.scripts?.build) return "web/ has no build script, placeholder page";
  const installed = mtime(join(web, "node_modules", ".package-lock.json"));
  if (!installed || installed < Math.max(mtime(webPkgFile), mtime(join(web, "package-lock.json")))) {
    run("npm", ["install", "--no-audit", "--no-fund"], web);
  }
  run("npm", ["run", "build"], web);
  return "built (web/)";
}

function startDetached(p: Proc, env: NodeJS.ProcessEnv): number {
  if (existsSync(p.logFile)) renameSync(p.logFile, `${p.logFile}.1`);
  const log = openSync(p.logFile, "a", 0o600);
  // --disable-sigusr1: no one at the Mac can open the inspector (and read the keys in memory) with kill -USR1 (T06 QA-1).
  const child = spawn(process.execPath, ["--disable-sigusr1", p.marker], { cwd: ROOT, detached: true, stdio: ["ignore", log, log], env });
  child.unref();
  if (!child.pid) fail(`could not start the ${p.name}`);
  writeFileSync(p.pidFile, `${child.pid}\n`);
  return child.pid;
}

mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 });

try {
  await stop(SERVER);
  await stop(MOCK);
} catch (err) {
  fail((err as Error).message);
}
// Only the ports this mode uses must be free: a stranger on the mock's port doesn't matter in live mode.
for (const p of mock ? [SERVER, MOCK] : [SERVER]) {
  const holder = foreignHolder(p);
  if (holder) fail(holder);
}

const web = buildWeb();

const env: NodeJS.ProcessEnv = { ...process.env, SS_PORT: String(SERVER.port) };

if (mock) {
  // The mock (and the server in mock mode) must never see the real key.
  delete env.VENICE_ADMIN_KEY;
  delete env.VENICE_API_KEY;
  const pid = startDetached(MOCK, { ...env, MOCK_VENICE_PORT: String(MOCK.port) });
  if (!(await waitFor(`http://127.0.0.1:${MOCK.port}/health`, pid))) {
    fail(`mock Venice did not start. Last log lines:\n${tail(MOCK.logFile)}`);
  }
  Object.assign(env, {
    SS_MODE: "mock",
    VENICE_BASE_URL: `http://127.0.0.1:${MOCK.port}/api/v1`,
    VENICE_ADMIN_KEY: "mock-key",
  });
} else {
  env.SS_MODE = "live";
  delete env.VENICE_BASE_URL;
  // The server loads .env itself; here we only check that a key will be there.
  if (existsSync(join(ROOT, ".env"))) process.loadEnvFile(join(ROOT, ".env"));
  if (!veniceApiKey()) console.warn("up: WARNING: VENICE_ADMIN_KEY is not in .env; Venice commands will fail.");
}

// What the server will use: its env, plus .env in live mode (loaded above, as the server loads it).
const idle = loadConfig({ ...process.env, ...env }).sessionIdleMinutes;
const pid = startDetached(SERVER, env);
if (!(await waitFor(`http://127.0.0.1:${SERVER.port}/api/health`, pid))) {
  fail(`the server did not become healthy. Last log lines:\n${tail(SERVER.logFile)}`);
}

console.log(
  [
    "",
    `simple-silver is up → http://localhost:${SERVER.port}`,
    `  Venice: ${mock ? `MOCK (http://127.0.0.1:${MOCK.port}/api/v1)` : "live (api.venice.ai)"}`,
    `  web:    ${web}`,
    `  pid ${pid} · log .run/server.log · stop with npm run down`,
    "  Sessions live in server memory, so log in again: ./ss auth.login --username <name>",
    `  ${idle > 0 ? `A login ends after ${minutes(idle)} without activity` : "Logins never time out"} (SS_SESSION_IDLE_MINUTES${idle > 0 ? "; 0 = never" : ""})`,
  ].join("\n"),
);
