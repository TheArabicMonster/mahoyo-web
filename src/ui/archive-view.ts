/**
 * Archive : liste des chapitres, ouverte depuis le sous-menu Extra du titre (HUD-08, #199 ;
 * docs/ANALYSE_HUD_ORIGINAL.md §2.2, docs/DESIGN.md §9.9).
 *
 * Module autonome (aucune dépendance au gestionnaire d'UI). Anti-spoiler : un chapitre non déverrouillé
 * n'expose ni son titre, ni son fichier (pas de `data-file`) : seul un emplacement « ??? » inerte est
 * dessiné. La règle de déverrouillage vit dans `chapter-list.ts` (`unlockedChapterIds`).
 *
 * Clavier : flèches (grille de `ARCHIVE_COLUMNS` colonnes), Début/Fin, Échap = Retour (stoppe la
 * propagation, pour que le titre ne referme pas aussi le sous-menu).
 */
import { t } from "./i18n.js";
import { NIGHT_CLASS } from "./night.js";
import type { ScriptSummary } from "./types.js";
import "./archive-view.css";

/** Colonnes de la grille (doit rester celle de `archive-view.css`). */
export const ARCHIVE_COLUMNS = 4;

export type ArchiveViewOptions = {
  scripts: readonly ScriptSummary[];
  /**
   * Identifiants (`ScriptSummary.id`) des chapitres déverrouillés. Absent = tous (appelant qui ne
   * connaît pas la progression).
   */
  unlocked?: readonly string[];
  /** Lance un chapitre déverrouillé. */
  onStart(file: string): void;
  /** Retour au sous-menu (bouton ou Échap). */
  onClose(): void;
};

export type ArchiveView = {
  el: HTMLElement;
  /** Focus sur le premier chapitre déverrouillé, sinon sur Retour. */
  focusFirst(): void;
};

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function createArchiveView(options: ArchiveViewOptions): ArchiveView {
  const { scripts, onStart, onClose } = options;
  const open = options.unlocked ? new Set(options.unlocked) : null;

  const view = h("section", `mh-ui-title-extra mh-ui-archive ${NIGHT_CLASS}`);
  view.setAttribute("aria-label", t("title.extra.chapters"));
  view.appendChild(h("h2", "mh-ui-title-extra-heading", t("title.entry.archive")));

  const list = h("ul", "mh-ui-scripts mh-ui-title-chapters");
  const cells: HTMLButtonElement[] = [];
  scripts.forEach((s, i) => {
    const li = document.createElement("li");
    const unlocked = open === null || open.has(s.id);
    const btn = h("button", "mh-ui-button mh-ui-script", unlocked ? s.label : t("archive.locked"));
    btn.type = "button";
    if (unlocked) {
      btn.dataset.file = s.file;
      btn.addEventListener("click", () => onStart(s.file));
    } else {
      btn.classList.add("mh-ui-script-locked");
      btn.setAttribute("aria-disabled", "true");
      btn.setAttribute("aria-label", t("archive.chapterLocked", { n: String(i + 1) }));
      btn.tabIndex = -1; // atteint par les flèches, pas par Tab
    }
    li.appendChild(btn);
    list.appendChild(li);
    cells.push(btn);
  });

  const back = h("button", "mh-ui-button mh-ui-title-back", t("common.back"));
  back.type = "button";
  back.addEventListener("click", onClose);
  view.append(list, back);

  view.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const all = [...cells, back];
    const current = all.indexOf(document.activeElement as HTMLButtonElement);
    const count = cells.length;
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
        else next = current + ARCHIVE_COLUMNS < count ? current + ARCHIVE_COLUMNS : count;
        break;
      case "ArrowUp":
        if (current < 0) next = 0;
        else if (current === count) next = count - 1;
        else next = Math.max(current - ARCHIVE_COLUMNS, 0);
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

  return {
    el: view,
    focusFirst: () => (cells.find((c) => !c.hasAttribute("aria-disabled")) ?? back).focus(),
  };
}
