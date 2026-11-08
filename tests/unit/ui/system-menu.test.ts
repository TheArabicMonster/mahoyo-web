import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultShortcuts } from "@/core/shortcuts.js";
import { setUiLanguage } from "@/ui/i18n.js";
import {
  focusSystemMenu,
  renderSystemMenu,
  SYSTEM_MENU_ENTRIES,
  syncSystemMenu,
  syncSystemMenuVeil,
} from "@/ui/system-menu.js";
import type { PlayerCommands, PlayerStatus } from "@/ui/types.js";
import { DomUIManager } from "@/ui/ui-manager.js";

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

const status = (p: Partial<PlayerStatus> = {}): PlayerStatus => ({
  mode: "normal", inGame: true, userHidden: false, canRollback: false, quickMenuLocked: false, autoPaused: false,
  mouseMode: "menu", autoHideCursor: false, fastForwardKey: "shift", shortcuts: defaultShortcuts(), ...p,
});

describe("entrées du menu système (données)", () => {
  it("l'ordre et les clés suivent ANALYSE_HUD_ORIGINAL §2.5, sans exitgame, avec flowchart avant graphic", () => {
    expect(SYSTEM_MENU_ENTRIES.map((e) => e.id)).toEqual([
      "save", "load", "config", "auto", "skip", "backlog", "flowchart", "graphic", "title",
    ]);
    expect(SYSTEM_MENU_ENTRIES.map((e) => e.id as string)).not.toContain("exitgame");
  });

  it("chaque entrée a un libellé dans les trois langues", () => {
    for (const lang of ["fr", "en", "ja"] as const) {
      setUiLanguage(lang);
      const root = renderSystemMenu({ commands: makeCommands(), getStatus: () => status(), confirmReturnToTitle: vi.fn() });
      const labels = [...root.querySelectorAll(".mh-sysmenu-entry")].map((b) => b.textContent);
      expect(labels).toHaveLength(SYSTEM_MENU_ENTRIES.length);
      expect(labels.every((l) => l && !l.startsWith("systemMenu."))).toBe(true);
    }
    setUiLanguage("fr");
  });

  it("aucun libellé en dur dans system-menu.ts (accent ou caractère japonais)", () => {
    const source = readFileSync(resolve(__dirname, "../../../src/ui/system-menu.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
    const literals = [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? "");
    expect(literals.filter((s) => /[À-ÿŒœ぀-ヿ一-鿿]/.test(s))).toEqual([]);
  });
});

describe("renderSystemMenu", () => {
  let cmd: ReturnType<typeof makeCommands>;
  let current: PlayerStatus;
  let confirmReturnToTitle: ReturnType<typeof vi.fn>;
  let menu: HTMLElement;
  const entry = (id: string) => menu.querySelector<HTMLButtonElement>(`[data-entry="${id}"]`)!;

  beforeEach(() => {
    document.body.innerHTML = "";
    setUiLanguage("fr");
    cmd = makeCommands();
    current = status();
    confirmReturnToTitle = vi.fn();
    menu = renderSystemMenu({ commands: cmd, getStatus: () => current, confirmReturnToTitle });
    document.body.appendChild(menu);
  });

  it("énumère les boutons dans l'ordre : 9 entrées puis « Back » en dernier", () => {
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((b) => b.dataset.entry)).toEqual([
      "save", "load", "config", "auto", "skip", "backlog", "flowchart", "graphic", "title", "back",
    ]);
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Sauvegarder", "Charger", "Config", "Auto", "Skip", "Historique", "Flowchart", "Masquer", "Titre", "Retour",
    ]);
    expect(buttons.every((b) => b.type === "button")).toBe(true);
  });

  it("en-tête « Système » avec sous-titre décoratif aria-hidden, dialogue nommé par l'en-tête", () => {
    expect(menu.querySelector(".mh-sysmenu-title")!.textContent).toBe("Système");
    const deco = menu.querySelector(".mh-sysmenu-deco")!;
    expect(deco.getAttribute("aria-hidden")).toBe("true");
    expect(menu.getAttribute("role")).toBe("dialog");
    expect(menu.getAttribute("aria-modal")).toBe("true");
    const labelledBy = menu.getAttribute("aria-labelledby")!;
    expect(menu.querySelector(`#${labelledBy}`)!.textContent).toContain("Système");
  });

  it("save et load sont désactivés quand quickMenuLocked est vrai, le reste non", () => {
    current = status({ quickMenuLocked: true });
    syncSystemMenu(menu, current);
    expect(entry("save").disabled).toBe(true);
    expect(entry("load").disabled).toBe(true);
    expect(entry("save").title).not.toBe("");
    for (const id of ["config", "auto", "skip", "backlog", "flowchart", "graphic", "title", "back"]) {
      expect(entry(id).disabled).toBe(false);
    }
    entry("save").click();
    expect(cmd.openScreen).not.toHaveBeenCalled();
    current = status({ quickMenuLocked: false });
    syncSystemMenu(menu, current);
    expect(entry("save").disabled).toBe(false);
    expect(entry("save").title).toBe("");
  });

  it("save, load, config, backlog et flowchart ouvrent leur écran", () => {
    for (const [id, screen] of [
      ["save", "save"], ["load", "load"], ["config", "settings"], ["backlog", "backlog"], ["flowchart", "flowchart"],
    ] as const) {
      entry(id).click();
      expect(cmd.openScreen).toHaveBeenLastCalledWith(screen);
    }
    expect(cmd.closeScreen).not.toHaveBeenCalled();
  });

  it("auto et skip basculent le mode puis referment le menu ; l'état est reflété par aria-pressed", () => {
    entry("auto").click();
    expect(cmd.setMode).toHaveBeenLastCalledWith("auto");
    expect(cmd.closeScreen).toHaveBeenCalledTimes(1);
    current = status({ mode: "auto" });
    syncSystemMenu(menu, current);
    expect(entry("auto").getAttribute("aria-pressed")).toBe("true");
    expect(entry("skip").getAttribute("aria-pressed")).toBe("false");
    entry("auto").click();
    expect(cmd.setMode).toHaveBeenLastCalledWith("normal");
    current = status({ mode: "normal" });
    entry("skip").click();
    expect(cmd.setMode).toHaveBeenLastCalledWith("skip");
    current = status({ mode: "skip" });
    entry("skip").click();
    expect(cmd.setMode).toHaveBeenLastCalledWith("normal");
  });

  it("graphic appelle toggleUserHide puis referme le menu", () => {
    entry("graphic").click();
    expect(cmd.toggleUserHide).toHaveBeenCalledTimes(1);
    expect(cmd.closeScreen).toHaveBeenCalledTimes(1);
  });

  it("title délègue à la confirmation, sans retourner au titre directement", () => {
    entry("title").click();
    expect(confirmReturnToTitle).toHaveBeenCalledTimes(1);
    expect(cmd.returnToTitle).not.toHaveBeenCalled();
  });

  it("Back referme le menu", () => {
    entry("back").click();
    expect(cmd.closeScreen).toHaveBeenCalledTimes(1);
  });

  it("isEnabled=false suspend les clics", () => {
    const off = renderSystemMenu({ commands: cmd, getStatus: () => current, confirmReturnToTitle }, () => false);
    off.querySelector<HTMLButtonElement>('[data-entry="config"]')!.click();
    off.querySelector<HTMLButtonElement>('[data-entry="back"]')!.click();
    expect(cmd.openScreen).not.toHaveBeenCalled();
    expect(cmd.closeScreen).not.toHaveBeenCalled();
  });

  describe("clavier", () => {
    const press = (target: Element, k: string, init: KeyboardEventInit = {}) => {
      const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(ev);
      return ev;
    };

    it("le focus initial va à la première entrée utilisable, ou à Back si save/load sont verrouillés", () => {
      focusSystemMenu(menu);
      expect(document.activeElement).toBe(entry("save"));
      current = status({ quickMenuLocked: true });
      syncSystemMenu(menu, current);
      focusSystemMenu(menu);
      expect(document.activeElement).toBe(entry("config"));
    });

    it("Tab boucle : de Back vers la première entrée, et Maj+Tab dans l'autre sens", () => {
      entry("back").focus();
      const fwd = press(entry("back"), "Tab");
      expect(fwd.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(entry("save"));
      const back = press(entry("save"), "Tab", { shiftKey: true });
      expect(back.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(entry("back"));
    });

    it("Tab au milieu de la liste laisse le navigateur avancer", () => {
      entry("load").focus();
      expect(press(entry("load"), "Tab").defaultPrevented).toBe(false);
    });

    it("les flèches haut et bas déplacent le focus en boucle, en sautant les entrées désactivées", () => {
      current = status({ quickMenuLocked: true });
      syncSystemMenu(menu, current);
      entry("config").focus();
      press(entry("config"), "ArrowDown");
      expect(document.activeElement).toBe(entry("auto"));
      press(entry("auto"), "ArrowUp");
      press(entry("config"), "ArrowUp");
      expect(document.activeElement).toBe(entry("back"));
      press(entry("back"), "ArrowDown");
      expect(document.activeElement).toBe(entry("config"));
    });
  });
});

describe("voile bleu nuit du slot", () => {
  it("la classe n'est posée que lorsque le slot a du contenu", () => {
    const slot = document.createElement("div");
    syncSystemMenuVeil(slot);
    expect(slot.classList.contains("mh-ui-night")).toBe(false);
    slot.appendChild(document.createElement("section"));
    syncSystemMenuVeil(slot);
    expect(slot.classList.contains("mh-ui-night")).toBe(true);
    expect(slot.classList.contains("mh-ui-night-veil")).toBe(true);
    slot.replaceChildren();
    syncSystemMenuVeil(slot);
    expect(slot.classList.contains("mh-ui-night")).toBe(false);
    expect(slot.classList.contains("mh-ui-night-veil")).toBe(false);
  });
});

describe("menu système dans DomUIManager", () => {
  let root: HTMLElement;
  let ui: DomUIManager;
  let cmd: ReturnType<typeof makeCommands>;
  const q = (sel: string) => root.querySelector<HTMLElement>(sel);
  const contextMenu = () => {
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    q("#ui-overlay")!.dispatchEvent(ev);
    return ev;
  };

  beforeEach(() => {
    document.body.innerHTML = '<div id="viewport"></div>';
    root = document.getElementById("viewport")!;
    cmd = makeCommands();
    ui = new DomUIManager();
    ui.init(root, cmd);
    ui.show({ screen: "game" });
    ui.setStatus(status());
  });
  afterEach(() => ui.dispose());

  it("le clic droit ouvre le menu en jeu, et le referme une fois ouvert", () => {
    contextMenu();
    expect(cmd.openScreen).toHaveBeenCalledWith("pause");
    expect(cmd.closeScreen).not.toHaveBeenCalled();
    ui.show({ screen: "pause" });
    const ev = contextMenu();
    expect(ev.defaultPrevented).toBe(true);
    expect(cmd.closeScreen).toHaveBeenCalledTimes(1);
  });

  it("Échap ferme le menu ouvert", () => {
    ui.show({ screen: "pause" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(cmd.closeScreen).toHaveBeenCalledTimes(1);
  });

  it("le slot reçoit le voile à l'ouverture et le perd à la fermeture", () => {
    const slot = q("#ui-pause")!;
    expect(slot.classList.contains("mh-ui-night")).toBe(false);
    ui.show({ screen: "pause" });
    expect(slot.classList.contains("mh-ui-night")).toBe(true);
    expect(slot.classList.contains("mh-ui-night-veil")).toBe(true);
    ui.show({ screen: "game" });
    expect(slot.classList.contains("mh-ui-night")).toBe(false);
  });

  it("le focus est donné à la première entrée à l'ouverture", () => {
    ui.show({ screen: "pause" });
    expect(document.activeElement).toBe(q('[data-entry="save"]'));
  });

  it("les bascules et le verrou suivent setStatus sans rouvrir l'écran", () => {
    ui.show({ screen: "pause" });
    ui.setStatus(status({ mode: "skip", quickMenuLocked: true }));
    expect(q('[data-entry="skip"]')!.getAttribute("aria-pressed")).toBe("true");
    expect((q('[data-entry="save"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("auto lit le mode courant au clic (pas celui du rendu)", () => {
    ui.show({ screen: "pause" });
    ui.setStatus(status({ mode: "auto" }));
    q('[data-entry="auto"]')!.click();
    expect(cmd.setMode).toHaveBeenLastCalledWith("normal");
  });

  it("title : confirmation avec Non par défaut ; Oui retourne au titre, Non reste dans le menu", async () => {
    ui.show({ screen: "pause" });
    q('[data-entry="title"]')!.click();
    const no = q(".mh-ui-confirm-no") as HTMLButtonElement;
    expect(document.activeElement).toBe(no);
    // Un clic droit pendant la confirmation ne referme pas le menu.
    contextMenu();
    expect(cmd.closeScreen).not.toHaveBeenCalled();
    no.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(cmd.returnToTitle).not.toHaveBeenCalled();
    expect(q(".mh-sysmenu")).not.toBeNull();

    q('[data-entry="title"]')!.click();
    q(".mh-ui-confirm-yes")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(cmd.returnToTitle).toHaveBeenCalledTimes(1);
  });

  it("changement de langue : le menu est redessiné", () => {
    ui.show({ screen: "pause" });
    setUiLanguage("en");
    expect(q('[data-entry="save"]')!.textContent).toBe("Save");
    expect(q(".mh-sysmenu-title")!.textContent).toBe("System");
    setUiLanguage("fr");
  });
});
