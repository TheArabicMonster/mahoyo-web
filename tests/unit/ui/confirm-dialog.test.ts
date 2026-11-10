import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openConfirmDialog, type ConfirmDialog, type ConfirmDialogOptions } from "@/ui/confirm-dialog.js";

/** HUD-05 (#190) : boîte de confirmation autonome (jsdom : comportement et sémantique, pas la mise en page). */

const OPTIONS: ConfirmDialogOptions = { message: "Supprimer ?", yesLabel: "Oui", noLabel: "Non" };

describe("openConfirmDialog", () => {
  let parent: HTMLElement;
  let dialog: ConfirmDialog | null;
  const open = (extra: Partial<ConfirmDialogOptions> = {}): ConfirmDialog => {
    dialog = openConfirmDialog(parent, { ...OPTIONS, ...extra });
    return dialog;
  };
  const q = (sel: string) => parent.querySelector<HTMLButtonElement>(sel)!;
  const key = (k: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
    (document.activeElement ?? document.body).dispatchEvent(e);
    return e;
  };

  beforeEach(() => {
    document.body.innerHTML = '<div id="parent"></div>';
    parent = document.getElementById("parent")!;
    dialog = null;
  });
  afterEach(() => dialog?.close(false));

  describe("sémantique", () => {
    it("expose role=dialog, aria-modal et un nom accessible tiré du message", () => {
      open();
      const box = q('[role="dialog"]');
      expect(box).not.toBeNull();
      expect(box.getAttribute("aria-modal")).toBe("true");
      const labelId = box.getAttribute("aria-labelledby")!;
      expect(document.getElementById(labelId)!.textContent).toBe("Supprimer ?");
    });

    it("deux boîtes ouvertes n'ont pas le même identifiant de nom accessible", () => {
      const a = open();
      const b = openConfirmDialog(parent, OPTIONS);
      const ids = [...parent.querySelectorAll('[role="dialog"]')].map((n) => n.getAttribute("aria-labelledby"));
      expect(new Set(ids).size).toBe(2);
      a.close(false);
      b.close(false);
    });

    it("les boutons sont natifs, Oui à gauche puis Non à droite, et les volutes sont décoratives", () => {
      open();
      const buttons = [...parent.querySelectorAll("button")];
      expect(buttons.map((b) => b.textContent)).toEqual(["Oui", "Non"]);
      expect(buttons.every((b) => b.type === "button")).toBe(true);
      const corners = [...parent.querySelectorAll(".mh-ui-confirm-corner")];
      expect(corners).toHaveLength(4);
      expect(corners.every((c) => c.getAttribute("aria-hidden") === "true")).toBe(true);
    });

    it("se monte dans le parent et se retire à la fermeture", () => {
      const d = open();
      expect(parent.contains(d.element)).toBe(true);
      d.close(true);
      expect(parent.contains(d.element)).toBe(false);
    });
  });

  describe("bouton par défaut", () => {
    it("Non est présélectionné sans option", () => {
      open();
      expect(document.activeElement).toBe(q(".mh-ui-confirm-no"));
    });

    it("Non est présélectionné avec defaultButton: no", () => {
      open({ defaultButton: "no" });
      expect(document.activeElement).toBe(q(".mh-ui-confirm-no"));
    });

    it("Oui est présélectionné avec defaultButton: yes", () => {
      open({ defaultButton: "yes" });
      expect(document.activeElement).toBe(q(".mh-ui-confirm-yes"));
    });

    it("Entrée répond Non par défaut", async () => {
      const d = open();
      key("Enter");
      expect(await d.result).toBe(false);
    });

    it("Entrée répond Oui quand Oui est le bouton par défaut", async () => {
      const d = open({ defaultButton: "yes" });
      key("Enter");
      expect(await d.result).toBe(true);
    });
  });

  describe("clavier", () => {
    it("Échap répond Non, même si Oui est présélectionné", async () => {
      const d = open({ defaultButton: "yes" });
      key("Escape");
      expect(await d.result).toBe(false);
    });

    it("flèche gauche sélectionne Oui, flèche droite sélectionne Non", () => {
      open();
      key("ArrowLeft");
      expect(document.activeElement).toBe(q(".mh-ui-confirm-yes"));
      key("ArrowRight");
      expect(document.activeElement).toBe(q(".mh-ui-confirm-no"));
    });

    it("les flèches aux extrémités ne sortent pas de la paire", () => {
      open({ defaultButton: "yes" });
      key("ArrowLeft");
      expect(document.activeElement).toBe(q(".mh-ui-confirm-yes"));
      key("ArrowRight");
      key("ArrowRight");
      expect(document.activeElement).toBe(q(".mh-ui-confirm-no"));
    });

    it("Entrée valide le bouton atteint par les flèches", async () => {
      const d = open();
      key("ArrowLeft");
      key("Enter");
      expect(await d.result).toBe(true);
    });

    it("Entrée maintenue (répétition) ne répond pas à la place du joueur", async () => {
      const d = open({ defaultButton: "yes" });
      key("Enter", { repeat: true });
      expect(parent.contains(d.element)).toBe(true);
      key("Enter");
      expect(await d.result).toBe(true);
    });

    it("les touches traitées n'atteignent pas les raccourcis du jeu", () => {
      const seen: string[] = [];
      const spy = (e: KeyboardEvent) => seen.push(e.key);
      document.addEventListener("keydown", spy);
      open();
      for (const k of ["ArrowLeft", "ArrowRight", "Tab", "Enter"]) key(k);
      document.removeEventListener("keydown", spy);
      expect(seen).toEqual([]);
    });

    it("les touches ignorées (lettres, espace) ne ferment pas la boîte", () => {
      const d = open();
      key("a");
      key(" ");
      expect(parent.contains(d.element)).toBe(true);
    });
  });

  describe("piège de focus", () => {
    it("Tab boucle entre Oui et Non, Maj+Tab dans l'autre sens", () => {
      open({ defaultButton: "yes" });
      const e1 = key("Tab");
      expect(e1.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(q(".mh-ui-confirm-no"));
      key("Tab");
      expect(document.activeElement).toBe(q(".mh-ui-confirm-yes"));
      key("Tab", { shiftKey: true });
      expect(document.activeElement).toBe(q(".mh-ui-confirm-no"));
    });

    it("un focus qui s'échappe revient sur la sélection", () => {
      const outside = document.createElement("button");
      document.body.appendChild(outside);
      open({ defaultButton: "yes" });
      outside.focus();
      expect(document.activeElement).toBe(q(".mh-ui-confirm-yes"));
      key("ArrowRight");
      outside.focus();
      expect(document.activeElement).toBe(q(".mh-ui-confirm-no"));
    });

    it("le focus retourne à l'élément précédent à la fermeture", () => {
      const trigger = document.createElement("button");
      parent.appendChild(trigger);
      trigger.focus();
      const d = open();
      expect(document.activeElement).not.toBe(trigger);
      d.close(false);
      expect(document.activeElement).toBe(trigger);
    });

    it("le survol d'une pastille y déplace la sélection", () => {
      open();
      q(".mh-ui-confirm-yes").dispatchEvent(new Event("pointerenter"));
      expect(document.activeElement).toBe(q(".mh-ui-confirm-yes"));
    });
  });

  describe("valeur retournée", () => {
    it("clic sur Oui répond true, clic sur Non répond false", async () => {
      const a = open();
      q(".mh-ui-confirm-yes").click();
      expect(await a.result).toBe(true);
      const b = open();
      q(".mh-ui-confirm-no").click();
      expect(await b.result).toBe(false);
    });

    it("close() est idempotent : la première réponse l'emporte", async () => {
      const d = open();
      d.close(true);
      d.close(false);
      expect(await d.result).toBe(true);
    });

    it("après fermeture, le clavier n'est plus capturé", () => {
      const d = open();
      d.close(false);
      const seen: string[] = [];
      const spy = (e: KeyboardEvent) => seen.push(e.key);
      document.addEventListener("keydown", spy);
      key("ArrowLeft");
      document.removeEventListener("keydown", spy);
      expect(seen).toEqual(["ArrowLeft"]);
    });
  });
});

describe("confirm-dialog.css", () => {
  const css = readFileSync(resolve(__dirname, "../../../src/ui/confirm-dialog.css"), "utf8");
  const tokens = readFileSync(resolve(__dirname, "../../../src/ui/tokens.css"), "utf8");

  it("n'embarque aucune image (thème en CSS pur)", () => {
    expect(css).not.toMatch(/url\(|image-set\(|@import/);
  });

  it("ne redéclare aucun token", () => {
    expect(css).not.toMatch(/^\s*--mh-[a-z0-9-]+\s*:/m);
  });

  it("lit les couleurs du design dans les tokens", () => {
    for (const token of [
      "--mh-dialog-top",
      "--mh-dialog-bottom",
      "--mh-dialog-border",
      "--mh-dialog-ornament",
      "--mh-pill-on",
      "--mh-pill-off",
    ]) {
      expect(css).toContain(`var(${token})`);
    }
  });

  it("dimensionne la boîte à 390x164 (585x246 @1080 converti en @720) avec un bord de 2 px", () => {
    expect(css).toMatch(/width:\s*390px/);
    expect(css).toMatch(/min-height:\s*164px/);
    expect(css).toMatch(/border:\s*2px solid var\(--mh-dialog-border\)/);
  });

  it("la durée d'ouverture vient de --mh-dur-fast, qui tombe à 0 sous prefers-reduced-motion", () => {
    expect(css).toMatch(/animation:\s*mh-ui-confirm-in var\(--mh-dur-fast\)/);
    expect(css).not.toMatch(/animation:[^;]*\d+m?s/);
    const reduced = tokens.slice(tokens.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/--mh-dur-fast:\s*0ms/);
  });

  it("garantit des cibles de 44 px sur écran tactile", () => {
    const coarse = css.slice(css.indexOf("@media (pointer: coarse)", css.indexOf(".mh-ui-confirm-pill:focus-visible")));
    expect(coarse).toMatch(/height:\s*44px/);
  });

  it("garde un contour de focus visible", () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*var\(--mh-focus-width, 2px\) solid var\(--mh-focus\)/);
  });
});

describe("code source", () => {
  const srcDir = resolve(__dirname, "../../../src");
  const files = (readdirSync(srcDir, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts"));

  it("n'appelle plus window.confirm nulle part", () => {
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((f) =>
      /\b(window|globalThis|self)\.confirm\s*\(/.test(readFileSync(resolve(srcDir, f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
