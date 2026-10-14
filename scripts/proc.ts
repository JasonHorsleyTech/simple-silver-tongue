import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/config.ts";

/** Pid-file process management for `npm run up` / `down`. Only ever kills processes that are ours. */

export const RUN_DIR = join(ROOT, ".run");

export type Proc = { name: string; pidFile: string; logFile: string; marker: string; port: number };

export const SERVER: Proc = {
  name: "server",
  pidFile: join(RUN_DIR, "server.pid"),
  logFile: join(RUN_DIR, "server.log"),
  marker: "src/server/main.ts",
  port: Number(process.env.SS_PORT || 4747),
};

export const MOCK: Proc = {
  name: "mock Venice",
  pidFile: join(RUN_DIR, "mock.pid"),
  logFile: join(RUN_DIR, "mock.log"),
  marker: "src/dev/mock-venice.ts",
  port: Number(process.env.MOCK_VENICE_PORT || 4748),
};

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function commandOf(pid: number): string {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/** Pids listening on a TCP port (empty if none, or if lsof is unavailable). */
export function listeners(port: number): number[] {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
    return out.split("\n").filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function kill(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  for (let i = 0; i < 40 && alive(pid); i++) await sleep(50);
  if (alive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
    for (let i = 0; i < 20 && alive(pid); i++) await sleep(50);
  }
}

/** Stop our process: the one in its pid file, plus any of ours still holding its port (e.g. a lost pid file). */
export async function stop(p: Proc): Promise<boolean> {
  const pids = new Set<number>();
  if (existsSync(p.pidFile)) {
    const pid = Number(readFileSync(p.pidFile, "utf8").trim());
    if (pid && alive(pid) && commandOf(pid).includes(p.marker)) pids.add(pid);
  }
  for (const pid of listeners(p.port)) {
    if (commandOf(pid).includes(p.marker)) pids.add(pid);
  }
  for (const pid of pids) await kill(pid);
  rmSync(p.pidFile, { force: true });
  return pids.size > 0;
}

/** Describes a program that is not ours holding the port, or null. We never kill those. */
export function foreignHolder(p: Proc): string | null {
  const foreign = listeners(p.port).filter((pid) => !commandOf(pid).includes(p.marker));
  return foreign.length ? `port ${p.port} is in use by another program (pid ${foreign.join(", ")}: ${commandOf(foreign[0]!)})` : null;
}

export async function waitFor(url: string, pid: number, timeoutMs = 15000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!alive(pid)) return false;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {}
    await sleep(100);
  }
  return false;
}

export function tail(file: string, lines = 20): string {
  if (!existsSync(file)) return "(no log)";
  return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
}
