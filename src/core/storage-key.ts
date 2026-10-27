/**
 * Normalisation unique des clés de storage KAG.
 *
 * KiriKiri résout les storages par nom de fichier seul, sans dossier, sans
 * extension et sans tenir compte de la casse. Le suffixe `|x` désigne une
 * variante d'expression (couleur, visage) gérée par le moteur ; le fichier
 * sur disque ne le porte pas.
 *
 * Cette fonction est partagée par le parser, le resolver et le pipeline pour
 * garantir que tous parlent la même "clé" pour un même asset.
 */

/**
 * Transforme une référence storage brute en clé normalisée.
 *
 * Étapes :
 * 1. Retire les guillemets environnants (`"foo"` → `foo`)
 * 2. Retire le suffixe d'expression (`山城01(近)|b` → `山城01(近)`)
 * 3. Ne garde que le nom de fichier sans dossier (`bg/night` → `night`)
 * 4. Retire l'extension (`.tlg`, `.png`, `.ogg`, `.ks`, etc.)
 * 5. Passe en minuscules
 */
export function storageKey(raw: string): string {
  if (!raw) return "";

  let s = raw.trim();

  // 1. Retirer les guillemets.
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1);
  }

  // 2. Retirer le suffixe d'expression |x.
  s = s.split("|")[0] ?? s;

  // 3. Ne garder que le nom de fichier (sans dossier).
  const lastSep = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  if (lastSep >= 0) s = s.slice(lastSep + 1);

  // 4. Retirer l'extension.
  const dot = s.lastIndexOf(".");
  if (dot > 0) s = s.slice(0, dot);

  // 5. Minuscules.
  return s.toLowerCase();
}

/**
 * Détermine si une clé de storage correspond à une couleur solide
 * (black, white, red, etc.) plutôt qu'un fichier.
 */
const SOLID_COLORS = new Set([
  "black",
  "white",
  "red",
  "blue",
  "green",
  "yellow",
  "gray",
  "grey",
  "orange",
  "purple",
  "pink",
  "brown",
  "none",
  "transparent",
]);

export function isSolidColor(storage: string): boolean {
  return SOLID_COLORS.has(storageKey(storage));
}
