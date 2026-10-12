/** File type validation by content, not extension (PRD §78). */
export type ImageKind = 'png' | 'jpeg' | 'webp' | 'gif' | 'avif' | 'svg';

export const IMAGE_MIME: Record<ImageKind, string> = {
  png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml',
};

export const IMAGE_EXT: Record<ImageKind, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif', avif: 'avif', svg: 'svg' };

/** Upload limits: PNG/JPG/WebP only from people, 25 MB (PRD §16, §78). */
export const UPLOAD_KINDS: ImageKind[] = ['png', 'jpeg', 'webp'];
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Website images can be larger (Arnifi serves 21328 px PNGs); they are downscaled on ingest. */
export const MAX_REMOTE_BYTES = 80 * 1024 * 1024;

export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }
  const head = new TextDecoder().decode(b.slice(0, 256)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return null;
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array) {
  const buf = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Hamming distance between two hex-encoded 64-bit perceptual hashes. */
export function hamming(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/** Perceptual near-duplicates: ≤ 6 of 64 bits differ. */
export const DHASH_DUPLICATE = 6;
