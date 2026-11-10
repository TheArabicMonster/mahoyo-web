// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FOCUS_RING_ATTRIBUTE, installFocusRingFallback, lastInputModality } from "@/ui/focus-modality.js";

/**
 * #257 : repli de focus visible pour les focus programmatiques (Firefox ne propage pas la modalité
 * clavier à `:focus-visible`). Le module suit la dernière modalité d'entrée et pose
 * `data-focus-ring` seulement en modalité clavier.
 */

let dispose: (() => void) | null = null;

/**
 * jsdom considère `:focus-visible` comme `:focus` (il renvoie vrai) : on injecte le prédicat pour
 * simuler Firefox (faux sur un focus programmatique) ou Chromium (vrai, aucun repli nécessaire).
 */
const installFirefox = (): (() => void) => installFocusRingFallback(document, { isFocusVisible: () => false });
const installChromium = (): (() => void) => installFocusRingFallback(document, { isFocusVisible: () => true });

function addButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = "Entrée";
  document.body.appendChild(button);
  return button;
}

const keydown = (): void => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
};
const pointerdown = (): void => {
  // jsdom n'implémente pas toujours PointerEvent : un Event suffit, le module ne lit pas le contenu.
  document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
};
const ring = (el: Element): string | null => el.getAttribute(FOCUS_RING_ATTRIBUTE);

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.replaceChildren();
});

describe("installFocusRingFallback (#257)", () => {
  it("pose l'anneau sur un focus programmatique en modalité clavier", () => {
    dispose = installFirefox();
    keydown();
    const button = addButton();
    button.focus();
    expect(lastInputModality()).toBe("keyboard");
    expect(ring(button)).toBe("true");
  });

  it("ne pose jamais d'anneau en modalité pointeur (clic souris)", () => {
    dispose = installFirefox();
    pointerdown();
    const button = addButton();
    button.focus();
    expect(lastInputModality()).toBe("pointer");
    expect(ring(button)).toBeNull();
  });

  it("retire l'anneau au blur et au focusout", () => {
    dispose = installFirefox();
    keydown();
    const first = addButton();
    first.focus();
    expect(ring(first)).toBe("true");
    first.blur();
    expect(ring(first)).toBeNull();
    const second = addButton();
    second.focus();
    expect(ring(second)).toBe("true");
    second.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(ring(second)).toBeNull();
  });

  it("un pointerdown retire l'anneau de l'élément actif et repasse en modalité pointeur", () => {
    dispose = installFirefox();
    keydown();
    const button = addButton();
    button.focus();
    expect(ring(button)).toBe("true");
    pointerdown();
    expect(lastInputModality()).toBe("pointer");
    expect(ring(button)).toBeNull();
  });

  it("une touche rend l'anneau visible sur le focus déjà posé (ouverture programmatique précédente)", () => {
    dispose = installFirefox();
    const button = addButton();
    button.focus(); // modalité encore inconnue : pas d'anneau
    expect(ring(button)).toBeNull();
    keydown();
    expect(ring(button)).toBe("true");
  });

  it("est idempotent : une seule installation, une seule désinstallation", () => {
    const first = installFirefox();
    const second = installFocusRingFallback(document);
    expect(second).toBe(first);
    dispose = second;
    keydown();
    const button = addButton();
    button.focus();
    expect(ring(button)).toBe("true");
    dispose();
    dispose = null;
    expect(lastInputModality()).toBeNull();
    expect(ring(button)).toBeNull();
  });

  it("ne pose aucun attribut quand le navigateur applique déjà `:focus-visible` (Chromium)", () => {
    dispose = installChromium();
    keydown();
    const button = addButton();
    button.focus();
    expect(lastInputModality()).toBe("keyboard");
    expect(ring(button)).toBeNull();
  });

  it("après désinstallation, plus aucun attribut n'est posé", () => {
    const off = installFirefox();
    off();
    keydown();
    const button = addButton();
    button.focus();
    expect(ring(button)).toBeNull();
  });
});
