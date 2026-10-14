import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ROOT, DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL } from "../config.ts";
import { rebuild } from "../conversations/campaign.ts";
import { DEFAULT_TEMPLATES, newBrain, nextColor } from "../conversations/defaults.ts";
import { createConversationFile, loadConversation } from "../conversations/store.ts";
import { lookupModel } from "../conversations/turn.ts";
import { SCHEMA_VERSION, type Brain, type Conversation, type ImageSettings, type LedgerMessage, type MessageVersion } from "../conversations/types.ts";
import { readImageFile, removeImageFiles, saveImageFile } from "../images/files.ts";
import { imageSettingsProblem } from "../images/request.ts";
import { badRequest, CommandError, notFound } from "../lib/errors.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { command, type Ctx } from "../registry.ts";
import { PLAYER, brainName, color, finalReminder, kind, reasoning, safeMode, stop, tool } from "./brains.ts";
import { conversationId, imageSettings, systemPrompt, templates, title } from "./conversations.ts";

/**
 * Starting a campaign from another one's setup (T07): a committed example (examples/*.json), a campaign file of
 * your own (any conversation.get --json), or one of your conversations (clone). The result is an ordinary
 * conversation: every brain, setup message and template is editable as always.
 */

export const EXAMPLES_DIR = join(ROOT, "examples");
const EXAMPLE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

// ── The campaign file: a conversation document (conversation.get --json), with ids and dates optional ──

const version = z.object({
  // A blank message (or image prompt) is refused here as message.edit refuses one (T07 QA-4).
  content: z.string().refine((s) => s.trim() !== "", "A message can't be blank"),
  source: z.enum(["generated", "authored"]).default("authored"),
  steer: z.string().optional(),
  steeredFrom: z.number().int().min(0).optional(),
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
const campaignSchema = z.object({
  /** One line for examples.list. Not sent to any model, and not stored. */
  about: z.string().optional(),
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
  setup: z.array(z.object({ label: z.string().trim().min(1).max(100), content: z.string() })).default([]),
  brains: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        name: brainName,
        color: color.optional(),
        kind: kind.default("text"),
        reasoning: reasoning.optional(),
        safeMode: safeMode.optional(),
        systemPrompt,
        finalReminder: finalReminder.optional(),
        tool: tool.optional(),
        /** Absent (a file from before T07 triage): the kind's default, as for a new brain. */
        stop: stop.optional(),
      }),
    )
    .min(1, "A campaign needs at least one brain"),
  /** The brain `turn` talks to without --brain. Default: the first brain. */
  defaultBrainId: z.string().optional(),
  messages: z
    .array(
      z.object({
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
    if (b.kind === "text" && (b.safeMode !== undefined || b.tool)) throw bad(`brains.${i}: safe mode and tool text are for image brains, and ${b.name} is a text brain.`);
    const brain = newBrain({ name: b.name, systemPrompt: b.systemPrompt, color: b.color ?? nextColor(shell), isDefault, kind: b.kind }); // an image brain gets DEFAULT_TOOL and safe mode
    Object.assign(brain.reasoning, b.reasoning ?? {});
    Object.assign(brain.finalReminder, b.finalReminder ?? {});
    if (b.safeMode !== undefined) brain.safeMode = b.safeMode;
    if (b.tool) Object.assign(brain.tool!, b.tool);
    if (b.stop) brain.stop = b.stop;
    if (b.id) {
      if (byId.has(b.id)) throw bad(`brains.${i}.id: two brains have the id ${b.id}.`);
      byId.set(b.id, brain);
    }
    shell.brains.push(brain);
  }
  const defaultBrain = doc.defaultBrainId ? byId.get(doc.defaultBrainId) : shell.brains[0];
  if (!defaultBrain) throw bad(`defaultBrainId: no brain has the id ${doc.defaultBrainId}.`);

  const messages = doc.messages.map((m, i): LedgerMessage => {
    const at = `messages.${i}`;
    let author: LedgerMessage["author"] = { type: "player" };
    let msgKind: LedgerMessage["kind"] = "text";
    let safe = true;
    if (m.author.type === "brain") {
      const brain = byId.get(m.author.brainId);
      if (!brain) throw bad(`${at}.author.brainId: no brain has the id ${m.author.brainId}.`);
      author = { type: "brain", brainId: brain.id };
      msgKind = brain.kind;
      safe = brain.safeMode ?? true;
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
      if (msgKind === "image") out.image = { id: "", status: "error", model: image?.model ?? doc.settings?.imageModel ?? DEFAULT_IMAGE_MODEL, safeMode: image?.safeMode ?? safe, createdAt: now };
      return out;
    });
    return { id: newId("m"), author, kind: msgKind, versions, activeVersion: active, createdAt: m.createdAt ?? now, updatedAt: m.updatedAt ?? now };
  });

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
    setup: doc.setup.map((x) => ({ id: newId("s"), label: x.label, content: x.content })),
    brains: shell.brains,
    defaultBrainId: defaultBrain.id,
    messages,
    spentUsd: 0,
  };
  if (s.maxTokens) conv.settings.maxTokens = s.maxTokens;
  if (s.temperature !== undefined && s.temperature !== null) conv.settings.temperature = s.temperature;
  return conv;
}

async function readExample(name: string): Promise<{ raw: unknown; where: string }> {
  if (!EXAMPLE_NAME.test(name)) throw badRequest("Example names are lowercase letters, digits and dashes. See ./ss examples.list.");
  const where = `examples/${name}.json`;
  let text: string;
  try {
    text = await readFile(join(EXAMPLES_DIR, `${name}.json`), "utf8");
  } catch {
    const names = await exampleNames();
    throw notFound(`No example "${name}". ${names.length ? `Examples: ${names.join(", ")}.` : "There are none in examples/."}`);
  }
  try {
    return { raw: JSON.parse(text), where };
  } catch {
    throw badRequest(`${where} is not valid JSON.`);
  }
}

async function exampleNames(): Promise<string[]> {
  const files = await readdir(EXAMPLES_DIR).catch(() => [] as string[]);
  return files.filter((f) => f.endsWith(".json") && EXAMPLE_NAME.test(f.slice(0, -5))).map((f) => f.slice(0, -5)).sort();
}

// ── Commands ──

/** A brain's color is its badge (T07 frontend: the browser shows the cast before you start). */
type ExampleInfo = { name: string; title: string; about?: string; brains: Array<{ name: string; kind: string; color?: string }>; setup: string[]; messages: number; error?: string };

export const examplesList = command({
  name: "examples.list",
  description: `List the example campaigns that come with the app (examples/*.json), ready to import.
Start one with ./ss conversation.import --example <name>. Nothing here is yours: they are committed files.`,
  auth: false,
  args: z.object({}),
  handler: async (): Promise<{ examples: ExampleInfo[] }> => {
    const examples: ExampleInfo[] = [];
    for (const name of await exampleNames()) {
      try {
        const { raw, where } = await readExample(name);
        const doc = parseCampaign(raw, where);
        examples.push({
          name,
          title: doc.title ?? name,
          about: doc.about,
          brains: doc.brains.map((b) => ({ name: b.name, kind: b.kind, ...(b.color ? { color: b.color } : {}) })),
          setup: doc.setup.map((s) => s.label),
          messages: doc.messages.length,
        });
      } catch (err) {
        examples.push({ name, title: name, brains: [], setup: [], messages: 0, error: (err as Error).message });
      }
    }
    return { examples };
  },
  format: ({ examples }: { examples: ExampleInfo[] }) =>
    examples.length
      ? examples
          .map((e) =>
            e.error
              ? `${e.name}: can't be imported (${e.error})`
              : [
                  `${e.name}: ${e.title}`,
                  e.about ? `  ${e.about}` : "",
                  `  Brains: ${e.brains.map((b) => (b.kind === "image" ? `${b.name} (image)` : b.name)).join(", ")}`,
                  `  Setup: ${e.setup.join(", ") || "none"} · ${e.messages} message${e.messages === 1 ? "" : "s"}`,
                  `  Start it: ./ss conversation.import --example ${e.name}`,
                ]
                  .filter(Boolean)
                  .join("\n"),
          )
          .join("\n\n")
      : "No examples in examples/.",
});

const withoutMessages = z.boolean().describe("Leave the ledger out: brains, setup messages, templates and settings only");

/** Check the models against Venice's list, and the image size against the image model, as conversation.update does. */
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
  const set = (Object.keys(conv.settings.image) as (keyof ImageSettings)[]).filter((k) => conv.settings.image[k] !== undefined);
  const problem = imageSettingsProblem(conv.settings.image, model, set);
  if (problem) throw badRequest(`${where}: settings.image: ${problem}`);
}

export const conversationImport = command({
  name: "conversation.import",
  description: `Start a new conversation from a campaign file: an example (--example) or your own (--campaign @file.json).
--example names a committed example (./ss examples.list); --campaign takes any campaign document, and any
conversation.get --json is one. You get its brains, setup messages, templates, settings and opening messages,
with fresh ids; it has cost nothing yet. Everything is
editable afterwards, as in any conversation. A file holds prompts, not pictures: an imported image message
shows its prompt, ready to paint again with image.retry. --without-messages leaves the ledger out.
Your own file stays where it is, in plaintext: the imported copy is encrypted like the rest of your data.`,
  args: z.object({
    example: z.string().min(1).optional().describe("A committed example, by name (./ss examples.list), e.g. dnd-tavern"),
    campaign: z.record(z.string(), z.unknown()).optional().describe("A campaign document as JSON: @file.json reads a file, - reads stdin"),
    title: title.optional().describe("Title for the new conversation (default: the campaign's)"),
    withoutMessages: withoutMessages.optional(),
  }),
  examples: [
    "./ss conversation.import --example dnd-tavern",
    './ss conversation.import --example dnd-tavern --title "Pathfinder night" --without-messages',
    "./ss conversation.import --campaign @my-campaign.json",
  ],
  handler: async (args, ctx): Promise<Conversation> => {
    const { vault } = ctx.requireSession();
    if ((args.example === undefined) === (args.campaign === undefined)) throw badRequest("Pass one of --example <name> (./ss examples.list) or --campaign @file.json.");
    const { raw, where } = args.example !== undefined ? await readExample(args.example) : { raw: args.campaign, where: "The campaign" };
    const draft = toConversation(parseCampaign(raw, where), where);
    await checkSettings(ctx, draft, where);
    const { conv } = rebuild(draft, { title: args.title ?? draft.title, messages: !args.withoutMessages, images: "none" });
    await createConversationFile(vault, conv);
    return conv;
  },
  format: (c: Conversation) => started("Imported", c),
});

export const conversationClone = command({
  name: "conversation.clone",
  description: `Start a new conversation from one of yours: same brains, setup, templates and settings (and ledger).
Unless --without-messages, the whole ledger comes too, every version and image included. It gets fresh ids and has
cost nothing yet; the original is untouched. With --without-messages it is a fresh start on the same setup:
"we're doing Pathfinder" from the D&D campaign, then edit the World Bible and the prompts to suit.`,
  args: z.object({
    id: conversationId.describe("The conversation to copy (c_...)"),
    title: title.optional().describe('Title for the copy (default: "<title> (copy)")'),
    withoutMessages: withoutMessages.optional(),
  }),
  examples: [
    './ss conversation.clone --id c_k3j9x0q2ma --title "Pathfinder" --without-messages',
    "./ss conversation.clone --id c_k3j9x0q2ma   # a branch to try something else, images and all",
  ],
  handler: async (args, ctx): Promise<Conversation> => {
    const { vault } = ctx.requireSession();
    const src = await loadConversation(vault, args.id);
    const { conv, copies } = rebuild(src, { title: args.title ?? `${src.title} (copy)`.slice(0, 200), messages: !args.withoutMessages, images: "copy" });
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
  const brains = c.brains.map((b) => `${b.name}${b.id === c.defaultBrainId ? " (default)" : ""}${b.kind === "image" ? " (image)" : ""}`).join(", ");
  // Only the images that came over unpainted: a clone copies finished ones (T07 QA-8).
  const images = c.messages.filter((m) => m.kind === "image" && m.versions[m.activeVersion]?.image?.status === "error").length;
  return [
    `${verb} ${c.id} "${c.title}" · ${c.settings.textModel} · images ${c.settings.imageModel}`,
    `Brains: ${brains}`,
    `Setup: ${c.setup.map((s) => s.label).join(", ") || "none"} · ${c.messages.length} message${c.messages.length === 1 ? "" : "s"}${images ? ` (${images} image prompt${images === 1 ? "" : "s"} still to paint: image.retry --message <id> paints one)` : ""}`,
    `Play in the browser: http://localhost:4747/c/${c.id}`,
    `Or here: export SS_CONVERSATION=${c.id}, then ./ss turn --content "..." (and turn --brain "${c.brains.find((b) => b.id !== c.defaultBrainId)?.name ?? c.brains[0]!.name}", prompt.preview, ...)`,
  ].join("\n");
}

export default [examplesList, conversationImport, conversationClone];
