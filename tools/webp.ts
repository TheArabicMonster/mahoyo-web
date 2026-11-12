/**
 * Encodage WebP du pipeline (#374, PERF-08).
 *
 * Par défaut **sans perte** (PNG→WebP) ; l'option avec perte est réservée aux catégories
 * `bg`/`ev`, à qualité ≥ 90, avec `sharp_yuv` (cwebp) / équivalent 4:4:4 (sharp), et garde-fou
 * SSIM ≥ 0,99 contre le PNG. Sans encodeur disponible, l'appelant garde le PNG (repli).
 */
import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type WebpEncoderKind = "sharp" | "cwebp";
export type WebpOptions = { lossless: boolean; quality: number };

export type WebpTooling = {
  encoder: WebpEncoderKind | null;
  /** ffmpeg permet de mesurer le SSIM des conversions avec perte. */
  ssim: boolean;
};

/** Détecte sharp (import optionnel), sinon cwebp ; ffmpeg pour le garde-fou SSIM. */
export async function detectWebpTooling(): Promise<WebpTooling> {
  let encoder: WebpEncoderKind | null = null;
  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    require("sharp");
    encoder = "sharp";
  } catch {
    try {
      await execFileAsync("cwebp", ["-version"]);
      encoder = "cwebp";
    } catch {
      encoder = null;
    }
  }
  let ssim = false;
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    ssim = true;
  } catch {
    ssim = false;
  }
  return { encoder, ssim };
}

async function sharpEncode(input: string | Buffer, outputPath: string, options: WebpOptions): Promise<void> {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const sharp = require("sharp");
  await sharp(input)
    .webp(
      options.lossless
        ? { lossless: true, effort: 6 }
        : // `sharp_yuv` n'existe pas dans sharp : 4:4:4 sans smartSubsample conserve les contours.
          { quality: Math.max(90, options.quality), effort: 6, chromaSubsampling: "4:4:4", smartSubsample: false },
    )
    .toFile(outputPath);
}

async function cwebpEncode(inputPath: string, outputPath: string, options: WebpOptions): Promise<void> {
  const args = options.lossless
    ? ["-lossless", "-z", "6", inputPath, "-o", outputPath]
    : ["-q", String(Math.max(90, options.quality)), "-sharp_yuv", "-m", "6", inputPath, "-o", outputPath];
  await execFileAsync("cwebp", args);
}

/** Encode un PNG (chemin ou buffer) en WebP. */
export async function encodePngToWebp(
  input: string | Buffer,
  outputPath: string,
  options: WebpOptions,
  encoder: WebpEncoderKind,
): Promise<void> {
  if (encoder === "sharp") return sharpEncode(input, outputPath, options);
  const dir = await mkdtemp(join(tmpdir(), "mahoyo-webp-"));
  const png = join(dir, "in.png");
  try {
    await writeFile(png, Buffer.isBuffer(input) ? input : await readFile(input));
    await cwebpEncode(png, outputPath, options);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Encode un TLG (décodé en PNG par le décodeur intégré) en WebP. */
export async function encodeTlgToWebp(
  sourcePath: string,
  outputPath: string,
  options: WebpOptions,
  encoder: WebpEncoderKind,
): Promise<void> {
  const { tlgToPng } = await import("./tlg-decode.js");
  const png = tlgToPng(await readFile(sourcePath));
  await encodePngToWebp(png, outputPath, options, encoder);
}

/** SSIM global WebP contre PNG via ffmpeg ; `null` si ffmpeg indisponible ou échec. */
export async function measureSsim(pngPath: string, webpPath: string): Promise<number | null> {
  let stderr = "";
  try {
    ({ stderr } = await execFileAsync("ffmpeg", [
      "-v",
      "info",
      "-i",
      webpPath,
      "-i",
      pngPath,
      "-lavfi",
      "ssim",
      "-f",
      "null",
      "-",
    ]));
  } catch (err) {
    // ffmpeg peut sortir en code non nul après avoir écrit le SSIM sur stderr.
    stderr = (err as { stderr?: string }).stderr ?? "";
  }
  return Number.parseFloat(stderr.match(/All:([0-9.]+)/)?.[1] ?? "") || null;
}
