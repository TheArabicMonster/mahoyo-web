/**
 * Résolveur d'images d'interface avec repli (HUD-03, #189).
 *
 * Les images d'interface du jeu (cadres, fonds, illustration de titre) viennent du manifeste de
 * l'utilisateur ; elles ne sont jamais versionnées. Ce module :
 *
 * - `uiAsset(key)` renvoie l'URL de l'image, ou `null` si la clé est absente du manifeste ;
 * - `apply(root)` pose `--mh-asset-<clé>: url("…")` sur la racine de l'UI, **uniquement** pour les
 *   clés présentes. Une clé absente ne laisse aucune variable : la feuille de style retombe sur son
 *   repli CSS (`var(--mh-asset-x, none)`), et le navigateur ne lance aucune requête.
 *
 * Le module ne contient que des clés du manifeste (jamais d'URL ni de nom de fichier). La
 * convention est documentée dans `docs/DESIGN.md` §9.
 */

import type { AssetResolver } from "@/core/asset-resolver.js";
import { foldKey } from "@/core/asset-manifest.js";
import { cssUrl } from "@/renderer/css-url.js";

/** Préfixe des variables CSS posées par le résolveur. */
export const UI_ASSET_VAR_PREFIX = "--mh-asset-";

/**
 * Clés du manifeste des ornements décrits dans `docs/DESIGN.md` §5 (liste exacte, sans jokers).
 * Les écrans en ajoutent d'autres en passant leurs propres clés à `apply`.
 */
export const UI_ASSET_KEYS: readonly string[] = [
  // Voiles de fond
  "c_background",
  "c_system_background",
  "c_message_background",
  "c_sound_background",
  "archive_background",
  "save_background",
  "cg_background",
  // Feuillage et arabesques
  "c_kusa3",
  "save_kusa",
  "c_titleバー",
  // Fenêtre de message
  "txtwindow00",
  "q_txtwindow00",
  // Cadres de panneau et de sauvegarde
  "system_window",
  "font_window",
  "save_window",
  "load_window",
  "save_textwindow",
  // Boîte de dialogue
  "yesnodialog",
  "yesno_okbutton",
  "yesno_cancelbutton",
  // Historique
  "backlog_カーソルバー",
  "backlog_カーソル",
  "backlog_矢印下ボタン",
  "backlog_矢印上ボタン",
  "backlog_キャンセルボタン",
  // Lecteur audio
  "sound_再生ボタン",
  "sound_停止ボタン",
  "sound_volumeボタン",
  "sound_page1ボタン",
  // Galerie CG
  "cg_サムネイルウィンドウ",
  "cg_サムネイルカーソル",
  "cg_ページ移動バー",
  // Curseur de choix
  "selectcursor",
  "selectcursor_a",
];

/**
 * Nom de la variable CSS d'une clé : `--mh-asset-` + clé repliée (NFKC, minuscules), où toute suite
 * de caractères hors lettres Unicode, chiffres, `_` et `-` devient un `-`. Les lettres japonaises
 * sont conservées (un identifiant CSS les accepte), ce qui évite les collisions entre clés.
 * Renvoie `null` pour une clé vide.
 */
export function uiAssetVarName(key: string): string | null {
  const slug = foldKey(key)
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? null : `${UI_ASSET_VAR_PREFIX}${slug}`;
}

/** Source minimale d'URL d'images d'interface (satisfaite par `AssetResolver`). */
export type UiImageSource = Pick<AssetResolver, "uiImage">;

export type UiAssets = {
  /** URL de l'image d'interface (clé du manifeste), ou `null` si absente. */
  uiAsset(key: string): string | null;
  /**
   * Pose `--mh-asset-*` sur `root` pour chaque clé présente (par défaut `UI_ASSET_KEYS`) et
   * retire celles posées plus tôt par ce résolveur mais devenues absentes. Renvoie les noms
   * de variables posés.
   */
  apply(root: HTMLElement, keys?: readonly string[]): string[];
  /** Retire toutes les variables posées par ce résolveur sur `root`. */
  clear(root: HTMLElement): void;
};

export function createUiAssets(source: UiImageSource | undefined): UiAssets {
  // Variables posées par instance et par racine, pour pouvoir les retirer sans toucher au reste.
  const applied = new WeakMap<HTMLElement, Set<string>>();

  function uiAsset(key: string): string | null {
    if (!source || key.trim() === "") return null;
    return source.uiImage(key) || null;
  }

  function clear(root: HTMLElement): void {
    for (const name of applied.get(root) ?? []) root.style.removeProperty(name);
    applied.delete(root);
  }

  function apply(root: HTMLElement, keys: readonly string[] = UI_ASSET_KEYS): string[] {
    clear(root);
    const set = new Set<string>();
    for (const key of keys) {
      const name = uiAssetVarName(key);
      const url = name ? uiAsset(key) : null;
      if (!name || !url) continue;
      root.style.setProperty(name, cssUrl(url));
      set.add(name);
    }
    if (set.size > 0) applied.set(root, set);
    return [...set];
  }

  return { uiAsset, apply, clear };
}
