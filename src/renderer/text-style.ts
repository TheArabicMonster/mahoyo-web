/**
 * Conversion du style de texte KAG (@font) en propriétés CSS.
 *
 * Fonction pure, séparée du renderer pour pouvoir être testée sans DOM.
 */

import type { TextStyle } from "@/kag/types.js";

const DEFAULT_EDGE_COLOR = "#000000";
const DEFAULT_SHADOW_COLOR = "#000000";

/** Contour de 1px simulé avec quatre ombres décalées (le texte garde sa couleur). */
function outline(color: string): string {
  return [`-1px -1px 0 ${color}`, `1px -1px 0 ${color}`, `-1px 1px 0 ${color}`, `1px 1px 0 ${color}`].join(", ");
}

/**
 * Retourne les propriétés CSS (noms en kebab-case) correspondant au style.
 * Un style vide donne un objet vide.
 *
 * Le contour s'applique dès qu'une couleur de contour est fournie, sauf si
 * `edge` vaut explicitement `false` ; `edge=true` sans couleur utilise du noir.
 */
export function textStyleToCss(style: TextStyle): Record<string, string> {
  const css: Record<string, string> = {};
  if (style.face) css["font-family"] = `"${style.face.replace(/"/g, "")}", serif`;
  if (style.size !== undefined) css["font-size"] = `${style.size}px`;
  if (style.color) css["color"] = style.color;
  if (style.bold !== undefined) css["font-weight"] = style.bold ? "bold" : "normal";
  if (style.italic !== undefined) css["font-style"] = style.italic ? "italic" : "normal";

  const shadows: string[] = [];
  const edgeOn = style.edge === true || (style.edge !== false && style.edgeColor !== undefined);
  if (edgeOn) shadows.push(outline(style.edgeColor ?? DEFAULT_EDGE_COLOR));
  if (style.shadow === true) shadows.push(`2px 2px 2px ${style.shadowColor ?? DEFAULT_SHADOW_COLOR}`);
  if (shadows.length > 0) css["text-shadow"] = shadows.join(", ");

  return css;
}
