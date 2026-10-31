/**
 * Tests du décodeur TLG (TLG0.0 / TLG5) et de l'écriture PNG.
 *
 * Aucun asset du jeu : les fichiers TLG5 sont fabriqués ici par un petit encodeur
 * (filtre inverse du décodeur + LZSS gourmand), sur des images inventées.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { crc32, inflateSync } from "zlib";
import {
  decodeTlg,
  encodePng,
  isTlg,
  lzssDecompress,
  tlgToPng,
  TlgFormatError,
  TlgUnsupportedError,
} from "../../../tools/tlg-decode.js";
import { convertTlg, convertTlgFile } from "../../../tools/convert-tlg.js";
import { executeTask } from "../../../tools/task-executor.js";
import type { Task } from "../../../tools/plan.js";
import type { InventoryEntry } from "../../../tools/inventory.js";

// ── Encodeur de test ──

const TLG5_MAGIC = Buffer.from("TLG5.0\0raw\x1a", "latin1");
const SDS_MAGIC = Buffer.from("TLG0.0\0sds\x1a", "latin1");

/** LZSS gourmand : réutilise les 16 dernières positions de la fenêtre (assez pour tester). */
function lzssCompress(data: Uint8Array, window: Uint8Array, startR: number): { bytes: Buffer; r: number } {
  const out: number[] = [];
  let r = startR;
  let pos = 0;
  let group: number[] = [];
  let flags = 0;
  let bit = 0;

  const flush = () => {
    if (bit === 0) return;
    out.push(flags, ...group);
    group = [];
    flags = 0;
    bit = 0;
  };
  const push = (isMatch: boolean, bytes: number[]) => {
    if (isMatch) flags |= 1 << bit;
    group.push(...bytes);
    if (++bit === 8) flush();
  };

  while (pos < data.length) {
    let bestLen = 0;
    let bestPos = 0;
    for (let d = 1; d <= 16; d++) {
      const mpos = (r - d + 4096) & 4095;
      let len = 0;
      while (len < 18 + 255 && pos + len < data.length) {
        const expected = len < d ? window[(mpos + len) & 4095] : data[pos + len - d];
        if (expected !== data[pos + len]) break;
        len++;
      }
      if (len > bestLen) {
        bestLen = len;
        bestPos = mpos;
      }
    }
    if (bestLen >= 3) {
      const bytes =
        bestLen >= 18
          ? [bestPos & 0xff, ((bestPos >> 8) & 0x0f) | (15 << 4), bestLen - 18]
          : [bestPos & 0xff, ((bestPos >> 8) & 0x0f) | ((bestLen - 3) << 4)];
      push(true, bytes);
      for (let i = 0; i < bestLen; i++) {
        window[r] = data[pos + i];
        r = (r + 1) & 4095;
      }
      pos += bestLen;
    } else {
      push(false, [data[pos]]);
      window[r] = data[pos];
      r = (r + 1) & 4095;
      pos++;
    }
  }
  flush();
  return { bytes: Buffer.from(out), r };
}

type EncodeOptions = {
  blockHeight: number;
  /** Indices (de bande × composante) à stocker sans compression (mark = 1). */
  rawBlocks?: Set<string>;
};

/** Encode des pixels RGBA en TLG5 (3 composantes si `channels` vaut 3, alpha ignoré). */
function encodeTlg5(
  width: number,
  height: number,
  rgba: Uint8Array,
  channels: 3 | 4,
  opts: EncodeOptions,
): Buffer {
  const window = new Uint8Array(4096);
  let r = 0;
  const blocks: Buffer[] = [];

  for (let by = 0, bi = 0; by < height; by += opts.blockHeight, bi++) {
    const rows = Math.min(opts.blockHeight, height - by);
    const comps = Array.from({ length: channels }, () => new Uint8Array(rows * width));
    for (let y = 0; y < rows; y++) {
      let prevB = 0, prevG = 0, prevR = 0, prevA = 0;
      for (let x = 0; x < width; x++) {
        const cur = ((by + y) * width + x) * 4;
        const up = (by + y - 1) * width * 4 + x * 4;
        const px = (o: number) => (by + y === 0 ? 0 : rgba[up + o]);
        // Différence verticale (BGRA), puis horizontale, puis décorrélation autour de G.
        const dB = (rgba[cur + 2] - px(2)) & 0xff;
        const dG = (rgba[cur + 1] - px(1)) & 0xff;
        const dR = (rgba[cur] - px(0)) & 0xff;
        const dA = channels === 4 ? (rgba[cur + 3] - px(3)) & 0xff : 0;
        const eB = (dB - prevB) & 0xff;
        const eG = (dG - prevG) & 0xff;
        const eR = (dR - prevR) & 0xff;
        const eA = (dA - prevA) & 0xff;
        prevB = dB; prevG = dG; prevR = dR; prevA = dA;
        const i = y * width + x;
        comps[0][i] = (eB - eG) & 0xff;
        comps[1][i] = eG;
        comps[2][i] = (eR - eG) & 0xff;
        if (channels === 4) comps[3][i] = eA;
      }
    }
    const parts: Buffer[] = [];
    comps.forEach((comp, c) => {
      let header: Buffer;
      let payload: Buffer;
      if (opts.rawBlocks?.has(`${bi}:${c}`)) {
        header = Buffer.from([1]);
        payload = Buffer.from(comp);
      } else {
        const res = lzssCompress(comp, window, r);
        r = res.r;
        header = Buffer.from([0]);
        payload = res.bytes;
      }
      const size = Buffer.alloc(4);
      size.writeUInt32LE(payload.length);
      parts.push(header, size, payload);
    });
    blocks.push(Buffer.concat(parts));
  }

  const head = Buffer.alloc(13);
  head[0] = channels;
  head.writeUInt32LE(width, 1);
  head.writeUInt32LE(height, 5);
  head.writeUInt32LE(opts.blockHeight, 9);
  const sizes = Buffer.alloc(blocks.length * 4);
  blocks.forEach((b, i) => sizes.writeUInt32LE(b.length, i * 4));
  return Buffer.concat([TLG5_MAGIC, head, sizes, ...blocks]);
}

/** Enveloppe un TLG interne dans un conteneur TLG0.0 « sds » suivi d'un tag. */
function wrapSds(inner: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(inner.length);
  return Buffer.concat([SDS_MAGIC, size, inner, Buffer.from("name=4:test,", "latin1")]);
}

/** Image inventée : dégradés + aplat répété (donne des références LZSS). */
function makeImage(width: number, height: number, withAlpha: boolean): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const flat = x >= width / 2 && y >= height / 2;
      rgba[o] = flat ? 200 : (x * 37 + y * 11) & 0xff;
      rgba[o + 1] = flat ? 30 : (x * 5 + y * 71) & 0xff;
      rgba[o + 2] = flat ? 90 : (x * 13 + y * 3 + 128) & 0xff;
      rgba[o + 3] = withAlpha ? (flat ? 255 : (x * 29 + y * 17) & 0xff) : 255;
    }
  }
  return rgba;
}

// ── Tests ──

describe("lzssDecompress", () => {
  it("décode des littéraux puis une référence vers la fenêtre", () => {
    // flags = 0b00001000 : 3 littéraux (A B C), puis référence mpos=0 len=3.
    const input = Uint8Array.from([0b00001000, 0x41, 0x42, 0x43, 0x00, 0x00]);
    const out = new Uint8Array(6);
    const r = lzssDecompress(input, out, new Uint8Array(4096), 0);
    expect(Buffer.from(out).toString("latin1")).toBe("ABCABC");
    expect(r).toBe(6);
  });

  it("gère les copies qui se chevauchent (motif répété)", () => {
    // Littéral X, puis référence mpos=0 len=5 : lit la fenêtre au fur et à mesure.
    const input = Uint8Array.from([0b00000010, 0x58, 0x00, 0x20]);
    const out = new Uint8Array(6);
    lzssDecompress(input, out, new Uint8Array(4096), 0);
    expect(Buffer.from(out).toString("latin1")).toBe("XXXXXX");
  });

  it("lit une fenêtre initialement à zéro et la longueur étendue (18 + octet)", () => {
    // Référence mpos=100 len=18+2=20 : 20 zéros de la fenêtre vierge.
    const input = Uint8Array.from([0b00000001, 100, 0xf0, 2]);
    const out = new Uint8Array(20).fill(9);
    lzssDecompress(input, out, new Uint8Array(4096), 0);
    expect(Array.from(out)).toEqual(new Array(20).fill(0));
  });

  it("rejette un flux qui ne remplit pas exactement le tampon", () => {
    const input = Uint8Array.from([0x00, 0x41]);
    expect(() => lzssDecompress(input, new Uint8Array(3), new Uint8Array(4096), 0)).toThrow(TlgFormatError);
    expect(() => lzssDecompress(input, new Uint8Array(0), new Uint8Array(4096), 0)).toThrow(TlgFormatError);
  });
});

describe("encodeur de test", () => {
  it("produit de vraies références LZSS (sinon les tests d'aller-retour ne prouveraient rien)", () => {
    const data = new Uint8Array(300).fill(7);
    const { bytes } = lzssCompress(data, new Uint8Array(4096), 0);
    expect(bytes.length).toBeLessThan(30);
    const out = new Uint8Array(300);
    lzssDecompress(bytes, out, new Uint8Array(4096), 0);
    expect(Array.from(out)).toEqual(Array.from(data));
  });
});

describe("decodeTlg (TLG5)", () => {
  it("restitue exactement une image RGB (bandes de 4 lignes, dernière bande partielle)", () => {
    const rgba = makeImage(9, 10, false);
    const img = decodeTlg(encodeTlg5(9, 10, rgba, 3, { blockHeight: 4 }));
    expect(img.width).toBe(9);
    expect(img.height).toBe(10);
    expect(img.channels).toBe(3);
    expect(Array.from(img.rgba)).toEqual(Array.from(rgba));
  });

  it("restitue exactement une image RGBA avec canal alpha", () => {
    const rgba = makeImage(16, 7, true);
    const img = decodeTlg(encodeTlg5(16, 7, rgba, 4, { blockHeight: 3 }));
    expect(img.channels).toBe(4);
    expect(Array.from(img.rgba)).toEqual(Array.from(rgba));
  });

  it("garde l'état de la fenêtre LZSS d'une bande à l'autre", () => {
    // Beaucoup de bandes d'une ligne : les références traversent les bandes.
    const rgba = makeImage(24, 12, true);
    const img = decodeTlg(encodeTlg5(24, 12, rgba, 4, { blockHeight: 1 }));
    expect(Array.from(img.rgba)).toEqual(Array.from(rgba));
  });

  it("accepte des composantes stockées sans compression (mark = 1)", () => {
    const rgba = makeImage(8, 8, false);
    const raw = new Set(["0:0", "1:2"]);
    const img = decodeTlg(encodeTlg5(8, 8, rgba, 3, { blockHeight: 4, rawBlocks: raw }));
    expect(Array.from(img.rgba)).toEqual(Array.from(rgba));
  });

  it("décode une image d'un seul pixel", () => {
    const rgba = Uint8Array.from([12, 34, 56, 255]);
    const img = decodeTlg(encodeTlg5(1, 1, rgba, 3, { blockHeight: 1 }));
    expect(Array.from(img.rgba)).toEqual([12, 34, 56, 255]);
  });
});

describe("decodeTlg (conteneur TLG0.0)", () => {
  it("déballe le TLG5 interne et ignore les tags", () => {
    const rgba = makeImage(10, 6, true);
    const inner = encodeTlg5(10, 6, rgba, 4, { blockHeight: 2 });
    const wrapped = wrapSds(inner);
    expect(isTlg(wrapped)).toBe(true);
    const img = decodeTlg(wrapped);
    expect(Array.from(img.rgba)).toEqual(Array.from(rgba));
  });

  it("signale un TLG6 comme non pris en charge", () => {
    const tlg6 = Buffer.concat([Buffer.from("TLG6.0\0raw\x1a", "latin1"), Buffer.alloc(32)]);
    expect(() => decodeTlg(tlg6)).toThrow(TlgUnsupportedError);
    expect(() => decodeTlg(wrapSds(tlg6))).toThrow(TlgUnsupportedError);
  });

  it("rejette un fichier qui n'est pas un TLG et les fichiers tronqués", () => {
    expect(isTlg(Buffer.from("UMF4/1\x01garbage-garbage", "latin1"))).toBe(false);
    expect(() => decodeTlg(Buffer.from("UMF4/1\x01garbage-garbage", "latin1"))).toThrow(TlgFormatError);
    const full = encodeTlg5(8, 8, makeImage(8, 8, false), 3, { blockHeight: 4 });
    expect(() => decodeTlg(full.subarray(0, 20))).toThrow(TlgFormatError);
    expect(() => decodeTlg(full.subarray(0, full.length - 3))).toThrow(TlgFormatError);
    expect(() => decodeTlg(wrapSds(full).subarray(0, 18))).toThrow(TlgFormatError);
  });
});

describe("encodePng", () => {
  it("produit un PNG RGBA valide (signature, CRC, pixels)", () => {
    const rgba = makeImage(5, 3, true);
    const png = encodePng(5, 3, rgba);
    expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);

    // Parcours des chunks : les CRC doivent correspondre.
    const idat: Buffer[] = [];
    let p = 8;
    const types: string[] = [];
    while (p < png.length) {
      const len = png.readUInt32BE(p);
      const type = png.toString("latin1", p + 4, p + 8);
      const data = png.subarray(p + 8, p + 8 + len);
      expect(png.readUInt32BE(p + 8 + len)).toBe(crc32(png.subarray(p + 4, p + 8 + len)));
      if (type === "IHDR") {
        expect(data.readUInt32BE(0)).toBe(5);
        expect(data.readUInt32BE(4)).toBe(3);
        expect(data[8]).toBe(8);
        expect(data[9]).toBe(6);
      }
      if (type === "IDAT") idat.push(data);
      types.push(type);
      p += 12 + len;
    }
    expect(types).toEqual(["IHDR", "IDAT", "IEND"]);

    const raw = inflateSync(Buffer.concat(idat));
    expect(raw.length).toBe((5 * 4 + 1) * 3);
    for (let y = 0; y < 3; y++) {
      expect(raw[y * 21]).toBe(0);
      expect(Array.from(raw.subarray(y * 21 + 1, y * 21 + 21))).toEqual(Array.from(rgba.subarray(y * 20, y * 20 + 20)));
    }
  });

  it("refuse un tampon de taille incohérente", () => {
    expect(() => encodePng(2, 2, new Uint8Array(3))).toThrow();
  });
});

describe("conversion de fichiers et pipeline", () => {
  const dir = mkdtempSync(join(tmpdir(), "mahoyo-tlg-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const rgba = makeImage(12, 9, true);
  const tlg = wrapSds(encodeTlg5(12, 9, rgba, 4, { blockHeight: 4 }));

  it("convertTlgFile écrit un PNG sans fichier temporaire résiduel", async () => {
    const src = join(dir, "sprite(全).tlg");
    const out = join(dir, "sortie", "sprite(全).png");
    writeFileSync(src, tlg);
    await convertTlgFile(src, out);
    expect(readFileSync(out).equals(tlgToPng(tlg))).toBe(true);
    expect(existsSync(`${out}.tmp`)).toBe(false);
  });

  it("convertTlg sans convertisseur utilise le décodeur intégré et compte les échecs", async () => {
    const inDir = join(dir, "in");
    const outDir = join(dir, "out");
    const { mkdirSync } = await import("fs");
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "ok.tlg"), tlg);
    writeFileSync(join(inDir, "chiffre.tlg"), Buffer.from("UMF4/1\x01garbage-garbage", "latin1"));
    const res = await convertTlg({ inputDir: inDir, outputDir: outDir });
    expect(res.tlgs).toHaveLength(2);
    expect(res.converted).toBe(1);
    expect(res.failed).toBe(1);
    expect(existsSync(join(outDir, "ok.png"))).toBe(true);
  });

  const makeTask = (source: string, outputPath: string, commandTemplate?: string): Task => {
    const entry: InventoryEntry = {
      source,
      relPath: "fg/sprite.tlg",
      kind: "image",
      ext: ".tlg",
      key: "sprite",
      webPath: "image/sprite.webp",
      webExt: ".webp",
    };
    return { entry, action: "convert-image", outputPath, outputExt: commandTemplate ? ".webp" : ".png", commandTemplate, internal: !commandTemplate };
  };

  it("executeTask décode un .tlg sans gabarit (sortie PNG)", async () => {
    const src = join(dir, "t1.tlg");
    const out = join(dir, "res", "t1.png");
    writeFileSync(src, tlg);
    const res = await executeTask(makeTask(src, out), false);
    expect(res.status).toBe("ok");
    expect(readFileSync(out).equals(tlgToPng(tlg))).toBe(true);
  });

  it("executeTask échoue proprement sur un TLG6 sans toucher à la sortie", async () => {
    const src = join(dir, "t6.tlg");
    const out = join(dir, "res", "t6.png");
    writeFileSync(src, Buffer.concat([Buffer.from("TLG6.0\0raw\x1a", "latin1"), Buffer.alloc(32)]));
    const res = await executeTask(makeTask(src, out), false);
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/TLG6/);
    expect(existsSync(out)).toBe(false);
  });

  it("executeTask garde le mode --tlg-cmd : l'outil externe prime sur le décodeur intégré", async () => {
    const src = join(dir, "t2.tlg");
    const out = join(dir, "res", "t2.webp");
    writeFileSync(src, tlg);
    const res = await executeTask(makeTask(src, out, "cp {in} {out}"), false);
    expect(res.status).toBe("ok");
    // cp recopie l'entrée telle quelle : ce n'est pas un PNG.
    expect(readFileSync(out).equals(tlg)).toBe(true);
  });
});
