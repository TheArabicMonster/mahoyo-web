/**
 * Modèle pur de la grille de sauvegarde (HUD-10 / #196, docs/ANALYSE_HUD_ORIGINAL.md §2.3, écarts E9 et E36).
 *
 * L'écran d'origine affiche 8 emplacements par page (2 colonnes × 4 lignes) sur 15 pages, soit 120 positions.
 * Le port place ses deux emplacements spéciaux (auto, rapide) en tête de la page 1 : il reste donc 118
 * emplacements numérotés. Aucun accès au DOM ici : le module est testé seul et partagé avec le player.
 */
import type { SaveSlot, SlotId } from "./types.js";

export const SAVE_COLUMNS = 2;
export const SAVE_ROWS = 4;
export const SAVE_SLOTS_PER_PAGE = SAVE_COLUMNS * SAVE_ROWS;
export const SAVE_PAGE_COUNT = 15;
/** Portrait (#210) : grille 1 colonne × 4 lignes, le nombre de pages double (120 positions). */
export const SAVE_COLUMNS_PORTRAIT = 1;
export const SAVE_SLOTS_PER_PAGE_PORTRAIT = 4;
/** Emplacements spéciaux du port, dans l'ordre d'affichage (tête de la page 1). */
export const SPECIAL_SLOT_IDS = ["auto", "quick"] as const satisfies readonly SlotId[];
/** Positions de la grille (120). */
export const SAVE_POSITION_COUNT = SAVE_SLOTS_PER_PAGE * SAVE_PAGE_COUNT;
/** Emplacements numérotés : 1 à 118. */
export const NUMBERED_SLOT_COUNT = SAVE_POSITION_COUNT - SPECIAL_SLOT_IDS.length;
/** Longueur maximale d'un commentaire (la zone de la fiche est étroite). */
export const SAVE_COMMENT_MAX_LENGTH = 60;

export type GridKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/** Identifiants de tous les emplacements, dans l'ordre de la grille. */
export function saveSlotIds(): SlotId[] {
  return [...SPECIAL_SLOT_IDS, ...Array.from({ length: NUMBERED_SLOT_COUNT }, (_, i) => i + 1)];
}

export function isSpecialSlot(id: SlotId): id is (typeof SPECIAL_SLOT_IDS)[number] {
  return id === "auto" || id === "quick";
}

/** Nombre de pages pour une taille de page donnée (8 → 15 pages, 4 en portrait → 30). */
export function pageCountFor(perPage: number = SAVE_SLOTS_PER_PAGE): number {
  return Math.ceil(SAVE_POSITION_COUNT / perPage);
}

/** Ramène un numéro de page dans 1..N (valeur non finie : page 1). */
export function clampPage(page: number, perPage: number = SAVE_SLOTS_PER_PAGE): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(pageCountFor(perPage), Math.max(1, Math.trunc(page)));
}

/** Page (1..15) qui porte l'emplacement, ou null s'il n'est pas dans la grille. */
export function pageOfSlot(id: SlotId): number | null {
  const index = saveSlotIds().findIndex((s) => s === id);
  return index < 0 ? null : Math.floor(index / SAVE_SLOTS_PER_PAGE) + 1;
}

/**
 * Découpe les emplacements fournis en 15 pages de 8. Les emplacements absents de la liste sont complétés
 * par des emplacements vides ; ceux qui sortent de la grille (numéro > 118) sont ignorés.
 */
export function paginate(
  slots: readonly SaveSlot[],
  perPage: number = SAVE_SLOTS_PER_PAGE,
): SaveSlot[][] {
  const byId = new Map(slots.map((s) => [String(s.id), s] as const));
  const all = saveSlotIds().map((id) => byId.get(String(id)) ?? { id, data: null });
  return Array.from({ length: pageCountFor(perPage) }, (_, p) =>
    all.slice(p * perPage, (p + 1) * perPage),
  );
}

/** Déplace le curseur de la grille 2×4 (index 0..7, rangée par rangée) ; reste en place au bord. */
export function moveCursor(
  index: number,
  key: GridKey,
  columns: number = SAVE_COLUMNS,
): number {
  const cols = Math.max(1, columns);
  const col = index % cols;
  const row = Math.floor(index / cols);
  switch (key) {
    case "ArrowLeft":
      return col > 0 ? index - 1 : index;
    case "ArrowRight":
      return col < cols - 1 ? index + 1 : index;
    case "ArrowUp":
      return row > 0 ? index - cols : index;
    case "ArrowDown":
      return row < SAVE_ROWS - 1 ? index + cols : index;
  }
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Date de la fiche, format de l'original : `AAAA/MM/JJ hh:mm:ss` (heure locale, indépendant de la langue). */
export function formatSaveDate(timestamp: number): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
