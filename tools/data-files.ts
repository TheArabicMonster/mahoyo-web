/**
 * Fichiers de **données** du moteur à installer tels quels dans la sortie web.
 *
 * Ce ne sont pas des assets graphiques/sonores : ils ne passent ni par le manifeste ni par la
 * conversion. Ils sont copiés de l'installation du jeu (dossier extrait des `.xp3`) vers la
 * sortie servie au navigateur, pour que le player puisse les charger à l'exécution.
 */
import { copyFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join } from "path";

/**
 * Liste des fichiers de données connus, avec leur chemin relatif attendu à l'identique dans
 * l'entrée (racine extraite) et dans la sortie.
 *
 * - `data/others/envcolor.ksc` : table des effets d'ambiance `effect=屋外深夜`… (issue #260).
 */
export const ENGINE_DATA_FILES: readonly string[] = ["data/others/envcolor.ksc"];

export type EngineDataInstallReport = {
  /** Fichiers copiés (ou qui le seraient en dry-run). */
  installed: string[];
  /** Fichiers absents de l'entrée : le player se rabattra sur le comportement sans données. */
  missing: string[];
};

/**
 * Installe les fichiers de données du moteur de `inputDir` vers `outputDir`.
 * Ne fait rien en `dryRun` (retourne quand même la liste de ce qui serait copié/absent).
 */
export async function installEngineDataFiles(
  inputDir: string,
  outputDir: string,
  opts: { dryRun: boolean },
): Promise<EngineDataInstallReport> {
  const report: EngineDataInstallReport = { installed: [], missing: [] };
  for (const relPath of ENGINE_DATA_FILES) {
    const source = join(inputDir, relPath);
    if (!existsSync(source)) {
      report.missing.push(relPath);
      continue;
    }
    if (!opts.dryRun) {
      const destination = join(outputDir, relPath);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }
    report.installed.push(relPath);
  }
  return report;
}
