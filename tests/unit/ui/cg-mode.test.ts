import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setUiLanguage } from "@/ui/i18n.js";
import {
  buildCgCatalog,
  cgCatalogSize,
  createCgMode,
  CG_SCREEN_CLASS,
  type CgImage,
  type CgMode,
} from "@/ui/cg-mode.js";

/**
 * HUD-15 (#208) : écran « CG mode ». jsdom ne calcule pas la mise en page (grille responsive
 * contrôlée dans `tests/unit/ui/cg-mode-css.test.ts`) : on teste ici le catalogue calculé à
 * l'exécution, le déverrouillage par les CG vues, la grille, la visionneuse (zoom, précédent/suivant)
 * et le clavier.
 */
const images: CgImage[] = [
  { key: "bg_a", url: "/assets/bg/a.webp", kind: "bg", source: "bg/a.tlg" },
  { key: "cg01", url: "/assets/image/cg01.webp", kind: "image", source: "image/cg01.tlg" },
  { key: "cg02", url: "/assets/image/cg02.webp", kind: "image", source: "image/cg02.tlg" },
  { key: "cg03", url: "/assets/image/cg03.webp", kind: "image", source: "image/cg03.tlg" },
  { key: "cg04", url: "/assets/image/cg04.webp", kind: "image", source: "image/cg04.tlg" },
  { key: "cg05", url: "/assets/image/cg05.webp", kind: "image", source: "image/cg05.tlg" },
  { key: "aoko", url: "/assets/image/aoko.webp", kind: "image", source: "fg/aoko.tlg" },
  { key: "cg_background", url: "/assets/image/cg_background.webp", kind: "image", source: "image/cg_background.tlg" },
  { key: "rule1", url: "/assets/rule/r.png", kind: "rule", source: "rule/r.tlg" },
];

const key = (k: string, init: KeyboardEventInit = {}) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));

describe("CG mode — catalogue calculé à l'exécution (HUD-15)", () => {
  it("sépare évènements (image/) et arrière-plans (bg/), exclut sprites, rules et ornements", () => {
    const catalog = buildCgCatalog(images);
    expect(catalog.event.map((e) => e.key)).toEqual(["cg01", "cg02", "cg03", "cg04", "cg05"]);
    expect(catalog.background.map((e) => e.key)).toEqual(["bg_a"]);
    expect(cgCatalogSize(catalog)).toBe(6);
    // Sprites (fg/), rules de transition et ornements d'interface (UI_ASSET_KEYS) ne sont pas des CG.
    const keys = [...catalog.event, ...catalog.background].map((e) => e.key);
    expect(keys).not.toContain("aoko");
    expect(keys).not.toContain("rule1");
    expect(keys).not.toContain("cg_background");
  });

  it("trie les clés de façon stable et numérique", () => {
    const catalog = buildCgCatalog([
      { key: "cg10", url: "/i/10.webp", kind: "image", source: "image/10.tlg" },
      { key: "cg2", url: "/i/2.webp", kind: "image", source: "image/2.tlg" },
    ]);
    expect(catalog.event.map((e) => e.key)).toEqual(["cg2", "cg10"]);
  });

  it("accepte une liste d'exclusion personnalisée (elle remplace la liste par défaut)", () => {
    const catalog = buildCgCatalog(images, { excluded: new Set(["cg01", "cg02"]) });
    expect(catalog.event.map((e) => e.key)).toEqual(["cg_background", "cg03", "cg04", "cg05"]);
  });

  it("sans manifeste : catalogue vide (aucun écran fantôme)", () => {
    expect(buildCgCatalog([])).toEqual({ event: [], background: [] });
  });
});

describe("CG mode — écran (HUD-15)", () => {
  let host: HTMLElement;
  let mode: CgMode | null = null;
  let closed: number;

  beforeEach(() => {
    vi.useFakeTimers();
    setUiLanguage("fr");
    document.body.innerHTML = '<div id="ui-overlay"><div id="ui-cg"></div></div>';
    host = document.getElementById("ui-cg")!;
    closed = 0;
  });

  afterEach(() => {
    mode?.destroy();
    mode = null;
    vi.useRealTimers();
    setUiLanguage("fr");
    document.body.innerHTML = "";
  });

  const mount = (seen: readonly string[] = [], catalog = buildCgCatalog(images)): CgMode => {
    mode = createCgMode({ catalog, seen: new Set(seen), onClose: () => closed++ });
    host.replaceChildren(mode.element);
    return mode;
  };
  const tiles = () => [...host.querySelectorAll<HTMLButtonElement>(".mh-cg-tile")];
  const tabs = () => [...host.querySelectorAll<HTMLButtonElement>(".mh-cg-tab")];
  const viewer = () => host.querySelector<HTMLElement>(".mh-cg-viewer")!;
  const viewerImage = () => host.querySelector<HTMLImageElement>(".mh-cg-viewer-image")!;

  it("construit un écran modal sur le fond nuit, titré et sans effet fantôme", () => {
    const screen = mount().element;
    expect(screen.classList.contains(CG_SCREEN_CLASS)).toBe(true);
    expect(screen.classList.contains("mh-ui-night")).toBe(true);
    expect(screen.getAttribute("role")).toBe("dialog");
    expect(screen.getAttribute("aria-modal")).toBe("true");
    expect(host.querySelector(".mh-cg-title")!.textContent).toBe("CG mode");
    expect(tabs().map((tab) => tab.textContent)).toEqual(["Évènement", "Arrière-plan"]);
  });

  it("une CG non vue est verrouillée : libellé « image non affichée », pas d'image, pas de visionneuse", () => {
    mount();
    const [tile] = tiles();
    expect(tile!.dataset.locked).toBe("true");
    expect(tile!.classList.contains("is-locked")).toBe(true);
    expect(tile!.getAttribute("aria-disabled")).toBe("true");
    expect(tile!.tabIndex).toBe(-1);
    expect(tile!.querySelector("img")).toBeNull();
    expect(tile!.querySelector(".mh-cg-tile-locked")!.textContent).toBe("image non affichée");
    tile!.click();
    expect(viewer().hidden).toBe(true);
  });

  it("une CG vue est affichée et ouvre la visionneuse", () => {
    mount(["cg01"]);
    const tile = tiles()[0]!;
    expect(tile.dataset.locked).toBe("false");
    expect(tile.classList.contains("is-unlocked")).toBe(true);
    const img = tile.querySelector<HTMLImageElement>("img.mh-cg-thumb")!;
    expect(img.getAttribute("src")).toBe("/assets/image/cg01.webp");
    expect(tile.getAttribute("aria-disabled")).toBeNull();

    tile.click();
    expect(viewer().hidden).toBe(false);
    expect(viewerImage().getAttribute("src")).toBe("/assets/image/cg01.webp");
    expect(host.querySelector(".mh-cg-viewer-caption")!.textContent).toBe("1 / 1");
  });

  it("bascule Évènement / Arrière-plan avec des compteurs implicites (onglets ARIA)", () => {
    mount(["bg_a"]);
    const [eventTab, backgroundTab] = tabs();
    expect(eventTab!.getAttribute("aria-selected")).toBe("true");
    backgroundTab!.click();
    expect(backgroundTab!.getAttribute("aria-selected")).toBe("true");
    expect(tiles().map((tile) => tile.dataset.key)).toEqual(["bg_a"]);
    expect(tiles()[0]!.dataset.locked).toBe("false");
  });

  it("navigation clavier dans la grille : flèches, Début, Fin (sélection sans couleur seule)", () => {
    mount(["cg01", "cg02", "cg03", "cg04", "cg05"]);
    tiles()[0]!.focus();
    expect(tiles()[0]!.classList.contains("is-selected")).toBe(true);
    expect(tiles()[0]!.getAttribute("aria-current")).toBe("true");

    key("ArrowRight");
    expect(document.activeElement).toBe(tiles()[1]);
    key("ArrowDown");
    expect(document.activeElement).toBe(tiles()[5] ?? tiles()[4]);
    key("End");
    expect(document.activeElement).toBe(tiles().at(-1));
    key("Home");
    expect(document.activeElement).toBe(tiles()[0]);
    // Le marqueur non chromatique existe dans la feuille (bord épais + losange) : cf. test CSS.
    expect(tiles()[0]!.getAttribute("aria-current")).toBe("true");
    expect(tiles()[1]!.hasAttribute("aria-current")).toBe(false);
  });

  it("Échap ferme la visionneuse puis l'écran (Retour)", () => {
    mount(["cg01"]);
    tiles()[0]!.click();
    expect(viewer().hidden).toBe(false);
    key("Escape");
    expect(viewer().hidden).toBe(true);
    expect(closed).toBe(0);
    key("Escape");
    expect(closed).toBe(1);
  });

  it("précédent/suivant en boucle dans la catégorie, au clavier et au clic", () => {
    mount(["cg01", "cg02"]);
    tiles()[0]!.click();
    key("ArrowRight");
    expect(viewerImage().getAttribute("src")).toBe("/assets/image/cg02.webp");
    expect(host.querySelector(".mh-cg-viewer-caption")!.textContent).toBe("2 / 2");
    key("ArrowRight"); // boucle vers la première
    expect(viewerImage().getAttribute("src")).toBe("/assets/image/cg01.webp");
    host.querySelector<HTMLButtonElement>(".mh-cg-viewer-prev")!.click();
    expect(viewerImage().getAttribute("src")).toBe("/assets/image/cg02.webp");
    host.querySelector<HTMLButtonElement>(".mh-cg-viewer-next")!.click();
    expect(viewerImage().getAttribute("src")).toBe("/assets/image/cg01.webp");
    // Une CG verrouillée n'apparaît jamais dans la visionneuse.
    expect(host.querySelectorAll(".mh-cg-viewer-image").length).toBe(1);
  });

  it("zoom borné entre 1 et 4 (boutons, clavier et molette)", () => {
    mount(["cg01"]);
    tiles()[0]!.click();
    const frame = host.querySelector<HTMLElement>(".mh-cg-viewer-frame")!;
    const zoom = () => Number(frame.style.getPropertyValue("--mh-cg-zoom"));
    expect(zoom()).toBe(1);
    host.querySelectorAll<HTMLButtonElement>(".mh-cg-viewer-button")[3]!.click(); // +
    expect(zoom()).toBe(1.5);
    key("+");
    expect(zoom()).toBe(2);
    key("-");
    expect(zoom()).toBe(1.5);
    for (let i = 0; i < 10; i++) key("+");
    expect(zoom()).toBe(4);
    expect(host.querySelectorAll<HTMLButtonElement>(".mh-cg-viewer-button")[3]!.disabled).toBe(true);
    for (let i = 0; i < 20; i++) key("-");
    expect(zoom()).toBe(1);
    // Molette sur le cadre : ± un cran, événement consommé.
    const wheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    frame.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(zoom()).toBe(1.5);
    // 1:1 réinitialise.
    host.querySelectorAll<HTMLButtonElement>(".mh-cg-viewer-button")[2]!.click();
    expect(zoom()).toBe(1);
  });

  it("affiche l'état vide quand le catalogue ne contient rien", () => {
    mount([], { event: [], background: [] });
    const empty = host.querySelector<HTMLElement>(".mh-cg-empty")!;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe("Aucune image disponible.");
    expect(tiles()).toHaveLength(0);
  });

  it("destroy() retire les listeners globaux", () => {
    const view = mount(["cg01"]);
    view.destroy();
    key("Escape");
    expect(closed).toBe(0);
  });

  it("libellés localisés (en, ja) : « image non affichée » traduit, jamais en dur", () => {
    setUiLanguage("en");
    host.replaceChildren();
    mode?.destroy();
    mode = createCgMode({ catalog: buildCgCatalog(images), seen: new Set(), onClose: () => closed++ });
    host.replaceChildren(mode.element);
    expect(host.querySelector(".mh-cg-tile-locked")!.textContent).toBe("image not displayed");
    setUiLanguage("ja");
    mode.destroy();
    mode = createCgMode({ catalog: buildCgCatalog(images), seen: new Set(), onClose: () => closed++ });
    host.replaceChildren(mode.element);
    expect(host.querySelector(".mh-cg-tile-locked")!.textContent).toBe("未表示の画像");
    expect(host.querySelectorAll(".mh-cg-tile-locked").length).toBeGreaterThan(0);
  });
});
