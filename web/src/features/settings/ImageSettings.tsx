import { useState } from "react";
import { errorMessage } from "../../api/errors.ts";
import { resolutionsOf, type Conversation, type ConversationUpdate } from "../../api/types.ts";
import { Notice } from "../../components/Notice.tsx";
import { SavedText } from "../../components/SavedText.tsx";
import { Segmented } from "../../components/Segmented.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { Switch } from "../../components/Switch.tsx";
import { imageModelsInUse, resolutionChoices, whoseImageModel } from "../../lib/models.ts";
import type { ModelList } from "./models.ts";

type ImageSettingsPatch = NonNullable<NonNullable<ConversationUpdate["settings"]>["image"]>;

/**
 * How image brains' prompts are painted, per conversation (conversation.update settings.image): the resolution,
 * for models that list resolutions (it sets the price), the file format, Venice's watermark, and a negative prompt
 * (text the image model reads, so it is editable like every other word sent). The picture's shape is each image
 * brain's own (Brains). The server refuses a resolution no model in use lists; its reason shows here. One left
 * over from another model isn't sent, and the note says so, with a way to clear it.
 *
 * T18: an image brain may paint with a model of its own, so the resolutions offered are every one an image model in
 * use lists (the conversation's and each image brain's own: conversation.update's rule), and the note names any model
 * in use that won't get the one picked (it is left out of that model's requests, and its payload view says so).
 */
export function ImageSettings({
  conv,
  models,
  onSave,
}: {
  conv: Conversation;
  /** The image models (useModels): `find` is undefined while one loads, null if Venice doesn't list it. */
  models: ModelList;
  onSave(patch: ImageSettingsPatch): Promise<unknown>;
}) {
  const s = conv.settings.image;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(what: string, patch: ImageSettingsPatch) {
    setBusy(what);
    setError(null);
    try {
      await onSave(patch);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const uses = imageModelsInUse(conv);
  const known = uses.flatMap((use) => {
    const info = models.find(use.id);
    return info ? [{ use, info, offers: resolutionsOf(info) }] : [];
  });
  const loading = uses.some((u) => models.find(u.id) === undefined) && !models.error;
  const choices = resolutionChoices(uses, models.find);
  const named = (x: (typeof known)[number]) => (uses.length > 1 ? `${x.use.id} (${whoseImageModel(x.use)})` : x.use.id);
  const unsized = known.filter((x) => x.offers.length === 0);
  const missed = s.resolution === undefined ? [] : known.filter((x) => x.offers.length > 0 && !x.offers.includes(s.resolution!));
  const defaults = [...new Set(known.map((x) => (x.info.constraints as { defaultResolution?: string } | undefined)?.defaultResolution).filter(Boolean))];

  const DEFAULT = "";
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-3">
          <span className="flex-1 text-[13px] font-medium text-fg">Resolution</span>
          {busy === "resolution" && <Spinner className="size-3.5 text-faint" />}
          {choices.length > 0 && (
            <Segmented
              label="Resolution"
              value={s.resolution ?? DEFAULT}
              disabled={!!busy}
              options={[
                { value: DEFAULT, label: "Default", title: defaults.length === 1 && known.length === 1 ? `Send none: the model uses ${defaults[0]}` : "Send none: each model uses its default" },
                ...choices.map((r) => ({
                  value: r,
                  label: r,
                  title: uses.length > 1 ? `Offered by ${known.filter((x) => x.offers.includes(r)).map(named).join(", ")}` : undefined,
                })),
              ]}
              onChange={(r) => void save("resolution", { resolution: r === DEFAULT ? null : r })}
            />
          )}
        </div>
        {loading ? (
          <p className="mt-1.5 text-[12.5px] text-faint">Loading what {uses.map((u) => u.id).join(" and ")} take…</p>
        ) : (
          <p className="mt-1 text-[12.5px] leading-5 text-faint">
            {choices.length > 0 && unsized.length === 0 && missed.length === 0 && "Sets the price. Each image brain picks its own shape (Brains)."}
            {choices.length > 0 && (unsized.length > 0 || missed.length > 0) && (
              <>
                Sets the price of {known.filter((x) => x.offers.length > 0).map(named).join(", ")}.
                {missed.map((x) => ` ${named(x)} doesn't offer ${s.resolution} (it offers ${x.offers.join(", ")}), so it isn't sent there.`).join("")}
              </>
            )}
            {unsized.length > 0 &&
              ` ${unsized.map(named).join(" and ")} ${unsized.length === 1 ? "has" : "have"} no resolution setting: ${unsized.length === 1 ? "its" : "their"} size is the brain's shape alone.`}
            {s.resolution !== undefined && !choices.includes(s.resolution) && (
              <>
                {" "}
                The resolution {s.resolution} is kept from another model but isn't sent.{" "}
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void save("resolution", { resolution: null })}
                  className="text-muted underline decoration-line-strong underline-offset-4 hover:text-fg"
                >
                  Clear it
                </button>
              </>
            )}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className="flex-1 text-[13px] font-medium text-fg">
          Format
          <span className="ml-2 text-[12px] font-normal text-faint">what is asked for; the file is whatever Venice sends</span>
        </span>
        {busy === "format" && <Spinner className="size-3.5 text-faint" />}
        <Segmented
          label="Format"
          value={s.format}
          disabled={!!busy}
          options={[
            { value: "webp", label: "WebP" },
            { value: "png", label: "PNG" },
            { value: "jpeg", label: "JPEG" },
          ]}
          onChange={(format) => void save("format", { format })}
        />
      </div>

      <Switch
        id="cv-watermark"
        label="Hide Venice's watermark"
        description="Sent as hide_watermark. Off: Venice may stamp its mark in a corner."
        checked={s.hideWatermark}
        busy={busy === "watermark"}
        onChange={(hideWatermark) => void save("watermark", { hideWatermark })}
      />

      <SavedText
        id="cv-negative"
        label="Negative prompt"
        description="Sent with every image as negative_prompt: what the pictures should leave out. Blank: not sent."
        saved={s.negativePrompt ?? ""}
        maxPx={160}
        placeholder="text, watermark, extra fingers"
        onSave={async (v) => void (await onSave({ negativePrompt: v.trim() ? v : null }))}
      />

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
