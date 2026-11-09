import { decoKeyOf, t } from "@/ui/i18n.js";
import type { BacklogEntry, PlayerCommands } from "@/ui/types.js";
import "./backlog-screen.css";

/**
 * Écran d'historique plein cadre (HUD-12 / #201, docs/ANALYSE_HUD_ORIGINAL.md §2.6, écart E13 ;
 * docs/DESIGN.md §9.7).
 *
 * Composant autonome : il ne connaît pas `DomUIManager`. Il reçoit les entrées (texte des pages déjà
 * lues) et la commande `closeScreen`, et rend :
 * - un titre « Back Log » (+ sous-titre japonais décoratif) ;
 * - une liste `<ol>` dans la police et la zone du texte de jeu, défilante par la barre **native** stylée
 *   (molette, tactile et clavier restent ceux du navigateur) ;
 * - trois boutons ronds sous la barre : bas, haut, fermer.
 * Le fond « nuit bleue » (`mh-ui-night`) est posé par `syncNightDemo` sur le conteneur.
 *
 * Le retour arrière (rollback) n'est pas touché : l'historique ne fait qu'afficher le texte.
 * Échap est géré par `DomUIManager` (comme pour tous les écrans superposés), pas ici.
 */

export interface BacklogScreenDeps {
  /** Texte des pages déjà lues, de la plus ancienne à la plus récente. */
  readonly entries: readonly BacklogEntry[];
  readonly commands: Pick<PlayerCommands, "closeScreen">;
}

export interface BacklogScreen {
  readonly element: HTMLElement;
  /** À appeler une fois l'élément dans le document : défile jusqu'à la dernière page et donne le focus à la liste. */
  mount(): void;
}

/** Part de la hauteur visible parcourue par `PageUp` / `PageDown` (un peu moins d'une page : le contexte reste lisible). */
export const PAGE_SCROLL_RATIO = 0.9;
/** Nombre de lignes parcourues par `↑` / `↓`. */
export const ARROW_SCROLL_LINES = 3;

let nextId = 0;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function roundButton(kind: "down" | "up" | "close", label: string): HTMLButtonElement {
  const btn = h("button", `mh-bl-btn mh-bl-${kind}`);
  btn.type = "button";
  btn.dataset.action = kind;
  btn.setAttribute("aria-label", label);
  const icon = h("span", "mh-bl-icon");
  icon.setAttribute("aria-hidden", "true");
  btn.appendChild(icon);
  return btn;
}

export function createBacklogScreen(deps: BacklogScreenDeps): BacklogScreen {
  const id = `mh-bl-${nextId++}`;
  const root = h("section", "mh-bl");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", `${id}-title`);

  // ── En-tête : « Back Log » et son sous-titre japonais (décoratif) ──
  const header = h("header", "mh-bl-header");
  const title = h("h2", "mh-bl-title", t("history.title"));
  title.id = `${id}-title`;
  const deco = h("span", "mh-bl-deco", t(decoKeyOf("history.title")));
  deco.setAttribute("aria-hidden", "true");
  header.append(title, deco);

  // ── Liste : zone défilante focusable (clavier), `<ol>` nommée ──
  const scroll = h("div", "mh-bl-scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-labelledby", `${id}-title`);
  const list = h("ol", "mh-bl-list");
  list.setAttribute("role", "list");
  list.setAttribute("aria-label", t("history.listLabel"));
  for (const entry of deps.entries) {
    const li = h("li", "mh-bl-entry", entry.text);
    if (entry.voice) li.dataset.voice = entry.voice;
    list.appendChild(li);
  }
  scroll.appendChild(list);

  // ── Boutons ronds : bas, haut, fermer ──
  const controls = h("div", "mh-bl-controls");
  const down = roundButton("down", t("history.scrollDown"));
  const up = roundButton("up", t("history.scrollUp"));
  const close = roundButton("close", t("history.close"));
  controls.append(down, up, close);

  root.append(header, scroll, controls);

  // ── Défilement ──
  const lineStep = (): number => {
    const px = parseFloat(getComputedStyle(list).lineHeight);
    return Number.isFinite(px) && px > 0 ? px : 50;
  };
  const pageStep = (): number => Math.max(1, Math.round(scroll.clientHeight * PAGE_SCROLL_RATIO));
  const scrollBy = (dy: number): void => {
    scroll.scrollTop += dy;
  };

  down.addEventListener("click", () => scrollBy(pageStep()));
  up.addEventListener("click", () => scrollBy(-pageStep()));
  close.addEventListener("click", () => deps.commands.closeScreen());

  const focusables: HTMLElement[] = [scroll, down, up, close];
  root.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    switch (e.key) {
      case "PageDown":
        e.preventDefault();
        scrollBy(pageStep());
        break;
      case "PageUp":
        e.preventDefault();
        scrollBy(-pageStep());
        break;
      case "ArrowDown":
        e.preventDefault();
        scrollBy(lineStep() * ARROW_SCROLL_LINES);
        break;
      case "ArrowUp":
        e.preventDefault();
        scrollBy(-lineStep() * ARROW_SCROLL_LINES);
        break;
      case "Home":
        e.preventDefault();
        scroll.scrollTop = 0;
        break;
      case "End":
        e.preventDefault();
        scroll.scrollTop = scroll.scrollHeight;
        break;
      case "Tab": {
        // Piège de focus : l'écran est modal, Tab boucle entre la liste et les trois boutons.
        const i = focusables.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (i <= 0 ? focusables.length - 1 : i - 1) : i === focusables.length - 1 ? 0 : i + 1;
        e.preventDefault();
        focusables[next]!.focus();
        break;
      }
    }
  });

  return {
    element: root,
    mount() {
      // Dernier texte lu en bas, visible par défaut. Pas de défilement animé à l'ouverture.
      scroll.style.scrollBehavior = "auto";
      scroll.scrollTop = scroll.scrollHeight;
      scroll.style.removeProperty("scroll-behavior");
      scroll.focus({ preventScroll: true });
    },
  };
}
