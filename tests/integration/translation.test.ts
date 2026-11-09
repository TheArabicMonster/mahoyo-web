/**
 * Test d'intégration : vérification de la traduction française installée.
 *
 * Nécessite les assets locaux (MAHOYO_ASSETS_DIR ou public/assets) et
 * l'index de langue `lang/fr/index.json` généré par `npm run translation`.
 * Sans l'un des deux, le test est ignoré.
 *
 * Aucun texte original ou traduit n'est affiché ; seuls des compteurs et
 * des noms de fichiers apparaissent dans les diagnostics.
 *
 * @vitest-environment node
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { parseLanguageIndex } from "@/core/language.js";
import type { AssetManifest } from "@/core/asset-manifest.js";
import { auditScript, listCorpus } from "../../tools/audit-lib.js";
import { hasAssets, assetsDir, manifestPath, scenarioDir } from "./skip-if-no-assets.js";

const LANG_FR_PATH = hasAssets && assetsDir ? join(assetsDir, "lang/fr/index.json") : "";
const hasFr = hasAssets && LANG_FR_PATH !== "" && existsSync(LANG_FR_PATH);

describe.skipIf(!hasFr)("Traduction française installée", () => {
  const manifest: AssetManifest | null = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf-8"))
    : null;
  // Calculé seulement si le corpus existe : sans assets, le describe est skippé mais son corps est
  // tout de même évalué à la collecte ; `listCorpus("")` lèverait ENOENT (checkout nu, #269).
  const originalListing = hasAssets && existsSync(scenarioDir) ? listCorpus(scenarioDir) : null;

  it("l'index français est valide et liste les scripts attendus", () => {
    const raw = JSON.parse(readFileSync(LANG_FR_PATH, "utf-8"));
    const index = parseLanguageIndex(raw);
    expect(index).not.toBeNull();
    expect(index!.language).toBe("fr");
    expect(index!.scripts.length).toBeGreaterThan(0);

    for (const file of index!.scripts) {
      const path = join(assetsDir!, "lang/fr/scenario", file);
      expect(existsSync(path), `script introuvable : ${file}`).toBe(true);
    }
  });

  it("l'index expose les ressources supplémentaires sans texte", () => {
    const raw = JSON.parse(readFileSync(LANG_FR_PATH, "utf-8"));
    const index = parseLanguageIndex(raw)!;
    expect(typeof index.extraAssets).toBe("object");
    for (const file of index.scripts) {
      const assets = index.extraAssets[file] ?? [];
      // Aucun texte de jeu/traduction ne doit apparaître dans les noms d'assets.
      expect(assets.every((a) => typeof a === "string")).toBe(true);
    }
  });

  it("les scripts traduits s'exécutent sans erreur bloquante", async () => {
    const raw = JSON.parse(readFileSync(LANG_FR_PATH, "utf-8"));
    const index = parseLanguageIndex(raw)!;
    const frDir = join(assetsDir!, "lang/fr/scenario");

    // Charge les scripts originaux comme fallback, puis surcharge les scripts traduits.
    const scriptTexts = new Map(originalListing?.scriptTexts ?? []);
    for (const file of index.scripts) {
      const path = join(frDir, file);
      const text = readFileSync(path, "utf-8");
      scriptTexts.set(file, text);
    }

    const errors: string[] = [];
    const maxStepsHits: string[] = [];
    for (const file of index.scripts) {
      const result = await auditScript(join(frDir, file), file, manifest, scriptTexts);
      if (result.errors.length > 0) errors.push(file);
      if (result.hitMaxSteps) maxStepsHits.push(file);
    }

    expect(errors).toEqual([]);
    expect(maxStepsHits).toEqual([]);
  });
});
