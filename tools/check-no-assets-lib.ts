/**
 * Logique pure du contrôle « aucun asset commité ».
 *
 * La fonction prend une liste de chemins (fichiers trackés par git) et une
 * allowlist, et retourne les chemins qui portent une extension d'asset sans
 * être explicitement autorisés.
 */

export const ASSET_EXTENSIONS = [
  // Images/textures moteur KiriKari
  ".tlg",
  ".tft",
  // Archives et scripts
  ".xp3",
  ".sar",
  ".ks",
  // Audio
  ".ogg",
  ".mp3",
  ".wav",
  // Images web
  ".png",
  ".webp",
  ".jpg",
  ".jpeg",
  ".gif",
  // Polices
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
] as const;

export interface Violation {
  path: string;
  extension: string;
}

/** Retourne l'extension interdite (minuscule) d'un chemin, ou null. */
export function getAssetExtension(path: string): string | null {
  const lower = path.toLowerCase();
  for (const ext of ASSET_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return ext;
    }
  }
  return null;
}

/** Liste les violations : fichiers trackés ayant une extension d'asset et
 *  absents de l'allowlist. */
export function findAssetViolations(
  files: readonly string[],
  allowlist: ReadonlySet<string>,
): Violation[] {
  return files
    .filter((file) => !allowlist.has(file))
    .map((file): Violation | null => {
      const extension = getAssetExtension(file);
      if (!extension) return null;
      return { path: file, extension };
    })
    .filter((v): v is Violation => v !== null);
}

/** Formate les violations pour un message d'erreur lisible. */
export function formatViolations(violations: readonly Violation[]): string {
  if (violations.length === 0) {
    return "";
  }

  const lines = [
    `Fichiers interdits détectés (${violations.length}) :`,
    ...violations.map((v) => `  - ${v.path} (${v.extension})`),
    "",
    "Si un fichier est un placeholder original, ajoutez-le à tools/allowed-assets.txt.",
    "Sinon, il ne doit pas être commité (assets sous copyright).",
  ];
  return lines.join("\n");
}
