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
    for (const id of ["ui-menu", "ui-flowchart", "ui-pause", "ui-choices", "ui-toast", "ui-loading"]) {
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
      { screen: "flowchart", scripts, progress: { unlocked: ["a"], completed: [] } },
    ];
    it.each(views.map((v) => [v.screen, v] as const))("affiche %s", (_n, v) => {
      ui.show(v);
      expect(q("#ui-overlay")!.dataset.screen).toBe(v.screen);
      expect(q(".mh-ui-panel")).not.toBeNull();
      ui.show({ screen: "game" });
      expect(q(".mh-ui-panel")).toBeNull();
    });

    it("title : script et continuer", () => {
      ui.show(views[0]!);
      q('[data-file="b.ks"]')!.click();
      expect(cmd.startScript).toHaveBeenCalledWith("b.ks");
      q(".mh-ui-continue")!.click();
      expect(cmd.load).toHaveBeenCalledWith("auto");
    });
    it("title : « Nouvelle partie » lance le premier script de la liste", () => {
      ui.show(views[0]!);
      q(".mh-ui-new-game")!.click();
      expect(cmd.startScript).toHaveBeenCalledWith("a.ks");
    });
    it("title : sans « Continuer » quand il n'y a pas d'autosave, « Nouvelle partie » reste là", () => {
      ui.show({ screen: "title", scripts, hasContinue: false });
      expect(q(".mh-ui-continue")).toBeNull();
      expect(q(".mh-ui-new-game")).not.toBeNull();
    });
    it("title : liste vide, pas de « Nouvelle partie »", () => {
      ui.show({ screen: "title", scripts: [], hasContinue: false });
      expect(q(".mh-ui-new-game")).toBeNull();
    });
    it("pause : reprendre et ouvrir save", () => {
      ui.show({ screen: "pause" });
      q(".mh-ui-resume")!.click();
      expect(cmd.closeScreen).toHaveBeenCalled();
    });
    it("pause : retour au titre demande confirmation", async () => {
      ui.show({ screen: "pause" });
      q(".mh-ui-to-title")!.click();
      q(".mh-ui-confirm-yes")!.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(cmd.returnToTitle).toHaveBeenCalled();
    });
    it("save : slot vide sauvegarde directement, occupé confirme", async () => {
      ui.show({ screen: "save", slots: [{ id: 1, data: slotData }, { id: 2, data: null }] });
      q('[data-slot="2"] .mh-ui-slot-action')!.click();
      await vi.waitFor(() => expect(cmd.save).toHaveBeenCalledWith(2));
      q('[data-slot="1"] .mh-ui-slot-action')!.click();
      expect(q(".mh-ui-confirm")).not.toBeNull();
      q(".mh-ui-confirm-yes")!.click();
      await vi.waitFor(() => expect(cmd.save).toHaveBeenCalledWith(1));
    });
    it("load : slot vide désactivé", () => {
      ui.show({ screen: "load", slots: [{ id: 1, data: slotData }, { id: 2, data: null }] });
      expect((q('[data-slot="2"] .mh-ui-slot-action') as HTMLButtonElement).disabled).toBe(true);
      q('[data-slot="1"] .mh-ui-slot-action')!.click();
      expect(cmd.load).toHaveBeenCalledWith(1);
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
    it("settings : test du volume SE et réinitialisation (#177)", () => {
      ui.show({ screen: "settings", settings, availableLanguages: ["ja"] });
      (q('[data-tab="sound"]') as HTMLButtonElement).click();
      (q(".mh-ui-test-se") as HTMLButtonElement).click();
      expect(cmd.testSe).toHaveBeenCalled();
      (q(".mh-ui-reset") as HTMLButtonElement).click();
      expect(cmd.resetSettings).toHaveBeenCalled();
    });
    it("flowchart : scripts verrouillés désactivés", () => {
      ui.show(views[6]!);
      expect((q('[data-id="b"]') as HTMLButtonElement).disabled).toBe(true);
      q('[data-id="a"]')!.click();
      expect(cmd.startScript).toHaveBeenCalledWith("a.ks");
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
      expect((q(".mh-ui-resume") as HTMLButtonElement).disabled).toBe(false);
      expect((q(".mh-ui-to-title") as HTMLButtonElement).disabled).toBe(false);
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
      expect(qa(".mh-ui-pause-screen .mh-ui-col button").map((b) => b.textContent)).toEqual([
        "Reprendre", "Sauvegarder", "Charger", "Réglages", "Historique", "Flowchart", "Retour au titre",
      ]);
      ui.show({ screen: "title", scripts, hasContinue: true });
      expect(q(".mh-ui-new-game")!.textContent).toBe("Nouvelle partie");
      expect(q(".mh-ui-continue")!.textContent).toBe("Continuer");
    });

    it("un changement de langue met à jour lang et redessine l'écran courant", () => {
      ui.show({ screen: "pause" });
      setUiLanguage("en");
      expect(q("#ui-overlay")!.lang).toBe("en");
      expect(document.documentElement.lang).toBe("en");
      expect(q(".mh-ui-resume")!.textContent).toBe("Resume");
      setUiLanguage("ja");
      expect(q("#ui-overlay")!.lang).toBe("ja");
      expect(q(".mh-ui-resume")!.textContent).toBe("ゲームに戻る");
    });

    it("l'écran de configuration, les emplacements et la confirmation suivent la langue", async () => {
      setUiLanguage("en");
      ui.show({ screen: "settings", settings, availableLanguages: ["ja", "en", "fr"] });
      expect(q(".mh-ui-tab[data-tab='system']")!.textContent).toBe("System");
      expect(q(".mh-ui-reset")!.textContent).toBe("Restore defaults");
      ui.show({ screen: "save", slots: [{ id: 3, data: slotData }, { id: "quick", data: null }] });
      expect(qa(".mh-ui-slot-label").map((e) => e.textContent)).toEqual(["Slot 3", "Quick save"]);
      expect(q(".mh-ui-slot-empty .mh-ui-slot-preview")!.textContent).toBe("— empty —");
      q(".mh-ui-slot[data-slot='3'] .mh-ui-slot-action")!.click();
      await Promise.resolve();
      expect(q(".mh-ui-confirm-message")!.textContent).toBe("Overwrite “Slot 3”?");
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
