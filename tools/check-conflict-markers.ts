/**
 * Garde-fou : aucun marqueur de conflit Git dans les fichiers versionnés (#342).
 *
 * Usage :
 *   npm run check:conflict-markers
 *
 * Parcourt `git ls-files` (hors `public/assets`, `node_modules`, `dist`, rapports),
 * ignore les binaires, et échoue (code de sortie 1) sur toute ligne `<<<<<<< `,
 * `>>>>>>> ` ou `=======` entre deux marqueurs — un `=======` seul (titre
 * Markdown) est légitime.
 */
import { fileURLToPath } from "url";
import {
  checkConflictMarkers,
  formatConflictMarkers,
} from "./check-conflict-markers-lib.js";

function main(): void {
  let result: ReturnType<typeof checkConflictMarkers>;
  try {
    result = checkConflictMarkers(process.cwd());
  } catch (err) {
    console.error(
      "[check:conflict-markers] Impossible de lister les fichiers versionnés :",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }

  if (result.violations.length > 0) {
    console.error(formatConflictMarkers(result.violations));
    process.exit(1);
  }

  console.log(
    `Aucun marqueur de conflit Git (${result.filesScanned} fichier(s) versionné(s) analysé(s)` +
      `${result.filesSkippedBinary > 0 ? `, ${result.filesSkippedBinary} binaire(s) ignoré(s)` : ""}).`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
