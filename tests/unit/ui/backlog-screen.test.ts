import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARROW_SCROLL_LINES, createBacklogScreen, type BacklogScreen } from "@/ui/backlog-screen.js";
import { setUiLanguage } from "@/ui/i18n.js";
import { DomUIManager } from "@/ui/ui-manager.js";
import type { BacklogEntry, PlayerCommands } from "@/ui/types.js";

/** HUD-12 (#201) : écran d'historique plein cadre. jsdom ne calcule pas la mise en page : on pilote `scrollTop`. */

const ENTRIES: BacklogEntry[] = [{ text: "Première page." }, { text: "Deuxième page.", voice: "v2" }, { text: "Troisième page." }];

function setup(entries: readonly BacklogEntry[] = ENTRIES) {
  const commands = { closeScreen: vi.fn() };
  const screen: BacklogScreen = createBacklogScreen({ entries, commands });
  document.body.appendChild(screen.element);
  screen.mount();
  const q = (sel: string) => screen.element.querySelector<HTMLElement>(sel)!;
  const scroll = q(".mh-bl-scroll");
  // Hauteurs fictives : 500 px visibles sur 3000 px de contenu.
  Object.defineProperty(scroll, "clientHeight", { value: 500, configurable: true });
  Object.defineProperty(scroll, "scrollHeight", { value: 3000, configurable: true });
  scroll.scrollTop = 0;
  const key = (k: string, init: KeyboardEventInit = {}, target: HTMLElement = scroll) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  return { screen, commands, q, scroll, key };
}

beforeEach(() => {
  document.body.innerHTML = "";
  setUiLanguage("fr");
});
afterEach(() => setUiLanguage("fr"));

describe("BacklogScreen", () => {
  it("rend une boîte de dialogue nommée « Back Log » avec un sous-titre japonais décoratif", () => {
    const { screen, q } = setup();
    expect(screen.element.getAttribute("role")).toBe("dialog");
    expect(screen.element.getAttribute("aria-modal")).toBe("true");
    expect(q(".mh-bl-title").textContent).toBe("Back Log");
    expect(screen.element.getAttribute("aria-labelledby")).toBe(q(".mh-bl-title").id);
    expect(q(".mh-bl-deco").textContent).toBe("履歴");
    expect(q(".mh-bl-deco").getAttribute("aria-hidden")).toBe("true");
  });

  it("la liste est un <ol> nommé qui contient une <li> par page, voix conservée", () => {
    const { q } = setup();
    const ol = q("ol.mh-bl-list");
    expect(ol.getAttribute("aria-label")).toBe("Historique");
    const items = [...ol.querySelectorAll("li")];
    expect(items.map((li) => li.textContent)).toEqual(ENTRIES.map((e) => e.text));
    expect(items[1]!.dataset.voice).toBe("v2");
    expect(items[0]!.dataset.voice).toBeUndefined();
  });

  it("les libellés suivent la langue", () => {
    setUiLanguage("en");
    const { q } = setup();
    expect(q(".mh-bl-list").getAttribute("aria-label")).toBe("History");
    expect(q('[data-action="down"]').getAttribute("aria-label")).toBe("Scroll down");
    expect(q('[data-action="close"]').getAttribute("aria-label")).toBe("Close the history");
  });

  it("monte sur la dernière page, focus sur la zone défilante", () => {
    const { screen, scroll } = setup();
    expect(document.activeElement).toBe(scroll);
    expect(scroll.tabIndex).toBe(0);
    // La zone défilante est nommée par le titre.
    expect(scroll.getAttribute("aria-labelledby")).toBe(screen.element.querySelector(".mh-bl-title")!.id);
  });

  it("trois boutons ronds nommés, dans l'ordre : bas, haut, fermer", () => {
    const { q } = setup();
    const buttons = [...q(".mh-bl-controls").querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((b) => b.dataset.action)).toEqual(["down", "up", "close"]);
    for (const b of buttons) {
      expect(b.type).toBe("button");
      expect(b.getAttribute("aria-label")).toBeTruthy();
      expect(b.textContent).toBe(""); // pictogramme en CSS, jamais un libellé en dur
    }
  });

  describe("défilement", () => {
    it("PageDown / PageUp parcourent 90 % de la hauteur visible, sans dépasser le début", () => {
      const { scroll, key } = setup();
      expect(key("PageDown")).toBe(false); // preventDefault
      expect(scroll.scrollTop).toBe(450);
      key("PageDown");
      expect(scroll.scrollTop).toBe(900);
      key("PageUp");
      expect(scroll.scrollTop).toBe(450);
    });

    it("les flèches parcourent quelques lignes", () => {
      const { scroll, key } = setup();
      key("ArrowDown");
      const step = scroll.scrollTop;
      expect(step).toBeGreaterThan(0);
      expect(step % ARROW_SCROLL_LINES).toBe(0);
      key("ArrowUp");
      expect(scroll.scrollTop).toBe(0);
    });

    it("Début et Fin vont aux extrémités", () => {
      const { scroll, key } = setup();
      key("End");
      expect(scroll.scrollTop).toBe(3000);
      key("Home");
      expect(scroll.scrollTop).toBe(0);
    });

    it("les touches fonctionnent aussi quand le focus est sur un bouton", () => {
      const { q, scroll, key } = setup();
      key("PageDown", {}, q('[data-action="close"]'));
      expect(scroll.scrollTop).toBe(450);
    });

    it("les boutons bas et haut défilent d'une page", () => {
      const { q, scroll } = setup();
      q('[data-action="down"]').click();
      expect(scroll.scrollTop).toBe(450);
      q('[data-action="up"]').click();
      expect(scroll.scrollTop).toBe(0);
    });

    it("Ctrl/Alt/Méta + touche ne sont pas détournés", () => {
      const { scroll, key } = setup();
      expect(key("PageDown", { ctrlKey: true })).toBe(true);
      expect(scroll.scrollTop).toBe(0);
    });
  });

  describe("fermeture et focus", () => {
    it("le bouton fermer appelle closeScreen", () => {
      const { q, commands } = setup();
      q('[data-action="close"]').click();
      expect(commands.closeScreen).toHaveBeenCalledTimes(1);
    });

    it("Tab boucle entre la liste et les trois boutons, Maj+Tab en sens inverse", () => {
      const { q, scroll, key } = setup();
      const order = [scroll, q('[data-action="down"]'), q('[data-action="up"]'), q('[data-action="close"]')];
      for (let i = 0; i < order.length; i++) {
        expect(document.activeElement).toBe(order[i]);
        key("Tab", {}, order[i]);
      }
      expect(document.activeElement).toBe(scroll);
      key("Tab", { shiftKey: true }, scroll);
      expect(document.activeElement).toBe(order[3]);
    });
  });
});

describe("DomUIManager : historique", () => {
  let root: HTMLElement;
  let ui: DomUIManager;
  let cmd: PlayerCommands & { closeScreen: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    document.body.innerHTML = '<div id="viewport"></div>';
    root = document.getElementById("viewport")!;
    cmd = { closeScreen: vi.fn(), openScreen: vi.fn(), advance: vi.fn(), rollback: vi.fn() } as never;
    ui = new DomUIManager();
    ui.init(root, cmd);
  });
  afterEach(() => ui.dispose());

  it("pose la nuit bleue en permanence (sans ?night) et rend l'écran plein cadre", () => {
    ui.show({ screen: "backlog", entries: ENTRIES });
    expect(root.querySelector("#ui-menu")!.classList.contains("mh-ui-night")).toBe(true);
    expect(root.querySelectorAll(".mh-bl-entry")).toHaveLength(3);
    expect(root.querySelector(".mh-ui-panel")).toBeNull();
    expect(document.activeElement).toBe(root.querySelector(".mh-bl-scroll"));
    ui.show({ screen: "game" });
    expect(root.querySelector("#ui-menu")!.classList.contains("mh-ui-night")).toBe(false);
  });

  it("Échap ferme l'historique une seule fois", () => {
    ui.show({ screen: "backlog", entries: ENTRIES });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(cmd.closeScreen).toHaveBeenCalledTimes(1);
  });

  it("le changement de langue redessine l'écran dans la nouvelle langue", () => {
    ui.show({ screen: "backlog", entries: ENTRIES });
    setUiLanguage("en");
    expect(root.querySelector(".mh-bl-list")!.getAttribute("aria-label")).toBe("History");
  });
});

describe("backlog-screen.css", () => {
  const css = readFileSync(resolve(__dirname, "../../../src/ui/backlog-screen.css"), "utf8");
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("ne référence aucune image (CSS pur, aucun asset)", () => {
    expect(code).not.toMatch(/url\(/i);
  });

  it("le texte est sélectionnable et la police est celle du texte de jeu", () => {
    expect(code).toMatch(/user-select: text/);
    expect(code).toMatch(/--mh-font-text/);
    expect(code).toMatch(/font-size: var\(--mh-text-size/);
    expect(code).toMatch(/line-height: var\(--mh-text-leading/);
  });

  it("barre de défilement native stylée : -webkit-scrollbar, scrollbar-color réservé à Firefox", () => {
    expect(code).toMatch(/::-webkit-scrollbar\s*\{[^}]*width:/);
    expect(code).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*min-height:/);
    // `scrollbar-color` désactiverait les pseudo-éléments dans Chrome 121+ : il doit rester sous @supports not.
    const outside = code.replace(/@supports not selector\(::-webkit-scrollbar\)\s*\{[\s\S]*?\n\}/, "");
    expect(outside).not.toMatch(/scrollbar-color/);
    expect(code).toMatch(/@supports not selector\(::-webkit-scrollbar\)[\s\S]*scrollbar-color/);
  });

  it("le focus clavier est visible (contour 2 px --mh-focus, décalage 2 px) sur la liste et les boutons", () => {
    expect(code).toMatch(/\.mh-bl-scroll:focus-visible\s*\{[^}]*outline: var\(--mh-focus-width, 2px\) solid var\(--mh-focus/);
    expect(code).toMatch(/\.mh-bl-btn:focus-visible\s*\{[^}]*outline: var\(--mh-focus-width, 2px\) solid var\(--mh-focus/);
    expect(code).toMatch(/outline-offset: var\(--mh-focus-offset, 2px\)/);
  });

  it("la zone et les boutons sont placés en pourcentages du repère 1280x720", () => {
    expect(code).toMatch(/left: 13\.8%/); // texte à x = 177 @720
    expect(code).toMatch(/top: 11\.77%/); // ascenseur y = 85 @720
    expect(code).toMatch(/top: 92\.6%/); // boutons y = 667 @720
  });

  it("les cibles tactiles passent à 44 px et le défilement animé respecte prefers-reduced-motion", () => {
    expect(code).toMatch(/@media \(pointer: coarse\)[\s\S]*2\.75rem/);
    expect(code).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{[^}]*scroll-behavior: smooth/);
  });
});
