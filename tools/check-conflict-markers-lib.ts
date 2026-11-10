/**
 * Logique pure du garde-fou anti-marqueurs de conflit Git (issue #342).
 *
 * Un merge mal résolu laisse des lignes `<<<<<<< …`, `=======`, `>>>>>>> …` dans
 * des fichiers versionnés ; les parseurs CSS/JS les tolèrent parfois et le
 * marqueur part alors dans le bundle sans que la CI ne bronche (cas réel de la
 * vague v1.1 : `src/ui/ui-manager.css`).
 *
 * Règle de détection :
 * - toute ligne commençant par `<<<<<<< ` ou `>>>>>>> ` est un marqueur ;
 * - `=======` seul n'est un marqueur que **s'il est entre** deux marqueurs
 *   (un titre Markdown souligné par `=======` reste légitime) ;
 * - fichiers binaires ignorés (octet NUL dans l'échantillon, comme `git`).
 */
import { execFileSync } from "child_process";
import { closeSync, openSync, readFileSync, readSync } from "fs";
import { join } from "path";

/** Type de marqueur détecté. */
export type ConflictMarkerKind = "start" | "separator" | "end";

/** Marqueur de conflit trouvé dans un fichier. */
export interface ConflictMarker {
  /** Chemin relatif au dépôt. */
  path: string;
  /** Numéro de ligne (1-based). */
  line: number;
  /** Contenu de la ligne (pour le diagnostic). */
  text: string;
  kind: ConflictMarkerKind;
}

const START_MARKER = /^<<<<<<<(?:\s|$)/;
const END_MARKER = /^>>>>>>>(?:\s|$)/;
const SEPARATOR_MARKER = /^=======$/;

/** Taille maximale d'échantillon binaire (comme `git`). */
export const BINARY_SAMPLE_BYTES = 8000;

/**
 * Préfixes exclus du contrôle : assets utilisateur, dépendances, build et
 * rapports (jamais à résoudre comme du code source).
 */
export const IGNORED_PREFIXES = [
  "public/assets/",
  "node_modules/",
  "dist/",
  ".git/",
  ".pipeline-work/",
  "decrypted/",
  "reports/",
  "test-results/",
  "playwright-report/",
] as const;

/** True si un contenu est binaire (octet NUL dans l'échantillon). */
export function looksBinary(sample: Uint8Array): boolean {
  return sample.includes(0);
}

/** True si le chemin doit être ignoré par le garde-fou. */
export function isIgnoredPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return IGNORED_PREFIXES.some(
    (prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
  );
}

/** Découpe la sortie de `git ls-files -z` (chemins séparés par NUL). */
export function parseTrackedPaths(raw: string): string[] {
  return raw.split("\0").filter((entry) => entry.length > 0);
}

/**
 * Cherche les marqueurs de conflit dans un contenu texte.
 * `path` sert uniquement à étiqueter les résultats.
 */
export function findConflictMarkers(content: string, path = ""): ConflictMarker[] {
  const markers: ConflictMarker[] = [];
  let insideConflict = false;
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (START_MARKER.test(line)) {
      insideConflict = true;
      markers.push({ path, line: index + 1, text: line, kind: "start" });
      continue;
    }
    if (END_MARKER.test(line)) {
      markers.push({ path, line: index + 1, text: line, kind: "end" });
      insideConflict = false;
      continue;
    }
    // `=======` n'est un marqueur que dans un bloc de conflit (sinon : titre Markdown).
    if (insideConflict && SEPARATOR_MARKER.test(line)) {
      markers.push({ path, line: index + 1, text: line, kind: "separator" });
    }
  }
  return markers;
}

/**
 * Liste les fichiers versionnés à contrôler (hors préfixes ignorés).
 * @throws si `git ls-files` échoue (pas un dépôt).
 */
export function listTrackedPaths(cwd: string = process.cwd()): string[] {
  const raw = execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf-8" });
  return parseTrackedPaths(raw).filter((path) => !isIgnoredPath(path));
}

/** Lit les premiers octets d'un fichier sans charger les gros binaires entièrement. */
function readSample(fullPath: string): Buffer {
  const fd = openSync(fullPath, "r");
  try {
    const buffer = Buffer.alloc(BINARY_SAMPLE_BYTES);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/** Résultat du contrôle sur un dépôt. */
export interface ConflictMarkerCheck {
  violations: ConflictMarker[];
  filesScanned: number;
  filesSkippedBinary: number;
}

/**
 * Contrôle un dépôt : parcourt les fichiers versionnés, ignore les binaires
 * et retourne les marqueurs de conflit (vide = dépôt propre).
 */
export function checkConflictMarkers(
  cwd: string = process.cwd(),
  options: { readFile?: (path: string) => string } = {},
): ConflictMarkerCheck {
  const violations: ConflictMarker[] = [];
  let filesScanned = 0;
  let filesSkippedBinary = 0;

  for (const path of listTrackedPaths(cwd)) {
    const fullPath = join(cwd, path);
    let content: string;
    if (options.readFile) {
      content = options.readFile(path);
    } else {
      try {
        if (looksBinary(readSample(fullPath))) {
          filesSkippedBinary++;
          continue;
        }
        content = readFileSync(fullPath, "utf-8");
      } catch {
        // Fichier illisible (supprimé, lien cassé…) : rien à contrôler.
        continue;
      }
    }
    filesScanned++;
    violations.push(...findConflictMarkers(content, path));
  }

  return { violations, filesScanned, filesSkippedBinary };
}

/** Formate les marqueurs pour un message d'erreur `fichier:ligne`. */
export function formatConflictMarkers(markers: readonly ConflictMarker[]): string {
  if (markers.length === 0) return "";
  const labels: Record<ConflictMarkerKind, string> = {
    start: "début",
    separator: "séparateur",
    end: "fin",
  };
  const lines = [
    `Marqueurs de conflit Git détectés (${markers.length}) :`,
    ...markers.map(
      (marker) => `  ${marker.path}:${marker.line} (marqueur de ${labels[marker.kind]}) : ${marker.text.trim()}`,
    ),
    "",
    "Résoudre le conflit et retirer ces lignes (voir #342).",
  ];
  return lines.join("\n");
}
