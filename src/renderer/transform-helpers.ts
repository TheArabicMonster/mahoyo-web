/**
 * Helpers de construction des chaînes CSS `transform` pour le renderer.
 *
 * Tous les sprites (simples et partbg wrapper) sont centrés sur leur point
 * d'ancrage via `translate(-50%, -50%)`. L'image interne d'un partbg est
 * décalée selon le repère source avec un signe négatif, conformément au
 * document de sémantique §4.
 */

/** Transform d'un sprite simple ou d'un wrapper partbg (centrage + rotation + zoom). */
export function spriteTransform(props: {
  zoomx?: number;
  zoomy?: number;
  rotate?: number;
}): string {
  const { zoomx = 1, zoomy = 1, rotate = 0 } = props;
  return `translate(-50%, -50%) rotate(${rotate}deg) scale(${zoomx}, ${zoomy})`;
}

/**
 * Pivot de l'image interne d'un partbg : le centre de l'image, à sa taille d'origine. Comme pour
 * `@bg` (voir `renderTransformedBg`), l'image est d'abord posée en (-srcleft, -srctop), puis
 * zoomée autour de son propre centre. Avec un pivot au coin haut gauche, les `srcleft`/`srctop`
 * négatifs du corpus (30 % des `@partbg`) repoussaient l'image dans le coin de la fenêtre (#169).
 */
export const PARTBG_INNER_ORIGIN = "50% 50%";

/** Transform de l'image interne d'un partbg (offset source négatif + zoom source, pivot au centre). */
export function partbgInnerTransform(props: {
  srcleft?: number;
  srctop?: number;
  srczoomx?: number;
  srczoomy?: number;
}): string {
  const x = -(props.srcleft ?? 0);
  const y = -(props.srctop ?? 0);
  const zx = (props.srczoomx ?? 100) / 100;
  const zy = (props.srczoomy ?? 100) / 100;
  return `translate(${x}px, ${y}px) scale(${zx}, ${zy})`;
}

/** Transform du wrapper partbg pour centrer l'élément sur son point d'ancrage. */
export function partbgWrapperTransform(): string {
  return "translate(-50%, -50%)";
}
