/**
 * Client-side image content check before Storage upload (avatars, post photos).
 *
 * Local Supabase Storage enforces only the bucket size limit and the *declared* MIME label: bytes are
 * not inspected (HTML labelled image/png and a header-only 30000x30000 PNG were both accepted; see
 * docs/TRACEABILITY.md security notes). expo-image-picker may return PNG or JPEG and never resizes.
 * So the app reads the real signature and header dimensions and uploads with the DETECTED type.
 * A modified client can skip this; it limits accidents and casual abuse, not a determined attacker.
 */

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';
export type ImageCheck = { ok: true; mimeType: ImageMime; width: number; height: number } | { ok: false; error: string };

export const MAX_IMAGE_DIMENSION = 4096;

type Info = { mimeType: ImageMime; width: number; height: number };

export function validateImage(input: ArrayBuffer | Uint8Array, opts: { maxBytes: number; maxDimension?: number }): ImageCheck {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const maxDimension = opts.maxDimension ?? MAX_IMAGE_DIMENSION;
  const mb = Math.round(opts.maxBytes / (1024 * 1024));
  if (b.byteLength === 0) return { ok: false, error: 'The image is empty.' };
  if (b.byteLength > opts.maxBytes) return { ok: false, error: `Choose an image smaller than ${mb} MB.` };
  const info = readPng(b) ?? readJpeg(b) ?? readWebp(b);
  if (!info) return { ok: false, error: 'Choose a JPEG, PNG or WebP image.' };
  if (info.width < 1 || info.height < 1) return { ok: false, error: 'The image is damaged.' };
  if (info.width > maxDimension || info.height > maxDimension) {
    return { ok: false, error: `Choose an image at most ${maxDimension}×${maxDimension} pixels.` };
  }
  return { ok: true, ...info };
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
const startsWith = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);

function readPng(b: Uint8Array): Info | null {
  if (!startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || b.length < 24 || !ascii(b, 12, 'IHDR')) return null;
  return { mimeType: 'image/png', width: u32be(b, 16), height: u32be(b, 20) };
}

/** Walks JPEG segments to the first start-of-frame marker (SOF0–SOF15 except DHT/JPG/DAC). */
function readJpeg(b: Uint8Array): Info | null {
  if (!startsWith(b, [0xff, 0xd8, 0xff])) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // standalone marker, no length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end/scan before any frame header
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return i + 8 < b.length ? { mimeType: 'image/jpeg', height: u16be(b, i + 5), width: u16be(b, i + 7) } : null;
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

function readWebp(b: Uint8Array): Info | null {
  if (b.length < 30 || !ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return null;
  if (ascii(b, 12, 'VP8 ')) {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { mimeType: 'image/webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (ascii(b, 12, 'VP8L')) {
    if (b[20] !== 0x2f) return null;
    const width = 1 + (b[21] | ((b[22] & 0x3f) << 8));
    const height = 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10));
    return { mimeType: 'image/webp', width, height };
  }
  if (ascii(b, 12, 'VP8X')) return { mimeType: 'image/webp', width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  return null;
}
