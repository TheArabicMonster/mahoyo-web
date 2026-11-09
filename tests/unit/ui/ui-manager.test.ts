import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultShortcuts } from "@/core/shortcuts.js";
import { DEFAULT_AUDIO_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "@/renderer/types.js";
import { setUiLanguage } from "@/ui/i18n.js";
import { TOAST_LEAVE_MS } from "@/ui/toast.js";
import { DomUIManager } from "@/ui/ui-manager.js";
import type { GameSettings, PlayerCommands, PlayerStatus, UIView } from "@/ui/types.js";

function makeCommands() {
  const names = [
    "advance", "hurryText", "setMode", "toggleUserHide", "rollback", "choose", "startScript", "openScreen",
    "closeScreen", "returnToTitle", "save", "load", "deleteSave", "updateSettings", "resetSettings",
    "toggleFullscreen", "testSe",
  ] as const;
  const c = {} as Record<string, ReturnType<typeof vi.fn>>;
  for (const n of names) c[n] = vi.fn(() => Promise.resolve());
  return c as unknown as PlayerCommands & Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
}

const settings: GameSettings = {
  display: { ...DEFAULT_DISPLAY_SETTINGS, textSpeedUnread: 30, autoPageDelay: 1500 },
  audio: { ...DEFAULT_AUDIO_SETTINGS, bgm: 0.8, se: 0.8 },
  skipUnread: false,
  language: "ja",
  shortcuts: defaultShortcuts(),
  flowchartRevealAll: false,
};
const status = (p: Partial<PlayerStatus> = {}): PlayerStatus => ({
  mode: "normal", inGame: true, userHidden: false, canRollback: false, quickMenuLocked: false, autoPaused: false,
  mouseMode: "menu", autoHideCursor: false, fastForwardKey: "shift", shortcuts: defaultShortcuts(), ...p,
});
const scripts = [
  { id: "a", label: "A", file: "a.ks", arc: "X", x: 100, y: 100 },
  { id: "b", label: "B", file: "b.ks", arc: "X", x: 300, y: 200 },
];
const slotData = { scriptFile: "a.ks", timestamp: 0, previewText: "hello", thumbnailUrl: null, stage: {} as never };

describe("DomUIManager", () => {
  let root: HTMLElement;
  let ui: DomUIManager;
  let cmd: ReturnType<typeof makeCommands>;
  const key = (k: string, init: KeyboardEventInit = {}) =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }));
  const q = (sel: string) => root.querySelector<HTMLElement>(sel);
  const qa = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];

  beforeEach(() => {
    document.body.innerHTML = '<div id="viewport"></div>';
    root = document.getElementById("viewport")!;
    cmd = makeCommands();
    ui = new DomUIManager();
    ui.init(root, cmd);
    ui.show({ screen: "game" });
    ui.setStatus(status());
  });
  afterEach(() => {
    ui.dispose();
    vi.useRealTimers();
  });

  it("crée le layout #ui-overlay", () => {
    for (const id of ["ui-menu", "ui-flowchart", "ui-pause", "ui-cg", "ui-choices", "ui-toast", "ui-loading"]) {
      expect(q(`#ui-overlay #${id}`)).not.toBeNull();
    }
  });

  describe("keymap", () => {
    it("clic, Espace, Entrée = advance", () => {
      q("#ui-overlay")!.click();
      key(" ");
      key("Enter");
      expect(cmd.advance).toHaveBeenCalledTimes(3);
    });
    it("une répétition clavier n'avance pas (B1)", () => {
      key(" ");
      key(" ", { repeat: true });
      key("Enter", { repeat: true });
      key("Enter");
      expect(cmd.advance).toHaveBeenCalledTimes(2);
    });
    it("les répétitions n'agissent pas sur A, S, flèche gauche ni Échap (B1)", () => {
      key("a", { repeat: true });
      key("s", { repeat: true });
      key("ArrowLeft", { repeat: true });
      key("Escape", { repeat: true });
      expect(cmd.setMode).not.toHaveBeenCalled();
      expect(cmd.rollback).not.toHaveBeenCalled();
      expect(cmd.openScreen).not.toHaveBeenCalled();
    });
    it("une répétition ne choisit pas d'option (B1)", () => {
      ui.showChoices(["A", "B"]);
      key("1", { repeat: true });
      expect(cmd.choose).not.toHaveBeenCalled();
      key("1");
      expect(cmd.choose).toHaveBeenCalledWith(0);
    });
    it("flèche gauche = rollback, sans advance (B2)", () => {
      const ev = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      expect(cmd.rollback).toHaveBeenCalledTimes(1);
      expect(cmd.advance).not.toHaveBeenCalled();
      expect(ev.defaultPrevented).toBe(true);
    });
    it("flèche gauche ignorée pendant un choix et dans un champ de saisie (B2)", () => {
      document.body.insertAdjacentHTML("beforeend", '<input id="f">');
      document.getElementById("f")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      ui.showChoices(["A"]);
      key("ArrowLeft");
      expect(cmd.rollback).not.toHaveBeenCalled();
    });
    it("A bascule l'auto, F avance jusqu'au dernier texte lu, S ouvre la sauvegarde (#177)", () => {
      key("a");
      expect(cmd.setMode).toHaveBeenLastCalledWith("auto");
      ui.setStatus(status({ mode: "auto" }));
      key("a");
      expect(cmd.setMode).toHaveBeenLastCalledWith("normal");
      key("f");
      expect(cmd.setMode).toHaveBeenLastCalledWith("skip");
      key("s");
      expect(cmd.openScreen).toHaveBeenCalledWith("save");
    });
    it("Échap ouvre le menu de pause en jeu (B2)", () => {
      key("Escape");
      expect(cmd.openScreen).toHaveBeenCalledWith("pause");
    });
    it("Espace sur un bouton focalisé n'avance pas (le clic du bouton s'en charge)", () => {
      document.body.insertAdjacentHTML("beforeend", "<button id=\"b\">x</button>");
      document.getElementById("b")!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      expect(cmd.advance).not.toHaveBeenCalled();
    });
    it("clic droit : menu direct par défaut, ou masquer puis menu (#177)", () => {
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      q("#ui-overlay")!.dispatchEvent(ev);
      expect(cmd.openScreen).toHaveBeenCalledWith("pause");
      expect(ev.defaultPrevented).toBe(true);
      cmd.openScreen.mockClear();
      ui.setStatus(status({ mouseMode: "hideThenMenu" }));
      q("#ui-overlay")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(cmd.toggleUserHide).toHaveBeenCalled();
      expect(cmd.openScreen).not.toHaveBeenCalled();
    });
    it("molette haut = rollback, bas = advance", () => {
      const o = q("#ui-overlay")!;
      o.dispatchEvent(new WheelEvent("wheel", { deltaY: -10, bubbles: true }));
      o.dispatchEvent(new WheelEvent("wheel", { deltaY: 10, bubbles: true }));
      expect(cmd.rollback).toHaveBeenCalledTimes(1);
      expect(cmd.advance).toHaveBeenCalledTimes(1);
    });
    it("Ctrl active le skip temporairement", () => {
      key("Control", { ctrlKey: true });
      expect(cmd.setMode).toHaveBeenLastCalledWith("skip");
      ui.setStatus(status({ mode: "skip" }));
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
      expect(cmd.setMode).toHaveBeenLastCalledWith("normal");
    });
    it("Échap ouvre pause en jeu, ferme sinon", () => {
      key("Escape");
      expect(cmd.openScreen).toHaveBeenCalledWith("pause");
      ui.show({ screen: "pause" });
      key("Escape");
      expect(cmd.closeScreen).toHaveBeenCalled();
    });
    it("F4 plein écran, F avance, S sauvegarde (#177)", () => {
      key("F4");
      expect(cmd.toggleFullscreen).toHaveBeenCalled();
      key("f");
      expect(cmd.setMode).toHaveBeenLastCalledWith("skip");
      ui.setStatus(status());
      key("s");
      expect(cmd.openScreen).toHaveBeenCalledWith("save");
    });
    it("hors jeu, clic/espace n'avancent pas", () => {
      ui.show({ screen: "pause" });
      q("#ui-overlay")!.click();
      key(" ");
      expect(cmd.advance).not.toHaveBeenCalled();
    });
  });

  describe("écrans", () => {
    const views: UIView[] = [
      { screen: "title", scripts, hasContinue: true },
      { screen: "pause" },
      { screen: "save", slots: [{ id: 1, data: slotData }, { id: 2, data: null }] },
      { screen: "load", slots: [{ id: 1, data: slotData }] },
      { screen: "settings", settings, availableLanguages: ["ja", "fr"] },
      { screen: "backlog", entries: [{ text: "t1" }, { text: "t2", voice: "v" }] },
      {
        screen: "flowchart",
        scripts,
        progress: { unlocked: ["a"], completed: [] },
        currentScript: null,
        story: { visited: [], finished: [], choices: [], endings: [] },
      },
    ];
    it.each(views.map((v) => [v.screen, v] as const))("affiche %s", (_n, v) => {
      ui.show(v);
      expect(q("#ui-overlay")!.dataset.screen).toBe(v.screen);
      // Menu système plein cadre (HUD-06, #194), écran titre plein cadre (HUD-07, #195) et flowchart (FLOW-05, #197) : pas de panneau centré.
      const full: Record<string, string> = { pause: ".mh-sysmenu", title: ".mh-ui-title-screen", flowchart: ".mh-flow-screen", backlog: ".mh-bl", settings: ".mh-cfg" };
      expect(q(full[v.screen] ?? ".mh-ui-panel, .mh-sl")).not.toBeNull();
      ui.show({ screen: "game" });
      expect(q(".mh-ui-panel, .mh-sl")).toBeNull();
      expect(q(".mh-sysmenu")).toBeNull();
      expect(q(".mh-ui-title-screen")).toBeNull();
      expect(q(".mh-flow-screen")).toBeNull();
      expect(q(".mh-bl")).toBeNull();
      expect(q(".mh-cfg")).toBeNull();
    });

    it("title : la grille de chapitres n'est plus au titre, Extra > Archive l'ouvre", () => {
      ui.show(views[0]!);
      expect(q(".mh-ui-script")).toBeNull();
      q('[data-entry="extra"]')!.click();
      expect(q(".mh-ui-script")).toBeNull(); // le sous-menu seul : la liste est derrière Archive
      q('[data-entry="archive"]')!.click();
      expect(qa(".mh-ui-script").map((b) => b.textContent)).toEqual(["A", "B"]);
    });
    it("title : chapitre (via Extra > Archive) et continuer", () => {
      ui.show(views[0]!);
      q('[data-entry="extra"]')!.click();
      q('[data-entry="archive"]')!.click();
      q('[data-file="b.ks"]')!.click();
      expect(cmd.startScript).toHaveBeenCalledWith("b.ks");
      q(".mh-ui-continue")!.click();
      expect(cmd.load).toHaveBeenCalledWith("auto");
    });
    it("title : unlockedChapters est transmis (Archive grisée sans chapitre déverrouillé)", () => {
      ui.show({ screen: "title", scripts, hasContinue: false, unlockedChapters: [] });
      q('[data-entry="extra"]')!.click();
      expect(q('[data-entry="archive"]')!.getAttribute("aria-disabled")).toBe("true");
      q('[data-entry="archive"]')!.click();
      expect(q(".mh-ui-script")).toBeNull();
    });
    it("title : « Start » lance le premier script de la liste", () => {
      ui.show(views[0]!);
      q(".mh-ui-new-game")!.click();
      expect(cmd.startScript).toHaveBeenCalledWith("a.ks");
    });
    it("title : sans « Continuer » quand il n'y a pas d'autosave, « Start » reste là", () => {
      ui.show({ screen: "title", scripts, hasContinue: false });
      expect(q(".mh-ui-continue")).toBeNull();
      expect(q(".mh-ui-new-game")).not.toBeNull();
    });
    it("title : liste vide, pas de « Start »", () => {
      ui.show({ screen: "title", scripts: [], hasContinue: false });
      expect(q(".mh-ui-new-game")).toBeNull();
    });
    it("les entrées Flowchart du titre et du menu système ouvrent le nouvel écran (FLOW-05)", () => {
      ui.show({ screen: "title", scripts, hasContinue: false });
      q('[data-entry="flowchart"]')!.click();
      expect(cmd.openScreen).toHaveBeenLastCalledWith("flowchart");
      ui.show({ screen: "pause" });
      q('[data-entry="flowchart"]')!.click();
      expect(cmd.openScreen).toHaveBeenCalledTimes(2);
      ui.show(views[6]!);
      expect(q(".mh-flow-screen")).not.toBeNull();
    });
    it("pause : « Back » referme le menu", () => {
      ui.show({ screen: "pause" });
      q(".mh-sysmenu-back")!.click();
      expect(cmd.closeScreen).toHaveBeenCalled();
    });
    it("pause : retour au titre demande confirmation", async () => {
      ui.show({ screen: "pause" });
      q('[data-entry="title"]')!.click();
      q(".mh-ui-confirm-yes")!.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(cmd.returnToTitle).toHaveBeenCalled();
    });
    it("save : le bouton Sauvegarder appelle la commande (la confirmation d'écrasement est celle du player)", async () => {
      ui.show({ screen: "save", slots: [{ id: 1, data: slotData }, { id: 2, data: null }] });
      q('[data-slot="2"] .mh-sl-save')!.click();
      await vi.waitFor(() => expect(cmd.save).toHaveBeenCalledWith(2));
      q('[data-slot="1"] .mh-sl-save')!.click();
      await vi.waitFor(() => expect(cmd.save).toHaveBeenCalledWith(1));
      expect(q(".mh-ui-confirm")).toBeNull();
    });
    it("load : slot vide sans bouton, charger confirme avec Oui présélectionné", async () => {
      ui.show({ screen: "load", slots: [{ id: 1, data: slotData }, { id: 2, data: null }] });
      expect(q('[data-slot="2"] .mh-sl-load')).toBeNull();
      q('[data-slot="1"] .mh-sl-load')!.click();
      await vi.waitFor(() => expect(q(".mh-ui-confirm")).not.toBeNull());
      expect(cmd.load).not.toHaveBeenCalled();
      q(".mh-ui-confirm-yes")!.click();
      await vi.waitFor(() => expect(cmd.load).toHaveBeenCalledWith(1));
    });
    it("settings : envoie le groupe audio complet depuis l'onglet Son/Effet", () => {
      ui.show({ screen: "settings", settings, availableLanguages: ["ja", "fr", "en"] });
      (q('[data-tab="sound"]') as HTMLButtonElement).click();
      const input = q('input[name="bgm"]') as HTMLInputElement;
      input.value = "50";
      input.dispatchEvent(new Event("input"));
      expect(cmd.updateSettings).toHaveBeenCalledWith({ audio: { ...settings.audio, bgm: 0.5 } });
    });
    it("settings : le sélecteur de langue ne propose que les langues disponibles", () => {
      ui.show({ screen: "settings", settings, availableLanguages: ["ja", "fr"] });
      (q('[data-tab="message"]') as HTMLButtonElement).click();
      const options = [...root.querySelectorAll<HTMLOptionElement>('select[name="language"] option')].map(
        (o) => o.value,
      );
      expect(options).toEqual(["ja", "fr"]);
      expect(options).not.toContain("en");
    });
    it("settings : quatre onglets et leurs contrôles (#177)", () => {
      ui.show({ screen: "settings", settings, availableLanguages: ["ja", "fr"] });
      expect(qa(".mh-ui-tab")).toHaveLength(4);
      (q('[data-tab="message"]') as HTMLButtonElement).click();
      expect(root.textContent).toContain("Vitesse des scènes non lues");
      (q('[data-tab="shortcuts"]') as HTMLButtonElement).click();
      expect(qa(".mh-ui-key")).toHaveLength(28);
      (q('[data-tab="sound"]') as HTMLButtonElement).click();
      expect(root.textContent).toContain("Volume des musiques");
    });
    it("settings : capture une touche et renvoie les raccourcis (#177)", () => {
      ui.show({ screen: "settings", settings, availableLanguages: ["ja"] });
      (q('[data-tab="shortcuts"]') as HTMLButtonElement).click();
      (q('[data-action="saveMenu"][data-index="0"]') as HTMLButtonElement).click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true }));
      expect(cmd.updateSettings).toHaveBeenCalledWith({
        shortcuts: { ...settings.shortcuts, saveMenu: ["x", "F2"] },
      });
    });
    it("settings : test du volume SE et réinitialisation avec confirmation (#177, #200)", async () => {
      ui.show({ screen: "settings", settings, availableLanguages: ["ja"] });
      (q('[data-tab="sound"]') as HTMLButtonElement).click();
      (q(".mh-ui-test-se") as HTMLButtonElement).click();
      expect(cmd.testSe).toHaveBeenCalled();
      // « Non » (présélectionné) : rien n'est réinitialisé.
      (q(".mh-ui-reset") as HTMLButtonElement).click();
      await vi.waitFor(() => expect(q(".mh-ui-confirm")).not.toBeNull());
      expect(q(".mh-ui-confirm-no")).toBe(document.activeElement);
      q(".mh-ui-confirm-no")!.click();
      await vi.waitFor(() => expect(q(".mh-ui-confirm")).toBeNull());
      expect(cmd.resetSettings).not.toHaveBeenCalled();
      // « Oui » : les réglages par défaut sont demandés.
      (q(".mh-ui-reset") as HTMLButtonElement).click();
      await vi.waitFor(() => expect(q(".mh-ui-confirm")).not.toBeNull());
      q(".mh-ui-confirm-yes")!.click();
      await vi.waitFor(() => expect(cmd.resetSettings).toHaveBeenCalledTimes(1));
    });
    it("flowchart : sans graphe, état vide et « Retour » fonctionnel", () => {
      ui.show(views[6]!);
      expect(q(".mh-flow-empty")).not.toBeNull();
      q(".mh-flow-back")!.click();
      expect(cmd.closeScreen).toHaveBeenCalled();
    });
  });

  describe("choix", () => {
    it("clic et touche numérique appellent choose, sans advance", () => {
      ui.showChoices(["un", "deux"]);
      expect(qa(".mh-ui-choice")).toHaveLength(2);
      qa(".mh-ui-choice")[1]!.click();
      expect(cmd.choose).toHaveBeenCalledWith(1);
      key("1");
      expect(cmd.choose).toHaveBeenCalledWith(0);
      q("#ui-overlay")!.click();
      key(" ");
      expect(cmd.advance).not.toHaveBeenCalled();
    });
    it("hideChoices vide la liste", () => {
      ui.showChoices(["a"]);
      ui.hideChoices();
      expect(qa(".mh-ui-choice")).toHaveLength(0);
    });
  });

  describe("confirm / toast / input / status", () => {
    it("confirm résout true/false", async () => {
      const p = ui.confirm("ok ?");
      q(".mh-ui-confirm-yes")!.click();
      expect(await p).toBe(true);
      const p2 = ui.confirm("ok ?");
      key("Escape");
      expect(await p2).toBe(false);
      expect(q(".mh-ui-confirm")).toBeNull();
    });
    it("confirm : Non est présélectionné par défaut, Oui avec defaultButton: yes", async () => {
      const p = ui.confirm("effacer ?");
      expect(document.activeElement).toBe(q(".mh-ui-confirm-no"));
      key("Enter");
      expect(await p).toBe(false);
      const p2 = ui.confirm("charger ?", { defaultButton: "yes" });
      expect(document.activeElement).toBe(q(".mh-ui-confirm-yes"));
      key("Enter");
      expect(await p2).toBe(true);
      expect(q(".mh-ui-confirm")).toBeNull();
    });
    it("confirm : boîte accessible (dialog modal nommé par le message), pilotée aux flèches", async () => {
      const p = ui.confirm("ok ?");
      const box = q('.mh-ui-confirm [role="dialog"]')!;
      expect(box.getAttribute("aria-modal")).toBe("true");
      expect(document.getElementById(box.getAttribute("aria-labelledby")!)!.textContent).toBe("ok ?");
      key("ArrowLeft");
      key("Enter");
      expect(await p).toBe(true);
    });
    it("confirm : pendant la boîte, les raccourcis du jeu et le clic ne font rien", async () => {
      const p = ui.confirm("ok ?");
      key(" ");
      key("Enter", { repeat: true });
      q("#ui-overlay")!.click();
      expect(cmd.advance).not.toHaveBeenCalled();
      key("Escape");
      expect(await p).toBe(false);
    });
    it("confirm : une nouvelle demande répond Non à la précédente et la remplace", async () => {
      const first = ui.confirm("un ?");
      const second = ui.confirm("deux ?");
      expect(await first).toBe(false);
      expect(qa(".mh-ui-confirm")).toHaveLength(1);
      expect(q(".mh-ui-confirm-message")!.textContent).toBe("deux ?");
      q(".mh-ui-confirm-yes")!.click();
      expect(await second).toBe(true);
    });
    it("confirm : dispose répond Non à une boîte ouverte", async () => {
      const p = ui.confirm("ok ?");
      ui.dispose();
      expect(await p).toBe(false);
    });
    it("toast disparaît après la durée", () => {
      vi.useFakeTimers();
      ui.toast("hi", 100);
      expect(q(".mh-toast")!.textContent).toBe("hi");
      vi.advanceTimersByTime(100 + TOAST_LEAVE_MS);
      expect(q(".mh-toast")).toBeNull();
    });
    it("toast : région aria-live polie, 3 toasts au plus (#191)", () => {
      expect(q("#ui-toast")!.getAttribute("aria-live")).toBe("polite");
      for (const m of ["a", "b", "c", "d"]) ui.toast(m);
      expect(qa(".mh-toast").map((e) => e.textContent)).toEqual(["b", "c", "d"]);
    });
    it("setInputEnabled(false) bloque les entrées", () => {
      ui.setInputEnabled(false);
      q("#ui-overlay")!.click();
      key(" ");
      key("Escape");
      expect(cmd.advance).not.toHaveBeenCalled();
      expect(cmd.openScreen).not.toHaveBeenCalled();
      expect(q("#ui-loading")!.hidden).toBe(false);
      ui.setInputEnabled(true);
      key(" ");
      expect(cmd.advance).toHaveBeenCalledTimes(1);
    });
    it("userHidden masque l'UI de jeu", () => {
      ui.setStatus(status({ userHidden: true }));
      expect(q("#ui-overlay")!.classList.contains("mh-ui-user-hidden")).toBe(true);
    });
    it("badge de mode", () => {
      ui.setStatus(status({ mode: "auto" }));
      expect(q(".mh-ui-badge-auto")).not.toBeNull();
    });
    it("auto suspendu par le script : le badge reste « auto » mais marqué en pause", () => {
      ui.setStatus(status({ mode: "auto", autoPaused: true }));
      const badge = q(".mh-ui-badge-auto")!;
      expect(badge.classList.contains("mh-ui-badge-suspended")).toBe(true);
      expect(badge.textContent).toContain("⏸");
      ui.setStatus(status({ mode: "auto", autoPaused: false }));
      expect(q(".mh-ui-badge-auto")!.classList.contains("mh-ui-badge-suspended")).toBe(false);
    });
    it("menu rapide verrouillé : Sauvegarder et Charger du menu pause sont désactivés", () => {
      ui.setStatus(status({ quickMenuLocked: true }));
      ui.show({ screen: "pause" });
      const quick = qa("[data-quick-menu]") as HTMLButtonElement[];
      expect(quick.map((b) => b.dataset.quickMenu)).toEqual(["save", "load"]);
      expect(quick.every((b) => b.disabled)).toBe(true);
      // Les autres entrées restent actives.
      expect((q(".mh-sysmenu-back") as HTMLButtonElement).disabled).toBe(false);
      expect((q('[data-entry="title"]') as HTMLButtonElement).disabled).toBe(false);
    });
    it("le déverrouillage réactive les boutons sans rouvrir l'écran", () => {
      ui.setStatus(status({ quickMenuLocked: true }));
      ui.show({ screen: "pause" });
      ui.setStatus(status({ quickMenuLocked: false }));
      expect((qa("[data-quick-menu]") as HTMLButtonElement[]).every((b) => !b.disabled)).toBe(true);
    });
  });

  it("dispose retire les listeners", () => {
    ui.dispose();
    key(" ");
    expect(cmd.advance).not.toHaveBeenCalled();
    expect(q("#ui-overlay")).toBeNull();
  });

  describe("langue de l'interface (#184)", () => {
    afterEach(() => setUiLanguage("fr"));

    it("pose lang sur la racine de l'interface et sur le document", () => {
      expect(q("#ui-overlay")!.lang).toBe("fr");
      expect(document.documentElement.lang).toBe("fr");
    });

    it("par défaut, les écrans sont en français", () => {
      ui.show({ screen: "pause" });
      expect(qa(".mh-sysmenu-entry").map((b) => b.textContent)).toEqual([
        "Sauvegarder", "Charger", "Config", "Auto", "Skip", "Historique", "Flowchart", "Masquer", "Titre",
      ]);
      expect(q(".mh-sysmenu-back")!.textContent).toBe("Retour");
      ui.show({ screen: "title", scripts, hasContinue: true });
      expect(q(".mh-ui-new-game")!.textContent).toBe("Start");
      expect(q(".mh-ui-continue")!.textContent).toBe("Continuer");
    });

    it("un changement de langue met à jour lang et redessine l'écran courant", () => {
      ui.show({ screen: "pause" });
      setUiLanguage("en");
      expect(q("#ui-overlay")!.lang).toBe("en");
      expect(document.documentElement.lang).toBe("en");
      expect(q(".mh-sysmenu-back")!.textContent).toBe("Back");
      expect(q('[data-entry="backlog"]')!.textContent).toBe("History");
      setUiLanguage("ja");
      expect(q("#ui-overlay")!.lang).toBe("ja");
      expect(q(".mh-sysmenu-back")!.textContent).toBe("戻る");
      expect(q('[data-entry="backlog"]')!.textContent).toBe("履歴");
    });

    it("l'écran de configuration, les emplacements et la confirmation suivent la langue", async () => {
      setUiLanguage("en");
      ui.show({ screen: "settings", settings, availableLanguages: ["ja", "en", "fr"] });
      expect(q(".mh-ui-tab[data-tab='system']")!.textContent).toBe("System");
      expect(q(".mh-ui-reset")!.textContent).toBe("Restore defaults");
      ui.show({ screen: "save", slots: [{ id: 3, data: slotData }, { id: "quick", data: null }] });
      expect(q(".mh-sl-title")!.textContent).toBe("Save");
      expect(q("[data-slot='3']")!.getAttribute("aria-label")).toContain("Slot 3");
      expect(q("[data-slot='quick'] .mh-sl-badge")!.textContent).toBe("Quick");
      ui.show({ screen: "load", slots: [{ id: 3, data: slotData }] });
      q("[data-slot='3'] .mh-sl-load")!.click();
      await vi.waitFor(() => expect(q(".mh-ui-confirm-message")).not.toBeNull());
      expect(q(".mh-ui-confirm-message")!.textContent).toBe("Load “Slot 3”?");
      expect(q(".mh-ui-confirm-yes")!.textContent).toBe("Yes");
    });

    it("les noms de langue restent dans leur propre langue", () => {
      setUiLanguage("en");
      ui.show({ screen: "settings", settings, availableLanguages: ["ja", "en", "fr"] });
      q(".mh-ui-tab[data-tab='message']")!.click();
      expect(qa("select[name='language'] option").map((o) => o.textContent)).toEqual(["日本語", "English", "Français"]);
    });

    it("dispose restaure lang du document", () => {
      ui.dispose();
      document.documentElement.lang = "fr";
      ui.init(root, cmd);
      setUiLanguage("ja");
      expect(document.documentElement.lang).toBe("ja");
      ui.dispose();
      expect(document.documentElement.lang).toBe("fr");
    });

    it("après dispose, un changement de langue ne touche plus l'interface", () => {
      ui.dispose();
      expect(() => setUiLanguage("en")).not.toThrow();
    });
  });
});

describe("DomUIManager — galerie CG (HUD-15, #208)", () => {
  let root: HTMLElement;
  let cmd: ReturnType<typeof makeCommands>;
  let ui: DomUIManager;
  const cgImages = [
    { key: "cg01", url: "/assets/image/cg01.webp", kind: "image", source: "image/cg01.tlg" },
    { key: "cg02", url: "/assets/image/cg02.webp", kind: "image", source: "image/cg02.tlg" },
  ];
  const title = (): UIView => ({ screen: "title", scripts, hasContinue: false });

  beforeEach(() => {
    document.body.innerHTML = '<div id="viewport"></div>';
    root = document.getElementById("viewport")!;
    cmd = makeCommands();
  });
  afterEach(() => {
    ui?.dispose();
    document.body.innerHTML = "";
  });

  const mount = (options: ConstructorParameters<typeof DomUIManager>[0] = {}): DomUIManager => {
    ui = new DomUIManager(options);
    ui.init(root, cmd);
    ui.show(title());
    return ui;
  };
  const q = (sel: string) => root.querySelector<HTMLElement>(sel);
  const escape = () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  it("sans galerie (aucun asset) : l'entrée Cgmode reste grisée, pas d'écran fantôme", () => {
    mount();
    q('[data-entry="extra"]')!.click();
    const entry = q('[data-entry="cgmode"]')!;
    expect(entry.getAttribute("aria-disabled")).toBe("true");
    entry.click();
    expect(q("#ui-cg")!.childElementCount).toBe(0);
  });

  it("manifeste sans image de CG : entrée grisée (pas de galerie vide)", () => {
    mount({
      cgGallery: {
        images: () => [{ key: "aoko", url: "/i/a.webp", kind: "image", source: "fg/aoko.tlg" }],
        seen: () => new Set(),
      },
    });
    q('[data-entry="extra"]')!.click();
    expect(q('[data-entry="cgmode"]')!.getAttribute("aria-disabled")).toBe("true");
  });

  it("avec des CG : l'entrée ouvre la galerie au-dessus du titre, dans #ui-cg", () => {
    mount({ cgGallery: { images: () => cgImages, seen: () => new Set(["cg01"]) } });
    q('[data-entry="extra"]')!.click();
    const entry = q('[data-entry="cgmode"]')!;
    expect(entry.getAttribute("aria-disabled")).toBeNull();
    entry.click();
    const screen = q("#ui-cg .mh-cg-screen");
    expect(screen).not.toBeNull();
    expect(screen!.querySelectorAll(".mh-cg-tile")).toHaveLength(2);
    // Focus initial : première tuile (cg01 est déverrouillée).
    expect(document.activeElement?.getAttribute("data-key")).toBe("cg01");
    expect(q(".mh-ui-title-screen")).not.toBeNull(); // le titre reste monté dessous
  });

  it("Échap ferme la galerie et rend le focus à l'entrée Cgmode", () => {
    mount({ cgGallery: { images: () => cgImages, seen: () => new Set() } });
    q('[data-entry="extra"]')!.click();
    q('[data-entry="cgmode"]')!.click();
    expect(q("#ui-cg .mh-cg-screen")).not.toBeNull();
    escape();
    expect(q("#ui-cg")!.childElementCount).toBe(0);
    expect(document.activeElement).toBe(q('[data-entry="cgmode"]'));
  });

  it("un changement d'écran referme la galerie", () => {
    mount({ cgGallery: { images: () => cgImages, seen: () => new Set() } });
    q('[data-entry="extra"]')!.click();
    q('[data-entry="cgmode"]')!.click();
    ui.show({ screen: "game" });
    expect(q("#ui-cg")!.childElementCount).toBe(0);
  });

  it("les entrées de jeu sont neutralisées tant que la galerie est ouverte", () => {
    mount({ cgGallery: { images: () => cgImages, seen: () => new Set(["cg01"]) } });
    q('[data-entry="extra"]')!.click();
    q('[data-entry="cgmode"]')!.click();
    q("#ui-overlay")!.click();
    expect(cmd.advance).not.toHaveBeenCalled();
    // Le clic droit ne doit pas ouvrir le menu système sous la galerie.
    q("#ui-overlay")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(cmd.openScreen).not.toHaveBeenCalled();
  });
});
