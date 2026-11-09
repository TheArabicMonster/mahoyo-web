import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setUiLanguage } from "@/ui/i18n.js";
import { createArchiveView } from "@/ui/archive-view.js";
import { createTitleScreen, TITLE_ASSET_KEYS, type TitleActions } from "@/ui/title-screen.js";
import type { PlayerCommands } from "@/ui/types.js";
import { DomUIManager } from "@/ui/ui-manager.js";

/**
 * HUD-07 (#195) : menu de l'écran titre (ordre, libellés, clavier, repli sans asset).
 * HUD-08 (#199) : sous-menu Extra en place, Archive (grisée, anti-spoiler), Cgmode et Soundmode à venir.
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

  function mount(
    opts: {
      hasContinue?: boolean;
      scripts?: typeof chapters;
      unlocked?: readonly string[];
      actions?: Partial<TitleActions>;
      uiAssets?: { uiAsset(k: string): string | null };
    } = {},
  ) {
    const actions = { ...makeActions(), ...opts.actions };
    const screen = createTitleScreen({
      scripts: opts.scripts ?? chapters,
      hasContinue: opts.hasContinue ?? false,
      unlockedChapters: opts.unlocked,
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

  describe("Extra (sous-menu en place) et Archive", () => {
    const open = () => host.querySelector<HTMLElement>('[data-entry="extra"]')!.click();
    const sub = () => [...host.querySelectorAll<HTMLButtonElement>(".mh-ui-title-extra-menu > button")];
    const subLabels = () => sub().map((b) => b.textContent);
    const openArchive = () => host.querySelector<HTMLElement>('[data-entry="archive"]')!.click();

    it("Extra n'ouvre pas la liste : il remplace les entrées par Archive, Cgmode, Soundmode, Back", () => {
      const { screen } = mount();
      expect(host.querySelector(".mh-ui-script")).toBeNull();
      expect(host.querySelector(".mh-ui-title-menu")!.classList.contains("is-away")).toBe(false);
      expect(host.querySelector(".mh-ui-title-extra-menu")!.classList.contains("is-away")).toBe(true);
      open();
      expect(screen.view).toBe("extra");
      expect(subLabels()).toEqual(["Archive", "Cgmode", "Soundmode", "Back"]);
      expect(host.querySelector(".mh-ui-title-menu")!.classList.contains("is-away")).toBe(true);
      expect(host.querySelector(".mh-ui-title-menu")!.hasAttribute("inert")).toBe(true);
      expect(host.querySelector(".mh-ui-title-extra-menu")!.hasAttribute("inert")).toBe(false);
      expect(host.querySelector('[data-entry="extra"]')!.getAttribute("aria-expanded")).toBe("true");
      expect(host.querySelector(".mh-ui-script")).toBeNull();
    });

    it("aucune entrée Flowchart (ni Exit) dans le sous-menu, quelle que soit la langue", () => {
      for (const lang of ["fr", "en", "ja"] as const) {
        setUiLanguage(lang);
        host.replaceChildren();
        mount({ hasContinue: true });
        const text = host.querySelector(".mh-ui-title-extra-menu")!.textContent ?? "";
        expect(text, lang).not.toMatch(/flowchart|フローチャート|exit|quit|quitter|終了/i);
        expect(host.querySelector(".mh-ui-title-extra-menu [data-entry='flowchart']")).toBeNull();
        expect(host.querySelectorAll(".mh-ui-title-extra-menu button")).toHaveLength(4);
      }
    });

    it("libellés d'origine (anglais) en français, traduits en japonais", () => {
      setUiLanguage("ja");
      mount();
      expect(subLabels()).toEqual(["アーカイブ", "CGモード", "サウンドモード", "戻る"]);
    });

    it("le focus passe à la première entrée (Archive)", () => {
      mount();
      open();
      expect(document.activeElement).toBe(sub()[0]);
    });

    it("Back et Échap ramènent au menu principal et rendent le focus à Extra", () => {
      const { screen } = mount();
      open();
      host.querySelector<HTMLElement>('[data-entry="back"]')!.click();
      expect(screen.view).toBe("main");
      expect(document.activeElement).toBe(host.querySelector('[data-entry="extra"]'));
      expect(host.querySelector(".mh-ui-title-menu")!.hasAttribute("inert")).toBe(false);
      expect(host.querySelector(".mh-ui-title-extra-menu")!.classList.contains("is-away")).toBe(true);

      open();
      press(document.activeElement!, "Escape");
      expect(screen.view).toBe("main");
      expect(document.activeElement).toBe(host.querySelector('[data-entry="extra"]'));
    });

    it("Échap au menu principal ne fait rien (et n'est pas avalé)", () => {
      mount();
      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      host.querySelector(".mh-ui-title-entry")!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });

    it("flèches, Début, Fin parcourent le sous-menu en boucle", () => {
      mount();
      open();
      const list = sub();
      press(document.activeElement!, "ArrowDown");
      expect(document.activeElement).toBe(list[1]);
      press(document.activeElement!, "End");
      expect(document.activeElement).toBe(list[3]);
      press(document.activeElement!, "ArrowDown");
      expect(document.activeElement).toBe(list[0]);
      press(document.activeElement!, "ArrowUp");
      expect(document.activeElement).toBe(list[3]);
    });

    it("Archive ouvre la liste des chapitres sur le fond nuit ; cliquer un chapitre le lance", () => {
      const { screen, actions } = mount();
      open();
      openArchive();
      expect(screen.view).toBe("archive");
      expect(host.querySelectorAll(".mh-ui-script")).toHaveLength(chapters.length);
      expect(host.querySelector(".mh-ui-title-extra")!.classList.contains("mh-ui-night")).toBe(true);
      expect(host.querySelector(".mh-ui-title-extra-heading")!.textContent).toBe("Archive");
      host.querySelector<HTMLElement>('[data-file="c3.ks"]')!.click();
      expect(actions.startChapter).toHaveBeenCalledWith("c3.ks");
    });

    it("dans l'Archive : focus sur le premier chapitre, titre inerte derrière", () => {
      mount();
      open();
      openArchive();
      expect(document.activeElement).toBe(host.querySelector(".mh-ui-script"));
      expect(host.querySelector(".mh-ui-title-main")!.hasAttribute("inert")).toBe(true);
    });

    it("Échap et Retour ferment l'Archive et reviennent au sous-menu (Archive refocalisée), un second Échap au principal", () => {
      const { screen } = mount();
      open();
      openArchive();
      press(document.activeElement!, "Escape");
      expect(host.querySelector(".mh-ui-title-extra")).toBeNull();
      expect(screen.view).toBe("extra");
      expect(document.activeElement).toBe(sub()[0]);
      expect(host.querySelector(".mh-ui-title-main")!.hasAttribute("inert")).toBe(false);
      press(document.activeElement!, "Escape");
      expect(screen.view).toBe("main");

      open();
      openArchive();
      host.querySelector<HTMLElement>(".mh-ui-title-back")!.click();
      expect(host.querySelector(".mh-ui-title-extra")).toBeNull();
      expect(screen.view).toBe("extra");
    });

    it("navigation de la grille : droite/gauche, bas/haut par rangée de 4, puis Retour", () => {
      mount();
      open();
      openArchive();
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

    describe("Archive grisée tant qu'aucun chapitre n'est déverrouillé", () => {
      it("aucun chapitre déverrouillé : aria-disabled, texte d'aide, clic sans effet, reste atteignable au clavier", () => {
        const { screen } = mount({ unlocked: [] });
        open();
        const archive = sub()[0]!;
        expect(archive.classList.contains("is-locked")).toBe(true);
        expect(archive.getAttribute("aria-disabled")).toBe("true");
        const hint = host.querySelector(`#${archive.getAttribute("aria-describedby")}`)!;
        expect(hint.textContent).toMatch(/déverrouille/);
        archive.click();
        expect(screen.view).toBe("extra");
        expect(host.querySelector(".mh-ui-script")).toBeNull();
        expect(document.activeElement).toBe(archive);
      });

      it("un chapitre déverrouillé suffit à dégriser Archive", () => {
        mount({ unlocked: ["c0"] });
        open();
        expect(sub()[0]!.hasAttribute("aria-disabled")).toBe(false);
        expect(sub()[0]!.classList.contains("is-locked")).toBe(false);
      });

      it("sans information de progression, tous les chapitres sont proposés", () => {
        mount();
        open();
        expect(sub()[0]!.hasAttribute("aria-disabled")).toBe(false);
      });

      it("sans aucun script, Archive est grisée", () => {
        mount({ scripts: [] });
        open();
        expect(sub()[0]!.getAttribute("aria-disabled")).toBe("true");
      });

      it("anti-spoiler : un chapitre verrouillé n'expose ni titre, ni fichier, ni action", () => {
        const { actions } = mount({ unlocked: ["c0", "c2"] });
        open();
        openArchive();
        const cells = [...host.querySelectorAll<HTMLButtonElement>(".mh-ui-script")];
        expect(cells).toHaveLength(chapters.length);
        expect(cells.filter((b) => b.dataset.file).map((b) => b.dataset.file)).toEqual(["c0.ks", "c2.ks"]);
        const locked = cells[1]!;
        expect(locked.textContent).toBe("???");
        expect(locked.getAttribute("aria-disabled")).toBe("true");
        expect(locked.getAttribute("aria-label")).toBe("Chapitre 2 verrouillé");
        expect(locked.hasAttribute("data-file")).toBe(false);
        expect(locked.tabIndex).toBe(-1);
        locked.click();
        expect(actions.startChapter).not.toHaveBeenCalled();
        expect(cells.map((b) => b.textContent)).toEqual([
          "Chapitre 0",
          "???",
          "Chapitre 2",
          ...Array<string>(chapters.length - 3).fill("???"),
        ]);
        const html = host.querySelector(".mh-ui-title-extra")!.outerHTML;
        for (const secret of ["c1.ks", "c3.ks", "c9.ks"]) expect(html, secret).not.toContain(secret);
      });

      it("le premier chapitre déverrouillé reçoit le focus ; les verrouillés restent atteignables aux flèches", () => {
        mount({ unlocked: ["c1"] });
        open();
        openArchive();
        const cells = [...host.querySelectorAll<HTMLElement>(".mh-ui-script")];
        expect(document.activeElement).toBe(cells[1]);
        press(document.activeElement!, "ArrowLeft");
        expect(document.activeElement).toBe(cells[0]);
      });

      it("liste ouverte sans chapitre déverrouillé (cas limite) : le focus tombe sur Retour", () => {
        const view = createArchiveView({ scripts: chapters, unlocked: [], onStart: vi.fn(), onClose: vi.fn() });
        host.appendChild(view.el);
        view.focusFirst();
        expect(document.activeElement).toBe(host.querySelector(".mh-ui-title-back"));
      });
    });

    describe("Cgmode et Soundmode (écrans à venir : #208, #209)", () => {
      it("grisés, sans écran fantôme, tant que l'action n'existe pas", () => {
        const { screen } = mount();
        open();
        for (const id of ["cgmode", "soundmode"]) {
          const b = host.querySelector<HTMLButtonElement>(`[data-entry="${id}"]`)!;
          expect(b.getAttribute("aria-disabled"), id).toBe("true");
          expect(host.querySelector(`#${b.getAttribute("aria-describedby")}`)!.textContent).toBe("Bientôt disponible.");
          b.click();
          expect(screen.view, id).toBe("extra");
        }
        expect(host.querySelector(".mh-ui-title-extra")).toBeNull();
      });

      it("s'activent quand le player fournit l'action", () => {
        const cgMode = vi.fn();
        const soundMode = vi.fn();
        mount({ actions: { cgMode, soundMode } });
        open();
        host.querySelector<HTMLElement>('[data-entry="cgmode"]')!.click();
        host.querySelector<HTMLElement>('[data-entry="soundmode"]')!.click();
        expect(cgMode).toHaveBeenCalledOnce();
        expect(soundMode).toHaveBeenCalledOnce();
        expect(host.querySelector('[data-entry="cgmode"]')!.hasAttribute("aria-disabled")).toBe(false);
      });
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
