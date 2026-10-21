import { BrainCircuit, ImageIcon } from "lucide-react";
import { useState } from "react";
import { BRAIN_COLORS, MAKES_NUMBER, type LibraryBrain } from "../../api/types.ts";
import { BrainBadge } from "../chat/BrainBadge.tsx";

/**
 * What a badge can't say: an image brain answers with a picture, and reasoning is on (a labeled opt-in, AGENTS.md:
 * the provider adds a small hidden instruction, so every list of brains says so; T10's Character Actor ships with it).
 * T16: a brain that makes brains ("makes Character N"), with its name pattern. T18: a brain's own models (`models`:
 * its text model and an image brain's image model, ids), since the conversation's are everyone else's.
 */
export function BrainTags({ kind, reasoning, makes, models }: { kind: LibraryBrain["kind"]; reasoning?: string | null; makes?: string | null; models?: { text?: string | null; image?: string | null } }) {
  const own = [models?.text, models?.image && `images: ${models.image}`].filter(Boolean).join(" · ");
  return (
    <>
      {makes && (
        <span
          className="inline-flex shrink-0 items-center gap-1 text-[11.5px] whitespace-nowrap text-faint"
          title={`Each new message it writes makes a new brain, named “${makes}”, with that message pinned to it.`}
        >
          <BrainCircuit aria-hidden className="size-3" /> makes {makes.replace(MAKES_NUMBER, "N")}
        </span>
      )}
      {kind === "image" && <ImageIcon aria-label="(image)" className="size-3.5 shrink-0 text-faint" />}
      {own && (
        <span className="shrink-0 font-mono text-[11px] whitespace-nowrap text-faint" title="A model of its own, instead of the conversation's">
          {own}
        </span>
      )}
      {reasoning && (
        <span className="shrink-0 text-[11.5px] whitespace-nowrap text-faint" title="Reasoning is on: it thinks before it answers (the provider adds a small hidden instruction).">
          reasoning {reasoning}
        </span>
      )}
    </>
  );
}

const colorOf = (b: LibraryBrain, i: number) => b.color ?? BRAIN_COLORS[i % BRAIN_COLORS.length]!;

/**
 * A committed file's brains (examples.list, presets.list): badges, each one's job on hover, and on request the
 * same brains as a list with that job written out, so you know who is at the table before you start.
 */
export function Cast({ brains }: { brains: LibraryBrain[] }) {
  const [open, setOpen] = useState(false);
  const told = brains.some((b) => b.about);
  if (!brains.length) return null;
  return (
    <div className="mt-3.5">
      {open ? (
        <ul aria-label="Brains" className="space-y-2.5">
          {brains.map((b, i) => (
            <li key={b.name} className="text-[13px] leading-5">
              <span className="flex items-center gap-1.5">
                <BrainBadge name={b.name} color={colorOf(b, i)} />
                <BrainTags kind={b.kind} reasoning={b.reasoning} makes={b.makes} models={{ text: b.textModel, image: b.imageModel }} />
              </span>
              {b.about && <p className="mt-1 pl-0.5 text-muted">{b.about}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <ul aria-label="Brains" className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {brains.map((b, i) => (
            <li key={b.name} className="inline-flex max-w-full items-center gap-1" title={b.about}>
              <BrainBadge name={b.name} color={colorOf(b, i)} />
              <BrainTags kind={b.kind} reasoning={b.reasoning} makes={b.makes} models={{ text: b.textModel, image: b.imageModel }} />
            </li>
          ))}
        </ul>
      )}
      {told && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="mt-2 text-[12.5px] text-faint underline decoration-line-strong underline-offset-4 hover:text-muted"
        >
          {open ? "Just the names" : "What each brain does"}
        </button>
      )}
    </div>
  );
}
