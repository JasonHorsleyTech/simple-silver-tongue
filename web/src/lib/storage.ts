/**
 * Per-browser conveniences only (a remembered username, a collapsed panel). Never app data: that lives on
 * the server, behind commands. Storage can be missing or throw (private windows), so every access is guarded.
 */
export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // ignore: this is only a convenience
  }
}
