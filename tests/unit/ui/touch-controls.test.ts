import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultShortcuts } from "@/core/shortcuts.js";
import { setUiLanguage } from "@/ui/i18n.js";
import {
  actionForGesture,
  AWAKE_MS,
  CLICK_SUPPRESS_MS,
  createTouchControls,
  nextTouchSeen,
  TOUCH_ACTIONS,
  type TouchControls,
} from "@/ui/touch-controls.js";
import type { PlayerCommands, PlayerStatus } from "@/ui/types.js";
import { DomUIManager } from "@/ui/ui-manager.js";

/** WEB-01 (#203) : commandes tactiles (barre, bouton de menu, appui long, balayage). */

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
  mode: "normal", inGame: true, userHidden: false, canRollback: false, quickMenuLocked: false, saveLoadEnabled: true, autoPaused: false,
  mouseMode: "menu", autoHideCursor: false, fastForwardKey: "shift", shortcuts: defaultShortcuts(), ...p,
});

function ptr(type: string, pointerType: string, init: { id?: number; x?: number; y?: number } = {}): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { pointerType, pointerId: init.id ?? 1, clientX: init.x ?? 100, clientY: init.y ?? 100 });
  return e;
}

/** Fausse sonde `pointer: coarse`. */
function media(matches: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches,
    addEventListener: (_t: string, l: () => void) => listeners.add(l),
    removeEventListener: (_t: string, l: () => void) => listeners.delete(l),
  };
  return {
    fn: () => mql as unknown as MediaQueryList,
    set(value: boolean) {
      mql.matches = value;
      for (const l of listeners) l();
    },
  };
}

describe("fonctions pures", () => {
  it("nextTouchSeen : un toucher active, la souris désactive, le stylet ne change rien", () => {
    expect(nextTouchSeen(false, "touch")).toBe(true);
    expect(nextTouchSeen(true, "mouse")).toBe(false);
    expect(nextTouchSeen(true, "pen")).toBe(true);
    expect(nextTouchSeen(false, "pen")).toBe(false);
  });

  it("actionForGesture : appui long = menu, balayage haut = historique, le reste ne fait rien", () => {
    expect(actionForGesture("long-press")).toBe("menu");
    expect(actionForGesture("swipe-up")).toBe("backlog");
    for (const g of ["tap", "swipe-down", "swipe-left", "swipe-right"] as const) {
      expect(actionForGesture(g)).toBeNull();
    }
  });

  it("la barre n'a ni Exit ni volume, dans l'ordre prévu", () => {
    expect(TOUCH_ACTIONS.map((a) => a.id)).toEqual(["qsave", "qload", "auto", "skip", "backlog", "fullscreen"]);
  });

  it("aucun libellé en dur dans touch-controls.ts (accent ou caractère japonais)", () => {
    const source = readFileSync(resolve(__dirname, "../../../src/ui/touch-controls.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
    const literals = [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? "");
    expect(literals.filter((s) => /[À-ÿŒœ぀-ヿ一-鿿]/.test(s))).toEqual([]);
  });
});

describe("createTouchControls", () => {
  let overlay: HTMLElement;
  let cmd: ReturnType<typeof makeCommands>;
  let controls: TouchControls | null = null;
  let playing = true;
  let st: PlayerStatus;

  const setup = (coarse: boolean, extra: { fullscreen?: boolean } = {}) => {
    const m = media(coarse);
    controls = createTouchControls(
      overlay,
      { commands: cmd, getStatus: () => st, isPlaying: () => playing },
      { matchMedia: m.fn, now: () => Date.now(), fullscreenSupported: () => extra.fullscreen ?? true },
    );
    controls.sync("game", st);
    return m;
  };
  const q = (sel: string) => overlay.querySelector<HTMLElement>(sel);
  const qa = (sel: string) => [...overlay.querySelectorAll<HTMLElement>(sel)];

  beforeEach(() => {
    vi.useFakeTimers();
    setUiLanguage("fr");
    document.body.innerHTML = '<div id="viewport"><div id="ui-overlay" class="mh-ui-overlay"></div></div>';
    overlay = document.getElementById("ui-overlay")!;
    cmd = makeCommands();
    playing = true;
    st = status();
  });
  afterEach(() => {
    controls?.dispose();
    controls = null;
    vi.useRealTimers();
  });

  describe("détection", () => {
    it("desktop souris (pointer: fine) : aucun nœud, aucune classe", () => {
      setup(false);
      expect(controls!.active).toBe(false);
      expect(q("#ui-touch")).toBeNull();
      expect(overlay.classList.contains("mh-ui-touch")).toBe(false);
    });

    it("pointer: coarse : bouton de menu et barre présents", () => {
      setup(true);
      expect(controls!.active).toBe(true);
      expect(overlay.classList.contains("mh-ui-touch")).toBe(true);
      expect(q(".mh-touch-menu")).not.toBeNull();
      expect(qa(".mh-touch-action").map((b) => b.dataset.touch)).toEqual([
        "qsave", "qload", "auto", "skip", "backlog", "fullscreen",
      ]);
    });

    it("un toucher sur un appareil hybride active, un clic de souris désactive", () => {
      setup(false);
      overlay.dispatchEvent(ptr("pointerdown", "touch"));
      expect(q("#ui-touch")).not.toBeNull();
      overlay.dispatchEvent(ptr("pointerup", "touch"));
      overlay.dispatchEvent(ptr("pointerdown", "mouse"));
      expect(q("#ui-touch")).toBeNull();
    });

    it("le changement de pointer: coarse à chaud crée ou retire les commandes", () => {
      const m = setup(false);
      m.set(true);
      expect(q("#ui-touch")).not.toBeNull();
      m.set(false);
      expect(q("#ui-touch")).toBeNull();
    });

    it("le bouton plein écran est omis quand le navigateur ne le gère pas (iPhone)", () => {
      setup(true, { fullscreen: false });
      expect(q('[data-touch="fullscreen"]')).toBeNull();
    });

    it("dispose retire tout", () => {
      setup(true);
      controls!.dispose();
      expect(q("#ui-touch")).toBeNull();
      expect(overlay.classList.contains("mh-ui-touch")).toBe(false);
    });
  });

  describe("visibilité et états", () => {
    it("caché hors jeu (titre, menus) et quand le texte est masqué, visible en jeu", () => {
      setup(true);
      expect(q("#ui-touch")!.hidden).toBe(false);
      controls!.sync("title", st);
      expect(q("#ui-touch")!.hidden).toBe(true);
      controls!.sync("pause", st);
      expect(q("#ui-touch")!.hidden).toBe(true);
      controls!.sync("game", status({ userHidden: true }));
      expect(q("#ui-touch")!.hidden).toBe(true);
      controls!.sync("game", status({ inGame: false }));
      expect(q("#ui-touch")!.hidden).toBe(true);
      controls!.sync("game", st);
      expect(q("#ui-touch")!.hidden).toBe(false);
    });

    it("auto et skip reflètent le mode (aria-pressed) ; save et load suivent @lockquickmenu", () => {
      setup(true);
      controls!.sync("game", status({ mode: "auto", quickMenuLocked: true }));
      expect(q('[data-touch="auto"]')!.getAttribute("aria-pressed")).toBe("true");
      expect(q('[data-touch="skip"]')!.getAttribute("aria-pressed")).toBe("false");
      expect((q('[data-touch="qsave"]') as HTMLButtonElement).disabled).toBe(true);
      expect((q('[data-touch="qload"]') as HTMLButtonElement).disabled).toBe(true);
      controls!.sync("game", status());
      expect((q('[data-touch="qsave"]') as HTMLButtonElement).disabled).toBe(false);
    });

    it("les libellés et aria-label passent par le dictionnaire et suivent la langue", () => {
      setup(true);
      expect(q(".mh-touch-menu")!.getAttribute("aria-label")).toBe("Menu");
      expect(q('[data-touch="qsave"]')!.textContent).toBe("Q.Save");
      expect(q(".mh-touch-bar")!.getAttribute("aria-label")).toBe("Actions rapides");
      setUiLanguage("en");
      controls!.sync("game", st);
      expect(q(".mh-touch-bar")!.getAttribute("aria-label")).toBe("Quick actions");
      expect(q('[data-touch="backlog"]')!.textContent).toBe("History");
      setUiLanguage("fr");
    });

    it("le bouton de menu se réveille au toucher puis redevient discret", () => {
      setup(true);
      overlay.dispatchEvent(ptr("pointerdown", "touch"));
      expect(q("#ui-touch")!.classList.contains("is-awake")).toBe(true);
      vi.advanceTimersByTime(AWAKE_MS + 10);
      expect(q("#ui-touch")!.classList.contains("is-awake")).toBe(false);
    });
  });

  describe("actions", () => {
    beforeEach(() => setup(true));
    const click = (id: string) => q(`[data-touch="${id}"]`)!.click();

    it("le bouton de menu ouvre le menu système", () => {
      click("menu");
      expect(cmd.openScreen).toHaveBeenCalledWith("pause");
    });

    it("Q.Save sauvegarde l'emplacement rapide ; Q.Load ouvre l'écran de chargement", () => {
      click("qsave");
      expect(cmd.save).toHaveBeenCalledWith("quick");
      click("qload");
      expect(cmd.openScreen).toHaveBeenCalledWith("load");
    });

    it("Auto et Skip basculent selon l'état courant", () => {
      click("auto");
      expect(cmd.setMode).toHaveBeenLastCalledWith("auto");
      st = status({ mode: "auto" });
      click("auto");
      expect(cmd.setMode).toHaveBeenLastCalledWith("normal");
      click("skip");
      expect(cmd.setMode).toHaveBeenLastCalledWith("skip");
    });

    it("Historique et plein écran", () => {
      click("backlog");
      expect(cmd.openScreen).toHaveBeenCalledWith("backlog");
      click("fullscreen");
      expect(cmd.toggleFullscreen).toHaveBeenCalledTimes(1);
    });

    it("rien ne part quand les entrées sont suspendues (chargement, confirmation)", () => {
      playing = false;
      for (const id of ["menu", "qsave", "qload", "auto", "skip", "backlog", "fullscreen"]) click(id);
      expect(cmd.openScreen).not.toHaveBeenCalled();
      expect(cmd.save).not.toHaveBeenCalled();
      expect(cmd.setMode).not.toHaveBeenCalled();
      expect(cmd.toggleFullscreen).not.toHaveBeenCalled();
    });
  });

  describe("gestes sur la scène", () => {
    beforeEach(() => setup(true));
    const touch = (type: string, x: number, y: number, id = 1) => overlay.dispatchEvent(ptr(type, "touch", { id, x, y }));

    it("appui long = menu système, une seule fois", () => {
      touch("pointerdown", 400, 300);
      vi.advanceTimersByTime(499);
      expect(cmd.openScreen).not.toHaveBeenCalled();
      vi.advanceTimersByTime(5);
      expect(cmd.openScreen).toHaveBeenCalledTimes(1);
      expect(cmd.openScreen).toHaveBeenCalledWith("pause");
      playing = false; // le menu est ouvert
      touch("pointerup", 400, 300);
      expect(cmd.openScreen).toHaveBeenCalledTimes(1);
    });

    it("appui long : le click synthétique qui suit est supprimé, le suivant passe", () => {
      const onClick = vi.fn();
      overlay.addEventListener("click", onClick);
      touch("pointerdown", 400, 300);
      vi.advanceTimersByTime(520);
      touch("pointerup", 400, 300);
      overlay.click();
      expect(onClick).not.toHaveBeenCalled();
      vi.advanceTimersByTime(CLICK_SUPPRESS_MS + 10);
      overlay.click();
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("un appui simple ne déclenche aucune commande de geste : le click natif avance", () => {
      const onClick = vi.fn();
      overlay.addEventListener("click", onClick);
      touch("pointerdown", 400, 300);
      vi.advanceTimersByTime(100);
      touch("pointerup", 400, 300);
      overlay.click();
      expect(cmd.openScreen).not.toHaveBeenCalled();
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("balayage vers le haut = historique ; vers le bas ou le côté = rien", () => {
      touch("pointerdown", 400, 500);
      touch("pointermove", 400, 420);
      vi.advanceTimersByTime(150);
      touch("pointerup", 400, 340);
      expect(cmd.openScreen).toHaveBeenCalledWith("backlog");

      cmd.openScreen.mockClear();
      for (const [x1, y1] of [[400, 600], [200, 400], [600, 400]] as const) {
        touch("pointerdown", 400, 400);
        vi.advanceTimersByTime(100);
        touch("pointerup", x1, y1);
      }
      expect(cmd.openScreen).not.toHaveBeenCalled();
    });

    it("un appui qui part d'un bouton ou d'un panneau n'est pas un geste", () => {
      const btn = document.createElement("button");
      overlay.appendChild(btn);
      btn.dispatchEvent(ptr("pointerdown", "touch"));
      vi.advanceTimersByTime(600);
      expect(cmd.openScreen).not.toHaveBeenCalled();
    });

    it("hors jeu (menu ouvert, confirmation), aucun geste", () => {
      playing = false;
      touch("pointerdown", 400, 300);
      vi.advanceTimersByTime(600);
      expect(cmd.openScreen).not.toHaveBeenCalled();
    });

    it("deux doigts (pincement) n'ouvrent rien", () => {
      touch("pointerdown", 400, 300, 1);
      touch("pointerdown", 440, 300, 2);
      vi.advanceTimersByTime(600);
      expect(cmd.openScreen).not.toHaveBeenCalled();
    });

    it("la souris ne déclenche aucun geste", () => {
      overlay.dispatchEvent(ptr("pointerdown", "mouse"));
      vi.advanceTimersByTime(600);
      overlay.dispatchEvent(ptr("pointerup", "mouse"));
      expect(cmd.openScreen).not.toHaveBeenCalled();
    });
  });

  describe("contextmenu", () => {
    beforeEach(() => setup(true));

    it("un contextmenu natif tactile est neutralisé et vaut appui long (Android)", () => {
      const down = ptr("pointerdown", "touch");
      overlay.dispatchEvent(down);
      const e = ptr("contextmenu", "touch");
      const reached = vi.fn();
      overlay.addEventListener("contextmenu", reached);
      overlay.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
      expect(reached).not.toHaveBeenCalled(); // le gestionnaire du clic droit (qui refermerait le menu) ne le voit pas
      expect(cmd.openScreen).toHaveBeenCalledTimes(1);
      expect(cmd.openScreen).toHaveBeenCalledWith("pause");
    });

    it("le clic droit souris passe intact (réglage 1/2 clics conservé)", () => {
      const reached = vi.fn();
      overlay.addEventListener("contextmenu", reached);
      overlay.dispatchEvent(ptr("pointerdown", "touch"));
      overlay.dispatchEvent(ptr("pointerup", "touch"));
      const e = ptr("contextmenu", "mouse");
      overlay.dispatchEvent(e);
      expect(reached).toHaveBeenCalledTimes(1);
      expect(cmd.openScreen).not.toHaveBeenCalled();
    });
  });
});

describe("branchement dans DomUIManager", () => {
  let ui: DomUIManager;
  let root: HTMLElement;
  let cmd: ReturnType<typeof makeCommands>;

  const mount = (coarse: boolean) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: coarse && query.includes("coarse"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    document.body.innerHTML = '<div id="viewport"></div>';
    root = document.getElementById("viewport")!;
    cmd = makeCommands();
    ui = new DomUIManager();
    ui.init(root, cmd);
    ui.show({ screen: "game" });
    ui.setStatus(status());
  };
  afterEach(() => {
    ui.dispose();
    vi.unstubAllGlobals();
  });

  it("desktop : aucun élément tactile, le clic droit et le clic avancent comme avant", () => {
    mount(false);
    expect(root.querySelector("#ui-touch")).toBeNull();
    root.querySelector<HTMLElement>("#ui-overlay")!.click();
    expect(cmd.advance).toHaveBeenCalledTimes(1);
    root.querySelector("#ui-overlay")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(cmd.openScreen).toHaveBeenCalledWith("pause");
  });

  it("tactile : la barre suit l'écran (cachée sous le menu système) et le geste ouvre le menu", () => {
    vi.useFakeTimers();
    mount(true);
    const touchRoot = () => root.querySelector<HTMLElement>("#ui-touch")!;
    expect(touchRoot().hidden).toBe(false);
    ui.show({ screen: "pause" });
    expect(touchRoot().hidden).toBe(true);
    ui.show({ screen: "game" });
    expect(touchRoot().hidden).toBe(false);

    const overlay = root.querySelector("#ui-overlay")!;
    overlay.dispatchEvent(ptr("pointerdown", "touch", { x: 300, y: 300 }));
    vi.advanceTimersByTime(600);
    expect(cmd.openScreen).toHaveBeenCalledWith("pause");
    vi.useRealTimers();
  });
});
