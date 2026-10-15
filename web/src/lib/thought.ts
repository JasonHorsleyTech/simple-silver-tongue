/**
 * T15: what the Fresh take box starts with, from the conversation's thought template (templates.thought): the
 * template with its {{thought}} marker taken out, and the caret where the (first) marker was. Whatever the box holds
 * when you send is sent word for word, so no marker may be left in it. DOM-free, so node:test runs it.
 */
export function prefillThought(template: string): { text: string; caret: number } {
  const MARK = "{{thought}}";
  const at = template.indexOf(MARK);
  if (at === -1) return { text: template, caret: template.length };
  return { text: template.split(MARK).join(""), caret: at };
}
