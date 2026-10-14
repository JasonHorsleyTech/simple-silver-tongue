import { toast } from "../components/toasts.tsx";

/** Copy text to the clipboard. Says so in a toast when the browser refuses, rather than failing silently. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toast.error("The browser didn't allow copying to the clipboard.", { key: "clipboard" });
    return false;
  }
}
