/**
 * Inventaire des assets : parcours, classement par type, priorités.
 *
 * Parcourt un dossier d'entrée (typiquement les fichiers extraits des .xp3),
 * classe chaque fichier par kind (bg, image, rule, bgm, se, scenario, other),
 * et calcule la clé de storage normalisée et le chemin de sortie web.
 */
import { extname, basename, join, relative, resolve } from "path";
import { readdirSync, statSync } from "fs";
import { storageKey } from "../src/core/storage-key.js";
import type { AssetKind } from "../src/core/asset-manifest.js";

export type InventoryEntry = {
  /** Chemin absolu du fichier source. */
  source: string;
  /** Chemin relatif au dossier d'entrée. */
  relPath: string;
  /** Kind déterminé (bg, image, rule, bgm, se, scenario, other). */
  kind: AssetKind;
  /** Extension d'origine (ex: .tlg, .png, .ogg). */
  ext: string;
  /** Clé de storage normalisée (minuscules, sans extension ni |suffix). */
  key: string;
  /** Chemin de sortie web relatif (ex: "bg/山城01(近).webp"). */
  webPath: string;
  /** Extension web cible (ex: .webp, .png, .ogg, .ks). */
  webExt: string;
  /** Archive XP3 d'origine si détectable (ex: "bg", "fg"). */
  archive?: string;
};

/** Extension web cible par type d'asset. */
const WEB_EXT: Record<AssetKind, string> = {
  bg: ".webp",
  image: ".webp",
  rule: ".png",
  bgm: ".ogg",
  se: ".ogg",
  scenario: ".ks",
};

/** Mapping dossier XP3 → kind. */
const DIR_TO_KIND: Record<string, AssetKind> = {
  bg: "bg",
  fg: "image",
  image: "image",
  rule: "rule",
  bgm: "bgm",
  sound: "se",
  se: "se",
};

/**
 * Détermine le kind d'un fichier à partir de son chemin relatif et de son extension.
 * Priorité : dossier parent > extension.
 */
export function classifyAsset(relPath: string): AssetKind {
  const parts = relPath.toLowerCase().split(/[\\/]/);
  const ext = extname(relPath).toLowerCase();

  // Dossier data/scenario → scenario
  if (parts.includes("scenario") || (parts.includes("data") && ext === ".ks")) {
    return "scenario";
  }

  // Dossier explicite
  for (const part of parts) {
    if (DIR_TO_KIND[part]) return DIR_TO_KIND[part];
  }

  // Par extension
  if (ext === ".ks") return "scenario";
  if (ext === ".tlg" || ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".bmp") {
    // Sans dossier, on ne peut pas déterminer si c'est bg ou fg → image par défaut
    return "image";
  }
  if (ext === ".ogg" || ext === ".mp3") return "bgm";
  if (ext === ".wav") return "se";

  return "other" as AssetKind;
}

/** Extension web cible pour un kind donné. */
export function webExtension(kind: AssetKind): string {
  return WEB_EXT[kind] ?? ".bin";
}

/**
 * Calcule le chemin de sortie web pour un asset.
 * Format : <kind>/<key><webExt>
 */
export function webPathFor(kind: AssetKind, key: string): string {
  return `${kind}/${key}${webExtension(kind)}`;
}

/**
 * Parcourt un dossier et construit l'inventaire des assets.
 * Les fichiers non pertinents (.tjs, .dll, .ini, .cur, etc.) sont ignorés.
 */
export function buildInventory(inputDir: string): InventoryEntry[] {
  const root = resolve(inputDir);
  const entries: InventoryEntry[] = [];

  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, name.name);
      if (name.isDirectory()) {
        walk(fullPath);
        continue;
      }

      const relPath = relative(root, fullPath);
      const ext = extname(name.name).toLowerCase();

      // Ignorer les fichiers non pertinents.
      if (IGNORED_EXTS.has(ext)) continue;

      const kind = classifyAsset(relPath);
      if (kind === ("other" as AssetKind)) continue;

      const key = storageKey(basename(name.name, ext));
      const webExt = webExtension(kind);

      entries.push({
        source: fullPath,
        relPath,
        kind,
        ext,
        key,
        webPath: webPathFor(kind, key),
        webExt,
        archive: detectArchive(relPath),
      });
    }
  };

  walk(root);

  // Déduplication : en cas de collision (même key + kind), garder le premier.
  const seen = new Set<string>();
  const unique: InventoryEntry[] = [];
  for (const entry of entries) {
    const id = `${entry.kind}:${entry.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(entry);
  }

  return unique;
}

/** Extensions de fichiers à ignorer. */
const IGNORED_EXTS = new Set([
  ".tjs",
  ".ksc",
  ".tft",
  ".ttd",
  ".asd",
  ".amv",
  ".gc",
  ".cur",
  ".ini",
  ".dll",
  ".psd",
  ".sli",
  ".sig",
  ".exe",
  ".inf",
  ".txt",
  ".ds_store",
]);

/** Détecte l'archive XP3 d'origine à partir du chemin. */
function detectArchive(relPath: string): string | undefined {
  const parts = relPath.toLowerCase().split(/[\\/]/);
  for (const part of parts) {
    if (DIR_TO_KIND[part]) return part;
  }
  return undefined;
}

/** Groupe les entrées par kind. */
export function groupByKind(entries: InventoryEntry[]): Record<AssetKind, InventoryEntry[]> {
  const groups: Record<AssetKind, InventoryEntry[]> = {
    bg: [],
    image: [],
    rule: [],
    bgm: [],
    se: [],
    scenario: [],
  };
  for (const entry of entries) {
    groups[entry.kind].push(entry);
  }
  return groups;
}
