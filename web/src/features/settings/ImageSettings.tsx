import { useState } from "react";
import { errorMessage } from "../../api/errors.ts";
import type { Conversation, ConversationUpdate, ModelInfo } from "../../api/types.ts";
import { Notice } from "../../components/Notice.tsx";
import { SavedText } from "../../components/SavedText.tsx";
import { Segmented } from "../../components/Segmented.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { Switch } from "../../components/Switch.tsx";

type ImageSettingsPatch = NonNullable<NonNullable<ConversationUpdate["settings"]>["image"]>;

/** What /models says about resolutions: Krea and Grok Imagine list some (1K, 2K), z-image-turbo none. */
type Constraints = { resolutions?: string[]; defaultResolution?: string };

/**
 * How image brains' prompts are painted, per conversation (conversation.update settings.image): the resolution,
 * for models that list resolutions (it sets the price), the file format, Venice's watermark, and a negative prompt
 * (text the image model reads, so it is editable like every other word sent). The picture's shape is each image
 * brain's own (Brains). The server refuses a resolution the model doesn't list; its reason shows here. One left
 * over from another model isn't sent, and the note says so, with a way to clear it.
 */
export function ImageSettings({
  conv,
  model,
  onSave,
}: {
  conv: Conversation;
  /** The image model's entry from models.list: undefined while it loads, null if Venice doesn't list it. */
  model: ModelInfo | null | undefined;
  onSave(patch: ImageSettingsPatch): Promise<unknown>;
}) {
  const s = conv.settings.image;
  const c = (model?.constraints ?? {}) as Constraints;
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

  const DEFAULT = "";
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-3">
          <span className="flex-1 text-[13px] font-medium text-fg">Resolution</span>
          {busy === "resolution" && <Spinner className="size-3.5 text-faint" />}
          {Array.isArray(c.resolutions) && (
            <Segmented
              label="Resolution"
              value={s.resolution ?? DEFAULT}
              disabled={!!busy}
              options={[
                { value: DEFAULT, label: "Default", title: c.defaultResolution ? `Send none: the model uses ${c.defaultResolution}` : "Send none" },
                ...c.resolutions.map((r) => ({ value: r, label: r })),
              ]}
              onChange={(r) => void save("resolution", { resolution: r === DEFAULT ? null : r })}
            />
          )}
        </div>
        {model === undefined ? (
          <p className="mt-1.5 text-[12.5px] text-faint">Loading what {conv.settings.imageModel} takes…</p>
        ) : Array.isArray(c.resolutions) ? (
          <p className="mt-1 text-[12.5px] leading-5 text-faint">Sets the price above. Each image brain picks its own shape (Brains).</p>
        ) : (
          <p className="mt-1.5 text-[12.5px] leading-5 text-faint">
            {conv.settings.imageModel} has no resolution setting: its size is the brain's shape alone.
            {s.resolution !== undefined && (
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
