/**
 * Logique pure du contrôle « aucun asset commité ».
 *
 * La fonction prend une liste de chemins (fichiers trackés par git) et une
 * allowlist, et retourne les chemins qui portent une extension d'asset sans
 * être explicitement autorisés.
 */

export const ASSET_EXTENSIONS = [
  // Images/textures moteur KiriKiri
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
  /** Extension d'asset détectée (vide pour une violation d'empreinte ou de binaire). */
  extension: string;
  /** Motif : extension interdite (défaut), contenu modifié, ou gros binaire hors liste. */
  reason?: "extension" | "hash" | "binary";
  /** Précision pour le message (ex. taille du binaire). */
  detail?: string;
}

/** Entrée de l'allowlist : chemin autorisé et empreinte SHA-256 de son contenu. */
export type AllowlistEntries = ReadonlyMap<string, string>;

const SHA256_LINE = /^([0-9a-f]{64})\s+(\S.*)$/i;

/**
 * Lit l'allowlist au format de `sha256sum` : `<empreinte>  <chemin>` par ligne.
 * Les lignes vides et les commentaires (`#`) sont ignorés. Une ligne sans
 * empreinte valide est une erreur : un chemin seul ne suffit plus.
 */
export function parseAllowlist(text: string): { entries: Map<string, string>; invalid: string[] } {
  const entries = new Map<string, string>();
  const invalid: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    if (line.length === 0) continue;
    const m = SHA256_LINE.exec(line);
    if (!m) {
      invalid.push(line);
      continue;
    }
    entries.set(m[2]!.trim(), m[1]!.toLowerCase());
  }
  return { entries, invalid };
}

/**
 * Fichiers autorisés dont le contenu ne correspond plus à l'empreinte déclarée
 * (un placeholder remplacé par un vrai asset garde le même chemin).
 * `hashOf` renvoie null pour un fichier absent du disque (ignoré).
 */
export function findHashMismatches(
  files: readonly string[],
  allowlist: AllowlistEntries,
  hashOf: (path: string) => string | null,
): Violation[] {
  const tracked = new Set(files);
  const out: Violation[] = [];
  for (const [path, expected] of allowlist) {
    if (!tracked.has(path)) continue;
    const actual = hashOf(path);
    if (actual !== null && actual !== expected) {
      out.push({ path, extension: "", reason: "hash", detail: "contenu différent de l'empreinte autorisée" });
    }
  }
  return out;
}

/** Taille à partir de laquelle un fichier binaire non autorisé est suspect (256 Kio). */
export const MAX_BINARY_BYTES = 256 * 1024;

/**
 * Gros fichiers binaires hors allowlist, quelle que soit leur extension : un asset
 * renommé (`.dat`, sans extension…) échappe au contrôle par extension.
 * Les fichiers déjà signalés pour leur extension sont ignorés.
 * `inspect` renvoie null pour un fichier absent du disque.
 */
export function findLargeBinaries(
  files: readonly string[],
  allowlist: AllowlistEntries,
  inspect: (path: string) => { size: number; binary: boolean } | null,
  maxBytes: number = MAX_BINARY_BYTES,
): Violation[] {
  const out: Violation[] = [];
  for (const file of files) {
    if (allowlist.has(file) || getAssetExtension(file)) continue;
    const info = inspect(file);
    if (info && info.binary && info.size > maxBytes) {
      out.push({ path: file, extension: "", reason: "binary", detail: `${Math.round(info.size / 1024)} Kio` });
    }
  }
  return out;
}

/** Détecte un contenu binaire : un octet NUL dans l'échantillon (comme `git`). */
export function looksBinary(sample: Uint8Array): boolean {
  return sample.includes(0);
}

/**
 * Réécrit l'allowlist avec les empreintes données, en conservant commentaires et
 * lignes vides. Les chemins sans nouvelle empreinte gardent leur ligne.
 */
export function renderAllowlist(text: string, hashes: ReadonlyMap<string, string>): string {
  return text
    .split("\n")
    .map((raw) => {
      const body = raw.replace(/#.*/, "").trim();
      const m = SHA256_LINE.exec(body);
      const path = m ? m[2]!.trim() : body;
      const hash = path ? hashes.get(path) : undefined;
      return path && hash ? `${hash}  ${path}` : raw;
    })
    .join("\n");
}

/** Découpe la sortie de `git ls-files -z` (chemins séparés par NUL). */
export function parseNulSeparated(raw: string): string[] {
  return raw.split("\0").filter((entry) => entry.length > 0);
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

function describe(v: Violation): string {
  if (v.reason === "hash") return `contenu modifié : ${v.detail ?? ""}`.trim();
  if (v.reason === "binary") return `gros binaire hors liste, ${v.detail ?? ""}`.trim();
  return v.extension;
}

/** Formate les violations pour un message d'erreur lisible. */
export function formatViolations(violations: readonly Violation[]): string {
  if (violations.length === 0) {
    return "";
  }

  const lines = [
    `Fichiers interdits détectés (${violations.length}) :`,
    ...violations.map((v) => `  - ${v.path} (${describe(v)})`),
    "",
    "Si un fichier est un placeholder original, ajoutez-le à tools/allowed-assets.txt avec son empreinte",
    "(npm run check:assets -- --update). Sinon, il ne doit pas être commité (assets sous copyright).",
  ];
  return lines.join("\n");
}
