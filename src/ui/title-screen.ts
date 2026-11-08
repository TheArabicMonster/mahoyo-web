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
 *       p.mh-ui-title-legal        mention de droits
 *     section.mh-ui-title-extra    (ouverte par Extra) liste des chapitres, provisoire jusqu'à HUD-08 (#199)
 *
 * Clavier : flèches haut/bas (et gauche/droite) déplacent le focus, Début/Fin vont aux extrémités,
 * Entrée/Espace activent le bouton (natif), Échap referme Extra. Le focus est visible.
 */
import { t } from "./i18n.js";
import { NIGHT_CLASS } from "./night.js";
import type { ScriptSummary } from "./types.js";
import type { UiAssets } from "./ui-assets.js";
import "./title-screen.css";

/** Clés du manifeste propres à l'écran titre (illustration plein cadre, logo), à passer à `UiAssets.apply`. */
export const TITLE_ASSET_KEYS: readonly string[] = ["title_background", "title_titlelogo"];

/** Colonnes de la liste de chapitres d'Extra (doit rester celle de `title-screen.css`). */
export const CHAPTER_COLUMNS = 4;

export type TitleActions = {
  /** Nouvelle partie : lance le premier script. */
  start(file: string): void;
  /** Reprise de l'autosave. */
  continueGame(): void;
  load(): void;
  flowchart(): void;
  config(): void;
  /** Lance un chapitre choisi dans Extra. */
  startChapter(file: string): void;
};

export type TitleScreenOptions = {
  scripts: readonly ScriptSummary[];
  hasContinue: boolean;
  actions: TitleActions;
  /** Résolveur d'images d'interface ; absent = repli CSS seul. */
  uiAssets?: Pick<UiAssets, "uiAsset">;
};

export type TitleScreen = {
  el: HTMLElement;
  /** Place le focus sur le menu (conteneur), sans ring : les flèches amènent ensuite sur une entrée. */
  focusMenu(): void;
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

export function createTitleScreen(options: TitleScreenOptions): TitleScreen {
  const { scripts, hasContinue, actions, uiAssets } = options;

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
  buttons.push(extraButton);
  nav.append(...buttons);

  nav.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = current < 0 ? 0 : cycle(current, 1, buttons.length);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = current < 0 ? buttons.length - 1 : cycle(current, -1, buttons.length);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = buttons.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    buttons[next]?.focus();
  });

  const legal = h("p", "mh-ui-title-legal", t("title.legal"));
  main.append(logo, nav, legal);
  el.appendChild(main);

  // ── Extra (provisoire) : liste des chapitres, en attendant le vrai sous-menu (HUD-08, #199) ──

  let extra: HTMLElement | null = null;

  function closeExtra(): void {
    if (!extra) return;
    extra.remove();
    extra = null;
    main.removeAttribute("inert");
    main.removeAttribute("aria-hidden");
    extraButton.setAttribute("aria-expanded", "false");
    extraButton.focus();
  }

  function openExtra(): void {
    if (extra) return;
    const view = h("section", `mh-ui-title-extra ${NIGHT_CLASS}`);
    view.setAttribute("aria-label", t("title.extra.chapters"));
    view.appendChild(h("h2", "mh-ui-title-extra-heading", t("title.extra.chapters")));

    const list = h("ul", "mh-ui-scripts mh-ui-title-chapters");
    const chapterButtons: HTMLButtonElement[] = [];
    for (const s of scripts) {
      const li = document.createElement("li");
      const btn = h("button", "mh-ui-button mh-ui-script", s.label);
      btn.type = "button";
      btn.dataset.file = s.file;
      btn.addEventListener("click", () => actions.startChapter(s.file));
      li.appendChild(btn);
      list.appendChild(li);
      chapterButtons.push(btn);
    }
    const back = h("button", "mh-ui-button mh-ui-title-back", t("common.back"));
    back.type = "button";
    back.addEventListener("click", closeExtra);
    view.append(list, back);

    view.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeExtra();
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const all = [...chapterButtons, back];
      const current = all.indexOf(document.activeElement as HTMLButtonElement);
      const count = chapterButtons.length;
      let next = current;
      switch (e.key) {
        case "ArrowRight":
          next = Math.min(current + 1, all.length - 1);
          break;
        case "ArrowLeft":
          next = Math.max(current - 1, 0);
          break;
        case "ArrowDown":
          if (current < 0) next = 0;
          else if (current >= count) next = current; // déjà sur « Retour »
          else next = current + CHAPTER_COLUMNS < count ? current + CHAPTER_COLUMNS : count;
          break;
        case "ArrowUp":
          if (current < 0) next = 0;
          else if (current === count) next = count - 1;
          else next = Math.max(current - CHAPTER_COLUMNS, 0);
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = all.length - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      all[next]?.focus();
    });

    extra = view;
    main.setAttribute("inert", "");
    main.setAttribute("aria-hidden", "true");
    extraButton.setAttribute("aria-expanded", "true");
    el.appendChild(view);
    (chapterButtons[0] ?? back).focus();
  }

  return { el, focusMenu: () => nav.focus({ preventScroll: true }) };
}
