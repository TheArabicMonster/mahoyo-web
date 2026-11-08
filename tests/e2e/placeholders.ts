/**
 * Génère des images PNG 1×1 très petites (placeholders) pour les tests e2e.
 *
 * Aucun asset sous copyright : les images sont générées algorithmiquement.
 */
import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeCrc32() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return (data: Buffer): number => {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
}
const crc32 = makeCrc32();

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length);
  const combined = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(combined));
  return Buffer.concat([lenBuf, combined, crcBuf]);
}

export function png1x1(r: number, g: number, b: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // color type RGB
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter method
  ihdr.writeUInt8(0, 12); // interlace
  const raw = Buffer.from([0, r, g, b]); // filter byte + RGB
  const idatData = deflateSync(raw);
  return Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", idatData), pngChunk("IEND", Buffer.alloc(0))]);
}

export function writePlaceholder(path: string, r: number, g: number, b: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png1x1(r, g, b));
}

export function generatePlaceholderAssets(outDir: string): void {
  writePlaceholder(join(outDir, "bg", "black.webp"), 0, 0, 0);
  writePlaceholder(join(outDir, "bg", "white.webp"), 255, 255, 255);
  writePlaceholder(join(outDir, "image", "placeholder.webp"), 255, 0, 0);
  writePlaceholder(join(outDir, "rule", "rule.png"), 128, 128, 128);
  // Cadre de la fenêtre de message par défaut (#182) : sans lui, le player retombe sur l'ancienne boîte.
  writePlaceholder(join(outDir, "image", "txtwindow02.webp"), 0, 0, 0);

  // Copie le manifest et le scénario depuis public/assets (non versionnés par le test).
  const publicAssets = join(__dirname, "..", "..", "public", "assets");
  const copy = (srcRel: string, dstRel: string) => {
    const src = join(publicAssets, srcRel);
    const dst = join(outDir, dstRel);
    if (existsSync(src)) {
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
    }
  };
  copy("asset-manifest.json", "asset-manifest.json");
  copy("scenario/1-0.ks", "scenario/1-0.ks");
}
