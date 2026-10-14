import { IMAGE_SHAPES, SHAPE_SIZES, type ImageShape } from "../../api/types.ts";
import { Segmented } from "../../components/Segmented.tsx";
import { Spinner } from "../../components/Spinner.tsx";

/** An image brain's picture shape: what it paints, whichever image model the conversation uses. */
export function ShapePicker({ value, disabled, busy, onChange }: { value: ImageShape; disabled?: boolean; busy?: boolean; onChange(shape: ImageShape): void }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="flex-1 text-[13px] font-medium text-fg">Shape</span>
        {busy && <Spinner className="size-3.5 text-faint" />}
        <Segmented<ImageShape>
          label="Shape"
          value={value}
          disabled={disabled}
          onChange={onChange}
          options={IMAGE_SHAPES.map((s) => ({
            value: s,
            label: s.charAt(0).toUpperCase() + s.slice(1),
            title: `${SHAPE_SIZES[s].width} × ${SHAPE_SIZES[s].height}, or the aspect ratio nearest ${SHAPE_SIZES[s].ratio}`,
          }))}
        />
      </div>
      <p className="mt-1 text-[12.5px] leading-5 text-faint">Its pictures' shape, whatever the image model: a width × height, or the nearest aspect ratio the model offers.</p>
    </div>
  );
}
