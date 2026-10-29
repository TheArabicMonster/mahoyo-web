/**
 * Vérifie qu'aucun asset sous copyright n'est commité dans le dépôt.
 *
 * Usage : npm run check:assets
 *
 * Le script utilise `git ls-files` pour lister les fichiers trackés, puis les
 * compare à l'allowlist `tools/allowed-assets.txt`. Il échoue avec le code de
 * sortie 1 si un fichier avec une extension d'asset n'est pas autorisé.
 */
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { findAssetViolations, formatViolations, parseNulSeparated } from "./check-no-assets-lib.js";

const ALLOWLIST_PATH = join(import.meta.dirname, "allowed-assets.txt");

function loadAllowlist(): Set<string> {
  const raw = readFileSync(ALLOWLIST_PATH, "utf-8");
  const lines = raw.split("\n");
  const entries = lines
    .map((line) => line.replace(/#.*/, "").trim())
    .filter((line) => line.length > 0);
  return new Set(entries);
}

function listTrackedFiles(): string[] {
  // -z : sans cela git met entre guillemets et échappe en octal les noms non ASCII
  // (ex. "\303\251.tlg"), ce qui masquerait l'extension.
  const raw = execFileSync("git", ["ls-files", "-z"], { encoding: "utf-8" });
  return parseNulSeparated(raw);
}

function main(): void {
  const allowlist = loadAllowlist();
  const files = listTrackedFiles();
  const violations = findAssetViolations(files, allowlist);

  if (violations.length > 0) {
    console.error(formatViolations(violations));
    process.exit(1);
  }

  console.log("Aucun asset sous copyright détecté.");
}

main();
