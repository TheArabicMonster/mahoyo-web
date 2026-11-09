/**
 * Écran titre au design d'origine (HUD-07, #195 ; docs/ANALYSE_HUD_ORIGINAL.md §2.1, docs/DESIGN.md §2.1).
 *
 * Module autonome : il ne connaît ni `DomUIManager` ni le player. Le gestionnaire d'UI lui fournit les
 * actions (déjà protégées contre les entrées bloquées) et, facultativement, le résolveur d'images
 * d'interface. Sans image du jeu, le repli en CSS pur (dégradé crème, titre textuel) reste lisible.
 *
 * Structure :
 *   section.mh-ui-title-screen
 *     div.mh-ui-title-main
 *       h1.mh-ui-title-logo        logo (image `title_titlelogo`) ou titre textuel
 *       nav.mh-ui-title-menu       <button> : Start, Load, [Continuer], Flowchart, Config, Extra
 *       nav.mh-ui-title-extra-menu <button> : Archive, Cgmode, Soundmode, Back (HUD-08, #199)
 *       p.mh-ui-title-legal        mention de droits
 *     section.mh-ui-title-extra    (ouverte par Archive) liste des chapitres, voir `archive-view.ts`
 *
 * Extra remplace sur place les entrées du menu par celles du sous-menu (fondu croisé ≈ 1 s, sans
 * animation sous `prefers-reduced-motion`). Pas d'entrée Flowchart dans Extra (décision 2 du propriétaire).
 * Archive est grisée tant qu'aucun chapitre n'est déverrouillé ; Cgmode et Soundmode le restent tant que
 * leurs écrans (#208, #209) n'existent pas : l'action correspondante est alors absente de `TitleActions`.
 *
 * Clavier : flèches haut/bas (et gauche/droite) déplacent le focus, Début/Fin vont aux extrémités,
 * Entrée/Espace activent le bouton (natif), Échap = Back (sous-menu) ou retour au sous-menu (Archive).
 * Les entrées grisées restent atteignables (`aria-disabled`) et décrites par un texte masqué.
 */
import { createArchiveView, type ArchiveView } from "./archive-view.js";
import { t } from "./i18n.js";
import type { ScriptSummary } from "./types.js";
import type { UiAssets } from "./ui-assets.js";
import "./title-screen.css";

/** Clés du manifeste propres à l'écran titre (illustration plein cadre, logo), à passer à `UiAssets.apply`. */
export const TITLE_ASSET_KEYS: readonly string[] = ["title_background", "title_titlelogo"];

export type TitleActions = {
  /** Nouvelle partie : lance le premier script. */
  start(file: string): void;
  /** Reprise de l'autosave. */
  continueGame(): void;
  load(): void;
  flowchart(): void;
  config(): void;
  /** Lance un chapitre choisi dans Extra > Archive. */
  startChapter(file: string): void;
  /** Écran CG (HUD-15, #208). Absent : l'entrée Cgmode est grisée. */
  cgMode?(): void;
  /** Écran Sound (HUD-16, #209). Absent : l'entrée Soundmode est grisée. */
  soundMode?(): void;
};

export type TitleScreenOptions = {
  scripts: readonly ScriptSummary[];
  hasContinue: boolean;
  /**
   * Identifiants (`ScriptSummary.id`) des chapitres déverrouillés (règle : `unlockedChapterIds`).
   * Absent = tous (aucune information de progression).
   */
  unlockedChapters?: readonly string[];
  actions: TitleActions;
  /** Résolveur d'images d'interface ; absent = repli CSS seul. */
  uiAssets?: Pick<UiAssets, "uiAsset">;
};

export type TitleView = "main" | "extra" | "archive";

export type TitleScreen = {
  el: HTMLElement;
  /** Place le focus sur le menu (conteneur), sans ring : les flèches amènent ensuite sur une entrée. */
  focusMenu(): void;
  /** Vue affichée : menu principal, sous-menu Extra ou liste Archive. */
  readonly view: TitleView;
};

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function entry(label: string, id: string, run: () => void, cls = ""): HTMLButtonElement {
  const btn = h("button", `mh-ui-title-entry ${cls}`.trim(), label);
  btn.type = "button";
  btn.dataset.entry = id;
  btn.addEventListener("click", run);
  return btn;
}

/** Index suivant dans une liste cyclique de `count` éléments. */
function cycle(index: number, delta: number, count: number): number {
  return (index + delta + count) % count;
}

/** Flèches, Début, Fin : déplacent le focus dans un menu vertical (parcours en boucle). */
function bindMenuKeys(menu: HTMLElement, list: readonly HTMLButtonElement[]): void {
  menu.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const current = list.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = current < 0 ? 0 : cycle(current, 1, list.length);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = current < 0 ? list.length - 1 : cycle(current, -1, list.length);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = list.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    list[next]?.focus();
  });
}

export function createTitleScreen(options: TitleScreenOptions): TitleScreen {
  const { scripts, hasContinue, actions, uiAssets, unlockedChapters } = options;

  const el = h("section", "mh-ui-title-screen");
  const main = h("div", "mh-ui-title-main");

  // Logo : l'image du manifeste si elle existe, sinon le titre textuel (repli CSS).
  const logo = h("h1", "mh-ui-title-logo");
  logo.appendChild(h("span", "mh-ui-title-logo-text", t("common.gameTitle")));
  if (uiAssets?.uiAsset("title_titlelogo")) logo.classList.add("mh-ui-title-logo-image");

  // Menu : 4 entrées d'origine (Start, Load, Config, Extra) + 2 ajouts du port après Load.
  const nav = h("nav", "mh-ui-title-menu");
  nav.setAttribute("aria-label", t("title.menu"));
  nav.tabIndex = -1;

  const first = scripts[0];
  const buttons: HTMLButtonElement[] = [];
  if (first) buttons.push(entry(t("title.entry.start"), "start", () => actions.start(first.file), "mh-ui-new-game"));
  buttons.push(entry(t("title.entry.load"), "load", () => actions.load()));
  if (hasContinue) buttons.push(entry(t("title.continue"), "continue", () => actions.continueGame(), "mh-ui-continue"));
  buttons.push(entry(t("title.flowchart"), "flowchart", () => actions.flowchart()));
  buttons.push(entry(t("title.entry.config"), "config", () => actions.config()));
  const extraButton = entry(t("title.entry.extra"), "extra", () => openExtra());
  extraButton.setAttribute("aria-haspopup", "true");
  extraButton.setAttribute("aria-expanded", "false");
  buttons.push(extraButton);
  nav.append(...buttons);
  bindMenuKeys(nav, buttons);

  // ── Sous-menu Extra (HUD-08, #199) : remplace les entrées sur place, fondu croisé ──

  const hasUnlocked = unlockedChapters === undefined ? scripts.length > 0 : unlockedChapters.length > 0;
  const submenu = h("nav", "mh-ui-title-extra-menu is-away");
  submenu.setAttribute("aria-label", t("title.extra.menu"));
  submenu.setAttribute("inert", "");

  /** Entrée du sous-menu ; `lockedHint` = grisée (`aria-disabled`, décrite par ce texte), sans action. */
  function extraEntry(label: string, id: string, run: () => void, lockedHint?: string): HTMLButtonElement {
    const btn = h("button", "mh-ui-title-entry mh-ui-title-extra-entry", label);
    btn.type = "button";
    btn.dataset.entry = id;
    if (lockedHint) {
      btn.classList.add("is-locked");
      btn.setAttribute("aria-disabled", "true");
      const hint = h("span", "mh-ui-title-hint", lockedHint);
      hint.id = `mh-title-hint-${id}`;
      btn.setAttribute("aria-describedby", hint.id);
      btn.title = lockedHint;
      submenu.appendChild(hint);
    }
    btn.addEventListener("click", () => {
      if (!lockedHint) run();
    });
    return btn;
  }

  const extraButtons: HTMLButtonElement[] = [
    extraEntry(t("title.entry.archive"), "archive", () => openArchive(), hasUnlocked ? undefined : t("title.extra.archiveLocked")),
    extraEntry(t("title.entry.cgmode"), "cgmode", () => actions.cgMode?.(), actions.cgMode ? undefined : t("title.extra.comingSoon")),
    extraEntry(
      t("title.entry.soundmode"),
      "soundmode",
      () => actions.soundMode?.(),
      actions.soundMode ? undefined : t("title.extra.comingSoon"),
    ),
    extraEntry(t("title.entry.back"), "back", () => closeExtra()),
  ];
  submenu.prepend(...extraButtons);
  bindMenuKeys(submenu, extraButtons);

  const legal = h("p", "mh-ui-title-legal", t("title.legal"));
  main.append(logo, nav, submenu, legal);
  el.appendChild(main);

  let current: TitleView = "main";
  let archive: ArchiveView | null = null;

  function openExtra(): void {
    if (current !== "main") return;
    current = "extra";
    nav.classList.add("is-away");
    nav.setAttribute("inert", "");
    submenu.classList.remove("is-away");
    submenu.removeAttribute("inert");
    extraButton.setAttribute("aria-expanded", "true");
    extraButtons[0]?.focus(); // Archive, même grisée : le clavier en apprend la raison via son texte d'aide
  }

  function closeExtra(): void {
    if (current !== "extra") return;
    current = "main";
    submenu.classList.add("is-away");
    submenu.setAttribute("inert", "");
    nav.classList.remove("is-away");
    nav.removeAttribute("inert");
    extraButton.setAttribute("aria-expanded", "false");
    extraButton.focus();
  }

  function openArchive(): void {
    if (current !== "extra") return;
    current = "archive";
    archive = createArchiveView({
      scripts,
      unlocked: unlockedChapters,
      onStart: (file) => actions.startChapter(file),
      onClose: closeArchive,
    });
    main.setAttribute("inert", "");
    main.setAttribute("aria-hidden", "true");
    el.appendChild(archive.el);
    archive.focusFirst();
  }

  function closeArchive(): void {
    if (current !== "archive") return;
    current = "extra";
    archive?.el.remove();
    archive = null;
    main.removeAttribute("inert");
    main.removeAttribute("aria-hidden");
    extraButtons[0]?.focus();
  }

  // Échap = Back depuis le sous-menu (l'Archive gère la sienne et stoppe la propagation).
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || current !== "extra") return;
    e.preventDefault();
    e.stopPropagation();
    closeExtra();
  });

  return {
    el,
    focusMenu: () => nav.focus({ preventScroll: true }),
    get view() {
      return current;
    },
  };
}
