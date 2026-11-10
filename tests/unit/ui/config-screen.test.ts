import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultShortcuts } from "@/core/shortcuts.js";
import { DEFAULT_AUDIO_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "@/renderer/types.js";
import { createConfigScreen, SETTINGS_TABS, type ConfigScreenHost, type SettingsTab } from "@/ui/config-screen.js";
import { setUiLanguage } from "@/ui/i18n.js";
import type { GameSettings, PlayerCommands, UIView } from "@/ui/types.js";

/** HUD-09 (#200) : écran de configuration au design d'origine, module autonome. */

const base: GameSettings = {
  display: { ...DEFAULT_DISPLAY_SETTINGS },
  audio: { ...DEFAULT_AUDIO_SETTINGS },
  skipUnread: false,
  language: "fr",
  shortcuts: defaultShortcuts(),
  flowchartRevealAll: false,
};

function setup(settings: GameSettings = base, tab: SettingsTab = "system") {
  const commands = {
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    closeScreen: vi.fn(),
    toggleFullscreen: vi.fn(),
    testSe: vi.fn(),
  } as unknown as PlayerCommands & Record<"updateSettings" | "resetSettings" | "closeScreen" | "testSe", ReturnType<typeof vi.fn>>;
  const views: UIView[] = [];
  const tabs: SettingsTab[] = [];
  const captures: { action: string; index: number; apply: (b: string) => void }[] = [];
  let answer = true;
  const host: ConfigScreenHost = {
    commands,
    isInputEnabled: () => true,
    confirm: vi.fn(() => Promise.resolve(answer)),
    setView: (v) => views.push(v),
    initialTab: tab,
    onTabChange: (t) => tabs.push(t),
    beginCapture: (action, index, apply) => captures.push({ action, index, apply }),
  };
  const screen = createConfigScreen(settings, ["ja", "en", "fr"], host);
  document.body.appendChild(screen.element);
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => screen.element.querySelector<T>(sel);
  const qa = (sel: string) => [...screen.element.querySelectorAll<HTMLElement>(sel)];
  return { screen, commands, views, tabs, captures, host, q, qa, setAnswer: (v: boolean) => (answer = v) };
}

describe("createConfigScreen", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setUiLanguage("fr");
  });
  afterEach(() => setUiLanguage("fr"));

  describe("interrupteur « Flowchart : tout révéler » (FLOW-03)", () => {
    it("est dans l'onglet Système, désactivé par défaut", () => {
      const { q } = setup();
      const input = q<HTMLInputElement>('input[name="flowchartRevealAll"]');
      expect(input).not.toBeNull();
      expect(input!.type).toBe("checkbox");
      expect(input!.checked).toBe(false);
      expect(input!.closest(".mh-cfg-row")!.textContent).toContain("tout révéler");
    });

    it("reflète la valeur enregistrée", () => {
      const { q } = setup({ ...base, flowchartRevealAll: true });
      expect(q<HTMLInputElement>('input[name="flowchartRevealAll"]')!.checked).toBe(true);
    });

    it("envoie flowchartRevealAll seul à updateSettings, à chaque changement", () => {
      const { q, commands, views } = setup();
      const input = q<HTMLInputElement>('input[name="flowchartRevealAll"]')!;
      input.click();
      expect(commands.updateSettings).toHaveBeenLastCalledWith({ flowchartRevealAll: true });
      input.click();
      expect(commands.updateSettings).toHaveBeenLastCalledWith({ flowchartRevealAll: false });
      expect(commands.updateSettings).toHaveBeenCalledTimes(2);
      // La vue tenue par l'UI suit : un re-rendu (langue, onglet) ne perd pas le choix.
      input.click();
      const last = views.at(-1) as Extract<UIView, { screen: "settings" }>;
      expect(last.settings.flowchartRevealAll).toBe(true);
    });

    it("est libellé dans les trois langues", () => {
      const labels = new Map<string, string>();
      for (const lang of ["fr", "en", "ja"] as const) {
        setUiLanguage(lang);
        document.body.innerHTML = "";
        labels.set(lang, setup().q('input[name="flowchartRevealAll"]')!.closest(".mh-cfg-row")!.textContent ?? "");
      }
      expect(new Set(labels.values()).size).toBe(3);
      expect(labels.get("en")).toContain("reveal everything");
    });
  });

  describe("réglages conservés", () => {
    it("un slider envoie le groupe display complet", () => {
      const { q, commands } = setup(base, "system");
      const input = q<HTMLInputElement>('input[name="fontScale"]')!;
      input.value = "1.5";
      input.dispatchEvent(new Event("input"));
      expect(commands.updateSettings).toHaveBeenCalledWith({ display: { ...base.display, fontScale: 1.5 } });
    });

    it("un bouton à bascule applique l'option, marque aria-pressed et n'en garde qu'une", () => {
      const { q, qa, commands } = setup();
      const buttons = qa('button[name="fullscreenMode"]');
      expect(buttons.map((b) => b.dataset.value)).toEqual(["fit", "fill", "none"]);
      expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
      q('button[name="fullscreenMode"][data-value="fill"]')!.click();
      expect(commands.updateSettings).toHaveBeenCalledWith({ display: { ...base.display, fullscreenMode: "fill" } });
      expect(qa('button[name="fullscreenMode"]').map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
      expect(q('button[name="fullscreenMode"][data-value="fill"]')!.classList.contains("active")).toBe(true);
    });

    it("les spinners du fondu (2 chiffres) changent la durée et l'opacité, bornés", () => {
      const { q, commands } = setup();
      const duration = q('[role="spinbutton"][data-name="readFadeDuration"]')!;
      expect(duration.textContent).toBe("15"); // 1500 ms = 15 dixièmes de seconde
      expect(duration.getAttribute("aria-valuetext")).toBe("1500 ms");
      duration.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      expect(commands.updateSettings).toHaveBeenLastCalledWith({ display: { ...base.display, readFadeDuration: 1600 } });
      expect(duration.textContent).toBe("16");
      duration.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
      expect(duration.textContent).toBe("30");
      duration.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      expect(duration.textContent).toBe("30");

      const opacity = q('[role="spinbutton"][data-name="readFadeOpacity"]')!;
      expect(opacity.textContent).toBe("40");
      const plus = opacity.parentElement!.querySelectorAll("button")[1]!;
      plus.click();
      expect(commands.updateSettings).toHaveBeenLastCalledWith({
        display: { ...base.display, readFadeDuration: 3000, readFadeOpacity: 0.41 },
      });
    });

    it("l'onglet Son/Effet garde ses volumes, radios Oui/Non et le bouton de test", () => {
      const { q, qa, commands } = setup(base, "sound");
      const bgm = q<HTMLInputElement>('input[name="bgm"]')!;
      bgm.value = "50";
      bgm.dispatchEvent(new Event("input"));
      expect(commands.updateSettings).toHaveBeenCalledWith({ audio: { ...base.audio, bgm: 0.5 } });
      q<HTMLInputElement>('input[type="radio"][name="instantEffects"][value="yes"]')!.click();
      expect(commands.updateSettings).toHaveBeenLastCalledWith({ display: { ...base.display, instantEffects: true } });
      expect(qa('input[type="radio"]')).toHaveLength(10); // 4 réglages d'effets × Oui/Non + réduction (#99)
      expect(q('input[name="reduceMotion"]')).not.toBeNull();
      q(".mh-ui-test-se")!.click();
      expect(commands.testSe).toHaveBeenCalled();
    });

    it("l'onglet Message garde la langue et le saut du texte non lu", () => {
      const { q, commands } = setup(base, "message");
      expect([...q<HTMLSelectElement>('select[name="language"]')!.options].map((o) => o.value)).toEqual(["ja", "en", "fr"]);
      q<HTMLInputElement>('input[name="skipUnread"]')!.click();
      expect(commands.updateSettings).toHaveBeenCalledWith({ skipUnread: true });
    });

    it("l'onglet Raccourcis : 28 touches, capture puis envoi des raccourcis", () => {
      const { q, qa, captures, commands } = setup(base, "shortcuts");
      expect(qa(".mh-ui-key")).toHaveLength(28);
      q('[data-action="saveMenu"][data-index="0"]')!.click();
      expect(captures).toHaveLength(1);
      captures[0]!.apply("x");
      expect(commands.updateSettings).toHaveBeenCalledWith({ shortcuts: { ...base.shortcuts, saveMenu: ["x", "F2"] } });
      expect(q('[data-action="saveMenu"][data-index="0"]')).toBe(document.activeElement);
    });
  });

  describe("réglages par défaut", () => {
    it("demande confirmation (Non par défaut) avant de réinitialiser", async () => {
      const { q, commands, host, setAnswer } = setup();
      setAnswer(false);
      q(".mh-ui-reset")!.click();
      await Promise.resolve();
      expect(host.confirm).toHaveBeenCalledTimes(1);
      expect(commands.resetSettings).not.toHaveBeenCalled();
      setAnswer(true);
      q(".mh-ui-reset")!.click();
      await vi.waitFor(() => expect(commands.resetSettings).toHaveBeenCalledTimes(1));
    });
  });

  describe("onglets et clavier", () => {
    it("role=tablist, un onglet sélectionné, tabindex itinérant, panneau étiqueté", () => {
      const { q, qa } = setup(base, "message");
      expect(q('[role="tablist"]')).not.toBeNull();
      const tabs = qa('[role="tab"]');
      expect(tabs.map((t) => t.dataset.tab)).toEqual([...SETTINGS_TABS]);
      expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false", "false"]);
      expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1, -1]);
      const panel = q('[role="tabpanel"]')!;
      expect(panel.getAttribute("aria-labelledby")).toBe(tabs[1]!.id);
    });

    it("le focus initial va sur l'onglet actif", () => {
      const { screen, q } = setup(base, "sound");
      screen.focusActiveTab();
      expect(document.activeElement).toBe(q('[data-tab="sound"]'));
    });

    it("← → Début Fin changent d'onglet sans perdre le focus, avec rappel", () => {
      const { q, tabs } = setup();
      const press = (key: string) => q('[role="tablist"]')!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      q('[data-tab="system"]')!.focus();
      press("ArrowRight");
      expect(q('[data-tab="message"]')!.getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(q('[data-tab="message"]'));
      expect(q('input[name="textSpeedUnread"]')).not.toBeNull();
      press("End");
      expect(document.activeElement).toBe(q('[data-tab="shortcuts"]'));
      press("ArrowRight"); // boucle
      expect(document.activeElement).toBe(q('[data-tab="system"]'));
      press("ArrowLeft");
      expect(document.activeElement).toBe(q('[data-tab="shortcuts"]'));
      press("Home");
      expect(document.activeElement).toBe(q('[data-tab="system"]'));
      expect(tabs).toEqual(["message", "shortcuts", "system", "shortcuts", "system"]);
    });

    it("le titre décoratif japonais et les sous-titres de section sont aria-hidden", () => {
      const { q } = setup();
      expect(q(".mh-cfg-title-deco")!.getAttribute("aria-hidden")).toBe("true");
      expect(q(".mh-cfg-heading")!.getAttribute("aria-hidden")).toBe("true");
    });

    it("chaque panneau est un groupe nommé par son libellé (fieldset + legend)", () => {
      const { qa } = setup();
      const panels = qa("fieldset.mh-cfg-panel");
      expect(panels.length).toBeGreaterThanOrEqual(4);
      for (const p of panels) expect(p.querySelector(":scope > legend")!.textContent).not.toBe("");
    });
  });

  it("ne contient aucun libellé en dur (accentué ou japonais) dans config-screen.ts", () => {
    const source = readFileSync(resolve(__dirname, "../../../src/ui/config-screen.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const literals = [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? "");
    expect(literals.filter((s) => /[À-ÿŒœ぀-ヿ一-鿿]/.test(s))).toEqual([]);
  });
});
