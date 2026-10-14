import type { CommandInfo, JsonSchema } from "../registry.ts";

/** Help text rendered from the registry's schemas. Shared by the `help` command and the CLI's offline fallback. */

export const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The effective JSON-schema type, looking through nullable/union wrappers. */
export function schemaType(s: JsonSchema | undefined): string | undefined {
  if (!s) return undefined;
  if (Array.isArray(s.type)) return s.type.find((t) => t !== "null");
  if (s.type) return s.type;
  if (s.enum) return "string";
  const inner = s.anyOf?.find((a) => a.type !== "null");
  return inner ? schemaType(inner) : undefined;
}

function argLabel(s: JsonSchema): string {
  const t = schemaType(s);
  const en = s.enum ?? s.anyOf?.find((a) => a.enum)?.enum;
  if (en) return ` ${en.join("|")}`;
  if (t === "boolean") return "";
  if (t === "number" || t === "integer") return " <n>";
  if (t === "array") return ` <${schemaType(s.items) ?? "value"}>...`;
  if (t === "object") return " <json>";
  return " <text>";
}

export function renderCommandList(commands: CommandInfo[], header?: string): string {
  const width = Math.max(...commands.map((c) => c.name.length));
  const groups = new Map<string, CommandInfo[]>();
  for (const c of commands) {
    const g = c.name.includes(".") ? c.name.split(".")[0]! : "";
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  const out: string[] = [];
  if (header) out.push(header, "");
  for (const [, cmds] of [...groups].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))) {
    for (const c of cmds) out.push(`  ${c.name.padEnd(width)}  ${c.summary}${c.kind === "stream" ? " (streams)" : ""}`);
    out.push("");
  }
  out.push(
    "Run ./ss help <command> (or ./ss <command> --help) for its arguments.",
    "Global flags: --json prints the raw JSON (or NDJSON events); --out <file> saves binary output.",
    "Text values: --x @file.md reads a file, --x - reads stdin, @@ escapes a leading @.",
  );
  return out.join("\n");
}

export function renderCommandHelp(c: CommandInfo): string {
  const out = [`${c.name}: ${c.summary}`];
  if (c.description) out.push("", c.description);
  const props = Object.entries(c.args.properties ?? {});
  const required = new Set(c.args.required ?? []);
  out.push("", props.length ? "Arguments:" : "Arguments: none");
  const row = (flag: string, s: JsonSchema, isRequired: boolean, fallback = "") => {
    const flags: string[] = [];
    if (isRequired) flags.push("required");
    if (s.default !== undefined) flags.push(`default ${JSON.stringify(s.default)}`);
    if (s.secret) flags.push("prompted (hidden) when omitted");
    else if (s.ask) flags.push("asked when omitted");
    const desc = [s.description ?? fallback, flags.length ? `(${flags.join(", ")})` : ""].filter(Boolean).join(" ");
    return [`${flag}${argLabel(s)}`, desc];
  };
  const rows: string[][] = [];
  // An object arg also lists its fields, each settable on its own (--final-reminder.content "..."), nested
  // objects included (--settings.image.width).
  const add = (path: string, s: JsonSchema, isRequired: boolean, depth: number) => {
    const fields = Object.entries((s.properties ? s : s.anyOf?.find((a) => a.properties))?.properties ?? {});
    rows.push(row(`${"  ".repeat(depth)}--${path}`, s, isRequired, fields.length ? "Any of these fields, as JSON, or one flag each:" : ""));
    for (const [sub, f] of fields) add(`${path}.${kebab(sub)}`, f, false, depth + 1);
  };
  for (const [key, s] of props) add(kebab(key), s, required.has(key), 0);
  const w = Math.max(0, ...rows.map((r) => r[0]!.length));
  for (const [flag, desc] of rows) out.push(`  ${flag!.padEnd(w)}  ${desc}`);
  out.push(
    "",
    [
      `Login required: ${c.auth ? "yes" : "no"}`,
      c.kind === "stream" ? "Output: streamed events (text prints live)" : c.kind === "binary" ? "Output: binary (use --out <file>)" : "",
      `HTTP: POST /api/${c.name}${c.httpGet ? ` (also GET)` : ""}`,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  if (c.examples.length) out.push("", "Examples:", ...c.examples.map((e) => `  ${e}`));
  return out.join("\n");
}
