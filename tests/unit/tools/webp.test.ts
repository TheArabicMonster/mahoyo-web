/** Encodage WebP du pipeline (#374) : sans perte par défaut, garde-fou SSIM. */
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { encodePng } from "../../../tools/tlg-decode.js";
import { detectWebpTooling, encodePngToWebp, measureSsim, type WebpTooling } from "../../../tools/webp.js";

let tooling: WebpTooling;
let dir: string;
let png: string;

beforeAll(async () => {
  tooling = await detectWebpTooling();
  dir = await mkdtemp(join(tmpdir(), "mahoyo-webp-test-"));
  png = join(dir, "src.png");
  // 8×8 RGBA synthétique (aucun asset du jeu).
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < 8 * 8; i++) {
    rgba[i * 4] = (i * 31) % 256;
    rgba[i * 4 + 1] = (i * 17) % 256;
    rgba[i * 4 + 2] = (i * 7) % 256;
    rgba[i * 4 + 3] = 255;
  }
  await writeFile(png, encodePng(8, 8, rgba));
});

describe("webp (#374)", () => {
  it("encode sans perte avec l'encodeur détecté (sinon skipped)", async () => {
    if (!tooling.encoder) return;
    const out = join(dir, "lossless.webp");
    await encodePngToWebp(png, out, { lossless: true, quality: 90 }, tooling.encoder);
    const buffer = await readFile(out);
    expect(buffer.subarray(0, 4).toString()).toBe("RIFF");
    expect(buffer.length).toBeGreaterThan(10);
    if (tooling.ssim) {
      const ssim = await measureSsim(png, out);
      expect(ssim).toBeGreaterThanOrEqual(0.99);
    }
    await rm(out, { force: true });
  });

  it("mesure le SSIM par ffmpeg quand disponible", async () => {
    if (!tooling.encoder || !tooling.ssim) return;
    const out = join(dir, "lossy.webp");
    await encodePngToWebp(png, out, { lossless: false, quality: 95 }, tooling.encoder);
    const ssim = await measureSsim(png, out);
    // ffmpeg peut refuser une image 8×8 selon la version : `null` déclenche le repli sans perte
    // du pipeline (garde-fou), on ne force pas une valeur ici.
    if (ssim !== null) expect(ssim).toBeGreaterThan(0.9);
    await rm(out, { force: true });
  });
});
