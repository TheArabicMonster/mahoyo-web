import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomUIManager } from "@/ui/ui-manager.js";
import type { GameSettings, PlayerCommands, PlayerStatus, UIView } from "@/ui/types.js";

function makeCommands() {
  const names = [
    "advance", "setMode", "toggleUserHide", "rollback", "choose", "startScript", "openScreen",
    "closeScreen", "returnToTitle", "save", "load", "deleteSave", "updateSettings", "toggleFullscreen",
  ] as const;
  const c = {} as Record<string, ReturnType<typeof vi.fn>>;
  for (const n of names) c[n] = vi.fn(() => Promise.resolve());
  return c as unknown as PlayerCommands & Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
}

const settings: GameSettings = {
  display: { textSpeed: 30, autoDelay: 1500, fontScale: 1, textboxOpacity: 0.8 },
  audio: { master: 1, bgm: 0.8, se: 0.8, voice: 1, muted: false },
  skipUnread: false,
  language: "ja",
};
const status = (p: Partial<PlayerStatus> = {}): PlayerStatus => ({
  mode: "normal", inGame: true, userHidden: false, canRollback: false, ...p,
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
    it("clic droit = toggleUserHide et preventDefault", () => {
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      q("#ui-overlay")!.dispatchEvent(ev);
      expect(cmd.toggleUserHide).toHaveBeenCalled();
      expect(ev.defaultPrevented).toBe(true);
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
    it("F, A, S", () => {
      key("f");
      expect(cmd.toggleFullscreen).toHaveBeenCalled();
      key("a");
      expect(cmd.setMode).toHaveBeenLastCalledWith("auto");
      ui.setStatus(status({ mode: "auto" }));
      key("a");
      expect(cmd.setMode).toHaveBeenLastCalledWith("normal");
      ui.setStatus(status());
      key("s");
      expect(cmd.setMode).toHaveBeenLastCalledWith("skip");
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
      { screen: "settings", settings },
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
    it("settings : envoie le groupe complet", () => {
      ui.show({ screen: "settings", settings });
      const input = q('input[name="bgm"]') as HTMLInputElement;
      input.value = "0.5";
      input.dispatchEvent(new Event("input"));
      expect(cmd.updateSettings).toHaveBeenCalledWith({ audio: { ...settings.audio, bgm: 0.5 } });
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
    it("toast disparaît après la durée", () => {
      vi.useFakeTimers();
      ui.toast("hi", 100);
      expect(q(".mh-ui-toast-item")!.textContent).toBe("hi");
      vi.advanceTimersByTime(100);
      expect(q(".mh-ui-toast-item")).toBeNull();
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
  });

  it("dispose retire les listeners", () => {
    ui.dispose();
    key(" ");
    expect(cmd.advance).not.toHaveBeenCalled();
    expect(q("#ui-overlay")).toBeNull();
  });
});
