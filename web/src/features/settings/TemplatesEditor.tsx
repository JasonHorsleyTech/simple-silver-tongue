import { api } from "../../api/client.ts";
import type { Conversation, Templates } from "../../api/types.ts";
import { SavedText } from "../../components/SavedText.tsx";

/** `required`: the server refuses the template without its placeholders (the roll's), so it can't be saved here either. */
type Spec = { key: keyof Templates; label: string; description: string; needs: string[]; required?: boolean };

const SPECS: Spec[] = [
  {
    key: "player",
    label: "Your messages",
    description: "How each of your messages is framed for a brain. {{content}} is your message.",
    needs: ["{{content}}"],
  },
  {
    key: "otherBrainText",
    label: "Another brain's messages",
    description:
      "How a brain sees what another brain said: {{brain}} is its name, {{content}} its message. Used once there is more than one brain. The Muse's notes are framed with it too (<!-- from: Muse -->), which is how every brain knows an idea is the Muse's.",
    needs: ["{{content}}"],
  },
  {
    key: "otherBrainImage",
    label: "Another brain's images",
    description: "How a brain sees another brain's picture: {{brain}} and {{prompt}}, the exact image prompt. Used with image brains.",
    needs: ["{{prompt}}"],
  },
  {
    key: "steer",
    label: "Steer",
    description: "Sent once, last, when you regenerate a reply with a direction. {{instruction}} is your direction. Never sent again.",
    needs: ["{{instruction}}"],
  },
  {
    key: "roll",
    label: "Your dice rolls",
    description:
      "The line a d20 roll adds as your message, which every brain reads (framed like your messages). {{roll}} is the number the server rolled. Used from the next roll on: earlier rolls keep their words (edit those like any message).",
    needs: ["{{roll}}"],
    required: true,
  },
  {
    key: "thought",
    label: "Fresh take: the Muse's note",
    description:
      "What Regenerate's Fresh take box starts with: the Muse's note, which goes into the ledger right before the reply for every brain to read, and which the brain then answers. {{brain}} is the brain it is for, {{thought}} where the caret goes (and where ./sst --wrap puts your words). Whatever the box holds when you send is sent word for word, so you can change it there each time. Inside a ```hidden block it stays folded for the player.",
    needs: ["{{thought}}"],
    required: true,
  },
];

/**
 * The templates (conversation.update --templates.*). They are plain text that reaches the models, so they are the
 * user's to edit; the payload view shows the effect. Placeholders are literal, single pass. Four frame messages
 * each time a request is built; the roll's (T09) is applied once, when the server rolls, and must have {{roll}}.
 * The thought's (T15) is the Fresh take box's starting text, the Muse's note (T17), and must have {{thought}}, where the
 * caret goes; {{brain}} in it is the brain the note is for.
 */
export function TemplatesEditor({ conv, onSaved }: { conv: Conversation; onSaved(c: Conversation): void }) {
  return (
    <div className="space-y-6">
      {SPECS.map((s) => (
        <SavedText
          key={s.key}
          id={`tpl-${s.key}`}
          label={s.label}
          description={s.description}
          saved={conv.templates[s.key]}
          mono
          maxPx={260}
          warn={(v) => {
            const missing = s.needs.filter((n) => !v.includes(n));
            if (!missing.length) return null;
            return s.key === "thought"
              ? `Needs ${missing.join(" and ")}: that is where the caret goes, and where ./sst puts your idea (--wrap).`
              : s.required
                ? `Needs ${missing.join(" and ")}: that is where the number goes, so a roll's line can't be made without it.`
                : `Without ${missing.join(" and ")}, the message itself isn't sent, only this text.`;
          }}
          validate={
            s.required ? (v) => (s.needs.every((n) => v.includes(n)) ? null : `Needs ${s.needs.join(" and ")}, ${s.key === "thought" ? "where your idea goes" : "where the number goes"}.`) : undefined
          }
          onSave={async (value) => onSaved(await api.call("conversation.update", { id: conv.id, templates: { [s.key]: value } }))}
        />
      ))}
    </div>
  );
}
