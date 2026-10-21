import { ChevronLeft, ChevronRight, Download, Expand, ImageOff, Paintbrush, PenLine, RotateCw, ShieldOff, X } from "lucide-react";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api } from "../../api/client.ts";
import { DEFAULT_SHAPE, IMAGE_SHAPES, SHAPE_SIZES, type Brain, type ImageRecord, type ImageShape, type MessageVersion } from "../../api/types.ts";
import { Button } from "../../components/Button.tsx";
import { Spinner } from "../../components/Spinner.tsx";
import { cx } from "../../lib/cx.ts";
import { formatUsd } from "../../lib/format.ts";
import { BrainBadge } from "./BrainBadge.tsx";

/**
 * An image brain's message (T05): the picture on top, the prompt under it as a caption. The picture goes
 * through its life in one frame, so nothing jumps:
 *   writing the prompt   a softly moving placeholder, and the prompt streaming in below it
 *   painting             the placeholder with a spinner and the seconds so far (or, for an edited prompt,
 *                        the last image dimmed under the spinner until the new one swaps in)
 *   done                 the image fades in; a click opens it large
 *   blurred / flagged    the image, with what safe mode or Venice did and a way to paint it again
 *   failed               the server's words, Retry, and the last image if there was one
 * Images are fetched with GET /api/image.get (decrypted by the server for an encrypted user, never cached).
 */

/**
 * T07: every finished image in the conversation, top to bottom (each image message's active version), so the
 * large view can step from one to the next (← →). Scrollback provides it.
 */
export type GalleryItem = { image: ImageRecord; prompt: string; brain?: Brain; label?: string };
export const GalleryContext = createContext<GalleryItem[]>([]);

/** Natural sizes of images already shown, by id: a remounted image takes its space at once. Memory only. */
const sizes = new Map<string, Aspect>();

export type Aspect = { w: number; h: number };

/** Pictures are at most this tall in the scrollback; the lightbox shows them as large as the window allows. */
const MAX_H = 420;

/** One object per shape, so a memo'd message doesn't re-render for a new but equal aspect. */
const SHAPE_ASPECTS = Object.fromEntries(IMAGE_SHAPES.map((s) => [s, { w: SHAPE_SIZES[s].width, h: SHAPE_SIZES[s].height }])) as Record<ImageShape, Aspect>;

/**
 * The shape a brain's next image is expected to have: its own shape (landscape if it has none), as the server
 * sends it to a width × height model. A model sized by aspect ratio gets the nearest ratio it lists, close
 * enough for a frame; the picture's own size replaces it once it loads.
 */
export function expectedAspect(brain: Pick<Brain, "shape"> | undefined): Aspect {
  return SHAPE_ASPECTS[brain?.shape ?? DEFAULT_SHAPE];
}

export const imageUrl = (id: string) => api.binaryUrl("image.get", { id });

/** The server's error, ending like a sentence, so the next one doesn't run into it. */
function sentence(s: string): string {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function frameStyle(a: Aspect, color?: string): CSSProperties {
  return {
    aspectRatio: `${a.w} / ${a.h}`,
    width: `min(100%, ${Math.round((MAX_H * a.w) / a.h)}px)`,
    ...(color ? { ["--paint" as string]: color } : {}),
  };
}

/** The saved image message's body: the picture in its current state, then the prompt (or the prompt editor). */
export function ImageBody({
  version: v,
  brain,
  aspect,
  versionLabel,
  editor,
  onRepaint,
  onEdit,
}: {
  version: MessageVersion;
  brain?: Brain;
  /** What a new image is expected to look like (the conversation's size settings). */
  aspect: Aspect;
  /** "v2/3", for the large view. */
  versionLabel?: string;
  /** While the prompt is being edited: the editor, in the caption's place, under the picture it would replace. */
  editor?: ReactNode;
  onRepaint(opts?: { safeModeOff?: boolean }): Promise<string | null>;
  onEdit(): void;
}) {
  const img = v.image;
  const gallery = useContext(GalleryContext);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState<null | "repaint" | "unblur">(null);
  const [problem, setProblem] = useState<string | null>(null);
  const name = brain?.name ?? "The image brain";
  const color = brain?.color;

  // A new image (a retry, an edit) clears the last attempt's trouble.
  useEffect(() => {
    setProblem(null);
  }, [img?.id]);

  async function repaint(safeModeOff?: boolean) {
    if (working) return;
    setWorking(safeModeOff ? "unblur" : "repaint");
    setProblem(null);
    const p = await onRepaint(safeModeOff ? { safeModeOff } : undefined);
    setWorking(null);
    if (p) setProblem(p);
  }

  const retryButtons = (label: string) => (
    <>
      <Button size="sm" variant="secondary" className="h-7 px-2.5 text-[12.5px]" loading={working === "repaint"} disabled={!!working} onClick={() => void repaint()}>
        {working !== "repaint" && <RotateCw aria-hidden className="size-3.5" />} {label}
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-[12.5px]" disabled={!!working} onClick={onEdit}>
        <PenLine aria-hidden className="size-3.5" /> Edit the prompt
      </Button>
    </>
  );

  let picture: ReactNode;
  let below: ReactNode = null;
  if (!img) {
    picture = (
      <FailedBox title="No image yet" detail="This prompt hasn't been painted.">
        {retryButtons("Paint it")}
      </FailedBox>
    );
  } else if (img.status === "pending") {
    picture = img.previous ? (
      <Shot key={img.previous.id} image={img.previous} fallback={aspect} alt="The last image, until the new one is ready" dim>
        <Painting image={img} overlay label="Painting the new prompt" />
      </Shot>
    ) : (
      <Frame aspect={aspect} color={color} className="sst-paint">
        <Painting image={img} label="Painting" />
      </Frame>
    );
  } else if (img.status === "done") {
    picture = (
      <Shot key={img.id} image={img} fallback={aspect} alt={v.content} onOpen={() => setOpen(true)} />
    );
    if (img.blurred || img.contentViolation) {
      const safeOn = brain?.safeMode !== false;
      below = (
        <Trouble tone="warn">
          <p>
            {img.blurred
              ? safeOn
                ? `Safe mode blurred this image. ${name}'s safe mode is on (it is by default), so Venice blurs adult content.`
                : `Safe mode blurred this image when it was made. ${name}'s safe mode is off now, so painting it again comes back unblurred.`
              : "Venice flagged this image under its content policy."}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {img.blurred && safeOn ? (
              <>
                <Button size="sm" variant="secondary" className="h-7 px-2.5 text-[12.5px]" loading={working === "unblur"} disabled={!!working} onClick={() => void repaint(true)}>
                  {working !== "unblur" && <ShieldOff aria-hidden className="size-3.5" />} Turn safe mode off and repaint
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[12.5px]" loading={working === "repaint"} disabled={!!working} onClick={() => void repaint()}>
                  Repaint as it is
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" className="h-7 px-2.5 text-[12.5px]" loading={working === "repaint"} disabled={!!working} onClick={() => void repaint()}>
                {working !== "repaint" && <Paintbrush aria-hidden className="size-3.5" />} Repaint
              </Button>
            )}
          </div>
          {img.blurred && safeOn && <p className="mt-1.5 text-[12px] text-amber-100/60">Safe mode then stays off for {name}; switch it back on under Brains in settings.</p>}
        </Trouble>
      );
    }
  } else {
    // A failed image (or one the server stopped making). With a last good image, that stays on show beside the error.
    picture = img.previous ? (
      <Shot key={img.previous.id} image={img.previous} fallback={aspect} alt={v.content} onOpen={() => setOpen(true)} faded />
    ) : (
      <FailedBox title="No image" detail={sentence(img.error ?? "The image couldn't be made")}>
        {retryButtons("Retry")}
      </FailedBox>
    );
    if (img.previous) {
      below = (
        <Trouble tone="error">
          <p>
            The new image wasn't made: {sentence(img.error ?? "something went wrong")} The last image is still shown.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">{retryButtons("Retry")}</div>
        </Trouble>
      );
    }
  }

  const shown = img?.status === "done" ? img : img?.previous;
  return (
    <div>
      {picture}
      {below}
      {problem && (
        <p role="alert" className="mt-2 text-[12.5px] leading-5 text-red-200">
          {problem}
        </p>
      )}
      {editor ?? <PromptCaption text={v.content} />}
      {open && shown && (
        <ImageLightbox
          // The conversation's pictures, starting at this one; a picture the gallery doesn't hold (the last good one beside a failure) alone.
          items={gallery.some((g) => g.image.id === shown.id) ? gallery : [{ image: shown, prompt: v.content, brain, label: versionLabel }]}
          startId={shown.id}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** An image brain's reply while its prompt streams in: the frame waiting for the picture, the words arriving. */
export function LiveImage({ prompt, aspect, color, failed }: { prompt: string; aspect: Aspect; color?: string; failed: boolean }) {
  if (failed) return prompt ? <PromptCaption text={prompt} dim /> : null;
  return (
    <div>
      <Frame aspect={aspect} color={color} className="sst-paint">
        <div className="absolute inset-0 grid place-items-center">
          <span className="shimmer text-[12.5px] font-medium">{prompt ? "Writing the prompt…" : "Thinking of a picture…"}</span>
        </div>
      </Frame>
      {prompt && <PromptCaption text={prompt} live />}
    </div>
  );
}

function Frame({
  aspect,
  color,
  className,
  interactive,
  children,
}: {
  aspect: Aspect;
  color?: string;
  className?: string;
  interactive?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cx("group/pic relative overflow-hidden rounded-xl border border-line bg-panel", interactive && "cursor-zoom-in", className)}
      style={frameStyle(aspect, color)}
    >
      {children}
    </div>
  );
}

/**
 * A finished image in its frame, fading in once it has loaded. Until then the frame has the expected shape
 * (`fallback`); from then on, the image's own, so nothing is ever cropped. `dim`: under a spinner. `faded`:
 * beside an error. Key it by the image id.
 */
function Shot({
  image,
  fallback,
  alt,
  onOpen,
  dim,
  faded,
  children,
}: {
  image: ImageRecord;
  fallback: Aspect;
  alt: string;
  onOpen?(): void;
  dim?: boolean;
  faded?: boolean;
  /** Said over the picture (the spinner while a new one is painted). */
  children?: ReactNode;
}) {
  const [size, setSize] = useState<Aspect | null>(() => sizes.get(image.id) ?? null);
  const [broken, setBroken] = useState(false);
  /** Why it didn't load, in the server's words (an <img> can't read the error): a damaged file says so (T06). */
  const [why, setWhy] = useState<{ code: string; message: string } | null>(null);
  useEffect(() => {
    if (!broken) return;
    let live = true;
    void api.binaryError("image.get", { id: image.id }).then((err) => {
      if (live) setWhy(err ? { code: err.code, message: err.message } : { code: "ok", message: "" });
    });
    return () => {
      live = false;
    };
  }, [broken, image.id]);
  const loaded = size !== null;
  if (broken) {
    const damaged = why?.code === "unreadable_file";
    return (
      <Frame aspect={fallback}>
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-[12.5px] leading-5 text-faint">
          <span className="max-w-sm">
            <ImageOff aria-hidden className={cx("mx-auto mb-1.5 size-5", damaged && "text-amber-300/80")} />
            {damaged ? (
              <>
                <span className="block text-muted">This image's file is damaged, so it can't be shown.</span>
                <span className="mt-1 block">
                  {capitalized(sentence(why.message.slice(why.message.indexOf(": ") + 2)))} Nothing was written over it: put back a good copy of{" "}
                  <span className="font-mono text-[11.5px]">{why.message.split(": ")[0]}</span> from a backup, or paint it again.
                </span>
              </>
            ) : why?.code === "ok" ? (
              <>
                The image didn't load.{" "}
                <button type="button" onClick={() => setBroken(false)} className="underline decoration-line-strong underline-offset-4 hover:text-fg">
                  Try again
                </button>
              </>
            ) : why ? (
              <>The image file couldn't be loaded: {why.message}</>
            ) : (
              "The image file couldn't be loaded."
            )}
          </span>
        </div>
        {children}
      </Frame>
    );
  }
  const img = (
    <img
      src={imageUrl(image.id)}
      alt={alt}
      decoding="async"
      draggable={false}
      onLoad={(e) => {
        const el = e.currentTarget;
        const natural = el.naturalWidth && el.naturalHeight ? { w: el.naturalWidth, h: el.naturalHeight } : fallback;
        sizes.set(image.id, natural);
        setSize(natural);
      }}
      onError={() => setBroken(true)}
      className={cx(
        "absolute inset-0 size-full object-cover transition-[opacity,filter,scale] duration-700 ease-out",
        !loaded ? "scale-[1.02] opacity-0" : dim ? "opacity-35 blur-[1.5px] saturate-50" : faded ? "opacity-55 saturate-75" : "opacity-100",
      )}
    />
  );
  return (
    <Frame aspect={size ?? fallback} interactive={!!onOpen}>
      {onOpen ? (
        <button type="button" onClick={onOpen} aria-label="Open the image large" title="Open it large" className="absolute inset-0 block size-full">
          {img}
          <span
            aria-hidden
            className="absolute top-2 right-2 grid size-7 place-items-center rounded-md bg-black/45 text-white/85 opacity-0 backdrop-blur-sm transition-opacity group-hover/pic:opacity-100"
          >
            <Expand className="size-3.5" />
          </span>
        </button>
      ) : (
        img
      )}
      {children}
    </Frame>
  );
}

/** What is said over a frame while its image is being made: who paints it, with what, and for how long so far. */
function Painting({ image, overlay, label }: { image: ImageRecord; overlay?: boolean; label: string }) {
  const seconds = useSecondsSince(image.createdAt);
  return (
    <div aria-live="polite" aria-busy className={cx("absolute inset-0 grid place-items-center", overlay && "bg-canvas/25")}>
      <div className={cx("flex flex-col items-center gap-2 rounded-xl px-4 py-3 text-center", overlay && "bg-canvas/70 shadow-lg shadow-black/30 backdrop-blur-sm")}>
        <Spinner className="size-5 text-silver" />
        <span className="text-[12.5px] font-medium text-fg">{label}…</span>
        <span className="text-[11.5px] text-faint tabular-nums">
          {image.model}
          {seconds >= 1 ? ` · ${seconds} s` : ""}
        </span>
      </div>
    </div>
  );
}

function useSecondsSince(iso: string): number {
  const at = Date.parse(iso);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Number.isNaN(at) ? 0 : Math.max(0, Math.floor((now - at) / 1000));
}

function FailedBox({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <div role="alert" className="max-w-[34rem] rounded-xl border border-dashed border-red-300/30 bg-red-400/[0.04] px-4 py-3.5">
      <div className="flex items-start gap-3">
        <ImageOff aria-hidden className="mt-0.5 size-4.5 shrink-0 text-red-300/80" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-red-100">{title}</p>
          <p className="mt-0.5 text-[13px] leading-5 text-red-100/75">{detail}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Trouble({ tone, children }: { tone: "warn" | "error"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "mt-2 max-w-[42rem] rounded-lg border px-3 py-2.5 text-[13px] leading-5",
        tone === "warn" ? "border-amber-300/20 bg-amber-300/[0.05] text-amber-50/90" : "border-red-400/25 bg-red-400/[0.07] text-red-100",
      )}
    >
      {children}
    </div>
  );
}

/**
 * The prompt, as it was sent: plain text, word for word. Three lines unless opened, so a long campaign of
 * pictures stays scannable. While it streams in it is shown whole, with a caret.
 */
export function PromptCaption({ text, live, dim }: { text: string; live?: boolean; dim?: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  const clamp = !open && !live;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !clamp) return setClamped(false);
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, clamp]);
  return (
    <div className="mt-2.5 max-w-[42rem]">
      <p
        ref={ref}
        className={cx("text-[13.5px] leading-[1.6] break-words whitespace-pre-wrap text-muted", clamp && "line-clamp-3", dim && "opacity-55")}
      >
        <span className="mr-1.5 align-[1px] text-[10.5px] font-semibold tracking-[0.08em] text-faint uppercase select-none">Prompt</span>
        {text}
        {live && <span aria-hidden className="sst-caret-inline" />}
      </p>
      {(clamped || open) && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-0.5 text-[12px] text-faint underline-offset-4 transition-colors hover:text-muted hover:underline">
          {open ? "Show less" : "Show the whole prompt"}
        </button>
      )}
    </div>
  );
}

/**
 * The image as large as the window allows, with its prompt and a download. With more than one picture in the
 * conversation, ‹ › (or ← →) step through them in ledger order. Escape or a click outside closes it.
 */
function ImageLightbox({ items, startId, onClose }: { items: GalleryItem[]; startId: string; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(() => Math.max(0, items.findIndex((g) => g.image.id === startId)));
  const item = items[Math.min(index, items.length - 1)]!;
  const { image, prompt, brain, label } = item;
  const many = items.length > 1;
  const step = (d: number) => setIndex((i) => (i + d + items.length) % items.length);
  const [size, setSize] = useState<Aspect | null>(() => sizes.get(image.id) ?? null);
  useEffect(() => {
    setSize(sizes.get(image.id) ?? null);
  }, [image.id]);
  useEffect(() => {
    const d = ref.current;
    const before = document.activeElement;
    if (d && !d.open) d.showModal();
    stage.current?.focus(); // not the first button: Escape closes, and no focus ring lands on Download
    return () => {
      d?.close();
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);
  const fit: Aspect = { w: 1, h: 1 };
  const ext = image.mime?.split("/")[1]?.replace("jpeg", "jpg") ?? "img";
  const file = `${(brain?.name ?? "image").replace(/[^\w-]+/g, "-").toLowerCase()}-${image.id}.${ext}`;
  const facts = [image.model, size && `${size.w} × ${size.h}`, image.costUsd !== undefined && formatUsd(image.costUsd), image.blurred && "blurred by safe mode"]
    .filter(Boolean)
    .join(" · ");
  const arrow = "absolute top-1/2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/[0.08] text-white/75 ring-1 ring-white/10 transition-colors hover:bg-white/15 hover:text-white";
  return (
    <dialog
      ref={ref}
      aria-label="Image"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (!many || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
        e.preventDefault();
        step(e.key === "ArrowLeft" ? -1 : 1);
      }}
      onClick={(e) => {
        if (e.target === ref.current || (e.target as HTMLElement).dataset.backdrop !== undefined) onClose();
      }}
      className="m-0 h-dvh max-h-none w-dvw max-w-none bg-transparent p-0 text-fg backdrop:bg-black/85 backdrop:backdrop-blur-sm"
    >
      {many && (
        <>
          <button type="button" onClick={() => step(-1)} aria-label="Previous image" title="Previous image (←)" className={cx(arrow, "left-3 sm:left-5")}>
            <ChevronLeft aria-hidden className="size-6" />
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Next image" title="Next image (→)" className={cx(arrow, "right-3 sm:right-5")}>
            <ChevronRight aria-hidden className="size-6" />
          </button>
        </>
      )}
      <div
        ref={stage}
        tabIndex={-1}
        data-backdrop
        className={cx("flex h-full flex-col items-center justify-center gap-3 py-4 outline-none", many ? "px-16 sm:px-20" : "px-4 sm:px-8")}
      >
        {/* As large as the window allows, whatever the file's own size: the height left after the caption, or the full width. */}
        <img
          key={image.id}
          src={imageUrl(image.id)}
          alt={prompt}
          onLoad={(e) => {
            const el = e.currentTarget;
            if (el.naturalWidth) setSize({ w: el.naturalWidth, h: el.naturalHeight });
          }}
          style={{
            aspectRatio: `${(size ?? fit).w} / ${(size ?? fit).h}`,
            width: `min(100%, calc((100dvh - 11rem) * ${(size ?? fit).w / (size ?? fit).h}))`,
          }}
          className="h-auto rounded-lg bg-panel object-contain shadow-2xl shadow-black/70"
        />
        <div className="w-full max-w-3xl">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {brain && <BrainBadge name={brain.name} color={brain.color} />}
            {label && <span className="text-[12px] text-muted tabular-nums">{label}</span>}
            {many && (
              <span className="text-[12px] text-muted tabular-nums">
                {index + 1} of {items.length}
              </span>
            )}
            <span className="min-w-0 truncate text-[12px] text-faint tabular-nums">{facts}</span>
            <span className="ml-auto flex items-center gap-1">
              <a
                href={imageUrl(image.id)}
                download={file}
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted transition-colors hover:bg-white/10 hover:text-fg"
              >
                <Download aria-hidden className="size-3.5" /> Download
              </a>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-white/10 hover:text-fg"
              >
                <X aria-hidden className="size-4" />
              </button>
            </span>
          </div>
          <p className="mt-2 max-h-[4.8rem] overflow-y-auto text-[13px] leading-[1.6] whitespace-pre-wrap text-muted">{prompt}</p>
        </div>
      </div>
    </dialog>
  );
}
