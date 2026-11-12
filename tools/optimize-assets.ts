/**
 * Optimisation des assets **déjà installés**, en place (#393, plan v2 §B3).
 *
 * `npm run assets:optimize` : sans ré-extraction ni relance du pipeline, convertit les WAV des SE
 * en Opus/Ogg (#387) et les PNG de `bg/` + `image/` en WebP (#374), met à jour le manifeste
 * (URLs = extensions réelles, `assetsVersion` recalculée), régénère `image-dimensions.json` et
 * affiche un rapport de poids avant/après par catégorie.
 *
 * Règles :
 * - **BGM `.ogg` non réencodées** ; `.wav` → Opus (`convertAudioFile`, durée vérifiée ±20 ms,
 *   écriture atomique) ; suppression des originaux sauf `--keep-originals` ;
 * - WebP **sans perte** pour `bg/` et `image/` ; `--webp-lossy` (q90 + garde-fou SSIM ≥ 0,99)
 *   pour `bg/` et les `image/ev*` seulement ; `rule/`, `lang/`, `scenario/` jamais touchés ;
 * - refuse un dossier qui n'est pas une installation d'assets (manifeste absent) sans `--force`,
 *   et un dossier d'un dépôt git non ignoré (jamais commiter d'assets) sans `--force` ;
 * - ne commit rien : les assets convertis restent ignorés par git (`public/assets/`).
 */
import { execFile, execFileSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "fs";
import { basename, join, resolve } from "path";
import { promisify } from "util";
import { fileURLToPath } from "url";
import type { AssetManifest } from "../src/core/asset-manifest.js";
import { convertAudioFile, DURATION_TOLERANCE_MS } from "./convert-audio.js";
import { generateImageDimensions } from "./image-dimensions.js";
import { writeManifest } from "./manifest.js";
import {
  detectWebpTooling,
  encodePngToWebp,
  measureSsim,
  type WebpEncoderKind,
} from "./webp.js";

export type OptimizeAssetsOptions = {
  /** Dossier des assets installés (contient `asset-manifest.json`). */
  assetsDir: string;
  /** Conserve les fichiers d'origine (`.wav`, `.png`) au lieu de les supprimer. */
  keepOriginals?: boolean;
  /** Désactive la conversion audio (WAV intacts). */
  noAudio?: boolean;
  /** Désactive la conversion WebP (PNG intacts). */
  noWebp?: boolean;
  /** WebP avec perte q90 + SSIM ≥ 0,99 pour `bg/` et `image/ev*` uniquement. */
  webpLossy?: boolean;
  /** Autorise un dossier sans manifeste ou non ignoré par git (risque de commit). */
  force?: boolean;
  /** Simule sans écrire. */
  dryRun?: boolean;
  /** Répare un manifeste incohérent (URL `.wav`/`.png` absente → extension alternative présente). */
  repair?: boolean;
  /** Vérifie la cohérence manifeste/fichiers et échoue (code 1) si des entrées manquent. */
  check?: boolean;
  /** Réécrit le manifeste tous les N conversions (crash-safety, défaut 25 ; 0 = à la fin seulement). */
  manifestFlushEvery?: number;
  /** Hook de progression (tests/flush) appelé après chaque conversion réussie. */
  onConverted?: () => void;
  /** Vérification d'identité pixel pour le mode sans perte (injectable pour les tests). */
  pixelIdentityCheck?: (pngPath: string, webpPath: string) => Promise<boolean | null>;
};

/** Réparations appliquées par `--repair`. */
export type RepairReport = {
  images: number;
  audio: number;
  details: string[];
};

/** Résultat du mode `--check`. */
export type CheckReport = {
  ok: boolean;
  missing: string[];
};

export type CategoryStats = {
  files: number;
  beforeBytes: number;
  afterBytes: number;
};

export type OptimizeReport = {
  assetsDir: string;
  dryRun: boolean;
  audio: CategoryStats & { warnings: number; kept: number };
  webp: CategoryStats & { lossless: number; lossy: number; kept: number; encoder: WebpEncoderKind | null };
  json: { manifestBeforeBytes: number; manifestAfterBytes: number; dimensionsBeforeBytes: number; dimensionsAfterBytes: number };
  /** Poids avant/après par catégorie (audio, bg, image, rule, json, autres). */
  categories: Record<string, CategoryStats>;
  totalBeforeBytes: number;
  totalAfterBytes: number;
  assetsVersion?: string;
  warnings: string[];
  /** Renseigné en mode `--repair`. */
  repairs?: RepairReport;
  /** Renseigné en mode `--check`. */
  check?: CheckReport;
};

/** Taille d'un fichier en octets (0 si absent). */
function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** Le chemin est-il ignoré par git (dossier d'un dépôt) ? Hors dépôt → true. */
export function isGitIgnoredOrOutsideRepo(dir: string): boolean {
  let topLevel: string;
  let prefix: string;
  try {
    const options = { encoding: "utf-8" as const, stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"] };
    topLevel = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], options).trim();
    // `--show-prefix` donne le chemin relatif à la racine du dépôt (robuste aux symlinks /var → /private/var).
    prefix = execFileSync("git", ["-C", dir, "rev-parse", "--show-prefix"], options).trim() || ".";
  } catch {
    return true; // hors dépôt git : aucun risque de commit
  }
  try {
    execFileSync("git", ["-C", topLevel, "check-ignore", "-q", prefix], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Catégorie d'un asset d'après son URL relative (`bg/…`, `image/…`, `se/…`, …). */
export function categoryOf(url: string): string {
  const clean = url.replace(/^\/?assets\//, "");
  const prefix = clean.split("/")[0] ?? "";
  if (["bg", "image", "rule", "bgm", "se", "scenario", "lang"].includes(prefix)) return prefix;
  if (prefix.endsWith(".json")) return "json";
  return "autres";
}

function addSize(map: Record<string, CategoryStats>, category: string, before: number, after: number): void {
  const current = map[category] ?? { files: 0, beforeBytes: 0, afterBytes: 0 };
  current.files += 1;
  current.beforeBytes += before;
  current.afterBytes += after;
  map[category] = current;
}

function formatMo(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function gainPercent(before: number, after: number): number {
  return before > 0 ? Math.round((1 - after / before) * 100) : 0;
}

/** Vérifie que le dossier est une installation d'assets et qu'on peut écrire sans risque de commit. */
export function assertOptimizableAssetsDir(assetsDir: string, force: boolean): void {
  if (!existsSync(assetsDir) || !statSync(assetsDir).isDirectory()) {
    throw new Error(`Dossier d'assets introuvable : ${assetsDir}`);
  }
  const manifestPath = join(assetsDir, "asset-manifest.json");
  if (!existsSync(manifestPath) && !force) {
    throw new Error(
      `Pas un dossier d'assets installé (asset-manifest.json absent) : ${assetsDir}. ` +
        "Utiliser --force pour optimiser quand même (risqué).",
    );
  }
  if (!isGitIgnoredOrOutsideRepo(assetsDir) && !force) {
    throw new Error(
      `Le dossier ${assetsDir} n'est pas ignoré par git : optimiser en place supprimerait des fichiers ` +
        "suitis. Ajouter au .gitignore ou relancer avec --force (ne rien committer).",
    );
  }
}

const execFileAsync = promisify(execFile);

/** Extensions alternatives acceptées par `--repair` (URL absente → extension présente). */
export const ALTERNATIVE_EXTENSIONS: Record<string, readonly string[]> = {
  ".png": [".webp", ".jpg", ".jpeg"],
  ".webp": [".png"],
  ".wav": [".ogg"],
  ".ogg": [".wav"],
  ".jpg": [".webp", ".png"],
  ".jpeg": [".webp", ".png"],
};

/** Hash des pixels décodés d'une image (RGBA brut via ffmpeg) — comparaison d'identité. */
export async function decodedPixelHash(filePath: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    ["-v", "error", "-i", filePath, "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    { encoding: "buffer", maxBuffer: 512 * 1024 * 1024 },
  );
  return createHash("sha256").update(stdout).digest("hex");
}

/**
 * Identité pixel entre un PNG source et le WebP produit (#398) : même décodage RGBA via ffmpeg,
 * hash comparés. `null` si la vérification est impossible (ffmpeg absent, fichier illisible).
 */
export async function pixelsIdentical(pngPath: string, webpPath: string): Promise<boolean | null> {
  try {
    const [pngHash, webpHash] = await Promise.all([decodedPixelHash(pngPath), decodedPixelHash(webpPath)]);
    return pngHash === webpHash;
  } catch {
    return null;
  }
}

/** Chemin disque d'une URL de manifeste (`bg/x.webp`, `/assets/bg/x.webp`…). */
function fileForUrl(assetsDir: string, url: string): string {
  return join(assetsDir, url.replace(/^\/?assets\//, ""));
}

/**
 * Vérifie la cohérence d'une installation : chaque entrée du manifeste doit avoir son fichier.
 * Utilisé par `--check` et après `--repair`.
 */
export function checkAssetsInstallation(assetsDir: string, manifest: AssetManifest): CheckReport {
  const missing: string[] = [];
  for (const entry of Object.values(manifest.images ?? {})) {
    if (!existsSync(fileForUrl(assetsDir, entry.url))) missing.push(`image:${entry.url}`);
  }
  for (const entry of Object.values(manifest.audio ?? {})) {
    if (!existsSync(fileForUrl(assetsDir, entry.url))) missing.push(`audio:${entry.url}`);
  }
  for (const entry of Object.values(manifest.scenarios ?? {})) {
    if (!existsSync(fileForUrl(assetsDir, entry.url))) missing.push(`scenario:${entry.url}`);
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Répare un manifeste incohérent (#398) : pour chaque URL absente, bascule vers l'extension
 * alternative existante (`.png` → `.webp`, `.wav` → `.ogg`, etc.). Les entrées restantes
 * manquantes sont signalées (le mode `--check` échoue alors).
 */
export function repairManifest(assetsDir: string, manifest: AssetManifest): { report: RepairReport; remaining: CheckReport } {
  const report: RepairReport = { images: 0, audio: 0, details: [] };
  const repairEntries = (
    entries: Record<string, { url: string }>,
    kind: "image" | "audio",
  ): void => {
    for (const entry of Object.values(entries)) {
      if (existsSync(fileForUrl(assetsDir, entry.url))) continue;
      const extension = entry.url.slice(entry.url.lastIndexOf(".")).toLowerCase();
      const base = entry.url.slice(0, entry.url.lastIndexOf("."));
      const alternative = (ALTERNATIVE_EXTENSIONS[extension] ?? []).find((candidate) =>
        existsSync(fileForUrl(assetsDir, `${base}${candidate}`)),
      );
      if (!alternative) continue;
      const before = entry.url;
      entry.url = `${base}${alternative}`;
      report.details.push(`${kind}:${before} → ${entry.url}`);
      if (kind === "image") report.images += 1;
      else report.audio += 1;
    }
  };
  repairEntries(manifest.images ?? {}, "image");
  repairEntries(manifest.audio ?? {}, "audio");
  return { report, remaining: checkAssetsInstallation(assetsDir, manifest) };
}

/**
 * Convertit les WAV des SE en Opus/Ogg en place. Les originaux ne sont **pas** supprimés ici :
 * la suppression est différée après l'écriture finale du manifeste (crash-safety, #398).
 */
export async function optimizeAudioFiles(
  assetsDir: string,
  manifest: AssetManifest,
  options: Pick<OptimizeAssetsOptions, "keepOriginals" | "dryRun" | "onConverted">,
): Promise<{ stats: OptimizeReport["audio"]; warnings: string[]; pendingDeletes: string[] }> {
  const stats: OptimizeReport["audio"] = {
    files: 0,
    beforeBytes: 0,
    afterBytes: 0,
    warnings: 0,
    kept: 0,
  };
  const warnings: string[] = [];
  const pendingDeletes: string[] = [];
  const seDir = join(assetsDir, "se");
  if (!existsSync(seDir)) return { stats, warnings, pendingDeletes };

  const wavFiles = readdirSync(seDir).filter((file) => file.toLowerCase().endsWith(".wav"));
  for (const file of wavFiles) {
    const input = join(seDir, file);
    const output = join(seDir, `${file.slice(0, -".wav".length)}.ogg`);
    const before = sizeOf(input);
    const relativeUrl = `se/${basename(input)}`;
    const outputUrl = relativeUrl.replace(/\.wav$/i, ".ogg");
    const manifestEntry = Object.values(manifest.audio ?? {}).find(
      (entry) => entry.url === relativeUrl || entry.url === `/${relativeUrl}`,
    );
    if (options.dryRun) {
      stats.files += 1;
      continue;
    }
    let convertedOk = false;
    try {
      const result = await convertAudioFile(input, output, { format: "opus" });
      if (result.durationDeltaMs !== null && Math.abs(result.durationDeltaMs) > DURATION_TOLERANCE_MS) {
        stats.warnings += 1;
        warnings.push(`${relativeUrl} : écart de durée ${result.durationDeltaMs} ms (±${DURATION_TOLERANCE_MS} ms attendu)`);
      }
      if (manifestEntry) manifestEntry.url = outputUrl;
      if (options.keepOriginals) stats.kept += 1;
      else pendingDeletes.push(input);
      stats.files += 1;
      stats.beforeBytes += before;
      stats.afterBytes += sizeOf(output);
      convertedOk = true;
    } catch (err) {
      warnings.push(`${relativeUrl} : conversion échouée (${err instanceof Error ? err.message : String(err)})`);
    }
    // Hook hors du try/catch : une interruption (test/SIGINT) doit se propager, pas être avalée.
    if (convertedOk) options.onConverted?.();
  }
  return { stats, warnings, pendingDeletes };
}

/** Convertit les PNG convertibles en WebP (sans perte, ou avec perte bg/ev) en place. */
export async function optimizeImages(
  assetsDir: string,
  manifest: AssetManifest,
  options: Pick<
    OptimizeAssetsOptions,
    "keepOriginals" | "noWebp" | "webpLossy" | "dryRun" | "onConverted" | "pixelIdentityCheck"
  >,
): Promise<{
  stats: OptimizeReport["webp"];
  warnings: string[];
  categories: Record<string, CategoryStats>;
  pendingDeletes: string[];
}> {
  const stats: OptimizeReport["webp"] = {
    files: 0,
    beforeBytes: 0,
    afterBytes: 0,
    lossless: 0,
    lossy: 0,
    kept: 0,
    encoder: null,
  };
  const warnings: string[] = [];
  const categories: Record<string, CategoryStats> = {};
  const pendingDeletes: string[] = [];
  if (options.noWebp) return { stats, warnings, categories, pendingDeletes };
  const { encoder } = await detectWebpTooling();
  stats.encoder = encoder;
  if (!encoder) {
    warnings.push("Aucun encodeur WebP (sharp/cwebp) : PNG laissés tels quels.");
    return { stats, warnings, categories, pendingDeletes };
  }

  for (const [key, entry] of Object.entries(manifest.images ?? {})) {
    const url = entry.url;
    const category = categoryOf(url);
    // `rule/` non converti par défaut (plan v2 §B3) ; uniquement bg/ et image/.
    if (category !== "bg" && category !== "image") continue;
    if (!/\.png$/i.test(url)) continue;
    const input = join(assetsDir, url);
    if (!existsSync(input)) continue;
    const outputUrl = url.replace(/\.png$/i, ".webp");
    const output = join(assetsDir, outputUrl);
    const before = sizeOf(input);

    // Avec perte : bg/ et image/ev* seulement, q90 + garde-fou SSIM ≥ 0,99.
    const lossy = Boolean(options.webpLossy) && (category === "bg" || (category === "image" && /^ev/i.test(key)));
    if (options.dryRun) {
      stats.files += 1;
      if (lossy) stats.lossy += 1;
      else stats.lossless += 1;
      continue;
    }
    let convertedOk = false;
    try {
      await encodePngToWebp(input, output, { lossless: !lossy, quality: 90 }, encoder);
      let usedLossy = lossy;
      if (lossy) {
        const ssim = await measureSsim(input, output);
        if (ssim === null || ssim < 0.99) {
          warnings.push(`${url} : SSIM ${ssim ?? "n/a"} < 0,99 → repli WebP sans perte`);
          await encodePngToWebp(input, output, { lossless: true, quality: 90 }, encoder);
          usedLossy = false;
        }
      }
      // Garde de fidélité (#398) : en mode SANS PERTE, l'image doit être pixel-identique à la
      // source AVANT toute suppression du PNG. Sinon on refuse, on garde le PNG et on avertit.
      if (!usedLossy) {
        const identityCheck = options.pixelIdentityCheck ?? pixelsIdentical;
        const identical = await identityCheck(input, output);
        if (identical !== true) {
          warnings.push(
            `${url} : identité pixel NON vérifiée (${identical === false ? "différence détectée" : "vérification impossible"}) → PNG conservé, conversion annulée`,
          );
          rmSync(output, { force: true });
          continue;
        }
      }
      entry.url = outputUrl;
      if (usedLossy) stats.lossy += 1;
      else stats.lossless += 1;
      if (options.keepOriginals) stats.kept += 1;
      else pendingDeletes.push(input);
      stats.files += 1;
      stats.beforeBytes += before;
      const after = sizeOf(output);
      stats.afterBytes += after;
      addSize(categories, category, before, after);
      convertedOk = true;
    } catch (err) {
      warnings.push(`${url} : conversion WebP échouée (${err instanceof Error ? err.message : String(err)})`);
      rmSync(output, { force: true });
    }
    if (convertedOk) options.onConverted?.();
  }
  return { stats, warnings, categories, pendingDeletes };
}

/**
 * Optimise une installation en place (audio Opus + WebP), réécrit le manifeste
 * (`assetsVersion` recalculée) et régénère `image-dimensions.json`.
 */
export async function optimizeAssets(options: OptimizeAssetsOptions): Promise<OptimizeReport> {
  const assetsDir = resolve(options.assetsDir);
  assertOptimizableAssetsDir(assetsDir, options.force ?? false);
  const manifestPath = join(assetsDir, "asset-manifest.json");
  const manifestBeforeBytes = sizeOf(manifestPath);
  const dimensionsPath = join(assetsDir, "image-dimensions.json");
  const dimensionsBeforeBytes = sizeOf(dimensionsPath);
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, "utf-8")) as AssetManifest)
    : ({ version: 1, generatedAt: new Date().toISOString(), images: {}, audio: {}, scenarios: {} } as AssetManifest);

  const categories: Record<string, CategoryStats> = {};
  const warnings: string[] = [];
  const emptyStats = { files: 0, beforeBytes: 0, afterBytes: 0 };

  // Mode `--repair` (#398) : répare les URLs incohérentes puis vérifie la cohérence.
  if (options.repair) {
    const { report, remaining } = repairManifest(assetsDir, manifest);
    let assetsVersion = manifest.assetsVersion;
    if (!options.dryRun && report.images + report.audio > 0) {
      writeManifest(manifest, manifestPath);
      assetsVersion = manifest.assetsVersion;
      generateImageDimensions(assetsDir);
    }
    return {
      assetsDir,
      dryRun: options.dryRun ?? false,
      audio: { ...emptyStats, warnings: 0, kept: 0 },
      webp: { ...emptyStats, lossless: 0, lossy: 0, kept: 0, encoder: null },
      json: {
        manifestBeforeBytes,
        manifestAfterBytes: sizeOf(manifestPath),
        dimensionsBeforeBytes,
        dimensionsAfterBytes: sizeOf(dimensionsPath),
      },
      categories: {},
      totalBeforeBytes: manifestBeforeBytes + dimensionsBeforeBytes,
      totalAfterBytes: sizeOf(manifestPath) + sizeOf(dimensionsPath),
      ...(assetsVersion ? { assetsVersion } : {}),
      warnings,
      repairs: report,
      check: remaining,
    };
  }

  // Mode `--check` (#398) : vérifie que chaque entrée du manifeste a son fichier.
  if (options.check) {
    const check = checkAssetsInstallation(assetsDir, manifest);
    return {
      assetsDir,
      dryRun: options.dryRun ?? false,
      audio: { ...emptyStats, warnings: 0, kept: 0 },
      webp: { ...emptyStats, lossless: 0, lossy: 0, kept: 0, encoder: null },
      json: {
        manifestBeforeBytes,
        manifestAfterBytes: manifestBeforeBytes,
        dimensionsBeforeBytes,
        dimensionsAfterBytes: dimensionsBeforeBytes,
      },
      categories: {},
      totalBeforeBytes: manifestBeforeBytes + dimensionsBeforeBytes,
      totalAfterBytes: manifestBeforeBytes + dimensionsBeforeBytes,
      warnings,
      check,
    };
  }

  // Crash-safety (#398) : le manifeste est réécrit (atomiquement) tous les
  // `manifestFlushEvery` conversions — les originaux ne sont supprimés qu'APRÈS
  // l'écriture finale, donc un run interrompu laisse toujours une installation cohérente.
  const flushEvery = options.manifestFlushEvery ?? 25;
  let convertedCount = 0;
  const onConverted = (): void => {
    convertedCount += 1;
    if (!options.dryRun && flushEvery > 0 && convertedCount % flushEvery === 0) {
      writeManifest(manifest, manifestPath);
    }
    options.onConverted?.();
  };
  const conversionOptions = { ...options, onConverted };

  const audioResult = options.noAudio
    ? { stats: { ...emptyStats, warnings: 0, kept: 0 }, warnings: [], pendingDeletes: [] }
    : await optimizeAudioFiles(assetsDir, manifest, conversionOptions);
  const imageResult = await optimizeImages(assetsDir, manifest, conversionOptions);
  warnings.push(...audioResult.warnings, ...imageResult.warnings);
  for (const [category, stats] of Object.entries(imageResult.categories)) {
    const current = categories[category] ?? { files: 0, beforeBytes: 0, afterBytes: 0 };
    current.files += stats.files;
    current.beforeBytes += stats.beforeBytes;
    current.afterBytes += stats.afterBytes;
    categories[category] = current;
  }
  if (audioResult.stats.files > 0) {
    categories["se"] = {
      files: audioResult.stats.files,
      beforeBytes: audioResult.stats.beforeBytes,
      afterBytes: audioResult.stats.afterBytes,
    };
  }

  let assetsVersion: string | undefined;
  let manifestAfterBytes = manifestBeforeBytes;
  let dimensionsAfterBytes = dimensionsBeforeBytes;
  // Ne réécrit manifeste/dimensions que si une conversion a bien eu lieu (sinon tout est intact,
  // précieux pour `--no-audio --no-webp` et les relances idempotentes).
  const changed = audioResult.stats.files > 0 || imageResult.stats.files > 0;
  if (!options.dryRun && changed) {
    writeManifest(manifest, manifestPath);
    assetsVersion = manifest.assetsVersion;
    manifestAfterBytes = sizeOf(manifestPath);
    generateImageDimensions(assetsDir);
    dimensionsAfterBytes = sizeOf(dimensionsPath);
  }
  // Suppression DIFFÉRÉE des originaux : seulement une fois le manifeste final écrit.
  if (!options.dryRun && !options.keepOriginals) {
    for (const path of [...audioResult.pendingDeletes, ...imageResult.pendingDeletes]) {
      rmSync(path, { force: true });
    }
  }

  const statsFor = (category: string): CategoryStats => categories[category] ?? { files: 0, beforeBytes: 0, afterBytes: 0 };
  const totalBeforeBytes =
    Object.values(categories).reduce((sum, stats) => sum + stats.beforeBytes, 0) + manifestBeforeBytes + dimensionsBeforeBytes;
  const totalAfterBytes =
    Object.values(categories).reduce((sum, stats) => sum + stats.afterBytes, 0) + manifestAfterBytes + dimensionsAfterBytes;

  return {
    assetsDir,
    dryRun: options.dryRun ?? false,
    audio: audioResult.stats,
    webp: imageResult.stats,
    json: { manifestBeforeBytes, manifestAfterBytes, dimensionsBeforeBytes, dimensionsAfterBytes },
    categories: {
      ...categories,
      rule: statsFor("rule"),
      json: { files: 2, beforeBytes: manifestBeforeBytes + dimensionsBeforeBytes, afterBytes: manifestAfterBytes + dimensionsAfterBytes },
    },
    totalBeforeBytes,
    totalAfterBytes,
    ...(assetsVersion ? { assetsVersion } : {}),
    warnings,
  };
}

/** Formate le rapport d'optimisation pour la console/PR. */
export function formatOptimizeReport(report: OptimizeReport): string {
  const lines: string[] = [];
  const prefix = report.dryRun ? "[assets:optimize] (dry-run) " : "[assets:optimize] ";
  lines.push(`${prefix}Dossier : ${report.assetsDir}`);
  if (report.audio.files > 0) {
    lines.push(
      `${prefix}SE (WAV → Opus/Ogg) : ${report.audio.files} fichier(s) — ${formatMo(report.audio.beforeBytes)} → ${formatMo(report.audio.afterBytes)} (−${gainPercent(report.audio.beforeBytes, report.audio.afterBytes)} %)`,
    );
  }
  if (report.webp.files > 0) {
    lines.push(
      `${prefix}Images (PNG → WebP, ${report.webp.encoder ?? "encodeur"}) : ${report.webp.files} fichier(s) ` +
        `(sans perte ${report.webp.lossless}, avec perte ${report.webp.lossy}) — ${formatMo(report.webp.beforeBytes)} → ${formatMo(report.webp.afterBytes)} (−${gainPercent(report.webp.beforeBytes, report.webp.afterBytes)} %)`,
    );
  }
  for (const category of ["bg", "image", "rule"]) {
    const stats = report.categories[category];
    if (!stats || stats.files === 0) continue;
    lines.push(
      `${prefix}  ${category} : ${stats.files} fichier(s) — ${formatMo(stats.beforeBytes)} → ${formatMo(stats.afterBytes)} (−${gainPercent(stats.beforeBytes, stats.afterBytes)} %)`,
    );
  }
  if (report.json.manifestBeforeBytes > 0 || report.json.dimensionsBeforeBytes > 0) {
    lines.push(
      `${prefix}JSON (manifeste + dimensions) : ${formatMo(report.json.manifestBeforeBytes + report.json.dimensionsBeforeBytes)} → ${formatMo(report.json.manifestAfterBytes + report.json.dimensionsAfterBytes)}`,
    );
  }
  lines.push(
    `${prefix}Total : ${formatMo(report.totalBeforeBytes)} → ${formatMo(report.totalAfterBytes)} (−${gainPercent(report.totalBeforeBytes, report.totalAfterBytes)} %)`,
  );
  if (report.repairs) {
    lines.push(
      `${prefix}Réparation : ${report.repairs.images} image(s), ${report.repairs.audio} audio réparées.`,
    );
    for (const detail of report.repairs.details.slice(0, 10)) lines.push(`${prefix}  ${detail}`);
    if (report.repairs.details.length > 10) lines.push(`${prefix}  … ${report.repairs.details.length - 10} autre(s)`);
  }
  if (report.check) {
    if (report.check.ok) {
      lines.push(`${prefix}Cohérence : 0 entrée manquante.`);
    } else {
      lines.push(`${prefix}Cohérence : ${report.check.missing.length} entrée(s) manquante(s) :`);
      for (const missing of report.check.missing.slice(0, 20)) lines.push(`${prefix}  MANQUANT ${missing}`);
      if (report.check.missing.length > 20) lines.push(`${prefix}  … ${report.check.missing.length - 20} autre(s)`);
    }
  }
  if (report.assetsVersion) lines.push(`${prefix}manifeste réécrit (assetsVersion ${report.assetsVersion}) ; image-dimensions.json régénéré.`);
  for (const warning of report.warnings) lines.push(`${prefix}⚠ ${warning}`);
  return lines.join("\n");
}

/** Aide du CLI. */
export function printOptimizeUsage(): string {
  return `Usage: npm run assets:optimize -- [options]

Optimise les assets DÉJÀ INSTALLÉS, en place (aucune ré-extraction) :
  - SE .wav → Opus/Ogg (ffmpeg, libopus 96/64 kbps, durée ±20 ms) ;
  - PNG de bg/ et image/ → WebP sans perte (ou avec perte bg/ev : --webp-lossy) ;
  - manifeste réécrit (URLs réelles, assetsVersion) + image-dimensions.json régénéré.

Options :
  --assets <dir>       Dossier des assets installés (défaut : public/assets)
  --repair             Répare un manifeste incohérent (URL absente → extension alternative présente)
  --check              Vérifie la cohérence manifeste/fichiers ; code 1 si des entrées manquent
  --keep-originals     Conserve les .wav/.png d'origine
  --no-audio           Désactive la conversion audio
  --no-webp            Désactive la conversion WebP
  --webp-lossy         WebP avec perte q90 + SSIM ≥ 0,99 pour bg/ et image/ev* (règle : jamais rule/)
  --force              Autorise un dossier sans manifeste ou non ignoré par git
  --dry-run            Simule sans écrire
  --manifest-flush-every <n>  Réécrit le manifeste tous les n conversions (défaut 25, 0 = à la fin)
  --help, -h           Affiche cette aide`;
}

function parseArgs(argv: string[]): OptimizeAssetsOptions {
  let assetsDir = join(process.cwd(), "public", "assets");
  let keepOriginals = false;
  let noAudio = false;
  let noWebp = false;
  let webpLossy = false;
  let force = false;
  let dryRun = false;
  let repair = false;
  let check = false;
  let manifestFlushEvery: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--assets":
        assetsDir = argv[++i] ?? assetsDir;
        break;
      case "--keep-originals":
        keepOriginals = true;
        break;
      case "--no-audio":
        noAudio = true;
        break;
      case "--no-webp":
        noWebp = true;
        break;
      case "--webp-lossy":
        webpLossy = true;
        break;
      case "--force":
        force = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--repair":
        repair = true;
        break;
      case "--check":
        check = true;
        break;
      case "--manifest-flush-every":
        manifestFlushEvery = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(manifestFlushEvery) || manifestFlushEvery < 0) {
          throw new Error("--manifest-flush-every: entier ≥ 0 attendu");
        }
        break;
      case "--help":
      case "-h":
        console.log(printOptimizeUsage());
        process.exit(0);
        break;
      default:
        throw new Error(`Option inconnue : ${argv[i]}`);
    }
  }
  return {
    assetsDir,
    keepOriginals,
    noAudio,
    noWebp,
    webpLossy,
    force,
    dryRun,
    ...(repair ? { repair: true } : {}),
    ...(check ? { check: true } : {}),
    ...(manifestFlushEvery !== undefined ? { manifestFlushEvery } : {}),
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (process.argv.includes("--help") || process.argv.includes("-h")) return;

  // Crash-safety (#398) : les originaux ne sont supprimés qu'après l'écriture finale du
  // manifeste ; une interruption laisse donc une installation cohérente.
  process.once("SIGINT", () => {
    console.error(
      "[assets:optimize] Interruption : manifeste non finalisé, originaux conservés (installation cohérente). Relancer pour reprendre.",
    );
    process.exit(130);
  });

  optimizeAssets(options)
    .then((report) => {
      console.log(formatOptimizeReport(report));
      if (report.check && !report.check.ok) {
        if (options.force) {
          console.warn("[assets:optimize] --force : entrées manquantes tolérées (code 0).");
        } else {
          console.error("[assets:optimize] Installation incohérente : relancer avec --repair ou régénérer les assets.");
          process.exitCode = 1;
        }
      }
      if (report.repairs && report.check && !report.check.ok) {
        console.error("[assets:optimize] Réparation incomplète : des entrées manquent encore.");
        process.exitCode = 1;
      }
      if (report.warnings.length > 0 && report.audio.files === 0 && report.webp.files === 0 && !report.check && !report.repairs) {
        console.warn(`[assets:optimize] ${report.warnings.length} avertissement(s) : rien n'a été optimisé.`);
      }
    })
    .catch((err) => {
      console.error("[assets:optimize]", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
