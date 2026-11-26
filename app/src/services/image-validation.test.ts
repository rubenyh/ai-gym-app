import { MAX_IMAGE_DIMENSION, validateImage } from './image-validation';

// Real images encoded by Pillow (not hand-built headers), except the explicit forgeries below.
const FIXTURES = {
  jpeg:
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCADwAUADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5/ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//Z',
  jpegProg:
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wgARCAARACEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfgAAAAA//xAAUEAEAAAAAAAAAAAAAAAAAAAAw/9oACAEBAAEFAn//xAAUEQEAAAAAAAAAAAAAAAAAAAAg/9oACAEDAQE/AV//xAAUEQEAAAAAAAAAAAAAAAAAAAAg/9oACAECAQE/AV//xAAUEAEAAAAAAAAAAAAAAAAAAAAw/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAAAAAAAAAw/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEAAAAAAP/8QAFBEBAAAAAAAAAAAAAAAAAAAAIP/aAAgBAwEBPxBf/8QAFBEBAAAAAAAAAAAAAAAAAAAAIP/aAAgBAgEBPxBf/8QAFBABAAAAAAAAAAAAAAAAAAAAMP/aAAgBAQABPxB//9k=',
  png:
    'iVBORw0KGgoAAAANSUhEUgAAEAEAAAACCAIAAAC4FeW7AAAAL0lEQVR4nO3BMQEAAADCoPVPbQlPoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgE4GYAgAATYtcFkAAAAASUVORK5CYII=',
  webpLossy:
    'UklGRqYAAABXRUJQVlA4IJoAAABwEACdASosAcgAPtFosVMoJiSioCgBABoJaW7hdrEbQAnsA99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJwoAD+/4wMAAAAAAAAAAAA',
  webpLossless:
    'UklGRiIAAABXRUJQVlA4TBYAAAAvK8ExAAcQEf0PACjS//8U0f/U/68B',
  webpX:
    'UklGRtIAAABXRUJQVlA4WAoAAAAQAAAALAEAyAAAQUxQSBEAAAABBxAREQBQpP//KaL/qf+rAwBWUDggmgAAAHAQAJ0BKi0ByQA+0WixUygmJKKgKAEAGglpbuF2sRtACewD32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snCgAP7/jAwAAAAAAAAAAAA=',
};
const bytes = (b64: string) => Uint8Array.from(Buffer.from(b64, 'base64'));
const LIMIT = { maxBytes: 2 * 1024 * 1024 };

/** Header-only PNG: valid signature + IHDR, no pixel data (decompression-bomb shape). */
function pngHeader(width: number, height: number) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return Uint8Array.from(b);
}

describe('validateImage', () => {
  it.each([
    ['baseline JPEG', FIXTURES.jpeg, 'image/jpeg', 320, 240],
    ['progressive JPEG', FIXTURES.jpegProg, 'image/jpeg', 33, 17],
    ['lossy WebP (VP8)', FIXTURES.webpLossy, 'image/webp', 300, 200],
    ['lossless WebP (VP8L)', FIXTURES.webpLossless, 'image/webp', 300, 200],
    ['extended WebP (VP8X)', FIXTURES.webpX, 'image/webp', 301, 201],
  ])('accepts a real %s and reports its true type and size', (_name, b64, mimeType, width, height) => {
    expect(validateImage(bytes(b64), LIMIT)).toEqual({ ok: true, mimeType, width, height });
  });

  it('detects the type from the bytes, not the label', () => {
    const check = validateImage(bytes(FIXTURES.webpLossless).buffer, LIMIT);
    expect(check.ok && check.mimeType).toBe('image/webp');
  });

  it('rejects HTML (or anything else) labelled as an image', () => {
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    expect(validateImage(html, LIMIT)).toEqual({ ok: false, error: 'Choose a JPEG, PNG or WebP image.' });
    expect(validateImage(new Uint8Array(0), LIMIT).ok).toBe(false);
  });

  it('rejects oversized dimensions, including header-only bombs', () => {
    expect(validateImage(pngHeader(30000, 30000), LIMIT)).toMatchObject({ ok: false, error: expect.stringContaining('4096') });
    expect(validateImage(bytes(FIXTURES.png), LIMIT).ok).toBe(false); // real 4097x2 PNG
    expect(validateImage(pngHeader(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), LIMIT).ok).toBe(true);
    expect(validateImage(pngHeader(0, 10), LIMIT).ok).toBe(false);
  });

  it('enforces the byte limit before parsing', () => {
    expect(validateImage(bytes(FIXTURES.jpeg), { maxBytes: 100 })).toMatchObject({ ok: false, error: expect.stringContaining('smaller than') });
  });

  it('rejects truncated JPEG and WebP headers instead of reading past the end', () => {
    const jpeg = bytes(FIXTURES.jpeg);
    expect(validateImage(jpeg.slice(0, 40), LIMIT).ok).toBe(false);
    expect(validateImage(bytes(FIXTURES.webpLossy).slice(0, 20), LIMIT).ok).toBe(false);
  });
});
