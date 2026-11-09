/**
 * Budgets de performance du player (#100).
 *
 * Chaque budget est un plafond (sauf `transitionFpsMin`, un plancher) avec une marge volontaire sur
 * la mesure de référence : l'objectif est de **détecter une régression**, pas de verrouiller un
 * chiffre machine à la milliseconde près. Les mesures et les marges sont documentées dans
 * `docs/PERFORMANCE.md` ; le script `npm run perf` les rejoue.
 *
 * Modifier un budget = décision explicite : mettre à jour ce fichier ET le tableau de référence de
 * `docs/PERFORMANCE.md` dans le même commit.
 */
import type { PerfBudgets } from "./perf-lib.js";

export const PERF_BUDGETS: PerfBudgets = {
  /** Bundle JS total (entrée + chunks), gzip — référence v1.0 : ~104 Ko. */
  jsGzipBytes: 130 * 1024,
  /** Bundle CSS total, gzip — référence v1.0 : ~13 Ko. */
  cssGzipBytes: 20 * 1024,
  /**
   * Build complet `tsc && vite build`. Référence locale : ~7 s ; marge large pour les runners CI
   * plus lents (build Vite mesuré ~1,3 s, le reste est `tsc`).
   */
  buildMs: 60_000,
  /** Premier rendu : écran titre visible, depuis le début de la navigation (Chromium headless). */
  firstRenderMs: 1_500,
  /** Requêtes HTTP émises jusqu'à l'affichage du titre (placeholders, hors cache). */
  startupRequests: 40,
  /** Mémoire JS utilisée après le premier rendu (Chromium). */
  heapUsedBytes: 96 * 1024 * 1024,
  /** Fluidité de la transition titre → jeu : plancher d'images par seconde. */
  transitionFpsMin: 50,
  /** Fluidité : p95 des intervalles entre images (20 ms ≈ 50 fps). */
  transitionP95FrameMs: 25,
};
