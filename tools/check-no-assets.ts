/**
 * Vérifie qu'aucun asset sous copyright n'est commité dans le dépôt.
 *
 * Usage :
 *   npm run check:assets                 contrôle (code de sortie 1 en cas d'écart)
 *   npm run check:assets -- --update     recalcule les empreintes de l'allowlist
 *
 * Le script liste les entrées de l'index (`git ls-files -s -z`) et applique
 * quatre règles :
 * 0. lien symbolique `public/assets` (ou imbriqué) suivi par git : interdit ; un
 *    lien local non suivi reste autorisé pour le développement (ignoré par .gitignore) ;
 * 1. extension d'asset (.tlg, .xp3, .ks, .png, .ogg, polices…) hors allowlist ;
 * 2. fichier de l'allowlist dont le contenu ne correspond plus à son empreinte SHA-256 ;
 * 3. gros fichier binaire hors allowlist, quelle que soit son extension.
 *
 * L'allowlist `tools/allowed-assets.txt` suit le format de `sha256sum`.
 */
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import {
  findAssetViolations,
  findHashMismatches,
  findLargeBinaries,
  findTrackedAssetSymlinks,
  formatViolations,
  looksBinary,
  parseAllowlist,
  parseLsFilesStage,
  renderAllowlist,
} from "./check-no-assets-lib.js";
import type { TrackedEntry } from "./check-no-assets-lib.js";

const ALLOWLIST_PATH = join(import.meta.dirname, "allowed-assets.txt");
const REPO_ROOT = join(import.meta.dirname, "..");
const SAMPLE_BYTES = 8000;

function listTrackedEntries(): TrackedEntry[] {
  // -s : mode et stage de chaque entrée (120000 = lien symbolique) ;
  // -z : sans cela git met entre guillemets et échappe en octal les noms non ASCII
  // (ex. "\303\251.tlg"), ce qui masquerait l'extension.
  const raw = execFileSync("git", ["ls-files", "-s", "-z"], { encoding: "utf-8", cwd: REPO_ROOT });
  return parseLsFilesStage(raw);
}

function sha256(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(join(REPO_ROOT, path))).digest("hex");
  } catch {
    return null;
  }
}

function inspect(path: string): { size: number; binary: boolean } | null {
  try {
    const full = join(REPO_ROOT, path);
    const { size } = statSync(full);
    const fd = openSync(full, "r");
    try {
      const buf = Buffer.alloc(Math.min(size, SAMPLE_BYTES));
      readSync(fd, buf, 0, buf.length, 0);
      return { size, binary: looksBinary(buf) };
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

function main(): void {
  const text = readFileSync(ALLOWLIST_PATH, "utf-8");
  const { entries, invalid } = parseAllowlist(text);

  if (process.argv.includes("--update")) {
    const hashes = new Map<string, string>();
    for (const path of entries.keys()) {
      const h = sha256(path);
      if (h) hashes.set(path, h);
    }
    // Les lignes sans empreinte valide sont réécrites si leur chemin existe.
    for (const raw of invalid) {
      const path = raw.trim();
      const h = sha256(path);
      if (h) hashes.set(path, h);
    }
    writeFileSync(ALLOWLIST_PATH, renderAllowlist(text, hashes), "utf-8");
    console.log(`Empreintes recalculées pour ${hashes.size} fichier(s) : relisez le diff avant de commiter.`);
    return;
  }

  if (invalid.length > 0) {
    console.error("tools/allowed-assets.txt : lignes sans empreinte SHA-256 valide (format « <sha256>  <chemin> ») :");
    for (const line of invalid) console.error(`  - ${line}`);
    process.exit(1);
  }

  const entriesOnDisk = listTrackedEntries();
  const files = entriesOnDisk.map((entry) => entry.path);
  const allowedPaths = new Set(entries.keys());
  const violations = [
    ...findTrackedAssetSymlinks(entriesOnDisk),
    ...findAssetViolations(files, allowedPaths),
    ...findHashMismatches(files, entries, sha256),
    ...findLargeBinaries(files, entries, inspect),
  ];

  if (violations.length > 0) {
    console.error(formatViolations(violations));
    process.exit(1);
  }

  console.log("Aucun asset sous copyright détecté.");
}

main();
