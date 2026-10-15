/**
 * T15: what the Fresh take box starts with, from the conversation's thought template (templates.thought): the
 * template with its {{thought}} marker taken out, and the caret where the (first) marker was. T17: {{brain}} becomes
 * the name of the brain the Muse's note is for, as message.regenerate --wrap fills it. Whatever the box holds when
 * you send is sent word for word, so no marker may be left in it. DOM-free, so node:test runs it.
 */
export function prefillThought(template: string, brain = ""): { text: string; caret: number } {
  const MARK = "{{thought}}";
  // One pass, as the server's render: a brain name that itself says {{thought}} is never taken for the marker.
  const parts = template.split(MARK).map((p) => p.split("{{brain}}").join(brain));
  if (parts.length === 1) return { text: parts[0]!, caret: parts[0]!.length };
  return { text: parts.join(""), caret: parts[0]!.length };
}
