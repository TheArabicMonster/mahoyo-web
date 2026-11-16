/**
 * Restauration des assets après les tests e2e (#417).
 *
 * Si `prepare-assets.ts` a dû écrire dans un dossier personnalisé (sauvegarde marquée par
 * `.e2e-assets-backup.json`), on restaure l'état d'origine ici : Playwright exécute ce teardown
 * après les tests, **y compris lorsqu'un test échoue**.
 */
import { restoreFromMarker } from "./assets-backup.js";

export default function globalTeardown(): void {
  const publicDir = process.env.MAHOYO_E2E_ASSETS?.trim();
  if (!publicDir) return;
  if (restoreFromMarker(publicDir)) {
    console.log(`[e2e] assets restaurés depuis la sauvegarde (#417) : ${publicDir}`);
  }
}
