/**
 * Accélération des interpolations d'une timeline (3e indicateur des keyframes, `accel`).
 *
 * Le jeu d'origine anime ses panoramiques, mouvements et fondus par interpolation
 * linéaire, sauf quand une ligne porte une accélération non nulle (valeurs observées :
 * 2, 3, 7 et 20). La formule exacte du jeu n'est pas connue ; on retient la convention de
 * KiriKiri pour `accel` (0 = vitesse constante, positif = accélération, négatif =
 * décélération) avec une loi de puissance :
 *
 *   k = 1 + ln(1 + |accel|)
 *   accel > 0 (départ lent)    : p(t) = t^k
 *   accel < 0 (arrivée douce)  : p(t) = 1 - (1 - t)^k
 *   accel = 0                  : p(t) = t
 *
 * `k` croît doucement avec |accel| (accel 3 -> 2,4 ; 7 -> 3,1 ; 20 -> 4,0) : un `accel` de 20
 * ne fige pas l'image pendant des secondes, et la courbe est continue en 0.
 * Ce module est pur : le runtime et le renderer l'utilisent avec les mêmes fonctions.
 */

/** Exposant de la loi de puissance pour une accélération donnée (1 si nulle). */
export function easeExponent(accel: number): number {
  return 1 + Math.log(1 + Math.abs(accel));
}

/** Progression eased dans [0, 1] pour une progression linéaire `t` dans [0, 1]. */
export function easeProgress(accel: number, t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  if (!accel || !Number.isFinite(accel)) return x;
  const k = easeExponent(accel);
  return accel > 0 ? Math.pow(x, k) : 1 - Math.pow(1 - x, k);
}

/** Nombre d'échantillons d'une fonction CSS `linear()`. */
const CSS_SAMPLES = 24;

let linearSupported: boolean | undefined;

/** Le navigateur comprend-il `linear(…)` comme fonction d'accélération CSS ? */
function supportsCssLinear(): boolean {
  if (linearSupported === undefined) {
    linearSupported =
      typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("transition-timing-function", "linear(0, 1)");
  }
  return linearSupported;
}

/**
 * Fonction d'accélération CSS d'une transition. `from` est la fraction (0..1) déjà
 * parcourue : la fonction décrit alors la queue de la courbe, ramenée à [0, 1] (un fond
 * qui poursuit son panoramique en s'effaçant).
 * Sans `linear()` (vieux navigateur), retombe sur `ease-in` / `ease-out` ; accélération
 * nulle : `linear`.
 */
export function cssEasing(accel: number, from = 0): string {
  if (!accel || !Number.isFinite(accel)) return "linear";
  if (!supportsCssLinear()) return accel > 0 ? "ease-in" : "ease-out";
  const p0 = easeProgress(accel, from);
  const span = 1 - p0;
  const points: string[] = [];
  for (let i = 0; i <= CSS_SAMPLES; i++) {
    const t = from + ((1 - from) * i) / CSS_SAMPLES;
    const y = span > 1e-9 ? (easeProgress(accel, t) - p0) / span : i / CSS_SAMPLES;
    points.push(String(Math.round(y * 10000) / 10000));
  }
  return `linear(${points.join(", ")})`;
}
