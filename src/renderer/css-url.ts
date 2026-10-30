/**
 * Écrit une URL de fond en CSS (`background-image`).
 *
 * Une URL sans guillemets (`url(/assets/bg/nom-(pluie).png)`) est invalide dès qu'elle
 * contient une parenthèse, un espace ou un guillemet : le navigateur ignore alors la
 * déclaration et l'image ne s'affiche pas, sans erreur. Les noms de ressources du jeu
 * en contiennent souvent (`山城01(近)`). L'URL est donc encodée, puis mise entre guillemets.
 */
export function cssUrl(url: string): string {
  return `url("${encodeURI(url)}")`;
}
