/**
 * Manifeste des dimensions d'images, généré au build (#315).
 *
 * Le placement des sprites en pixels absolus a besoin de la taille native de l'image **avant**
 * décodage : `resolvePlacement` réserve ainsi la boîte correcte dès la première frame (pas de
 * `translate(-50%)` sur une boîte 0×0, pas de sprite qui saute après `img.onload`).
 *
 * Le fichier `image-dimensions.json` est écrit à côté de `asset-manifest.json` par
 * `npm run assets:dimensions` (et par les placeholders e2e). Le player le charge au démarrage ;
 * en son absence, le renderer retombe sur `naturalWidth/Height` après décodage.
 */

export type ImageSizeEntry = { width: number; height: number };

export type ImageDimensionsManifest = {
  version: 1;
  generatedAt: string;
  /** Clé du manifeste d'images → dimensions natives. */
  dimensions: Record<string, ImageSizeEntry>;
};

/** Lit la taille d'une image PNG/WebP/JPEG depuis ses premiers octets (aucun décodage). */
export function readImageSize(data: Uint8Array): ImageSizeEntry | null {
  return readPng(data) ?? readWebp(data) ?? readJpeg(data);
}

function readPng(data: Uint8Array): ImageSizeEntry | null {
  if (data.length < 24) return null;
  if (data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

function readWebp(data: Uint8Array): ImageSizeEntry | null {
  if (data.length < 21) return null;
  const ascii = (start: number, end: number): string => String.fromCharCode(...data.slice(start, end));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 12) !== "WEBP") return null;
  const chunk = ascii(12, 16);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (chunk === "VP8X") {
    // VP8X : 24-bit (largeur-1, hauteur-1) aux offsets 24 et 27.
    const width = 1 + (data[24]! | (data[25]! << 8) | (data[26]! << 16));
    const height = 1 + (data[27]! | (data[28]! << 8) | (data[29]! << 16));
    return { width, height };
  }
  if (chunk === "VP8 ") {
    // VP8 lossy : dimensions 14 bits dans le frame header (offsets 26/28).
    if (data.length < 30 || data[23] !== 0x9d || data[24] !== 0x01 || data[25] !== 0x2a) return null;
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === "VP8L") {
    // VP8L lossless : 14 bits (largeur-1) puis 14 bits (hauteur-1) à partir de l'octet 21.
    if (data.length < 25 || data[20] !== 0x2f) return null;
    const bits = data[21]! | (data[22]! << 8) | (data[23]! << 16) | (data[24]! << 24);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  return null;
}

function readJpeg(data: Uint8Array): ImageSizeEntry | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1]!;
    // SOF0..SOF15 sauf DHT (0xC4), JPG (0xC8), DAC (0xCC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (data[offset + 5]! << 8) | data[offset + 6]!;
      const width = (data[offset + 7]! << 8) | data[offset + 8]!;
      return { width, height };
    }
    const length = (data[offset + 2]! << 8) | data[offset + 3]!;
    offset += 2 + length;
  }
  return null;
}
