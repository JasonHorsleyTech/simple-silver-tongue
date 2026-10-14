/**
 * What an image really is, from its first bytes. Venice may not send the format that was asked for (the mock
 * always sends PNG), so the stored type, the file extension and image.get's Content-Type all come from here.
 */

export type ImageKind = { mime: string; ext: string };

const KINDS: Record<string, ImageKind> = {
  png: { mime: "image/png", ext: "png" },
  jpeg: { mime: "image/jpeg", ext: "jpg" },
  webp: { mime: "image/webp", ext: "webp" },
  gif: { mime: "image/gif", ext: "gif" },
};

export function sniffImage(b: Uint8Array): ImageKind | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return KINDS.png!;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return KINDS.jpeg!;
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return KINDS.webp!;
  if (b.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return KINDS.gif!;
  return null;
}

/** The kind for a stored file's extension (images/<id>.<ext>). */
export function kindOfExt(ext: string): ImageKind | null {
  return Object.values(KINDS).find((k) => k.ext === ext) ?? null;
}
