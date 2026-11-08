import "./confirm-dialog.css";

/**
 * Boîte de confirmation au design d'origine (HUD-05, #190 ; docs/ANALYSE_HUD_ORIGINAL.md §2.8).
 *
 * Composant autonome : il ne connaît ni `DomUIManager` ni le dictionnaire (les libellés sont fournis par
 * l'appelant). Habillage en CSS pur (`confirm-dialog.css`, tokens `--mh-*`), aucune image du jeu.
 *
 * Clavier (écouteur `keydown` posé sur le document, en phase de capture, tant que la boîte est ouverte) :
 * - `Entrée` valide le bouton sélectionné (celui qui a le focus ; à l'ouverture, le bouton par défaut) ;
 * - `Échap` répond Non ;
 * - `←` sélectionne Oui (à gauche), `→` sélectionne Non (à droite) ;
 * - `Tab` / `Maj+Tab` bouclent entre les deux boutons ; le focus ne peut pas sortir de la boîte.
 * Les touches traitées sont arrêtées (`stopImmediatePropagation`) pour ne pas déclencher les raccourcis du jeu.
 */

/** Bouton présélectionné à l'ouverture. */
export type ConfirmDefault = "yes" | "no";

export interface ConfirmDialogOptions {
  /** Question posée (déjà traduite). Sert aussi de nom accessible à la boîte. */
  message: string;
  yesLabel: string;
  noLabel: string;
  /**
   * Bouton présélectionné. `"no"` (défaut) pour une action destructrice (retour au titre, suppression,
   * écrasement) ; `"yes"` pour une action sans perte (charger).
   */
  defaultButton?: ConfirmDefault;
}

export interface ConfirmDialog {
  /** Racine ajoutée au parent (fond transparent qui bloque les clics hors de la boîte). */
  readonly element: HTMLElement;
  /** Résolu une seule fois : `true` pour Oui, `false` pour Non, Échap ou fermeture forcée. */
  readonly result: Promise<boolean>;
  /** Ferme la boîte avec cette réponse. Sans effet si elle est déjà fermée. */
  close(value: boolean): void;
}

let nextId = 0;
/** Boîtes ouvertes, la plus récente en dernier : seule celle-ci capte le clavier et le focus. */
const openStack: symbol[] = [];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}

/** Ouvre la boîte dans `parent` et donne le focus au bouton par défaut. */
export function openConfirmDialog(parent: HTMLElement, options: ConfirmDialogOptions): ConfirmDialog {
  const defaultButton: ConfirmDefault = options.defaultButton ?? "no";
  const id = `mh-confirm-${++nextId}`;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const root = el("div", "mh-ui-confirm");
  const box = el("div", "mh-ui-confirm-box");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-labelledby", `${id}-message`);

  for (const corner of ["tl", "tr", "bl", "br"]) {
    const ornament = el("span", `mh-ui-confirm-corner mh-ui-confirm-corner-${corner}`);
    ornament.setAttribute("aria-hidden", "true");
    box.appendChild(ornament);
  }

  const message = el("p", "mh-ui-confirm-message");
  message.id = `${id}-message`;
  message.textContent = options.message;

  const row = el("div", "mh-ui-confirm-row");
  const makeButton = (cls: string, label: string, value: boolean): HTMLButtonElement => {
    const btn = el("button", `mh-ui-confirm-pill ${cls}`);
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", () => close(value));
    btn.addEventListener("focus", () => {
      current = btn;
    });
    // Survol : la sélection suit la souris (une seule pastille « allumée », comme à l'origine).
    btn.addEventListener("pointerenter", () => btn.focus());
    return btn;
  };
  const yes = makeButton("mh-ui-confirm-yes", options.yesLabel, true);
  const no = makeButton("mh-ui-confirm-no", options.noLabel, false);
  row.append(yes, no);
  box.append(message, row);
  root.appendChild(box);

  let settle!: (value: boolean) => void;
  const result = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  let closed = false;

  const buttons = [yes, no];
  const preselected = defaultButton === "yes" ? yes : no;
  const token = Symbol(id);
  /** Bouton sélectionné : le dernier à avoir reçu le focus (à l'ouverture, le bouton par défaut). */
  let current: HTMLButtonElement = preselected;
  const selected = (): HTMLButtonElement => current;

  function close(value: boolean): void {
    if (closed) return;
    closed = true;
    openStack.splice(openStack.indexOf(token), 1);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("focusin", onFocusIn, true);
    root.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
    settle(value);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (openStack[openStack.length - 1] !== token) return;
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        e.stopImmediatePropagation();
        close(false);
        return;
      case "Enter":
        e.preventDefault();
        e.stopImmediatePropagation();
        // Une touche maintenue depuis l'écran précédent ne doit pas répondre à la place du joueur.
        if (!e.repeat) close(selected() === yes);
        return;
      case "ArrowLeft":
      case "ArrowRight":
        e.preventDefault();
        e.stopImmediatePropagation();
        (e.key === "ArrowLeft" ? yes : no).focus();
        return;
      case "Tab": {
        e.preventDefault();
        e.stopImmediatePropagation();
        const step = e.shiftKey ? -1 : 1;
        const index = buttons.indexOf(selected());
        buttons[(index + step + buttons.length) % buttons.length]!.focus();
        return;
      }
    }
  }

  /** Piège de focus : si le focus s'échappe (clic hors boîte, script), on le ramène sur la sélection. */
  function onFocusIn(e: FocusEvent): void {
    if (openStack[openStack.length - 1] !== token) return;
    if (e.target instanceof Node && !root.contains(e.target)) selected().focus();
  }

  // Un clic sur le fond ne doit pas retirer le focus de la boîte.
  root.addEventListener("mousedown", (e) => {
    if (e.target === root) e.preventDefault();
  });

  parent.appendChild(root);
  openStack.push(token);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("focusin", onFocusIn, true);
  preselected.focus();

  return { element: root, result, close };
}
