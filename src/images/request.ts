import type { ImageRequest, ImageShape, Settings } from "../conversations/types.ts";
import type { ModelInfo } from "../venice/models.ts";

/**
 * The exact /image/generate body for one prompt (design.md, "Image generation"). Pure: the send path and
 * prompt.preview both call it, and the browser uses it to price each image model. The prompt goes in word for
 * word, and every other field comes from the conversation's image settings and the brain's safe mode and shape.
 * Only what the model takes is sent, going by its constraints in /models?type=image: models with an aspect
 * ratio list get the one nearest the brain's shape (and a resolution, if they list those), the rest
 * (z-image-turbo) the shape's width and height in multiples of widthHeightDivisor. A setting the model can't
 * take is left out, and a note says so, so nothing is dropped silently.
 */

export type ImagePlan = {
  body: ImageRequest;
  /** Plain-language notes on settings that were left out or adjusted for this model. */
  notes: string[];
  /** Set when Venice would refuse this prompt (too long): nothing is sent, and this is the image's error. */
  problem?: string;
};

/** An image brain's shapes, in the order the pickers show them. */
export const IMAGE_SHAPES: readonly ImageShape[] = ["portrait", "square", "landscape"];
export const DEFAULT_SHAPE: ImageShape = "landscape";

/**
 * Each shape for models sized by width × height: about a megapixel, multiples of 16, at most 1280 on a side.
 * Models sized by aspect ratio get the one they list nearest the same ratio.
 */
export const SHAPE_SIZES: Record<ImageShape, { width: number; height: number; ratio: string }> = {
  portrait: { width: 832, height: 1216, ratio: "2:3" },
  square: { width: 1024, height: 1024, ratio: "1:1" },
  landscape: { width: 1216, height: 832, ratio: "3:2" },
};

type Constraints = {
  promptCharacterLimit?: number;
  widthHeightDivisor?: number;
  resolutions?: string[];
  aspectRatios?: string[];
  defaultResolution?: string;
  defaultAspectRatio?: string;
  defaultQuality?: string;
};

const constraintsOf = (model: ModelInfo) => (model.constraints ?? {}) as Constraints;

export function buildImageRequest(settings: Settings, model: ModelInfo, prompt: string, safeMode: boolean, shape: ImageShape = DEFAULT_SHAPE): ImagePlan {
  const s = settings.image;
  const c = constraintsOf(model);
  const notes: string[] = [];
  const body: ImageRequest = { model: model.id, prompt, safe_mode: safeMode, format: s.format, hide_watermark: s.hideWatermark };
  const size = SHAPE_SIZES[shape];

  if (s.resolution !== undefined) {
    if (!Array.isArray(c.resolutions)) notes.push(`The resolution ${s.resolution} is not sent: ${model.id} has no resolution setting.`);
    else if (c.resolutions.includes(s.resolution)) body.resolution = s.resolution;
    else notes.push(`The resolution ${s.resolution} is not sent: ${model.id} offers ${c.resolutions.join(", ")}${c.defaultResolution ? ` (it uses ${c.defaultResolution})` : ""}.`);
  }
  const ratio = Array.isArray(c.aspectRatios) ? nearestRatio(size.ratio, c.aspectRatios) : null;
  if (ratio) {
    body.aspect_ratio = ratio;
    if (ratio !== size.ratio) notes.push(`The ${shape} shape is sent as the aspect ratio ${ratio}, the nearest to ${size.ratio} that ${model.id} offers.`);
  } else if (Array.isArray(c.resolutions) || Array.isArray(c.aspectRatios)) {
    notes.push(`The ${shape} shape is not sent: ${model.id} lists no aspect ratio to send it as.`);
  } else {
    const div = typeof c.widthHeightDivisor === "number" && c.widthHeightDivisor > 1 ? c.widthHeightDivisor : 1;
    body.width = Math.max(div, Math.floor(size.width / div) * div);
    body.height = Math.max(div, Math.floor(size.height / div) * div);
  }
  if (s.negativePrompt?.trim()) body.negative_prompt = s.negativePrompt;

  const plan: ImagePlan = { body, notes };
  const limit = c.promptCharacterLimit;
  if (typeof limit === "number" && prompt.length > limit) {
    plan.problem = `The prompt is ${prompt.length} characters, and ${model.id} takes at most ${limit}, so no image was requested. Edit the prompt to shorten it, and the image is made then.`;
  }
  return plan;
}

/** The listed aspect ratio ("16:9") nearest the wanted one, by how far apart their ratios are on a log scale. */
function nearestRatio(want: string, offered: string[]): string | null {
  const value = (r: string) => {
    const [w, h] = r.split(":").map(Number);
    return w && h ? Math.log(w / h) : NaN;
  };
  const target = value(want);
  let best: string | null = null;
  for (const r of offered) {
    const v = value(r);
    if (Number.isNaN(v)) continue;
    if (best === null || Math.abs(v - target) < Math.abs(value(best) - target)) best = r;
  }
  return best;
}

/**
 * What Venice charges for this image by the model's price list: a flat price per image, or per resolution
 * (and quality, at the model's default quality). /image/generate reports no cost of its own. Undefined when
 * the list has no price for it.
 */
export function imagePriceUsd(model: ModelInfo, body: ImageRequest): number | undefined {
  const p = model.pricing as Record<string, any>;
  const c = constraintsOf(model);
  const usd = (v: unknown) => (typeof (v as { usd?: unknown } | undefined)?.usd === "number" ? (v as { usd: number }).usd : undefined);
  const flat = usd(p.generation);
  if (flat !== undefined) return flat;
  const res = body.resolution ?? c.defaultResolution;
  if (res === undefined) return undefined;
  return (c.defaultQuality ? usd(p.quality?.[res]?.[c.defaultQuality]) : undefined) ?? usd(p.resolutions?.[res]);
}

/** The resolutions this model lists (none for a model sized by width × height, or by aspect ratio alone). */
export const resolutionsOf = (model: ModelInfo): string[] => {
  const r = constraintsOf(model).resolutions;
  return Array.isArray(r) ? r : [];
};
export const offersResolution = (model: ModelInfo, resolution: string) => resolutionsOf(model).includes(resolution);

/**
 * Why these image settings can't be used with this model, or null (conversation.update). Only the fields being
 * set now are checked: a resolution left over from an earlier model is just not sent (buildImageRequest's notes
 * say so).
 */
export function imageSettingsProblem(settings: Settings["image"], model: ModelInfo, changing: Array<keyof Settings["image"]>): string | null {
  const c = constraintsOf(model);
  const want = settings.resolution;
  if (!changing.includes("resolution") || want === undefined) return null;
  if (!Array.isArray(c.resolutions)) return `${model.id} has no resolution setting: its size is the brain's shape alone.`;
  if (!c.resolutions.includes(want)) return `${model.id} offers the resolutions ${c.resolutions.join(", ")}, not ${want}.`;
  return null;
}
