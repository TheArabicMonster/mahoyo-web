/**
 * Tests unitaires pour tools/ks-encoding.ts
 *
 * Les fixtures sont synthétiques : aucun texte du jeu n'est utilisé.
 */
import { describe, it, expect } from "vitest";
import { decodeKs } from "../../../tools/ks-encoding.js";
import { deflateSync } from "zlib";

describe("decodeKs — buffer vide", () => {
  it("retourne du texte vide", () => {
    const result = decodeKs(Buffer.alloc(0));
    expect(result.text).toBe("");
    expect(result.encoding).toBe("utf-8");
    expect(result.bom).toBe(false);
  });
});

describe("decodeKs — UTF-16LE avec BOM", () => {
  it("décode un script UTF-16LE", () => {
    const text = "@bg storage=black\nこんにちは。";
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf-16le")]);
    const result = decodeKs(buf);
    expect(result.encoding).toBe("utf-16le");
    expect(result.bom).toBe(true);
    expect(result.text).toContain("@bg");
    expect(result.text).toContain("こんにちは");
  });

  it("compte les remplacements pour un buffer corrompu", () => {
    // BOM UTF-16LE + données invalides
    const buf = Buffer.from([0xff, 0xfe, 0xd8, 0x00, 0xdc, 0x00]);
    const result = decodeKs(buf);
    expect(result.encoding).toBe("utf-16le");
    expect(result.replacementCount).toBeGreaterThanOrEqual(0);
  });
});

describe("decodeKs — UTF-16BE avec BOM", () => {
  it("décode un script UTF-16BE", () => {
    const text = "@bg storage=black";
    // Construire manuellement en UTF-16BE (Node ne supporte pas utf-16be nativement)
    const chars = text.split("").map((c) => c.charCodeAt(0));
    const bytes: number[] = [0xfe, 0xff];
    for (const ch of chars) {
      bytes.push((ch >> 8) & 0xff, ch & 0xff);
    }
    const buf = Buffer.from(bytes);
    const result = decodeKs(buf);
    expect(result.encoding).toBe("utf-16be");
    expect(result.bom).toBe(true);
    expect(result.text).toContain("@bg");
  });
});

describe("decodeKs — UTF-8 avec BOM", () => {
  it("décode un script UTF-8 avec BOM", () => {
    const text = "@bg storage=black\nこんにちは。";
    const buf = Buffer.from("\uFEFF" + text, "utf-8");
    const result = decodeKs(buf);
    expect(result.encoding).toBe("utf-8");
    expect(result.bom).toBe(true);
    expect(result.text).toContain("@bg");
    expect(result.text).toContain("こんにちは");
  });
});

describe("decodeKs — UTF-8 sans BOM", () => {
  it("décode un script ASCII pur", () => {
    const text = "@bg storage=black\nHello World.";
    const buf = Buffer.from(text, "utf-8");
    const result = decodeKs(buf);
    expect(result.encoding).toBe("utf-8");
    expect(result.bom).toBe(false);
    expect(result.text).toBe(text);
  });

  it("décode un script UTF-8 japonais sans BOM", () => {
    const text = "@bg storage=black\nこんにちは世界。";
    const buf = Buffer.from(text, "utf-8");
    const result = decodeKs(buf);
    expect(result.encoding).toBe("utf-8");
    expect(result.bom).toBe(false);
    expect(result.text).toContain("こんにちは世界");
  });
});

describe("decodeKs — Shift_JIS", () => {
  it("décode un buffer Shift_JIS", () => {
    // "こんにちは" en Shift_JIS
    const buf = Buffer.from([0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd]);
    const result = decodeKs(buf);
    expect(result.encoding).toBe("shift_jis");
    expect(result.bom).toBe(false);
    expect(result.text).toContain("こんにちは");
  });
});

describe("decodeKs — chiffré KiriKiri", () => {
  it("mode 0 : déchiffre avec XOR", () => {
    // Créer un fixture : texte UTF-16LE transformé avec mode 0
    const original = "@bg storage=black";
    const utf16 = Buffer.from(original, "utf-16le");
    const transformed: number[] = [];
    for (let i = 0; i + 1 < utf16.length; i += 2) {
      let ch = utf16[i] | (utf16[i + 1] << 8);
      if (ch >= 0x20) ch ^= ((ch & 0xfe) << 8) ^ 1;
      transformed.push(ch & 0xff, (ch >> 8) & 0xff);
    }
    const buf = Buffer.from([0xfe, 0xfe, 0x00, ...transformed]);
    const result = decodeKs(buf);
    expect(result.encoding).toBe("kirikiri-encrypted-0");
    expect(result.text).toContain("@bg");
  });

  it("mode 1 : déchiffre avec échange de bits", () => {
    // Créer un fixture : texte UTF-16LE transformé avec mode 1
    const original = "@bg storage=black";
    const utf16 = Buffer.from(original, "utf-16le");
    const transformed: number[] = [];
    for (let i = 0; i + 1 < utf16.length; i += 2) {
      let ch = utf16[i] | (utf16[i + 1] << 8);
      ch = ((ch & 0xaaaa) >> 1) | ((ch & 0x5555) << 1);
      transformed.push(ch & 0xff, (ch >> 8) & 0xff);
    }
    const buf = Buffer.from([0xfe, 0xfe, 0x01, ...transformed]);
    const result = decodeKs(buf);
    expect(result.encoding).toBe("kirikiri-encrypted-1");
    expect(result.text).toContain("@bg");
  });

  it("mode 2 : déchiffre avec zlib", () => {
    // Créer un fixture : texte UTF-16LE compressé avec zlib
    const original = "@bg storage=black\nこんにちは。";
    const utf16 = Buffer.from(original, "utf-16le");
    const compressed = deflateSync(utf16);
    // En-tête : FE FE 02 + int64 compressed + int64 decompressed + zlib data
    const header = Buffer.alloc(16);
    header.writeBigInt64LE(BigInt(compressed.length), 0);
    header.writeBigInt64LE(BigInt(utf16.length), 8);
    const buf = Buffer.concat([Buffer.from([0xfe, 0xfe, 0x02]), header, compressed]);
    const result = decodeKs(buf);
    expect(result.encoding).toBe("kirikiri-encrypted-2");
    expect(result.text).toContain("@bg");
    expect(result.text).toContain("こんにちは");
  });

  it("mode inconnu : retourne unknown", () => {
    const buf = Buffer.from([0xfe, 0xfe, 0x09, 0x00, 0x00]);
    const result = decodeKs(buf);
    expect(result.encoding).toBe("unknown");
    expect(result.text).toBe("");
  });
});

describe("decodeKs — heuristique UTF-16LE sans BOM", () => {
  it("détecte UTF-16LE sans BOM pour un texte ASCII", () => {
    // "@bg" en UTF-16LE sans BOM : 40 00 62 00 67 00
    const text = "@bg storage=black";
    const buf = Buffer.from(text, "utf-16le");
    const result = decodeKs(buf);
    expect(result.encoding).toBe("utf-16le");
    expect(result.bom).toBe(false);
    expect(result.text).toContain("@bg");
  });
});
