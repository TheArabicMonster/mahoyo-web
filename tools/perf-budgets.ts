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
import type { PerfBudgets, SceneBudgets } from "./perf-lib.js";

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

/**
 * Budgets `scene-ready` (#375, PERF-09) — seuils du plan [`docs/PERF_PLAN_OPUS.md`](../docs/PERF_PLAN_OPUS.md)
 * (§1). Mesurés par le banc local `npm run perf:scenes` (`reports/perf-scenes.json`) puis évalués par
 * `npm run perf` de façon **non bloquante** (avertissement explicite ; CI : voir `docs/CI.md`).
 *
 * - `coldP95Ms` : premier affichage d'une image, assets locaux, **sans préchargement** ;
 * - `preloadedP95Ms` : image **préchargée par le lookahead + cache chaud** (seuil non évaluable si
 *   la passe chaude ne contient pas de lookahead) ;
 * - `longTasksOver50` : blocages > 50 ms pendant une transition ;
 * - `inpMs` : INP au clic/touche d'avance ;
 * - `decodedCacheBytes` : cache décodé estimé (`w×h×4` par image chargée).
 *
 * Modifier un seuil = mise à jour de ce fichier ET du tableau de `docs/PERFORMANCE.md`.
 */
export const PERF_SCENE_BUDGETS: SceneBudgets = {
  coldP95Ms: { desktop: 100, mobile: 250 },
  preloadedP95Ms: { desktop: 16, mobile: 33 },
  longTasksOver50: { desktop: 0, mobile: 1 },
  inpMs: { desktop: 100, mobile: 200 },
  decodedCacheBytes: { desktop: 192 * 1024 * 1024, mobile: 64 * 1024 * 1024 },
};
