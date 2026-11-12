/**
 * Utilitaires partagés par les outils du pipeline d'assets.
 */
import { createReadStream, createWriteStream, mkdirSync, readdirSync, statSync } from "fs";
import { copyFile, mkdir, stat } from "fs/promises";
import { dirname, extname, join, relative, resolve } from "path";

export type AssetKind = "bg" | "image" | "rule" | "bgm" | "se" | "scenario" | "other";

export type PipelineContext = {
  inputDir: string;
  outputDir: string;
  /** true = mode sec, aucune écriture. */
  dryRun: boolean;
  /** Extérieur : convertisseur TLG à utiliser. */
  tlgConverter?: string;
  /** Extérieur : extracteur XP3 à utiliser. */
  xp3Extractor?: string;
  /** Extérieur : encodeur audio (ffmpeg, etc.). */
  audioEncoder?: string;
  /** Format des WAV convertis en interne (#387) : `opus` (défaut) ou `aac` (repli Safari). */
  audioFormat?: "opus" | "aac";
};

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export async function ensureDirAsync(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export async function isFileAsync(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function listFiles(root: string, predicate?: (path: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (!predicate || predicate(path)) out.push(path);
    }
  };
  walk(root);
  return out;
}

export function assetKindFromPath(path: string): AssetKind {
  const ext = extname(path).toLowerCase();
  const lower = path.toLowerCase();
  if (ext === ".ks") return "scenario";
  if (lower.includes("/bg/") || lower.includes("/background/")) return "bg";
  if (lower.includes("/rule/")) return "rule";
  if (lower.includes("/bgm/") || lower.includes("/music/")) return "bgm";
  if (lower.includes("/se/") || lower.includes("/sound/")) return "se";
  if (ext === ".tlg" || ext === ".png" || ext === ".jpg" || ext === ".jpeg") return "image";
  return "other";
}

export function outputPathFor(inputRoot: string, outputRoot: string, inputPath: string, newExt?: string): string {
  const rel = relative(resolve(inputRoot), resolve(inputPath));
  const out = join(resolve(outputRoot), rel);
  return newExt ? `${out.slice(0, Math.max(0, out.lastIndexOf("."))) || out}${newExt}` : out;
}

export async function copyAsset(inputPath: string, outputPath: string, context: PipelineContext): Promise<void> {
  if (context.dryRun) return;
  await ensureDirAsync(dirname(outputPath));
  await copyFile(inputPath, outputPath);
}

export { createReadStream, createWriteStream, dirname, extname, join, relative, resolve };
