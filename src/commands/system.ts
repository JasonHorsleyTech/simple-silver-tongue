import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { notFound } from "../lib/errors.ts";
import { renderCommandHelp, renderCommandList } from "../lib/help-text.ts";
import { command, describeCommand, type CommandInfo } from "../registry.ts";

type HelpResult = { commands: CommandInfo[] };

export const help = command({
  name: "help",
  description: `List every command, or show one command's arguments.
The CLI uses this catalog to parse flags, so it is always in step with the running server.`,
  auth: false,
  args: z.object({ command: z.string().optional().describe("A command name, e.g. user.create") }),
  examples: ["./sst help", "./sst help user.create"],
  handler: (args, ctx): HelpResult => {
    const all = ctx.deps.commands.map(describeCommand);
    if (!args.command) return { commands: all };
    const one = all.find((c) => c.name === args.command);
    if (!one) throw notFound(`Unknown command ${args.command}. Run ./sst help for the list.`);
    return { commands: [one] };
  },
  format: (r: HelpResult) =>
    r.commands.length === 1 ? renderCommandHelp(r.commands[0]!) : renderCommandList(r.commands, "simple-silver commands:"),
});

export const health = command({
  name: "health",
  description: "Server status: mode (live or mock Venice), uptime and whether the web UI is built.",
  auth: false,
  httpGet: true,
  args: z.object({}),
  handler: (_args, ctx) => {
    const { config, startedAt } = ctx.deps;
    return {
      ok: true,
      mode: config.mode,
      venice: config.veniceBaseUrl,
      url: `http://localhost:${config.port}`,
      pid: process.pid,
      startedAt,
      uptimeSec: Math.round(process.uptime()),
      web: existsSync(join(config.webDist, "index.html")) ? "built" : "not built",
      commands: ctx.deps.commands.length,
      /** Minutes without activity before a login ends (0 = never), so a client can say so even after a reload. */
      sessionIdleMinutes: ctx.deps.sessions.idleMinutes,
    };
  },
  format: (r) =>
    `ok · ${r.mode === "mock" ? "MOCK Venice" : "live Venice"} (${r.venice}) · ${r.url} · pid ${r.pid} · up ${r.uptimeSec}s · web ${r.web}`,
});

export default [help, health];
