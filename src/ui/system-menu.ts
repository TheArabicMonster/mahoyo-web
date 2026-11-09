import { decoKeyOf, t, type MessageKey } from "@/ui/i18n.js";
import { NIGHT_CLASS, NIGHT_VEIL_CLASS } from "@/ui/night.js";
import type { PlayerCommands, PlayerStatus } from "@/ui/types.js";
import "./system-menu.css";

/**
 * Menu système plein cadre (clic droit), HUD-06 / #194 (docs/ANALYSE_HUD_ORIGINAL.md §2.5, écart E7 ;
 * docs/DESIGN.md §2.2, §4, §6, §7).
 *
 * Composant autonome : il ne connaît pas `DomUIManager`. Il reçoit les commandes du player et deux
 * rappels (confirmation de retour au titre, interrupteur d'entrées) et rend :
 * - un en-tête « SYSTÈME » (+ ligne japonaise décorative) ;
 * - une colonne de boutons construite depuis `SYSTEM_MENU_ENTRIES` ;
 * - « Back » en bas à droite.
 * Le voile bleu nuit (`mh-ui-night mh-ui-night-veil`) est posé sur le conteneur par `syncSystemMenuVeil`.
 */

/** Identifiants d'entrées, dans l'ordre d'affichage (docs/ANALYSE_HUD_ORIGINAL.md §2.5, sans `exitgame`). */
export type SystemMenuEntryId =
  | "save"
  | "load"
  | "config"
  | "auto"
  | "skip"
  | "backlog"
  | "flowchart"
  | "graphic"
  | "title";

/** Ce que les actions peuvent faire : commandes du player, état courant, confirmation du retour au titre. */
export interface SystemMenuContext {
  readonly commands: PlayerCommands;
  /** État courant du player (lu au moment du clic, pas au rendu). */
  readonly getStatus: () => Readonly<PlayerStatus>;
  /** Demande confirmation (Non par défaut) puis retourne au titre. */
  readonly confirmReturnToTitle: () => void;
}

export interface SystemMenuEntry {
  readonly id: SystemMenuEntryId;
  /** Clé de libellé sans paramètre (`systemMenu.entry.*`). */
  readonly labelKey: Extract<MessageKey, `systemMenu.entry.${string}`>;
  /** Verrouillée par `@lockquickmenu` (sauvegarde et chargement). */
  readonly lockedByQuickMenu?: boolean;
  /** Bascule : l'état courant (`aria-pressed`) vient de `PlayerStatus`. */
  readonly pressed?: (status: Readonly<PlayerStatus>) => boolean;
  readonly run: (ctx: SystemMenuContext) => void;
}

/** Ferme le menu puis exécute l'action : le jeu reprend avec le nouveau mode ou le texte masqué. */
function thenResume(ctx: SystemMenuContext, action: () => void): void {
  action();
  ctx.commands.closeScreen();
}

/**
 * Entrées du menu, dans l'ordre. Insérer ou retirer une entrée = une ligne ici (plus son libellé dans
 * le dictionnaire). `exitgame` n'existe pas (décision 3 du propriétaire) ; `flowchart` ouvre l'écran
 * intégré (FLOW-05/06/07, branchement FLOW-08 / #207), entre `backlog` et `graphic`.
 */
export const SYSTEM_MENU_ENTRIES: readonly SystemMenuEntry[] = [
  { id: "save", labelKey: "systemMenu.entry.save", lockedByQuickMenu: true, run: (c) => c.commands.openScreen("save") },
  { id: "load", labelKey: "systemMenu.entry.load", lockedByQuickMenu: true, run: (c) => c.commands.openScreen("load") },
  { id: "config", labelKey: "systemMenu.entry.config", run: (c) => c.commands.openScreen("settings") },
  {
    id: "auto",
    labelKey: "systemMenu.entry.auto",
    pressed: (s) => s.mode === "auto",
    run: (c) => thenResume(c, () => c.commands.setMode(c.getStatus().mode === "auto" ? "normal" : "auto")),
  },
  {
    id: "skip",
    labelKey: "systemMenu.entry.skip",
    pressed: (s) => s.mode === "skip",
    run: (c) => thenResume(c, () => c.commands.setMode(c.getStatus().mode === "skip" ? "normal" : "skip")),
  },
  { id: "backlog", labelKey: "systemMenu.entry.backlog", run: (c) => c.commands.openScreen("backlog") },
  { id: "flowchart", labelKey: "systemMenu.entry.flowchart", run: (c) => c.commands.openScreen("flowchart") },
  { id: "graphic", labelKey: "systemMenu.entry.graphic", run: (c) => thenResume(c, () => c.commands.toggleUserHide()) },
  { id: "title", labelKey: "systemMenu.entry.title", run: (c) => c.confirmReturnToTitle() },
];

const SELECTOR_BUTTONS = "button:not(:disabled)";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Construit le menu. `isEnabled` permet à l'appelant de suspendre les clics (chargement en cours).
 * Les états dépendant de `PlayerStatus` (verrou, auto, skip) sont posés par `syncSystemMenu`.
 */
export function renderSystemMenu(ctx: SystemMenuContext, isEnabled: () => boolean = () => true): HTMLElement {
  const root = el("section", "mh-sysmenu");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");

  const header = el("h2", "mh-sysmenu-head");
  header.id = "mh-sysmenu-title";
  header.appendChild(el("span", "mh-sysmenu-title", t("systemMenu.title")));
  const deco = el("span", "mh-sysmenu-deco", t(decoKeyOf("systemMenu.title")));
  deco.setAttribute("aria-hidden", "true");
  header.appendChild(deco);
  root.setAttribute("aria-labelledby", header.id);
  root.appendChild(header);

  // Liste de boutons (pas de role="menu" : DESIGN §10), Tab parcourt les entrées puis « Back ».
  const list = el("ul", "mh-sysmenu-list");
  for (const entry of SYSTEM_MENU_ENTRIES) {
    const li = el("li", "mh-sysmenu-item");
    const btn = el("button", "mh-sysmenu-entry", t(entry.labelKey));
    btn.type = "button";
    btn.dataset.entry = entry.id;
    if (entry.lockedByQuickMenu) btn.dataset.quickMenu = entry.id;
    btn.addEventListener("click", () => {
      if (isEnabled()) entry.run(ctx);
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
  root.appendChild(list);

  const back = el("button", "mh-sysmenu-back", t("common.back"));
  back.type = "button";
  back.dataset.entry = "back";
  back.addEventListener("click", () => {
    if (isEnabled()) ctx.commands.closeScreen();
  });
  root.appendChild(back);

  root.addEventListener("keydown", (e) => onMenuKeyDown(root, e));
  syncSystemMenu(root, ctx.getStatus());
  return root;
}

/**
 * Met à jour l'état des entrées depuis `PlayerStatus` sans redessiner (verrou du menu rapide,
 * bascules auto et skip). Sans effet si `root` ne contient pas de menu.
 */
export function syncSystemMenu(root: ParentNode, status: Readonly<PlayerStatus>): void {
  for (const entry of SYSTEM_MENU_ENTRIES) {
    const btn = root.querySelector<HTMLButtonElement>(`.mh-sysmenu-entry[data-entry="${entry.id}"]`);
    if (!btn) continue;
    if (entry.lockedByQuickMenu) {
      btn.disabled = status.quickMenuLocked;
      btn.title = status.quickMenuLocked ? t("systemMenu.quickMenuLocked") : "";
    }
    if (entry.pressed) {
      const on = entry.pressed(status);
      btn.setAttribute("aria-pressed", String(on));
      btn.classList.toggle("is-active", on);
    }
  }
}

/** Pose (ou retire) le voile bleu nuit sur le slot : seulement quand il contient le menu. */
export function syncSystemMenuVeil(slot: HTMLElement): void {
  const filled = slot.childElementCount > 0;
  slot.classList.toggle(NIGHT_CLASS, filled);
  slot.classList.toggle(NIGHT_VEIL_CLASS, filled);
}

/** Donne le focus à la première entrée utilisable (ou à « Back » si tout est désactivé). */
export function focusSystemMenu(root: ParentNode): void {
  const first = root.querySelector<HTMLButtonElement>(`.mh-sysmenu-entry:not(:disabled), .mh-sysmenu-back`);
  first?.focus();
}

/** Piège de focus (Tab boucle) et navigation par flèches haut/bas, Début/Fin. */
function onMenuKeyDown(root: HTMLElement, e: KeyboardEvent): void {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>(SELECTOR_BUTTONS)];
  if (buttons.length === 0) return;
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const last = buttons.length - 1;
  let next: number | null = null;
  switch (e.key) {
    case "Tab":
      if (index === -1) next = e.shiftKey ? last : 0;
      else if (e.shiftKey && index === 0) next = last;
      else if (!e.shiftKey && index === last) next = 0;
      break;
    case "ArrowDown":
      next = index === -1 || index === last ? 0 : index + 1;
      break;
    case "ArrowUp":
      next = index <= 0 ? last : index - 1;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = last;
      break;
  }
  if (next === null) return;
  e.preventDefault();
  e.stopPropagation();
  buttons[next]!.focus();
}
