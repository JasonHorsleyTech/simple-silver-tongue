import { api } from "../../api/client.ts";
import type { Conversation, Templates } from "../../api/types.ts";
import { SavedText } from "../../components/SavedText.tsx";

type Spec = { key: keyof Templates; label: string; description: string; needs: string[] };

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
    description: "How a brain sees what another brain said: {{brain}} is its name, {{content}} its message. Used once there is more than one brain.",
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
];

/**
 * The framing templates (conversation.update --templates.*). They are plain text that reaches the models,
 * so they are the user's to edit; the payload view shows the effect. Placeholders are literal, single pass.
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
            return missing.length ? `Without ${missing.join(" and ")}, the message itself isn't sent, only this text.` : null;
          }}
          onSave={async (value) => onSaved(await api.call("conversation.update", { id: conv.id, templates: { [s.key]: value } }))}
        />
      ))}
    </div>
  );
}
