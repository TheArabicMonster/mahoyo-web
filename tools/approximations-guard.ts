/**
 * Garde-fou CI du registre des approximations (#295).
 *
 * Modes :
 *   npm run approximations:check              valide le registre et compare à la baseline
 *   npm run approximations:baseline           régénère tools/approximations-baseline.json
 *
 * Échoue si : entrée incomplète (écart/issue/test/compteur), test figé absent ou sans marqueur
 * `approx:<id>`, compteur supérieur à la baseline, id manquant/ajouté sans mise à jour explicite.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  APPROXIMATIONS_BASELINE_PATH,
  APPROXIMATIONS,
  compareApproximationsWithBaseline,
  loadApproximationsBaseline,
  serializeApproximationsBaseline,
  validateApproximations,
} from "./approximations.js";

const REPO_ROOT = join(import.meta.dirname, "..");
const updateBaseline = process.argv.includes("--update-baseline");

const problems = [...validateApproximations(APPROXIMATIONS, REPO_ROOT)];
if (!updateBaseline) {
  const baseline = loadApproximationsBaseline(REPO_ROOT);
  problems.push(...compareApproximationsWithBaseline(APPROXIMATIONS, baseline));
}

if (updateBaseline) {
  writeFileSync(join(REPO_ROOT, APPROXIMATIONS_BASELINE_PATH), serializeApproximationsBaseline(APPROXIMATIONS));
  console.log(`[approximations] baseline régénérée : ${APPROXIMATIONS.length} approximation(s).`);
}

if (problems.length > 0) {
  console.error("[approximations] ÉCHEC :");
  for (const problem of problems) console.error(` ❌ ${problem}`);
  process.exit(1);
}
console.log("[approximations] OK — registre valide, compteurs non croissants, tests figés présents.");
