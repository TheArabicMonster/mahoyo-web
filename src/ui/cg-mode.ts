/**
 * CG mode (HUD-15, #208 ; docs/ANALYSE_HUD_ORIGINAL.md §2.11, docs/DESIGN.md §2.4, §8 et §9.13).
 *
 * Écran de galerie ouvert depuis le sous-menu Extra du titre : grille responsive (2 à 4 colonnes),
 * vignettes calculées **à l'exécution** depuis les assets de l'utilisateur (aucune miniature
 * commitée), libellé « image non affichée » pour une CG verrouillée, visionneuse plein écran avec
 * zoom et navigation précédent/suivant, navigation clavier et sélection sans couleur seule (bord
 * épais + marqueur).
 *
 * Module autonome : il ne connaît ni le gestionnaire d'UI ni le player. L'appelant fournit le
 * catalogue (dérivé du manifeste d'assets, voir `buildCgCatalog`), l'ensemble des clés déjà vues
 * (donnée de progression, `src/player/cg-seen.ts`) et l'action de retour.
 *
 * Les entrées du catalogue ne sont que des **clés** du manifeste et des URL fournies par le
 * résolveur : le dépôt ne contient aucune image du jeu. Une clé absente ou verrouillée ne déclenche
 * aucune requête.
 */
import { t } from "./i18n.js";
import { NIGHT_CLASS } from "./night.js";
import { UI_ASSET_KEYS } from "./ui-assets.js";
import "./cg-mode.css";

/** Image du manifeste fournie par le résolveur d'assets (`imageEntries`). */
export type CgImage = {
  /** Clé du manifeste (nom normalisé, sans extension). */
  key: string;
  /** URL complète de l'image (calculée par le résolveur). */
  url: string;
  /** Kind du manifeste : `bg`, `image` ou `rule`. */
  kind: string;
  /** Chemin source d'origine (ex. `image/cg01.tlg`) : sert à distinguer les CG des sprites. */
  source: string;
};

/** Catégories de l'écran d'origine : Évènement (CG) et Arrière-plan (fonds). */
export type CgCategory = "event" | "background";

/** Entrée affichée dans la grille. */
export type CgEntry = {
  key: string;
  url: string;
  category: CgCategory;
};

export type CgCatalog = {
  event: readonly CgEntry[];
  /** Fonds du jeu : l'original a une bascule Évènement / Arrière-plan. */
  background: readonly CgEntry[];
};

export type BuildCgCatalogOptions = {
  /** Clés à ne jamais afficher (ornements d'interface). Défaut : `UI_ASSET_KEYS`. */
  excluded?: ReadonlySet<string>;
};

/** Dossiers sources (pipeline, `docs/PIPELINE.md`) : `fg/` = sprites, pas des CG. */
const SPRITE_DIR = "fg/";
const BACKGROUND_DIR = "bg/";

function normalizedSource(source: string): string {
  return source.replace(/\\/g, "/").toLowerCase();
}

/**
 * Construit le catalogue à partir des entrées d'images du manifeste de l'utilisateur.
 *
 * Convention (documentée dans `docs/DESIGN.md` §9.13) : le kind du manifeste vient du dossier de
 * classification du pipeline (`tools/inventory.ts`). Les images de `image/` sont les CG
 * « évènement », celles de `bg/` sont les « arrière-plan ». Les sprites (`fg/`) et les rules de
 * transition sont exclus, ainsi que les ornements d'interface (`UI_ASSET_KEYS`). L'ordre est stable
 * (tri par clé, comparaison numérique) pour que la grille ne change pas entre deux ouvertures.
 */
export function buildCgCatalog(
  images: readonly CgImage[],
  options: BuildCgCatalogOptions = {},
): CgCatalog {
  const excluded = options.excluded ?? new Set(UI_ASSET_KEYS);
  const event: CgEntry[] = [];
  const background: CgEntry[] = [];
  const seenKeys = new Set<string>();

  for (const image of images) {
    const key = image.key;
    if (!key || seenKeys.has(key) || excluded.has(key)) continue;
    if (image.kind === "rule") continue;
    const source = normalizedSource(image.source ?? "");
    // Sprites (fg/) : ce ne sont pas des CG de galerie.
    if (source.startsWith(SPRITE_DIR)) continue;

    const category: CgCategory =
      source.startsWith(BACKGROUND_DIR) || image.kind === "bg"
        ? "background"
        : "event";
    seenKeys.add(key);
    const entry: CgEntry = { key, url: image.url, category };
    (category === "event" ? event : background).push(entry);
  }

  const byKey = (a: CgEntry, b: CgEntry): number => a.key.localeCompare(b.key, "ja", { numeric: true });
  return { event: event.sort(byKey), background: background.sort(byKey) };
}

/** Nombre total de CG du catalogue. */
export function cgCatalogSize(catalog: CgCatalog): number {
  return catalog.event.length + catalog.background.length;
}

/** Nombre de colonnes de la grille (bornes 2–4 ; jsdom sans mise en page : 4). */
const CG_COLUMNS_MAX = 4;
const CG_MIN_ZOOM = 1;
const CG_MAX_ZOOM = 4;
const CG_ZOOM_STEP = 0.5;
/** Classe de l'écran (doit rester alignée avec `cg-mode.css`). */
export const CG_SCREEN_CLASS = "mh-cg-screen";

export type CgModeOptions = {
  catalog: CgCatalog;
  /** Clés des CG déjà vues (données de progression) : seules celles-ci sont affichées. */
  seen: ReadonlySet<string>;
  /** Retour au sous-menu Extra (bouton Retour ou Échap). */
  onClose(): void;
};

export type CgMode = {
  element: HTMLElement;
  /** Place le focus sur le premier élément utilisable (onglet actif, sinon Retour). */
  focusFirst(): void;
  /** Retire les listeners globaux ; l'appelant retire l'élément du DOM. */
  destroy(): void;
  readonly category: CgCategory;
  readonly viewerOpen: boolean;
  readonly selectedKey: string | null;
};

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function button(cls: string, label: string, ariaLabel?: string): HTMLButtonElement {
  const btn = h("button", cls, label);
  btn.type = "button";
  if (ariaLabel) btn.setAttribute("aria-label", ariaLabel);
  return btn;
}

/** Colonnes effectives de la grille (fallback 4 hors mise en page). */
function gridColumns(grid: HTMLElement): number {
  try {
    const value = getComputedStyle(grid).gridTemplateColumns;
    const count = value.split(/\s+/).filter(Boolean).length;
    return count >= 2 ? Math.min(count, CG_COLUMNS_MAX) : CG_COLUMNS_MAX;
  } catch {
    return CG_COLUMNS_MAX;
  }
}

export function createCgMode(options: CgModeOptions): CgMode {
  const { catalog, onClose } = options;
  const seen = new Set(options.seen);

  let category: CgCategory = catalog.event.length > 0 || catalog.background.length === 0 ? "event" : "background";
  let viewerOpen = false;
  let selectedKey: string | null = null;
  let zoom = 1;
  let destroyed = false;

  const screen = h("section", `${CG_SCREEN_CLASS} ${NIGHT_CLASS}`);
  screen.setAttribute("role", "dialog");
  screen.setAttribute("aria-modal", "true");
  screen.setAttribute("aria-label", t("cg.title"));
  screen.dataset.category = category;

  // ── En-tête : titre + bascule Évènement / Arrière-plan ──
  const header = h("header", "mh-cg-header");
  header.appendChild(h("h2", "mh-cg-title", t("cg.title")));

  const tabs = h("div", "mh-cg-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", t("cg.title"));
  const tabButtons: Record<CgCategory, HTMLButtonElement> = {
    event: button("mh-cg-tab", t("cg.tab.event")),
    background: button("mh-cg-tab", t("cg.tab.background")),
  };
  for (const key of ["event", "background"] as const) {
    const btn = tabButtons[key];
    btn.setAttribute("role", "tab");
    btn.id = `ui-cg-tab-${key}`;
    btn.dataset.category = key;
    btn.setAttribute("aria-controls", "ui-cg-panel");
    btn.setAttribute("aria-selected", "false");
    btn.tabIndex = -1;
    btn.addEventListener("click", () => setCategory(key));
    tabs.appendChild(btn);
  }
  header.appendChild(tabs);
  screen.appendChild(header);

  // ── Grille (une seule zone, remplie pour la catégorie active) ──
  const grid = h("ul", "mh-cg-grid");
  grid.id = "ui-cg-panel";
  grid.setAttribute("role", "tabpanel");
  grid.setAttribute("aria-labelledby", `ui-cg-tab-${category}`);
  const empty = h("p", "mh-cg-empty", t("cg.empty"));
  empty.hidden = true;
  const scroll = h("div", "mh-cg-scroll");
  scroll.append(grid, empty);
  screen.appendChild(scroll);

  // ── Pied : Retour ──
  const footer = h("footer", "mh-cg-footer");
  const back = button("mh-cg-back", t("common.back"));
  back.addEventListener("click", () => onClose());
  footer.appendChild(back);
  screen.appendChild(footer);

  // ── Visionneuse plein écran ──
  const viewer = h("section", "mh-cg-viewer");
  viewer.setAttribute("role", "dialog");
  viewer.setAttribute("aria-modal", "true");
  viewer.setAttribute("aria-label", t("cg.viewer.label"));
  viewer.hidden = true;
  viewer.tabIndex = -1;
  const viewerImage = document.createElement("img");
  viewerImage.className = "mh-cg-viewer-image";
  viewerImage.alt = "";
  viewerImage.decoding = "async";
  const viewerFrame = h("div", "mh-cg-viewer-frame");
  viewerFrame.appendChild(viewerImage);
  const viewerBar = h("div", "mh-cg-viewer-bar");
  const prev = button("mh-cg-viewer-button mh-cg-viewer-prev", "‹", t("cg.viewer.prev"));
  const zoomOut = button("mh-cg-viewer-button", "−", t("cg.viewer.zoomOut"));
  const zoomReset = button("mh-cg-viewer-button", "1:1", t("cg.viewer.zoomReset"));
  const zoomIn = button("mh-cg-viewer-button", "+", t("cg.viewer.zoomIn"));
  const next = button("mh-cg-viewer-button mh-cg-viewer-next", "›", t("cg.viewer.next"));
  const close = button("mh-cg-viewer-button mh-cg-viewer-close", t("common.back"), t("cg.viewer.close"));
  const caption = h("p", "mh-cg-viewer-caption");
  caption.setAttribute("aria-live", "polite");
  viewerBar.append(prev, zoomOut, zoomReset, zoomIn, next, caption, close);
  viewer.append(viewerFrame, viewerBar);
  screen.appendChild(viewer);

  const setZoom = (value: number): void => {
    zoom = Math.min(CG_MAX_ZOOM, Math.max(CG_MIN_ZOOM, value));
    viewerFrame.style.setProperty("--mh-cg-zoom", String(zoom));
    zoomReset.disabled = zoom <= CG_MIN_ZOOM;
    zoomIn.disabled = zoom >= CG_MAX_ZOOM;
    viewerFrame.dataset.zoom = String(zoom);
  };

  const entries = (): readonly CgEntry[] => catalog[category];
  const viewableEntries = (): readonly CgEntry[] => entries().filter((entry) => seen.has(entry.key));

  let viewerKey: string | null = null;

  const currentViewerIndex = (): number => {
    const list = viewableEntries();
    const index = list.findIndex((entry) => entry.key === viewerKey);
    return index < 0 ? 0 : index;
  };

  const showViewerAt = (index: number): void => {
    const list = viewableEntries();
    if (list.length === 0) return;
    const wrapped = ((index % list.length) + list.length) % list.length;
    const entry = list[wrapped]!;
    viewerKey = entry.key;
    viewerImage.src = entry.url;
    viewerImage.alt = "";
    caption.textContent = `${wrapped + 1} / ${list.length}`;
    setZoom(CG_MIN_ZOOM);
    viewerOpen = true;
    viewer.hidden = false;
    viewer.focus();
  };

  const openViewer = (key: string): void => {
    const list = viewableEntries();
    const index = list.findIndex((entry) => entry.key === key);
    if (index < 0) return;
    showViewerAt(index);
  };

  const closeViewer = (): void => {
    viewerOpen = false;
    viewer.hidden = true;
    viewerImage.removeAttribute("src");
    viewerKey = null;
    const tile = tiles.find((candidate) => candidate.dataset.key === selectedKey);
    tile?.focus();
  };

  const stepViewer = (delta: number): void => {
    if (!viewerOpen) return;
    showViewerAt(currentViewerIndex() + delta);
  };

  prev.addEventListener("click", () => stepViewer(-1));
  next.addEventListener("click", () => stepViewer(1));
  close.addEventListener("click", () => closeViewer());
  zoomOut.addEventListener("click", () => setZoom(zoom - CG_ZOOM_STEP));
  zoomIn.addEventListener("click", () => setZoom(zoom + CG_ZOOM_STEP));
  zoomReset.addEventListener("click", () => setZoom(CG_MIN_ZOOM));
  viewerFrame.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      setZoom(zoom + (event.deltaY < 0 ? CG_ZOOM_STEP : -CG_ZOOM_STEP));
    },
    { passive: false },
  );

  // ── Onglets ──
  function setCategory(next: CgCategory): void {
    category = next;
    screen.dataset.category = category;
    grid.setAttribute("aria-labelledby", `ui-cg-tab-${category}`);
    for (const key of ["event", "background"] as const) {
      const active = key === category;
      tabButtons[key].setAttribute("aria-selected", active ? "true" : "false");
      tabButtons[key].tabIndex = active ? 0 : -1;
    }
    closeViewer();
    renderGrid();
    const first = tiles[0];
    if (first) first.focus();
    else tabButtons[category].focus();
  }

  // ── Grille ──
  let tiles: HTMLButtonElement[] = [];

  function renderGrid(): void {
    grid.replaceChildren();
    tiles = [];
    const list = entries();
    empty.hidden = list.length > 0;
    list.forEach((entry, index) => {
      const unlocked = seen.has(entry.key);
      const li = document.createElement("li");
      li.className = "mh-cg-cell";
      const tile = button("mh-cg-tile", "");
      tile.dataset.key = entry.key;
      tile.dataset.locked = unlocked ? "false" : "true";
      tile.setAttribute("aria-label", unlocked ? t("cg.open", { n: String(index + 1) }) : t("cg.lockedHint", { n: String(index + 1) }));
      if (unlocked) {
        tile.classList.add("is-unlocked");
        const img = document.createElement("img");
        img.className = "mh-cg-thumb";
        img.src = entry.url;
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = "";
        tile.appendChild(img);
      } else {
        tile.classList.add("is-locked");
        tile.setAttribute("aria-disabled", "true");
        tile.tabIndex = -1; // atteinte par les flèches, pas par Tab
        const label = h("span", "mh-cg-tile-locked", t("cg.locked"));
        tile.appendChild(label);
        const mark = h("span", "mh-cg-tile-lock-marker");
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = "×";
        tile.appendChild(mark);
      }
      tile.addEventListener("click", () => {
        if (unlocked) openViewer(entry.key);
      });
      li.appendChild(tile);
      grid.appendChild(li);
      tiles.push(tile);
    });
    updateSelection();
  }

  const updateSelection = (): void => {
    for (const tile of tiles) {
      const selected = tile.dataset.key === selectedKey;
      tile.classList.toggle("is-selected", selected);
      if (selected) tile.setAttribute("aria-current", "true");
      else tile.removeAttribute("aria-current");
    }
  };

  const focusTile = (index: number): void => {
    const clamped = Math.min(tiles.length - 1, Math.max(0, index));
    tiles[clamped]?.focus();
  };

  const onGridFocusIn = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    const tile = target?.closest<HTMLButtonElement>(".mh-cg-tile");
    if (!tile) return;
    selectedKey = tile.dataset.key ?? null;
    updateSelection();
  };
  grid.addEventListener("focusin", onGridFocusIn);

  // ── Clavier global (capture : l'écran prime sur le menu du titre) ──
  const onKeyDown = (event: KeyboardEvent): void => {
    if (destroyed) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (viewerOpen) closeViewer();
      else onClose();
      return;
    }
    if (viewerOpen) {
      switch (event.key) {
        case "ArrowLeft":
        case "PageUp":
          event.preventDefault();
          event.stopPropagation();
          stepViewer(-1);
          return;
        case "ArrowRight":
        case "PageDown":
          event.preventDefault();
          event.stopPropagation();
          stepViewer(1);
          return;
        case "+":
        case "=":
          event.preventDefault();
          event.stopPropagation();
          setZoom(zoom + CG_ZOOM_STEP);
          return;
        case "-":
        case "_":
          event.preventDefault();
          event.stopPropagation();
          setZoom(zoom - CG_ZOOM_STEP);
          return;
        case "0":
          event.preventDefault();
          event.stopPropagation();
          setZoom(CG_MIN_ZOOM);
          return;
        default:
          return;
      }
    }
    if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
      // Bascule des onglets quand le focus est dedans.
      const active = document.activeElement as HTMLElement | null;
      const tab = active?.closest<HTMLButtonElement>(".mh-cg-tab");
      if (tab) {
        event.preventDefault();
        event.stopPropagation();
        const keys: CgCategory[] = ["event", "background"];
        const index = keys.indexOf(category);
        let target = index;
        if (event.key === "ArrowRight") target = (index + 1) % keys.length;
        else if (event.key === "ArrowLeft") target = (index + keys.length - 1) % keys.length;
        else if (event.key === "Home") target = 0;
        else if (event.key === "End") target = keys.length - 1;
        setCategory(keys[target]!);
        return;
      }
      const current = tiles.indexOf(document.activeElement as HTMLButtonElement);
      if (current < 0) return;
      event.preventDefault();
      event.stopPropagation();
      const columns = gridColumns(grid);
      switch (event.key) {
        case "ArrowRight":
          focusTile(current + 1);
          break;
        case "ArrowLeft":
          focusTile(current - 1);
          break;
        case "ArrowDown":
          focusTile(current + columns);
          break;
        case "ArrowUp":
          focusTile(current - columns);
          break;
        case "Home":
          focusTile(0);
          break;
        case "End":
          focusTile(tiles.length - 1);
          break;
      }
    }
  };
  document.addEventListener("keydown", onKeyDown, true);

  // ── État initial ──
  setCategory(category);
  if (tiles.length === 0 && cgCatalogSize(catalog) === 0) back.focus();

  return {
    element: screen,
    focusFirst(): void {
      const firstUnlocked = tiles.find((tile) => tile.dataset.locked === "false");
      (firstUnlocked ?? tiles[0] ?? tabButtons[category] ?? back).focus();
    },
    destroy(): void {
      destroyed = true;
      document.removeEventListener("keydown", onKeyDown, true);
      grid.removeEventListener("focusin", onGridFocusIn);
      viewerOpen = false;
    },
    get category(): CgCategory {
      return category;
    },
    get viewerOpen(): boolean {
      return viewerOpen;
    },
    get selectedKey(): string | null {
      return selectedKey;
    },
  };
}
