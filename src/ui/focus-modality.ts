/**
 * Repli de focus visible pour les focus **programmatiques** (#257).
 *
 * `:focus-visible` est un comportement natif du navigateur : un focus posé par programme depuis un
 * gestionnaire `keydown` (ex. `Échap` ouvre le menu système et focalise « Sauvegarder ») affiche
 * l'anneau dans Chromium, mais **pas** dans Firefox : mesuré, `:focus-visible` reste faux et
 * `outline-style` vaut `none`, alors que la navigation est bien au clavier. C'est un écart
 * d'accessibilité réel pour Firefox (docs/DESIGN.md §10).
 *
 * Ce module suit la dernière **modalité d'entrée** (clavier ou pointeur) et, quand un focus
 * programmatique arrive en modalité clavier sans que `:focus-visible` ne s'applique, pose
 * `data-focus-ring="true"` sur l'élément. `ui-manager.css` dessine alors l'anneau (2 px
 * `--mh-focus`, décalage 2 px). L'attribut est retiré au blur, au `focusout` et au `pointerdown` :
 * un clic souris ne montre donc jamais l'anneau, comme dans Chromium.
 *
 * Le suivi est posé en phase de capture sur `document`, donc avant les gestionnaires de clavier des
 * écrans : lorsque `ui-manager` déplace le focus dans son handler `keydown`, la modalité est déjà
 * « clavier ». Aucun écran n'est codé en dur : tous les focus programmatiques en bénéficient
 * (titre, menu système, confirmation, sauvegarde/chargement, historique, configuration, etc.).
 */

export const FOCUS_RING_ATTRIBUTE = "data-focus-ring";

export type InputModality = "keyboard" | "pointer" | null;

export type FocusFallbackOptions = {
  /**
   * Prédicat `:focus-visible` injectable pour les tests (jsdom traite `:focus-visible` comme `:focus`
   * et renvoie donc vrai à tort). Par défaut : `el.matches(":focus-visible")`, faux si non supporté.
   */
  isFocusVisible?: (el: Element) => boolean;
};

let modality: InputModality = null;
let dispose: (() => void) | null = null;

/** Dernière modalité d'entrée observée (exposé pour les tests). */
export function lastInputModality(): InputModality {
  return modality;
}

/** Vrai si l'élément courant satisfait réellement `:focus-visible` (faux si non supporté). */
function isNativeFocusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return false;
  }
}

function clearRing(el: Element | null): void {
  if (el instanceof HTMLElement) el.removeAttribute(FOCUS_RING_ATTRIBUTE);
}

function markRing(el: Element): void {
  if (el instanceof HTMLElement) el.setAttribute(FOCUS_RING_ATTRIBUTE, "true");
}

/**
 * Installe le suivi de modalité et le repli d'anneau. Idempotent : un second appel renvoie la même
 * fonction de nettoyage. Renvoie la fonction de désinstallation (tests, `dispose`).
 */
export function installFocusRingFallback(doc: Document = document, options: FocusFallbackOptions = {}): () => void {
  if (dispose) return dispose;
  const matchesFocusVisible = options.isFocusVisible ?? isNativeFocusVisible;

  const onKeyDown = (): void => {
    modality = "keyboard";
    // Cas où le focus a été posé *avant* la touche (ex. ouverture programmatique précédente) :
    // la touche clavier rend l'anneau légitime s'il n'est pas déjà natif.
    const active = doc.activeElement;
    if (active instanceof HTMLElement && !matchesFocusVisible(active)) markRing(active);
  };
  const onPointerDown = (): void => {
    modality = "pointer";
    clearRing(doc.activeElement);
  };
  const onFocusIn = (event: FocusEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (modality === "keyboard" && !matchesFocusVisible(target)) markRing(target);
    else clearRing(target);
  };
  const onFocusOut = (event: FocusEvent): void => {
    const target = event.target;
    if (target instanceof Element) clearRing(target);
  };

  // Phase de capture : la modalité est connue avant les gestionnaires des écrans.
  // `focusin`/`focusout` (qui remontent) sont complétés par `focus`/`blur` en capture : certains
  // environnements (jsdom dans les tests) n'émettent que ces derniers.
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("focusin", onFocusIn, true);
  doc.addEventListener("focusout", onFocusOut, true);
  doc.addEventListener("focus", onFocusIn, true);
  doc.addEventListener("blur", onFocusOut, true);

  dispose = () => {
    doc.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("focusin", onFocusIn, true);
    doc.removeEventListener("focusout", onFocusOut, true);
    doc.removeEventListener("focus", onFocusIn, true);
    doc.removeEventListener("blur", onFocusOut, true);
    clearRing(doc.activeElement);
    modality = null;
    dispose = null;
  };
  return dispose;
}
