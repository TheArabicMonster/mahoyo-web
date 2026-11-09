import { prepareE2eAssets } from "./prepare-assets.js";

/**
 * Contrôle (et journalise) la préparation des assets e2e.
 *
 * La génération a lieu **avant** le serveur Vite, dans la commande `webServer` de
 * `playwright.config.ts` (voir `tests/e2e/prepare-assets.ts`). Ici on re-valide le mode courant :
 * une erreur de configuration (assets réels incomplets) échoue d'un coup avec un message clair,
 * sans laisser 58 tests échouer en cascade.
 */
export default function globalSetup() {
  const { publicDir, mode } = prepareE2eAssets();
  console.log(`[e2e] assets ${mode === "real" ? "réels" : "placeholders"} : ${publicDir}`);
}
