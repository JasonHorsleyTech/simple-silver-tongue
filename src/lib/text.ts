/** Plain-text rendering helpers for CLI output. No colors: the server renders these and can't see the terminal. */

export function table(headers: string[], rows: unknown[][]): string {
  const cells = rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c))));
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) =>
    r
      .map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i] ?? 0)))
      .join("  ")
      .trimEnd();
  return [line(headers), ...cells.map(line)].join("\n");
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isScalar = (v: unknown) => v === null || ["string", "number", "boolean", "undefined"].includes(typeof v);

/** Generic YAML-ish view of a JSON result: key: value lines, tables for lists of flat objects. */
export function toText(value: unknown, indent = ""): string {
  if (isScalar(value)) return value === undefined || value === null ? "-" : String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}(none)`;
    if (value.every((v) => isPlainObject(v) && Object.values(v).every(isScalar))) {
      const keys = [...new Set(value.flatMap((v) => Object.keys(v as object)))];
      const t = table(keys, value.map((v) => keys.map((k) => (v as Record<string, unknown>)[k])));
      return t.split("\n").map((l) => indent + l).join("\n");
    }
    return value.map((v) => `${indent}- ${toText(v, `${indent}  `).trimStart()}`).join("\n");
  }
  const lines: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isScalar(v)) lines.push(`${indent}${k}: ${toText(v)}`);
    else lines.push(`${indent}${k}:\n${toText(v, `${indent}  `)}`);
  }
  return lines.join("\n");
}
