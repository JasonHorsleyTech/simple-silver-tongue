import { schemaType } from "../lib/help-text.ts";
import type { JsonSchema } from "../registry.ts";

/** Flags the CLI itself owns. Commands must not define args with these names. */
export type GlobalFlags = { json: boolean; help: boolean; out?: string };

export type Split = { command?: string; global: GlobalFlags; rest: string[] };

const looksLikeFlag = (t: string | undefined) => t !== undefined && /^--[A-Za-z]/.test(t);

/** Find the command name and pull out global flags. Everything else is left for parseFlags. */
export function splitArgv(argv: string[]): Split {
  const global: GlobalFlags = { json: false, help: false };
  const rest: string[] = [];
  let command: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === "--json") global.json = true;
    else if (t === "--help" || t === "-h") global.help = true;
    else if (t === "--out" || t.startsWith("--out=")) {
      const v = t === "--out" ? argv[++i] : t.slice(6);
      if (v === undefined) throw new UsageError("--out needs a file path");
      global.out = v;
    } else if (command === undefined && !t.startsWith("-")) command = t;
    else rest.push(t);
  }
  return { command, global, rest };
}

export class UsageError extends Error {}

export type Readers = {
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
};

const camel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const stripFinalNewline = (s: string) => s.replace(/\r?\n$/, "");

function objectBranch(s: JsonSchema | undefined): JsonSchema | undefined {
  if (!s) return undefined;
  if (s.properties) return s;
  return s.anyOf?.find((a) => a.properties);
}

/** Resolve a dotted flag path ("settings.max-tokens") to schema keys and the field schema. */
function lookup(root: JsonSchema, rawPath: string): { keys: string[]; schema: JsonSchema } | null {
  let node: JsonSchema | undefined = root;
  const keys: string[] = [];
  for (const part of rawPath.split(".")) {
    const obj = objectBranch(node);
    const props: Record<string, JsonSchema> = obj?.properties ?? {};
    const key = part in props ? part : camel(part) in props ? camel(part) : null;
    if (!key) return null;
    keys.push(key);
    node = props[key];
  }
  return node ? { keys, schema: node } : null;
}

function setPath(target: Record<string, unknown>, keys: string[], value: unknown, append: boolean) {
  let o = target;
  for (const k of keys.slice(0, -1)) {
    if (typeof o[k] !== "object" || o[k] === null) o[k] = {};
    o = o[k] as Record<string, unknown>;
  }
  const last = keys.at(-1)!;
  if (append) o[last] = [...((o[last] as unknown[]) ?? []), value];
  else o[last] = value;
}

function parseBool(v: string): boolean | null {
  const s = v.toLowerCase();
  if (["true", "1", "yes", "on"].includes(s)) return true;
  if (["false", "0", "no", "off"].includes(s)) return false;
  return null;
}

/**
 * Turn `--flag value` tokens into a typed args object using the command's JSON schema (from `help`).
 *   --name value | --name=value      kebab-case or camelCase; dotted paths reach nested objects
 *   --flag | --no-flag | --flag=false   booleans
 *   --n 3                             numbers
 *   --tag a --tag b                   arrays (repeat the flag, or pass a JSON array)
 *   --settings '{"a":1}'              objects as JSON
 *   --content @file.md | --content -  text from a file or stdin (one trailing newline dropped); @@x is a literal "@x"
 *   secret args (passwords) take "-" for stdin but are otherwise literal: no @file, so "@x" is "@x"
 */
export async function parseFlags(
  tokens: string[],
  schema: JsonSchema,
  readers: Readers,
): Promise<{ args: Record<string, unknown>; positionals: string[]; inlineSecrets: string[]; stdinUsed: boolean }> {
  const args: Record<string, unknown> = {};
  const positionals: string[] = [];
  /** Secret flags given a non-empty value right on the command line, which the shell keeps in its history (T06). */
  const inlineSecrets: string[] = [];
  let stdinUsed = false;

  const text = async (v: string, flag: string): Promise<string> => {
    if (v === "-") {
      if (stdinUsed) throw new UsageError(`${flag}: stdin can only be read once`);
      stdinUsed = true;
      return stripFinalNewline(await readers.readStdin());
    }
    if (v.startsWith("@@")) return v.slice(1);
    if (v.startsWith("@") && v.length > 1) {
      try {
        return stripFinalNewline(await readers.readFile(v.slice(1)));
      } catch (err) {
        throw new UsageError(`${flag}: cannot read ${v.slice(1)} (${(err as NodeJS.ErrnoException).code ?? "error"})`);
      }
    }
    return v;
  };

  const coerce = async (v: string, s: JsonSchema, flag: string): Promise<unknown> => {
    switch (schemaType(s)) {
      case "number":
      case "integer": {
        const n = Number(v);
        if (v.trim() === "" || Number.isNaN(n)) throw new UsageError(`${flag} expects a number, got ${JSON.stringify(v)}`);
        return n;
      }
      case "boolean": {
        const b = parseBool(v);
        if (b === null) throw new UsageError(`${flag} expects true or false, got ${JSON.stringify(v)}`);
        return b;
      }
      case "object":
      case "array":
        try {
          return JSON.parse(await text(v, flag));
        } catch (err) {
          if (err instanceof UsageError) throw err;
          throw new UsageError(`${flag} expects JSON`);
        }
      case "string":
        // A password may start with "@", and a failed file read would echo it to the terminal.
        return s.secret && v !== "-" ? v : text(v, flag);
      default: {
        // untyped: JSON if it parses, else the string
        const t = await text(v, flag);
        try {
          return JSON.parse(t);
        } catch {
          return t;
        }
      }
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (!tok.startsWith("--") || tok === "--") {
      positionals.push(tok);
      continue;
    }
    const eq = tok.indexOf("=");
    const rawKey = eq === -1 ? tok.slice(2) : tok.slice(2, eq);
    const inline = eq === -1 ? undefined : tok.slice(eq + 1);

    let found = lookup(schema, rawKey);
    let negated = false;
    if (!found && rawKey.startsWith("no-")) {
      const pos = lookup(schema, rawKey.slice(3));
      if (pos && schemaType(pos.schema) === "boolean") {
        found = pos;
        negated = true;
      }
    }
    if (!found) throw new UsageError(`unknown flag --${rawKey}`);
    const { keys, schema: field } = found;
    const flag = `--${rawKey}`;
    const type = schemaType(field);

    if (type === "boolean") {
      let value = true;
      if (inline !== undefined) value = (await coerce(inline, field, flag)) as boolean;
      else if (tokens[i + 1] !== undefined && parseBool(tokens[i + 1]!) !== null) value = parseBool(tokens[++i]!)!;
      setPath(args, keys, negated ? !value : value, false);
      continue;
    }

    let raw = inline;
    if (raw === undefined) {
      const next = tokens[i + 1];
      if (next === undefined || looksLikeFlag(next)) throw new UsageError(`${flag} needs a value`);
      raw = next;
      i++;
    }
    if (type === "array" && !raw.trimStart().startsWith("[")) {
      setPath(args, keys, await coerce(raw, field.items ?? {}, flag), true);
    } else {
      setPath(args, keys, await coerce(raw, field, flag), false);
    }
    if (field.secret && raw !== "-" && raw !== "") inlineSecrets.push(flag);
  }
  return { args, positionals, inlineSecrets, stdinUsed };
}
