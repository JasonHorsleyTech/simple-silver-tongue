import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ROOT, DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL } from "../config.ts";
import { rebuild } from "../conversations/campaign.ts";
import { DEFAULT_PIN_AS, DEFAULT_TEMPLATES, newBrain, nextColor, upgradeTemplates } from "../conversations/defaults.ts";
import { createConversationFile, loadConversation, mutateConversation } from "../conversations/store.ts";
import { lookupModel } from "../conversations/turn.ts";
import { SCHEMA_VERSION, SETUP_ROLES, type Brain, type Conversation, type ImageSettings, type LedgerMessage, type MessageVersion } from "../conversations/types.ts";
import { readImageFile, removeImageFiles, saveImageFile } from "../images/files.ts";
import { imageSettingsProblem } from "../images/request.ts";
import { badRequest, CommandError, notFound } from "../lib/errors.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { command, type Ctx } from "../registry.ts";
import {
  PLAYER,
  applyMakes,
  brainLine,
  brainName,
  checkBrainModels,
  checkName,
  color,
  finalReminder,
  imageModel,
  kind,
  makes,
  pinAs,
  reasoning,
  reasoningNotes,
  safeMode,
  shape,
  stop,
  textModel,
  tool,
} from "./brains.ts";
import { conversationId, imageSettings, messageId, systemPrompt, templates, title } from "./conversations.ts";

/**
 * Starting a campaign from another one's setup (T07): a committed example (examples/*.json), a campaign file of
 * your own (any conversation.get --json), or one of your conversations (clone). The result is an ordinary
 * conversation: every brain, setup message and template is editable as always.
 *
 * T10: a preset (presets/*.json) is a campaign file with brains and no world: no setup, no messages. You start a
 * conversation from one and write its World Bible, or take one of its brains into a conversation you already have
 * (brain.import, which takes an example's brains too).
 */

export const EXAMPLES_DIR = join(ROOT, "examples");
export const PRESETS_DIR = join(ROOT, "presets");
const FILE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The two folders of committed campaign files. Examples are ready to play; presets are brains with no world (T10). */
type Library = "example" | "preset";
const LIBRARY = {
  example: { dir: EXAMPLES_DIR, folder: "examples", list: "examples.list", flag: "--example" },
  preset: { dir: PRESETS_DIR, folder: "presets", list: "presets.list", flag: "--preset" },
} as const;

// ── The campaign file: a conversation document (conversation.get --json), with ids and dates optional ──

const version = z.object({
  // A blank message (or image prompt) is refused here as message.edit refuses one (T07 QA-4).
  content: z.string().refine((s) => s.trim() !== "", "A message can't be blank"),
  source: z.enum(["generated", "authored"]).default("authored"),
  steer: z.string().optional(),
  steeredFrom: z.number().int().min(0).optional(),
  thought: z.string().optional(), // a fresh take's note, display only (T17: the Muse's note is its own message; T15: a text version's content starts with it)
  repaintOf: z.number().int().min(0).optional(),
  reasoning: z.string().optional(),
  edited: z.boolean().optional(),
  model: z.string().optional(),
  finishReason: z.string().optional(),
  stopped: z.literal(true).optional(),
  usage: z.object({ promptTokens: z.number(), completionTokens: z.number(), reasoningTokens: z.number().optional(), cachedTokens: z.number().optional() }).optional(),
  costUsd: z.number().min(0).optional(),
  createdAt: z.string().optional(),
  // Only what the image was made with: a campaign file brings prompts, never pictures.
  image: z.object({ model: z.string(), safeMode: z.boolean() }).partial().optional(),
  // T09: what a player's roll said, for display. The content is what the brains read.
  roll: z.object({ die: z.literal("d20"), result: z.number().int().min(1).max(20) }).optional(),
});
/** One line for the lists and the browser's picker (T10 QA-7: a line break broke the CLI listing). */
const about = z.string().regex(/^[^\r\n]*$/, "one line, with no line breaks");
const campaignSchema = z.object({
  /** A conversation.get --json carries it: which upgrades the file still needs (T17 QA-2). Not stored; import writes the current one. */
  schemaVersion: z.number().optional(),
  /** One line for examples.list. Not sent to any model, and not stored. */
  about: about.optional(),
  title: title.optional(),
  settings: z
    .object({
      textModel: z.string().min(1),
      maxTokens: z.number().int().positive().nullable(),
      temperature: z.number().min(0).max(2).nullable(),
      imageModel: z.string().min(1),
      image: imageSettings,
    })
    .partial()
    .optional(),
  templates: templates.optional(),
  /** T13: role absent (a file from before it) = user, as setup messages were always sent. */
  setup: z.array(z.object({ label: z.string().trim().min(1).max(100), role: z.enum(SETUP_ROLES).default("user"), content: z.string() })).default([]),
  brains: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        name: brainName,
        /** T10: one line on the brain's job, for examples.list, presets.list and the browser. Not sent, not stored. */
        about: about.optional(),
        color: color.optional(),
        kind: kind.default("text"),
        reasoning: reasoning.optional(),
        safeMode: safeMode.optional(),
        shape: shape.optional(),
        systemPrompt,
        finalReminder: finalReminder.optional(),
        tool: tool.optional(),
        /** Absent (a file from before T07 triage): the kind's default, as for a new brain. */
        stop: stop.optional(),
        /** T16: messages pinned to it, by their `id` in this file (import gives them fresh ids). */
        pins: z.array(z.object({ messageId: z.string().min(1), as: pinAs.default(DEFAULT_PIN_AS) })).default([]),
        /** T16: "Each new message makes a new brain" (checked as brain.update --makes checks it). */
        makes: makes.optional(),
        /** T16: the message (its `id` in this file) the brain was made from. */
        madeFrom: z.string().min(1).optional(),
        /** T18: the brain's own models (absent or null: the conversation's). Checked against Venice's list, as the settings' are. */
        textModel: textModel.optional(),
        imageModel: imageModel.optional(),
      }),
    )
    .min(1, "A campaign needs at least one brain"),
  /** The brain `turn` talks to without --brain. Default: the first brain. */
  defaultBrainId: z.string().optional(),
  messages: z
    .array(
      z.object({
        /** T16: only what pins and madeFrom refer to it by; import gives it a fresh id. */
        id: z.string().min(1).optional(),
        author: z.union([z.object({ type: z.literal("player") }), z.object({ type: z.literal("brain"), brainId: z.string().min(1) })]),
        kind: kind.optional(),
        versions: z.array(version).min(1),
        /** 0-based, as in the document. Default: the last version. */
        activeVersion: z.number().int().min(0).optional(),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),
      }),
    )
    .default([]),
});
type Campaign = z.output<typeof campaignSchema>;

/** Parse a campaign file, saying where it is wrong (`brains.2.systemPrompt: ...`), never what it says. */
function parseCampaign(raw: unknown, where: string): Campaign {
  const r = campaignSchema.safeParse(raw);
  if (r.success) return r.data;
  const issues = r.error.issues.slice(0, 5).map((i) => `${i.path.map(String).join(".") || "(top level)"}: ${i.message.replace(/\.$/, "")}`);
  throw badRequest(`${where} isn't a campaign this app can import. ${issues.join("; ")}.`, { issues: r.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });
}

/** The campaign as a conversation document, checked the way brain.add, message.add and conversation.update check. */
function toConversation(doc: Campaign, where: string): Conversation {
  const now = nowIso();
  const bad = (msg: string) => badRequest(`${where}: ${msg}`);
  const shell = { brains: [] as Brain[] };
  const byId = new Map<string, Brain>();
  for (const [i, b] of doc.brains.entries()) {
    if (/^b_[a-z0-9]+$/.test(b.name)) throw bad(`brains.${i}.name: a brain name can't look like a brain id (b_...).`);
    if (b.name.toLowerCase() === PLAYER) throw bad(`brains.${i}.name: "${b.name}" is reserved (message.add --as player means you).`);
    const twin = shell.brains.findIndex((x) => x.name.toLowerCase() === b.name.toLowerCase());
    if (twin >= 0) throw bad(`brains.${i}.name: two brains are called "${shell.brains[twin]!.name}" (names are unique, ignoring case).`);
    const isDefault = doc.defaultBrainId ? b.id === doc.defaultBrainId : i === 0;
    if (b.kind === "text" && (b.safeMode !== undefined || b.shape !== undefined || b.tool || typeof b.imageModel === "string")) {
      throw bad(`brains.${i}: safe mode, shape, tool text and an image model are for image brains, and ${b.name} is a text brain.`);
    }
    const brain = newBrain({ name: b.name, systemPrompt: b.systemPrompt, color: b.color ?? nextColor(shell), isDefault, kind: b.kind }); // an image brain gets DEFAULT_TOOL and safe mode
    Object.assign(brain.reasoning, b.reasoning ?? {});
    Object.assign(brain.finalReminder, b.finalReminder ?? {});
    if (b.safeMode !== undefined) brain.safeMode = b.safeMode;
    if (b.shape !== undefined) brain.shape = b.shape;
    if (b.tool) Object.assign(brain.tool!, b.tool);
    if (b.stop) brain.stop = b.stop;
    if (typeof b.textModel === "string") brain.textModel = b.textModel; // T18
    if (typeof b.imageModel === "string") brain.imageModel = b.imageModel;
    if (b.makes) {
      try {
        applyMakes(brain, b.makes);
      } catch (err) {
        throw bad(`brains.${i}.makes: ${(err as Error).message}`);
      }
    }
    if (b.id) {
      if (byId.has(b.id)) throw bad(`brains.${i}.id: two brains have the id ${b.id}.`);
      byId.set(b.id, brain);
    }
    shell.brains.push(brain);
  }
  const defaultBrain = doc.defaultBrainId ? byId.get(doc.defaultBrainId) : shell.brains[0];
  if (!defaultBrain) throw bad(`defaultBrainId: no brain has the id ${doc.defaultBrainId}.`);

  const msgIds = new Map<string, string>();
  const messages = doc.messages.map((m, i): LedgerMessage => {
    const at = `messages.${i}`;
    let author: LedgerMessage["author"] = { type: "player" };
    let msgKind: LedgerMessage["kind"] = "text";
    let safe = true;
    let paints = doc.settings?.imageModel ?? DEFAULT_IMAGE_MODEL;
    if (m.author.type === "brain") {
      const brain = byId.get(m.author.brainId);
      if (!brain) throw bad(`${at}.author.brainId: no brain has the id ${m.author.brainId}.`);
      author = { type: "brain", brainId: brain.id };
      msgKind = brain.kind;
      safe = brain.safeMode ?? true;
      paints = brain.imageModel ?? paints; // T18: an image brain's own model
    } else if (m.versions.length !== 1) {
      throw bad(`${at}: a player message has exactly one version.`);
    }
    if (m.kind !== undefined && m.kind !== msgKind) throw bad(`${at}.kind: ${m.kind} doesn't match its author (${msgKind}).`);
    const active = m.activeVersion ?? m.versions.length - 1;
    if (active >= m.versions.length) throw bad(`${at}.activeVersion: there is no version ${active} (0-based).`);
    const versions = m.versions.map((v): MessageVersion => {
      const { image, ...rest } = v;
      const out: MessageVersion = { ...rest, createdAt: v.createdAt ?? now };
      // Display-only pointers to other versions: dropped if they point nowhere.
      if (out.steeredFrom !== undefined && out.steeredFrom >= m.versions.length) delete out.steeredFrom;
      if (out.repaintOf !== undefined && out.repaintOf >= m.versions.length) delete out.repaintOf;
      if (author.type === "brain") delete out.roll; // only the player rolls
      if (msgKind === "image") out.image = { id: "", status: "error", model: image?.model ?? paints, safeMode: image?.safeMode ?? safe, createdAt: now };
      return out;
    });
    const id = newId("m");
    if (m.id !== undefined) {
      if (msgIds.has(m.id)) throw bad(`${at}.id: two messages have the id ${m.id}.`);
      msgIds.set(m.id, id);
    }
    return { id, author, kind: msgKind, versions, activeVersion: active, createdAt: m.createdAt ?? now, updatedAt: m.updatedAt ?? now };
  });

  // T16: pins and madeFrom name messages by their id in the file; they get the fresh ones.
  for (const [i, b] of doc.brains.entries()) {
    const brain = shell.brains[i]!;
    const fresh = (fileId: string, at: string) => {
      const id = msgIds.get(fileId);
      if (!id) throw bad(`brains.${i}.${at}: no message has the id ${fileId}.`);
      return id;
    };
    for (const [j, p] of b.pins.entries()) {
      const messageId = fresh(p.messageId, `pins.${j}.messageId`);
      if (!brain.pins.some((x) => x.messageId === messageId)) brain.pins.push({ messageId, as: p.as });
    }
    if (b.madeFrom !== undefined) brain.madeFrom = fresh(b.madeFrom, "madeFrom");
  }

  const s = doc.settings ?? {};
  const image: ImageSettings = { format: "webp", hideWatermark: true };
  for (const [k, v] of Object.entries(s.image ?? {})) if (v !== null && v !== undefined) Object.assign(image, { [k]: v });
  const conv: Conversation = {
    schemaVersion: SCHEMA_VERSION,
    id: newId("c"),
    title: doc.title ?? "Imported campaign",
    createdAt: now,
    updatedAt: now,
    settings: { textModel: s.textModel ?? DEFAULT_TEXT_MODEL, imageModel: s.imageModel ?? DEFAULT_IMAGE_MODEL, image },
    templates: { ...DEFAULT_TEMPLATES, ...doc.templates },
    setup: doc.setup.map((x) => ({ id: newId("s"), label: x.label, role: x.role, content: x.content })),
    brains: shell.brains,
    defaultBrainId: defaultBrain.id,
    messages,
    spentUsd: 0,
  };
  if (s.maxTokens) conv.settings.maxTokens = s.maxTokens;
  if (s.temperature !== undefined && s.temperature !== null) conv.settings.temperature = s.temperature;
  // T17: a file with T15's thought template gets the Muse's note, as a load does; one that says it is from schema 7
  // on (a conversation.get --json since T17) keeps its template as it is (T17 QA-2).
  if ((doc.schemaVersion ?? 0) < 7) upgradeTemplates(conv.templates);
  return conv;
}

/** A committed campaign file, by name: examples/<name>.json or presets/<name>.json. The name is checked first. */
async function readLibrary(lib: Library, name: string): Promise<{ raw: unknown; where: string }> {
  const { dir, folder, list } = LIBRARY[lib];
  if (!FILE_NAME.test(name)) throw badRequest(`${lib === "preset" ? "Preset" : "Example"} names are lowercase letters, digits and dashes. See ./ss ${list}.`);
  const where = `${folder}/${name}.json`;
  let text: string;
  try {
    text = await readFile(join(dir, `${name}.json`), "utf8");
  } catch {
    const names = await libraryNames(lib);
    throw notFound(`No ${lib} "${name}". ${names.length ? `${lib === "preset" ? "Presets" : "Examples"}: ${names.join(", ")}.` : `There are none in ${folder}/.`}`);
  }
  try {
    return { raw: JSON.parse(text), where };
  } catch {
    throw badRequest(`${where} is not valid JSON.`);
  }
}

async function libraryNames(lib: Library): Promise<string[]> {
  const files = await readdir(LIBRARY[lib].dir).catch(() => [] as string[]);
  return files.filter((f) => f.endsWith(".json") && FILE_NAME.test(f.slice(0, -5))).map((f) => f.slice(0, -5)).sort();
}

/** A committed file, parsed and checked. A preset is brains with no world: setup or messages make it an example. */
async function readCampaign(lib: Library, name: string): Promise<{ doc: Campaign; where: string }> {
  const { raw, where } = await readLibrary(lib, name);
  const doc = parseCampaign(raw, where);
  if (lib === "preset" && (doc.setup.length || doc.messages.length)) {
    throw badRequest(`${where}: a preset has brains and no world, so no setup and no messages. A campaign with them belongs in examples/.`);
  }
  return { doc, where };
}

// ── Commands ──

/**
 * A brain's color is its badge (T07 frontend: the browser shows the cast before you start); `about` is its job (T10).
 * `reasoning` is its effort when the file switches reasoning on (T10 frontend): a labeled opt-in, so the pickers say so.
 */
/** `makes` (T16): the name pattern of a brain that makes brains ("Character {{n}}"), when its setting is on. */
/** `textModel` / `imageModel` (T18): the brain's own models, when the file gives it some (else it uses the conversation's). */
type BrainInfo = { name: string; kind: string; color?: string; about?: string; reasoning?: string; makes?: string; textModel?: string; imageModel?: string };
type ExampleInfo = { name: string; title: string; about?: string; brains: BrainInfo[]; setup: string[]; messages: number; error?: string };
type PresetInfo = { name: string; title: string; about?: string; brains: BrainInfo[]; error?: string };

/** Every committed file of a library, each parsed and checked as an import would; a bad one is listed with why. */
async function listLibrary(lib: Library): Promise<ExampleInfo[]> {
  const out: ExampleInfo[] = [];
  for (const name of await libraryNames(lib)) {
    try {
      const { doc, where } = await readCampaign(lib, name);
      // T10 QA-7: what an import would refuse (two brains of one name) isn't listed as usable. The brains are listed as
      // an import makes them (the color it would give one without, its reasoning), in the file's order.
      const conv = toConversation(doc, where);
      out.push({
        name,
        title: doc.title ?? name,
        about: doc.about,
        brains: conv.brains.map((b, i) => ({
          name: b.name,
          kind: b.kind,
          color: b.color,
          ...(doc.brains[i]?.about ? { about: doc.brains[i]!.about } : {}),
          ...(b.reasoning.enabled ? { reasoning: b.reasoning.effort } : {}),
          ...(b.makes?.enabled ? { makes: b.makes.name } : {}),
          ...(b.textModel ? { textModel: b.textModel } : {}),
          ...(b.kind === "image" && b.imageModel ? { imageModel: b.imageModel } : {}),
        })),
        setup: doc.setup.map((s) => s.label),
        messages: doc.messages.length,
      });
    } catch (err) {
      out.push({ name, title: name, brains: [], setup: [], messages: 0, error: (err as Error).message });
    }
  }
  return out;
}

const brainNames = (brains: BrainInfo[]) => brains.map((b) => `${b.name}${b.kind === "image" ? " (image)" : ""}${b.reasoning ? ` (reasoning ${b.reasoning})` : ""}`).join(", ");

export const examplesList = command({
  name: "examples.list",
  description: `List the example campaigns that come with the app (examples/*.json), ready to import.
Start one with ./ss conversation.import --example <name>. Nothing here is yours: they are committed files.
Their brains can also join a conversation of yours one at a time: ./ss brain.import --example <name> --brain <brain>.`,
  auth: false,
  args: z.object({}),
  handler: async (): Promise<{ examples: ExampleInfo[] }> => ({ examples: await listLibrary("example") }),
  format: ({ examples }: { examples: ExampleInfo[] }) =>
    examples.length
      ? examples
          .map((e) =>
            e.error
              ? `${e.name}: can't be imported (${e.error})`
              : [
                  `${e.name}: ${e.title}`,
                  e.about ? `  ${e.about}` : "",
                  `  Brains: ${brainNames(e.brains)}`,
                  `  Setup: ${e.setup.join(", ") || "none"} · ${e.messages} message${e.messages === 1 ? "" : "s"}`,
                  `  Start it: ./ss conversation.import --example ${e.name}`,
                ]
                  .filter(Boolean)
                  .join("\n"),
          )
          .join("\n\n")
      : "No examples in examples/.",
});

export const presetsList = command({
  name: "presets.list",
  description: `List the presets that come with the app (presets/*.json): kits of brains with good instructions and no world.
A preset has no World Bible and no story. Start a conversation from one, then write its World Bible (setup.add):
./ss conversation.import --preset <name> --title "Chinatown". Or add one of its brains to a conversation you
already have: ./ss brain.import --preset <name> --brain <brain>. Nothing here is yours: they are committed files.`,
  auth: false,
  args: z.object({}),
  handler: async (): Promise<{ presets: PresetInfo[] }> => ({
    presets: (await listLibrary("preset")).map(({ setup: _s, messages: _m, ...p }) => p),
  }),
  format: ({ presets }: { presets: PresetInfo[] }) =>
    presets.length
      ? presets
          .map((p) =>
            p.error
              ? `${p.name}: can't be used (${p.error})`
              : [
                  `${p.name}: ${p.title}`,
                  p.about ? `  ${p.about}` : "",
                  ...p.brains.map((b) => `  · ${b.name}${b.kind === "image" ? " (image)" : ""}${b.reasoning ? ` (reasoning ${b.reasoning})` : ""}${b.makes ? ` (makes "${b.makes}" brains)` : ""}${b.about ? `: ${b.about}` : ""}`),
                  `  Start one: ./ss conversation.import --preset ${p.name} --title "..."`,
                  `  Add one brain: ./ss brain.import --conversation c_... --preset ${p.name} --brain "${p.brains[0]?.name ?? "..."}"`,
                ]
                  .filter(Boolean)
                  .join("\n"),
          )
          .join("\n\n")
      : "No presets in presets/.",
});

const withoutMessages = z
  .boolean()
  .describe("Leave the ledger out: brains, setup messages, templates and settings only. A brain made from a message (T16) stays behind with it, and each brain that makes brains counts from 1 again");

/** Check the models against Venice's list, and the image resolution against the image model, as conversation.update does. */
async function checkSettings(ctx: Ctx, conv: Conversation, where: string): Promise<void> {
  // Nothing has been created yet, so the fix is in the file, not conversation.update (T07 QA-8).
  const named = (type: "text" | "image", id: string) => (err: unknown) =>
    Promise.reject(
      err instanceof CommandError && err.code === "unknown_model"
        ? new CommandError(err.status, err.code, `${where}: settings.${type}Model: Venice has no ${type} model "${id}". Fix it in the file (./ss models.list --type ${type} lists them), or leave it out for the default.`)
        : err,
    );
  await lookupModel(ctx.deps.venice, "text", conv.settings.textModel).catch(named("text", conv.settings.textModel));
  const model = await lookupModel(ctx.deps.venice, "image", conv.settings.imageModel).catch(named("image", conv.settings.imageModel));
  // T18: each brain's own models too (and those its blueprint gives the brains it makes).
  await checkBrainModels(ctx, conv.brains, (i, field) => `${where}: brains.${i}.${field}`);
  const set = (Object.keys(conv.settings.image) as (keyof ImageSettings)[]).filter((k) => conv.settings.image[k] !== undefined);
  const problem = imageSettingsProblem(conv.settings.image, model, set);
  if (problem) throw badRequest(`${where}: settings.image: ${problem}`);
}

export const conversationImport = command({
  name: "conversation.import",
  description: `Start a new conversation from a campaign file: an example, a preset, or your own file.
--example names a committed example (./ss examples.list): brains, a World Bible and an opening, ready to play.
--preset names a committed preset (./ss presets.list): brains only, no World Bible and no story, so write the
World Bible next (setup.add). --campaign takes any campaign document, and any conversation.get --json is one.
You get its brains, setup messages, templates, settings and opening messages, with fresh ids; it has cost nothing
yet. Everything is editable afterwards, as in any conversation. A file holds prompts, not pictures: an imported
image message shows its prompt, ready to paint again with image.retry. --without-messages leaves the ledger out.
Your own file stays where it is, in plaintext: the imported copy is encrypted like the rest of your data.`,
  args: z.object({
    example: z.string().min(1).optional().describe("A committed example, by name (./ss examples.list), e.g. dnd-tavern"),
    preset: z.string().min(1).optional().describe("A committed preset, by name (./ss presets.list), e.g. tabletop-rpg"),
    campaign: z.record(z.string(), z.unknown()).optional().describe("A campaign document as JSON: @file.json reads a file, - reads stdin"),
    title: title.optional().describe("Title for the new conversation (default: the campaign's)"),
    withoutMessages: withoutMessages.optional(),
  }),
  examples: [
    "./ss conversation.import --example dnd-tavern",
    './ss conversation.import --preset tabletop-rpg --title "Chinatown"   # then: ./ss setup.add --content @world.md',
    './ss conversation.import --example dnd-tavern --title "Pathfinder night" --without-messages',
    "./ss conversation.import --campaign @my-campaign.json",
  ],
  handler: async (args, ctx): Promise<Conversation> => {
    const { vault } = ctx.requireSession();
    const given = [args.example, args.preset, args.campaign].filter((x) => x !== undefined).length;
    if (given !== 1) throw badRequest("Pass one of --example <name> (./ss examples.list), --preset <name> (./ss presets.list) or --campaign @file.json.");
    const { doc, where } =
      args.example !== undefined
        ? await readCampaign("example", args.example)
        : args.preset !== undefined
          ? await readCampaign("preset", args.preset)
          : { doc: parseCampaign(args.campaign, "The campaign"), where: "The campaign" };
    const draft = toConversation(doc, where);
    await checkSettings(ctx, draft, where);
    const { conv } = rebuild(draft, { title: args.title ?? draft.title, keep: args.withoutMessages ? 0 : draft.messages.length, images: "none" });
    await createConversationFile(vault, conv);
    return conv;
  },
  format: (c: Conversation) => started("Imported", c),
});

/** brain.import's answer: the brain as added, where it came from, and what it left behind. */
export type BrainImport = { conversationId: string; brain: Brain; from: { preset?: string; example?: string; title: string }; notes: string[] };

const TEMPLATE_NAMES = ["player", "otherBrainText", "otherBrainImage", "steer", "roll", "thought"] as const;

export const brainImport = command({
  name: "brain.import",
  description: `Add one brain from a preset (or an example campaign) to a conversation you already have.
The whole brain comes over, as its file has it: system prompt, final reminder, kind, reasoning, stop sequences,
and for an image brain its tool text and safe mode. Nothing else does: the file's World Bible, templates and
settings stay behind, and the answer says so when its templates differ from this conversation's. It gets a fresh
id, keeps its color unless a brain here already has it, and is never the default. A brain here with the same name
is a 409: --name adds it under another name. Edit it afterwards like any brain (brain.update). A preset brain
learns secrets from hidden notes, never from another brain's system prompt: the answer says so when that matters.`,
  args: z.object({
    conversation: conversationId,
    preset: z.string().min(1).optional().describe("The preset it comes from (./ss presets.list), e.g. tabletop-rpg"),
    example: z.string().min(1).optional().describe("Or the example campaign it comes from (./ss examples.list), e.g. dnd-tavern"),
    brain: z
      .string()
      .refine((s) => s.trim() !== "", "Name the brain to bring over, as the preset or example calls it")
      .describe("The brain's name in that file (case-insensitive), e.g. \"Character Actor\""),
    name: brainName.optional().describe("Add it under this name instead (when this conversation already has a brain by its name)"),
  }),
  examples: [
    './ss brain.import --conversation c_k3j9x0q2ma --preset tabletop-rpg --brain "Character Actor"',
    './ss brain.import --conversation c_k3j9x0q2ma --preset tabletop-rpg --brain "Character Actor" --name "Second Actor"',
    './ss brain.import --conversation c_k3j9x0q2ma --example dnd-tavern --brain "Dice Master"',
  ],
  handler: async (args, ctx): Promise<BrainImport> => {
    const { vault } = ctx.requireSession();
    if ((args.preset === undefined) === (args.example === undefined)) throw badRequest("Pass one of --preset <name> (./ss presets.list) or --example <name> (./ss examples.list).");
    const lib: Library = args.preset !== undefined ? "preset" : "example";
    const fileName = (args.preset ?? args.example)!;
    const { doc, where } = await readCampaign(lib, fileName);
    // The whole file is checked as an import would check it, so a brain comes over exactly as it would there.
    const src = toConversation(doc, where);
    const title = doc.title ?? fileName;
    const wanted = args.brain.trim().toLowerCase();
    const found = src.brains.find((b) => b.name.toLowerCase() === wanted);
    if (!found) throw notFound(`${lib === "preset" ? "The preset" : "The example"} "${title}" has no brain called "${args.brain.trim()}". Its brains: ${src.brains.map((b) => b.name).join(", ")}.`);
    await checkBrainModels(ctx, [found], (_i, field) => `${where}: ${found.name}'s ${field}`); // T18: its own models, if it has any

    const { conv, result } = await mutateConversation(vault, args.conversation, (c) => {
      // T16: its pins and the message it was made from are that file's messages, so they stay behind; its maker setting comes.
      const { pins: _pins, madeFrom: _from, ...whole } = structuredClone(found);
      const brain: Brain = { ...whole, pins: [], id: newId("b"), name: args.name ?? found.name };
      checkName(c, brain.name, undefined, args.name === undefined ? ` Add this one under another name with --name (e.g. --name "${found.name} 2").` : "");
      if (c.brains.some((b) => b.color.toLowerCase() === brain.color.toLowerCase())) brain.color = nextColor(c);
      c.brains.push(brain);
      return brain;
    });

    const notes: string[] = [];
    const differ = TEMPLATE_NAMES.filter((k) => src.templates[k] !== conv.templates[k]);
    if (differ.length) {
      notes.push(
        `Only the brain came over: this conversation keeps its own templates, which differ from "${title}"'s (${differ.join(", ")}), so ${result.name} reads the table as this conversation frames it. Settings → Templates (conversation.update --templates.<name>) changes them.`,
      );
    }
    if (lib === "example") notes.push(`It was written for "${title}", so its prompt may name that campaign's world and people: brain.list shows it, and brain.update changes it.`);
    if (found.pins.length) notes.push(`Its ${found.pins.length === 1 ? "pin" : `${found.pins.length} pins`} stayed behind: ${found.pins.length === 1 ? "it was a message" : "they were messages"} of "${title}". Pin one of yours with brain.pin.`);
    if (result.textModel || result.imageModel) {
      const own = [result.textModel ? `text model ${result.textModel}` : "", result.kind === "image" && result.imageModel ? `image model ${result.imageModel}` : ""].filter(Boolean).join(" and ");
      notes.push(`${result.name} came with its own ${own}, not this conversation's: brain.update --brain "${result.name}" --text-model null${result.imageModel ? " (or --image-model null)" : ""} puts it on this conversation's.`);
    }
    if (result.makes?.enabled) notes.push(`${result.name} makes a brain from each new message ("${result.makes.name}", from ${result.makes.next}): brain.list shows the blueprint, and brain.update --no-makes.enabled stops it.`);
    // T10 QA-3: a preset brain learns secrets from hidden notes. A brain whose prompt doesn't know the convention
    // (the Gilded Goat's GM) may keep its secrets in that prompt, which no other brain reads.
    if (lib === "preset" && conv.brains.some((b) => b.id !== result.id && !/(```|~~~)hidden/i.test(b.systemPrompt))) {
      notes.push(
        `${result.name} learns what the player hasn't seen from hidden notes (\`\`\`hidden blocks, such as character sheets). It can't read the other brains' system prompts, so a secret only one of them holds is news to it. To share one, put it in a hidden note in a setup message (setup.add): every brain reads those.`,
      );
    }
    return { conversationId: conv.id, brain: result, from: { [lib]: fileName, title }, notes };
  },
  format: (r: BrainImport) =>
    [
      `Added brain ${brainLine(r.brain)} from ${r.from.preset !== undefined ? "the preset" : "the example"} "${r.from.title}".`,
      ...r.notes,
      `Talk to it with turn --brain "${r.brain.name}"; prompt.preview --brain "${r.brain.name}" shows what it sees.${reasoningNotes(r.brain)}`,
    ].join("\n"),
});

export const conversationClone = command({
  name: "conversation.clone",
  description: `Start a new conversation from one of yours: same brains, setup, templates and settings (and ledger).
Unless --without-messages, the whole ledger comes too, every version and image included. It gets fresh ids and has
cost nothing yet; the original is untouched, and nothing done to either one ever touches the other. With
--without-messages it is a fresh start on the same setup: "we're doing Pathfinder" from the D&D campaign, then edit
the World Bible and the prompts to suit. With --through <message id> the ledger comes up to and including that
message, every version and image of the messages that come: the story as it stood there, to play the next turn
again (with --text-model, under another model). The brains made from messages that stay behind (a Character
Creator's characters) stay behind with them, and their makers hand those numbers back; without the ledger the
makers count from 1 again.
--text-model sets the copy's conversation model, which every brain without a model of its own uses (T18). A brain
with its own (brain.update --text-model) keeps it, as it would if you changed the conversation's model: the answer
names those brains, and brain.update --brain <name> --text-model null puts one on the copy's model.`,
  args: z.object({
    id: conversationId.describe("The conversation to copy (c_...)"),
    title: title.optional().describe('Title for the copy (default: "<title> (copy)")'),
    withoutMessages: withoutMessages.optional(),
    through: messageId
      .optional()
      .describe("Keep the ledger up to and including this message (m_..., from conversation.get); every later message stays behind"),
    textModel: z
      .string()
      .min(1)
      .optional()
      .describe("The copy's text model, for every brain without one of its own (default: the original's). A brain with its own keeps it. See ./ss models.list --type text"),
  }),
  examples: [
    './ss conversation.clone --id c_k3j9x0q2ma --title "Pathfinder" --without-messages',
    "./ss conversation.clone --id c_k3j9x0q2ma   # a branch to try something else, images and all",
    './ss conversation.clone --id c_k3j9x0q2ma --through m_p0x7c2k9qa --title "Tavern - GLM" --text-model z-ai-glm-5-3   # the story up to there, another model',
  ],
  handler: async (args, ctx): Promise<Conversation> => {
    const { vault } = ctx.requireSession();
    if (args.withoutMessages && args.through !== undefined) throw badRequest("Pass --without-messages (no ledger) or --through <message id> (the ledger up to that message), not both.");
    const src = await loadConversation(vault, args.id);
    let keep = args.withoutMessages ? 0 : src.messages.length;
    if (args.through !== undefined) {
      const at = src.messages.findIndex((m) => m.id === args.through);
      if (at < 0) throw notFound(`"${src.title}" has no message ${args.through}. conversation.get --id ${src.id} --json lists its message ids.`);
      keep = at + 1;
    }
    if (args.textModel) await lookupModel(ctx.deps.venice, "text", args.textModel);
    const { conv, copies } = rebuild(src, { title: args.title ?? `${src.title} (copy)`.slice(0, 200), keep, images: "copy" });
    if (args.textModel) conv.settings.textModel = args.textModel;
    const written: string[] = [];
    try {
      // The images first, so the document never points at a file that isn't there.
      for (const c of copies) {
        const file = await readImageFile(vault, c.from).catch(() => null);
        if (!file?.kind) {
          c.missing();
          continue;
        }
        await saveImageFile(vault, c.to, file.kind, file.bytes);
        written.push(c.to);
      }
      await createConversationFile(vault, conv);
    } catch (err) {
      await removeImageFiles(vault, written).catch(() => {});
      throw err;
    }
    return conv;
  },
  format: (c: Conversation) => started(`Cloned into`, c),
});

function started(verb: string, c: Conversation): string {
  // T10 QA-8: reasoning is a labeled opt-in, and a preset or a file can switch it on for you. T18: so is a model of its own.
  const ownModels = (b: Brain) => [b.textModel ? `its own model ${b.textModel}` : "", b.kind === "image" && b.imageModel ? `its own image model ${b.imageModel}` : ""].filter(Boolean);
  const brains = c.brains
    .map((b) => `${b.name}${b.id === c.defaultBrainId ? " (default)" : ""}${b.kind === "image" ? " (image)" : ""}${b.reasoning.enabled ? ` (reasoning ${b.reasoning.effort})` : ""}${ownModels(b).map((x) => ` (${x})`).join("")}`)
    .join(", ");
  const own = c.brains.filter((b) => ownModels(b).length);
  // Only the images that came over unpainted: a clone copies finished ones (T07 QA-8).
  const images = c.messages.filter((m) => m.kind === "image" && m.versions[m.activeVersion]?.image?.status === "error").length;
  return [
    `${verb} ${c.id} "${c.title}" · ${c.settings.textModel} · images ${c.settings.imageModel}`,
    `Brains: ${brains}`,
    ...(own.length
      ? [
          `${own.map((b) => b.name).join(", ")} ${own.length === 1 ? "has a model of its own and keeps it" : "have models of their own and keep them"}; the rest use the conversation's. brain.update --brain <name> --text-model null${own.some((b) => b.kind === "image" && b.imageModel) ? " (or --image-model null)" : ""} puts one on the conversation's.`,
        ]
      : []),
    `Setup: ${c.setup.map((s) => s.label).join(", ") || "none"} · ${c.messages.length} message${c.messages.length === 1 ? "" : "s"}${images ? ` (${images} image prompt${images === 1 ? "" : "s"} still to paint: image.retry --message <id> paints one)` : ""}`,
    // T10: a preset brings brains and no world. Every brain reads the setup messages, so the World Bible comes first.
    ...(c.setup.length ? [] : [`No World Bible yet: write one before you play (every brain reads it): ./ss setup.add --conversation ${c.id} --content @world.md`]),
    `Play in the browser: http://localhost:4747/c/${c.id}`,
    `Or here: export SS_CONVERSATION=${c.id}, then ./ss turn --content "..." (and turn --brain "${c.brains.find((b) => b.id !== c.defaultBrainId)?.name ?? c.brains[0]!.name}", prompt.preview, ...)`,
  ].join("\n");
}

export default [examplesList, presetsList, conversationImport, conversationClone, brainImport];
