import { useEffect, useState } from "react";
import { errorMessage } from "../../api/errors.ts";
import type { Conversation, ConversationUpdate, ModelInfo } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Notice } from "../../components/Notice.tsx";
import { SavedText } from "../../components/SavedText.tsx";
import { Segmented } from "../../components/Segmented.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { Switch } from "../../components/Switch.tsx";
import { cx } from "../../lib/cx.ts";

type ImageSettingsPatch = NonNullable<NonNullable<ConversationUpdate["settings"]>["image"]>;

/** What /models says about sizing: z-image-turbo is width × height (multiples of 8), Nano Banana a listed resolution and aspect ratio. */
type Constraints = { widthHeightDivisor?: number; resolutions?: string[]; aspectRatios?: string[]; defaultResolution?: string; defaultAspectRatio?: string };

/** Sizes for width × height models; all multiples of 8 and at most 1280 on a side. */
const PRESETS = [
  { label: "Square", w: 1024, h: 1024 },
  { label: "Landscape", w: 1216, h: 832 },
  { label: "Wide", w: 1280, h: 720 },
  { label: "Portrait", w: 832, h: 1216 },
] as const;

/**
 * How image brains' prompts are painted, per conversation (conversation.update settings.image): the size, in
 * the terms the image model takes (from its /models constraints), the file format, Venice's watermark, and a
 * negative prompt (text the image model reads, so it is editable like every other word sent). The server
 * refuses a size the model can't take; its reason shows here. A size left over from another model isn't sent,
 * and the note says so, with a way to clear it.
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
  const byResolution = Array.isArray(c.resolutions) || Array.isArray(c.aspectRatios);
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

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[13px] font-medium text-fg">Size</span>
          {(busy === "size" || busy === "clear") && <Spinner className="size-3.5 text-faint" />}
        </div>
        {model === undefined ? (
          <p className="text-[12.5px] text-faint">Loading what {conv.settings.imageModel} takes…</p>
        ) : byResolution ? (
          <ResolutionPicker c={c} s={s} disabled={!!busy} onSave={(patch) => void save("size", patch)} />
        ) : (
          <WidthHeight divisor={c.widthHeightDivisor ?? 1} s={s} busy={busy === "size"} onSave={(patch) => save("size", patch)} />
        )}
        {model && <LeftoverSize byResolution={byResolution} s={s} modelId={model.id} busy={busy === "clear"} onClear={(patch) => void save("clear", patch)} />}
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

/** Width × height, for models sized that way: presets that save on click, or any size in multiples of the divisor. */
function WidthHeight({
  divisor,
  s,
  busy,
  onSave,
}: {
  divisor: number;
  s: Conversation["settings"]["image"];
  busy: boolean;
  onSave(patch: ImageSettingsPatch): Promise<void>;
}) {
  const [w, setW] = useState(s.width === undefined ? "" : String(s.width));
  const [h, setH] = useState(s.height === undefined ? "" : String(s.height));
  useEffect(() => {
    setW(s.width === undefined ? "" : String(s.width));
    setH(s.height === undefined ? "" : String(s.height));
  }, [s.width, s.height]);
  const dirty = w !== (s.width === undefined ? "" : String(s.width)) || h !== (s.height === undefined ? "" : String(s.height));
  const problem = sizeProblem(w, h, divisor);
  const isDefault = s.width === undefined && s.height === undefined;

  const chip = (on: boolean) =>
    cx(
      "h-7 rounded-md border px-2 text-[12.5px] tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-60",
      on ? "border-line-strong bg-hover text-fg" : "border-line text-faint enabled:hover:border-line-strong enabled:hover:text-muted",
    );
  return (
    <div>
      <div role="group" aria-label="Size presets" className="flex flex-wrap gap-1.5">
        <button type="button" className={chip(isDefault)} disabled={busy} aria-pressed={isDefault} onClick={() => !isDefault && void onSave({ width: null, height: null })} title="Send no size: Venice uses the model's own default">
          Default
        </button>
        {PRESETS.map((p) => {
          const on = s.width === p.w && s.height === p.h;
          return (
            <button
              key={p.label}
              type="button"
              className={chip(on)}
              disabled={busy}
              aria-pressed={on}
              title={`${p.w} × ${p.h}`}
              onClick={() => !on && void onSave({ width: p.w, height: p.h })}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        <label className="sr-only" htmlFor="cv-img-w">
          Width
        </label>
        <input
          id="cv-img-w"
          inputMode="numeric"
          value={w}
          placeholder="width"
          onChange={(e) => setW(e.target.value.trim())}
          onKeyDown={(e) => e.key === "Enter" && dirty && !problem && void onSave(sizePatch(w, h))}
          className={cx(field, dirty && "border-amber-300/35")}
        />
        <span className="text-faint">×</span>
        <label className="sr-only" htmlFor="cv-img-h">
          Height
        </label>
        <input
          id="cv-img-h"
          inputMode="numeric"
          value={h}
          placeholder="height"
          onChange={(e) => setH(e.target.value.trim())}
          onKeyDown={(e) => e.key === "Enter" && dirty && !problem && void onSave(sizePatch(w, h))}
          className={cx(field, dirty && "border-amber-300/35")}
        />
        <span className="text-[12px] text-faint">px</span>
        {dirty && (
          <>
            <Button size="sm" variant="ghost" className="ml-auto px-2" disabled={busy} onClick={() => (setW(s.width === undefined ? "" : String(s.width)), setH(s.height === undefined ? "" : String(s.height)))}>
              Revert
            </Button>
            <Button size="sm" variant="primary" loading={busy} disabled={!!problem} onClick={() => void onSave(sizePatch(w, h))}>
              Save
            </Button>
          </>
        )}
      </div>
      <p className={cx("mt-1.5 text-[12px] leading-5", dirty && problem ? "text-amber-200/85" : "text-faint")}>
        {dirty && problem ? problem : `Multiples of ${divisor}. Both blank: no size is sent, and the model uses its own.`}
      </p>
    </div>
  );
}

const field =
  "h-8 w-[5.5rem] rounded-md border border-line-strong bg-raised px-2.5 font-mono text-[12.5px] text-fg tabular-nums outline-none placeholder:font-sans placeholder:text-faint focus:border-focus/60 focus:ring-3 focus:ring-focus/15";

function sizeProblem(w: string, h: string, divisor: number): string | null {
  if (w === "" && h === "") return null;
  for (const [name, v] of [["width", w], ["height", h]] as const) {
    if (!/^[1-9]\d*$/.test(v)) return `Give both a width and a height in pixels (or leave both blank).`;
    if (Number(v) % divisor !== 0) return `The ${name} must be a multiple of ${divisor}: ${Math.floor(Number(v) / divisor) * divisor} or ${Math.ceil(Number(v) / divisor) * divisor}.`;
  }
  return null;
}

const sizePatch = (w: string, h: string): ImageSettingsPatch => (w === "" && h === "" ? { width: null, height: null } : { width: Number(w), height: Number(h) });

/** Resolution and aspect ratio, for models sized that way (Nano Banana): only what the model lists. */
function ResolutionPicker({
  c,
  s,
  disabled,
  onSave,
}: {
  c: Constraints;
  s: Conversation["settings"]["image"];
  disabled: boolean;
  onSave(patch: ImageSettingsPatch): void;
}) {
  const DEFAULT = "";
  return (
    <div className="space-y-2.5">
      {Array.isArray(c.resolutions) && (
        <div className="flex items-center gap-3">
          <span className="w-24 text-[12.5px] text-muted">Resolution</span>
          <Segmented
            label="Resolution"
            value={s.resolution ?? DEFAULT}
            disabled={disabled}
            options={[{ value: DEFAULT, label: "Default", title: c.defaultResolution ? `Send none: the model uses ${c.defaultResolution}` : "Send none" }, ...c.resolutions.map((r) => ({ value: r, label: r }))]}
            onChange={(r) => onSave({ resolution: r === DEFAULT ? null : r })}
          />
        </div>
      )}
      {Array.isArray(c.aspectRatios) && (
        <div className="flex items-center gap-3">
          <label htmlFor="cv-img-ar" className="w-24 text-[12.5px] text-muted">
            Aspect ratio
          </label>
          <select
            id="cv-img-ar"
            value={s.aspectRatio ?? DEFAULT}
            disabled={disabled}
            onChange={(e) => onSave({ aspectRatio: e.target.value === DEFAULT ? null : e.target.value })}
            className="h-8 rounded-md border border-line-strong bg-raised px-2 text-[13px] text-fg outline-none focus:border-focus/60 disabled:opacity-60"
          >
            <option value={DEFAULT}>Default{c.defaultAspectRatio ? ` (${c.defaultAspectRatio})` : ""}</option>
            {c.aspectRatios.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

/** A size set for another kind of model stays in the settings but isn't sent (buildImageRequest says so): offer to clear it. */
function LeftoverSize({
  byResolution,
  s,
  modelId,
  busy,
  onClear,
}: {
  byResolution: boolean;
  s: Conversation["settings"]["image"];
  modelId: string;
  busy: boolean;
  onClear(patch: ImageSettingsPatch): void;
}) {
  const left = byResolution
    ? s.width !== undefined || s.height !== undefined
      ? { what: `The size ${s.width ?? "?"} × ${s.height ?? "?"}`, patch: { width: null, height: null } as ImageSettingsPatch }
      : null
    : s.resolution !== undefined || s.aspectRatio !== undefined
      ? { what: [s.resolution, s.aspectRatio].filter(Boolean).join(" at "), patch: { resolution: null, aspectRatio: null } as ImageSettingsPatch }
      : null;
  if (!left) return null;
  return (
    <p className="mt-2 text-[12px] leading-5 text-faint">
      {left.what} is kept from another model but isn't sent: {modelId} is sized {byResolution ? "by resolution and aspect ratio" : "by width and height"}.{" "}
      <button type="button" disabled={busy} onClick={() => onClear(left.patch)} className="text-muted underline decoration-line-strong underline-offset-4 hover:text-fg">
        Clear it
      </button>
    </p>
  );
}
