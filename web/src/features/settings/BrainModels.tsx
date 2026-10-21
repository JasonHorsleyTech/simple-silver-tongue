import type { ReactNode } from "react";
import { buildImageRequest, DEFAULT_SHAPE, imagePriceUsd, type Brain, type Conversation, type ImageShape, type ModelInfo } from "../../api/types.ts";
import { formatUsd } from "../../lib/format.ts";
import type { ModelList } from "./models.ts";
import { ModelPicker, textModelDetail } from "./ModelPicker.tsx";

type Settings = Conversation["settings"];
export type ModelsValue = Pick<Brain, "kind" | "textModel" | "imageModel" | "shape">;
export type ModelsPatch = { textModel?: string | null; imageModel?: string | null };

/**
 * One image from this model for a brain of this shape, at the conversation's resolution, format and the rest: its price
 * and size, by the server's own rules (buildImageRequest, imagePriceUsd), as the payload view would send it.
 */
export function imageFacts(settings: Settings, model: ModelInfo, shape: ImageShape = DEFAULT_SHAPE): { price: string; size: string } {
  const { body } = buildImageRequest(settings, model, "", true, shape);
  const usd = imagePriceUsd(model, body);
  const fallback = (model.constraints as { defaultResolution?: string } | undefined)?.defaultResolution;
  const resolution = body.resolution ?? (fallback && `${fallback} (its default)`);
  const size = body.width && body.height ? `${body.width} × ${body.height}` : [resolution, body.aspect_ratio].filter(Boolean).join(", ");
  return { price: usd === undefined ? model.price : `${formatUsd(usd)}/image`, size };
}

/**
 * T18: which models a brain uses (or, for a maker's blueprint, the brains it makes): its text model, and an image
 * brain's image model too, each "Conversation default" (null: it follows the conversation's) or a model of its own.
 * `reasoning` (ReasoningFields) sits right under the text model it follows: its switch, effort levels and notes are
 * that model's. The image model's price and size follow it, the brain's shape and the conversation's resolution.
 * Saves on change, like the conversation's pickers.
 */
export function BrainModels({
  idBase,
  value,
  who,
  blueprint,
  settings,
  textModels,
  imageModels,
  reasoning,
  save,
}: {
  idBase: string;
  value: ModelsValue;
  /** The brain's name, or for a blueprint "each new brain". */
  who: string;
  blueprint?: boolean;
  settings: Settings;
  textModels: ModelList;
  imageModels: ModelList;
  /** The reasoning switch and its notes (ReasoningFields), for this text model. */
  reasoning: ReactNode;
  save(patch: ModelsPatch): Promise<void>;
}) {
  const shape = value.shape ?? DEFAULT_SHAPE;
  const image = value.kind === "image";
  const follows = blueprint
    ? "“Conversation default” follows the conversation's model; any other is theirs to keep."
    : `“Conversation default” follows the conversation's model; any other stays ${who}'s own.`;
  return (
    <div className="space-y-4">
      <ModelPicker
        id={`tm-${idBase}`}
        label={blueprint ? "Their text model" : "Text model"}
        description={`${image ? `Writes ${blueprint ? "their" : "its"} image prompts.` : blueprint ? "What each new brain writes with." : `What ${who} writes with.`} ${follows}`}
        value={value.textModel ?? null}
        inherit={settings.textModel}
        list={textModels}
        detail={textModelDetail}
        showListError={false}
        ownWords={blueprint ? "their own" : "its own"}
        onPick={(textModel) => save({ textModel })}
      />
      {reasoning}
      {image && (
        <ModelPicker
          id={`im-${idBase}`}
          label={blueprint ? "Their image model" : "Image model"}
          description={`Paints ${blueprint ? "their" : "its"} prompts, at ${blueprint ? "their" : "its"} shape and the conversation's resolution. Prices are per image.`}
          value={value.imageModel ?? null}
          inherit={settings.imageModel}
          list={imageModels}
          optionDetail={(m) => imageFacts(settings, m, shape).price}
          detail={(m) => {
            const f = imageFacts(settings, m, shape);
            return [f.price, f.size, m.privacy].filter(Boolean).join(" · ");
          }}
          showListError={false}
          ownWords={blueprint ? "their own" : "its own"}
          onPick={(imageModel) => save({ imageModel })}
        />
      )}
    </div>
  );
}
