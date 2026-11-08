import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setUiLanguage } from "@/ui/i18n.js";
import { createTitleScreen, TITLE_ASSET_KEYS, type TitleActions } from "@/ui/title-screen.js";
import type { PlayerCommands } from "@/ui/types.js";
import { DomUIManager } from "@/ui/ui-manager.js";

/**
 * HUD-07 (#195) : menu de l'écran titre (ordre, libellés, clavier, Extra provisoire, repli sans asset).
 * Les positions réelles se vérifient au navigateur (tests/e2e/title-screen.spec.ts).
 */
const chapters = Array.from({ length: 10 }, (_, i) => ({
  id: `c${i}`,
  label: `Chapitre ${i}`,
  file: `c${i}.ks`,
  arc: "X",
  x: 0,
  y: 0,
}));

function makeActions() {
  return {
    start: vi.fn(),
    continueGame: vi.fn(),
    load: vi.fn(),
    flowchart: vi.fn(),
    config: vi.fn(),
    startChapter: vi.fn(),
  } satisfies TitleActions;
}

const press = (target: Element, key: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

describe("createTitleScreen", () => {
  let host: HTMLElement;
  beforeEach(() => {
    setUiLanguage("fr");
    document.body.innerHTML = '<div id="host"></div>';
    host = document.getElementById("host")!;
  });
  afterEach(() => setUiLanguage("fr"));

  function mount(opts: { hasContinue?: boolean; scripts?: typeof chapters; uiAssets?: { uiAsset(k: string): string | null } } = {}) {
    const actions = makeActions();
    const screen = createTitleScreen({
      scripts: opts.scripts ?? chapters,
      hasContinue: opts.hasContinue ?? false,
      actions,
      uiAssets: opts.uiAssets,
    });
    host.appendChild(screen.el);
    return { screen, actions };
  }
  const entries = () => [...host.querySelectorAll<HTMLButtonElement>(".mh-ui-title-menu > button")];
  const labels = () => entries().map((b) => b.textContent);

  describe("menu", () => {
    it("est un <nav> étiqueté de <button> dans l'ordre Start, Load, Flowchart, Config, Extra", () => {
      mount();
      const nav = host.querySelector("nav")!;
      expect(nav.getAttribute("aria-label")).toBe("Menu principal");
      expect(labels()).toEqual(["Start", "Load", "Flowchart", "Config", "Extra"]);
      expect(entries().every((b) => b.type === "button")).toBe(true);
    });

    it("insère Continuer après Load quand une autosave existe (les 4 entrées d'origine gardent leur ordre)", () => {
      mount({ hasContinue: true });
      expect(labels()).toEqual(["Start", "Load", "Continuer", "Flowchart", "Config", "Extra"]);
    });

    it("sans script, pas de Start", () => {
      mount({ scripts: [] });
      expect(labels()).toEqual(["Load", "Flowchart", "Config", "Extra"]);
    });

    it("aucune entrée Exit / Quitter, ni dans le menu ni ailleurs", () => {
      mount({ hasContinue: true });
      expect(host.querySelector('[data-entry="exit"]')).toBeNull();
      expect(host.textContent).not.toMatch(/\b(exit|quit|quitter)\b/i);
      for (const lang of ["en", "ja"] as const) {
        setUiLanguage(lang);
        host.replaceChildren();
        mount({ hasContinue: true });
        expect(host.textContent, lang).not.toMatch(/exit|quit|quitter|終了/i);
      }
    });

    it("chaque entrée appelle son action", () => {
      const { actions } = mount({ hasContinue: true });
      const click = (id: string) => host.querySelector<HTMLElement>(`[data-entry="${id}"]`)!.click();
      click("start");
      expect(actions.start).toHaveBeenCalledWith("c0.ks");
      click("load");
      click("continue");
      click("flowchart");
      click("config");
      expect(actions.load).toHaveBeenCalledOnce();
      expect(actions.continueGame).toHaveBeenCalledOnce();
      expect(actions.flowchart).toHaveBeenCalledOnce();
      expect(actions.config).toHaveBeenCalledOnce();
    });

    it("libellés d'origine en français comme en anglais, japonais traduit", () => {
      setUiLanguage("en");
      mount({ hasContinue: true });
      expect(labels()).toEqual(["Start", "Load", "Continue", "Flowchart", "Config", "Extra"]);
      setUiLanguage("ja");
      host.replaceChildren();
      mount();
      expect(labels()).toEqual(["スタート", "ロード", "フローチャート", "コンフィグ", "エクストラ"]);
    });
  });

  describe("clavier", () => {
    it("le focus initial est sur le menu, les flèches amènent sur une entrée", () => {
      const { screen } = mount();
      screen.focusMenu();
      expect(document.activeElement).toBe(host.querySelector("nav"));
      press(document.activeElement!, "ArrowDown");
      expect(document.activeElement).toBe(entries()[0]);
    });

    it("flèches haut/bas, Début/Fin parcourent tout le menu en boucle", () => {
      mount({ hasContinue: true });
      const list = entries();
      list[0]!.focus();
      const seen: Element[] = [];
      for (let i = 0; i < list.length; i++) {
        press(document.activeElement!, "ArrowDown");
        seen.push(document.activeElement!);
      }
      expect(seen).toEqual([...list.slice(1), list[0]]);
      press(document.activeElement!, "ArrowUp");
      expect(document.activeElement).toBe(list.at(-1));
      press(document.activeElement!, "Home");
      expect(document.activeElement).toBe(list[0]);
      press(document.activeElement!, "End");
      expect(document.activeElement).toBe(list.at(-1));
    });

    it("ArrowUp depuis le conteneur va à la dernière entrée", () => {
      const { screen } = mount();
      screen.focusMenu();
      press(document.activeElement!, "ArrowUp");
      expect(document.activeElement).toBe(entries().at(-1));
    });

    it("le focus est déjà dans l'ordre de tabulation naturel (aucun tabindex positif)", () => {
      mount();
      expect(entries().every((b) => b.tabIndex === 0)).toBe(true);
    });

    it("Entrée sur une entrée se traduit par un clic natif (activation via le navigateur)", () => {
      const { actions } = mount();
      entries()[1]!.focus();
      entries()[1]!.click(); // le navigateur envoie `click` sur Entrée/Espace pour un <button>
      expect(actions.load).toHaveBeenCalledOnce();
    });
  });

  describe("Extra (liste des chapitres, provisoire)", () => {
    const open = () => host.querySelector<HTMLElement>('[data-entry="extra"]')!.click();

    it("la grille de chapitres n'est pas au titre ; Extra l'ouvre sur le fond nuit", () => {
      mount();
      expect(host.querySelector(".mh-ui-script")).toBeNull();
      open();
      expect(host.querySelectorAll(".mh-ui-script")).toHaveLength(chapters.length);
      expect(host.querySelector(".mh-ui-title-extra")!.classList.contains("mh-ui-night")).toBe(true);
    });

    it("cliquer un chapitre le lance", () => {
      const { actions } = mount();
      open();
      host.querySelector<HTMLElement>('[data-file="c3.ks"]')!.click();
      expect(actions.startChapter).toHaveBeenCalledWith("c3.ks");
    });

    it("le focus passe au premier chapitre, le titre est inerte derrière", () => {
      mount();
      open();
      expect(document.activeElement).toBe(host.querySelector(".mh-ui-script"));
      expect(host.querySelector(".mh-ui-title-main")!.hasAttribute("inert")).toBe(true);
    });

    it("Échap et Retour ferment Extra et rendent le focus à son entrée", () => {
      mount();
      open();
      press(document.activeElement!, "Escape");
      expect(host.querySelector(".mh-ui-title-extra")).toBeNull();
      expect(document.activeElement).toBe(host.querySelector('[data-entry="extra"]'));
      expect(host.querySelector(".mh-ui-title-main")!.hasAttribute("inert")).toBe(false);

      open();
      host.querySelector<HTMLElement>(".mh-ui-title-back")!.click();
      expect(host.querySelector(".mh-ui-title-extra")).toBeNull();
    });

    it("navigation de la grille : droite/gauche, bas/haut par rangée de 4, puis Retour", () => {
      mount();
      open();
      const items = [...host.querySelectorAll<HTMLElement>(".mh-ui-script")];
      const back = host.querySelector<HTMLElement>(".mh-ui-title-back")!;
      press(document.activeElement!, "ArrowRight");
      expect(document.activeElement).toBe(items[1]);
      press(document.activeElement!, "ArrowDown");
      expect(document.activeElement).toBe(items[5]);
      press(document.activeElement!, "ArrowUp");
      expect(document.activeElement).toBe(items[1]);
      press(document.activeElement!, "ArrowLeft");
      expect(document.activeElement).toBe(items[0]);
      press(document.activeElement!, "End");
      expect(document.activeElement).toBe(back);
      press(document.activeElement!, "ArrowUp");
      expect(document.activeElement).toBe(items.at(-1));
      items[7]!.focus();
      press(items[7]!, "ArrowDown"); // 7 + 4 dépasse la liste : on passe à Retour
      expect(document.activeElement).toBe(back);
    });

    it("les chapitres restent atteignables sans le moindre Exit", () => {
      mount();
      open();
      expect(host.textContent).not.toMatch(/exit|quit|quitter/i);
    });
  });

  describe("repli sans assets", () => {
    it("sans résolveur : titre textuel, aucune classe d'image", () => {
      mount();
      const logo = host.querySelector(".mh-ui-title-logo")!;
      expect(logo.tagName).toBe("H1");
      expect(logo.textContent).toBe("Mahoutsukai no Yoru");
      expect(logo.classList.contains("mh-ui-title-logo-image")).toBe(false);
    });

    it("résolveur sans la clé du logo : même repli", () => {
      mount({ uiAssets: { uiAsset: () => null } });
      expect(host.querySelector(".mh-ui-title-logo-image")).toBeNull();
    });

    it("avec la clé du logo : classe image, le texte reste dans le DOM pour l'accessibilité", () => {
      const asked: string[] = [];
      mount({
        uiAssets: {
          uiAsset: (k) => {
            asked.push(k);
            return k === "title_titlelogo" ? "/x.png" : null;
          },
        },
      });
      expect(asked).toContain("title_titlelogo");
      const logo = host.querySelector(".mh-ui-title-logo")!;
      expect(logo.classList.contains("mh-ui-title-logo-image")).toBe(true);
      expect(logo.textContent).toBe("Mahoutsukai no Yoru");
    });

    it("la mention de droits est présente et traduite", () => {
      mount();
      expect(host.querySelector(".mh-ui-title-legal")!.textContent).toMatch(/TYPE-MOON/);
    });

    it("expose ses clés du manifeste", () => {
      expect(TITLE_ASSET_KEYS).toEqual(["title_background", "title_titlelogo"]);
    });
  });
});

describe("DomUIManager : écran titre", () => {
  let root: HTMLElement;
  let ui: DomUIManager;
  const cmd = () =>
    ({
      startScript: vi.fn(),
      openScreen: vi.fn(),
      load: vi.fn(() => Promise.resolve()),
    }) as unknown as PlayerCommands & Record<"startScript" | "openScreen" | "load", ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    setUiLanguage("fr");
    document.body.innerHTML = '<div id="viewport"></div>';
    root = document.getElementById("viewport")!;
  });
  afterEach(() => {
    ui.dispose();
    setUiLanguage("fr");
  });

  it("branche le résolveur : variables --mh-asset-* posées pour les clés du titre présentes seulement", () => {
    ui = new DomUIManager({
      resolver: { uiImage: (k: string) => (k === "title_background" ? "/assets/image/fond.webp" : null) },
    });
    ui.init(root, cmd());
    const overlay = root.querySelector<HTMLElement>("#ui-overlay")!;
    expect(overlay.style.getPropertyValue("--mh-asset-title_background")).toBe('url("/assets/image/fond.webp")');
    expect(overlay.style.getPropertyValue("--mh-asset-title_titlelogo")).toBe("");
    ui.dispose();
    expect(overlay.style.getPropertyValue("--mh-asset-title_background")).toBe("");
  });

  it("sans résolveur : aucune variable, repli CSS", () => {
    ui = new DomUIManager();
    ui.init(root, cmd());
    expect(root.querySelector<HTMLElement>("#ui-overlay")!.getAttribute("style") ?? "").not.toContain("--mh-asset");
  });

  it("n'applique jamais le fond nuit à l'écran titre lui-même, même avec ?night", () => {
    window.history.replaceState(null, "", "/?night");
    try {
      ui = new DomUIManager();
      ui.init(root, cmd());
      ui.show({ screen: "title", scripts: chapters, hasContinue: false });
      expect(root.querySelector("#ui-menu")!.classList.contains("mh-ui-night")).toBe(false);
      expect(root.querySelector(".mh-ui-title-screen")!.classList.contains("mh-ui-night")).toBe(false);
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("entrées bloquées (chargement) : les entrées du titre n'envoient aucune commande", () => {
    ui = new DomUIManager();
    const c = cmd();
    ui.init(root, c);
    ui.show({ screen: "title", scripts: chapters, hasContinue: true });
    ui.setInputEnabled(false);
    for (const id of ["start", "load", "continue", "flowchart", "config"]) {
      root.querySelector<HTMLElement>(`[data-entry="${id}"]`)!.click();
    }
    expect(c.startScript).not.toHaveBeenCalled();
    expect(c.openScreen).not.toHaveBeenCalled();
    expect(c.load).not.toHaveBeenCalled();
    ui.setInputEnabled(true);
    root.querySelector<HTMLElement>('[data-entry="config"]')!.click();
    expect(c.openScreen).toHaveBeenCalledWith("settings");
  });

  it("le titre suit la langue de l'interface", () => {
    ui = new DomUIManager();
    ui.init(root, cmd());
    ui.show({ screen: "title", scripts: chapters, hasContinue: true });
    setUiLanguage("ja");
    expect(root.querySelector('[data-entry="continue"]')!.textContent).toBe("つづきから");
    expect(root.querySelector(".mh-ui-title-logo-text")!.textContent).toBe("魔法使いの夜");
  });

  it("Load, Flowchart, Config et Continuer ouvrent les bons écrans", () => {
    ui = new DomUIManager();
    const c = cmd();
    ui.init(root, c);
    ui.show({ screen: "title", scripts: chapters, hasContinue: true });
    const click = (id: string) => root.querySelector<HTMLElement>(`[data-entry="${id}"]`)!.click();
    click("load");
    click("flowchart");
    click("config");
    click("continue");
    expect(c.openScreen.mock.calls.map((a) => a[0])).toEqual(["load", "flowchart", "settings"]);
    expect(c.load).toHaveBeenCalledWith("auto");
  });
});
