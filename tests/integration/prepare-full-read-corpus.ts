/**
 * Génère un corpus de placeholders **originaux** pour la lecture complète (#269).
 *
 * Utilisé par la CI (et utilisable en local) pour exécuter le test `full-read` sans aucun asset du
 * jeu : manifeste, images, scripts du parcours complet puis des scripts `corpus-NNN.ks` couvrant
 * les commandes visuelles. Le corpus est écrit sous `<MAHOYO_E2E_ASSETS>/assets/` et contient un
 * marqueur `placeholder-corpus.json` (taille attendue par le test).
 *
 * Le code de génération est partagé avec l'e2e (`tests/e2e/placeholders.ts`).
 *
 * Usage :
 *   node --import tsx tests/integration/prepare-full-read-corpus.ts
 *
 * Variables :
 * - `MAHOYO_E2E_ASSETS` : dossier `publicDir` de sortie (défaut `<tmp>/mahoyo-full-read`) ;
 * - `MAHOYO_FULL_READ_SCRIPTS` : nombre de scripts narratifs à générer (défaut 221, taille du corpus
 *   de référence de la DoD v1.0).
 *
 * Puis :
 *   MAHOYO_ASSETS_DIR=<dossier>/assets npm run test:full-read
 */
import { tmpdir } from "os";
import { join } from "path";
import { FULL_READ_CORPUS_SIZE, generateFullReadCorpus } from "../e2e/placeholders.js";

const publicDir = process.env.MAHOYO_E2E_ASSETS?.trim() || join(tmpdir(), "mahoyo-full-read");
const fromEnv = Number.parseInt(process.env.MAHOYO_FULL_READ_SCRIPTS ?? "", 10);
const size = Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : FULL_READ_CORPUS_SIZE;

const marker = generateFullReadCorpus(publicDir, size);
const assetsDir = join(publicDir, "assets");
console.log(`[full-read] corpus de placeholders : ${marker.scripts} scripts → ${assetsDir}`);
console.log(`[full-read] lancer : MAHOYO_ASSETS_DIR=${assetsDir} npm run test:full-read`);
