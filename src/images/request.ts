import type { ImageRequest, Settings } from "../conversations/types.ts";
import type { ModelInfo } from "../venice/models.ts";

/**
 * The exact /image/generate body for one prompt (design.md, "Image generation"). Pure: the send path and
 * prompt.preview both call it. The prompt goes in word for word, and every other field comes from the
 * conversation's image settings and the brain's safe mode. Only what the model takes is sent, going by its
 * constraints in /models?type=image: models with a resolution list (Nano Banana) are sized by resolution and
 * aspect ratio, the rest (z-image-turbo) by width and height in multiples of widthHeightDivisor. A setting the
 * model can't take is left out, and a note says so, so nothing is dropped silently.
 */

export type ImagePlan = {
  body: ImageRequest;
  /** Plain-language notes on settings that were left out or adjusted for this model. */
  notes: string[];
  /** Set when Venice would refuse this prompt (too long): nothing is sent, and this is the image's error. */
  problem?: string;
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

export function buildImageRequest(settings: Settings, model: ModelInfo, prompt: string, safeMode: boolean): ImagePlan {
  const s = settings.image;
  const c = constraintsOf(model);
  const notes: string[] = [];
  const body: ImageRequest = { model: model.id, prompt, safe_mode: safeMode, format: s.format, hide_watermark: s.hideWatermark };

  const byResolution = Array.isArray(c.resolutions) || Array.isArray(c.aspectRatios);
  if (byResolution) {
    if (s.width !== undefined || s.height !== undefined) {
      notes.push(`Width and height are not sent: ${model.id} is sized by resolution and aspect ratio.`);
    }
    pick("resolution", s.resolution, c.resolutions, c.defaultResolution, (v) => (body.resolution = v));
    pick("aspect ratio", s.aspectRatio, c.aspectRatios, c.defaultAspectRatio, (v) => (body.aspect_ratio = v));
  } else {
    const div = typeof c.widthHeightDivisor === "number" && c.widthHeightDivisor > 1 ? c.widthHeightDivisor : 1;
    for (const key of ["width", "height"] as const) {
      const v = s[key];
      if (v === undefined) continue;
      const fit = Math.max(div, Math.floor(v / div) * div);
      if (fit !== v) notes.push(`The ${key} ${v} is sent as ${fit}: ${model.id} takes multiples of ${div}.`);
      body[key] = fit;
    }
    if (s.resolution !== undefined || s.aspectRatio !== undefined) {
      notes.push(`Resolution and aspect ratio are not sent: ${model.id} is sized by width and height.`);
    }
  }
  if (s.negativePrompt?.trim()) body.negative_prompt = s.negativePrompt;

  const plan: ImagePlan = { body, notes };
  const limit = c.promptCharacterLimit;
  if (typeof limit === "number" && prompt.length > limit) {
    plan.problem = `The prompt is ${prompt.length} characters, and ${model.id} takes at most ${limit}, so no image was requested. Edit the prompt to shorten it, and the image is made then.`;
  }
  return plan;

  function pick(what: string, want: string | undefined, offered: string[] | undefined, fallback: string | undefined, set: (v: string) => void) {
    if (want === undefined) return;
    if (!Array.isArray(offered) || offered.includes(want)) return set(want);
    notes.push(`The ${what} ${want} is not sent: ${model.id} offers ${offered.join(", ")}${fallback ? ` (it uses ${fallback})` : ""}.`);
  }
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

/**
 * Why these image settings can't be used with this model, or null (conversation.update). Only the fields being
 * set now are checked: a size left over from an earlier model is just not sent (buildImageRequest's notes say so).
 */
export function imageSettingsProblem(settings: Settings["image"], model: ModelInfo, changing: Array<keyof Settings["image"]>): string | null {
  const c = constraintsOf(model);
  const byResolution = Array.isArray(c.resolutions) || Array.isArray(c.aspectRatios);
  const set = (k: keyof Settings["image"]) => changing.includes(k) && settings[k] !== undefined;
  if (byResolution) {
    if (set("width") || set("height")) return `${model.id} is sized by resolution and aspect ratio, not width and height.`;
    if (set("resolution") && Array.isArray(c.resolutions) && !c.resolutions.includes(settings.resolution!)) {
      return `${model.id} offers the resolutions ${c.resolutions.join(", ")}, not ${settings.resolution}.`;
    }
    if (set("aspectRatio") && Array.isArray(c.aspectRatios) && !c.aspectRatios.includes(settings.aspectRatio!)) {
      return `${model.id} offers the aspect ratios ${c.aspectRatios.join(", ")}, not ${settings.aspectRatio}.`;
    }
    return null;
  }
  if (set("resolution") || set("aspectRatio")) return `${model.id} is sized by width and height, not resolution or aspect ratio.`;
  const div = c.widthHeightDivisor;
  for (const key of ["width", "height"] as const) {
    const v = settings[key];
    if (set(key) && typeof div === "number" && div > 1 && v! % div !== 0) {
      return `${model.id} needs a width and height that are multiples of ${div}, and the ${key} ${v} isn't.`;
    }
  }
  return null;
}
