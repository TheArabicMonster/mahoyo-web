import { WINDOW_SIZE_OPTIONS } from "@/core/display.js";
import { cloneShortcuts, formatBinding, SHORTCUT_DEFINITIONS, type ShortcutAction } from "@/core/shortcuts.js";
import type { ConfirmOptions, GameLanguage, GameSettings, PlayerCommands, UIView } from "@/ui/types.js";
import { LANGUAGE_NAMES, t } from "@/ui/i18n.js";
import "./config-screen.css";

/**
 * Écran de configuration au design d'origine (HUD-09, #200 ; docs/ANALYSE_HUD_ORIGINAL.md §2.9, docs/DESIGN.md §9.10).
 *
 * Module autonome : il ne connaît pas `DomUIManager`, seulement l'interface `ConfigScreenHost`. Le modèle de
 * réglages ne change pas (`GameSettings`, migration dans `settings-store.ts`) : chaque contrôle envoie le même
 * `updateSettings` qu'avant, sauvegarde automatique à chaque changement. Habillage en CSS pur, aucun asset.
 */

export type SettingsTab = "system" | "message" | "sound" | "shortcuts";

export const SETTINGS_TABS: readonly SettingsTab[] = ["system", "message", "sound", "shortcuts"];

export interface ConfigScreenHost {
  readonly commands: PlayerCommands;
  /** Faux pendant un chargement : les contrôles ne font rien. */
  isInputEnabled(): boolean;
  confirm(message: string, options?: ConfirmOptions): Promise<boolean>;
  /** Tient la vue courante à jour (re-rendu après un changement de langue, par exemple). */
  setView(view: UIView): void;
  /** Onglet à ouvrir, et rappel quand le joueur en change (conservé d'un rendu à l'autre). */
  readonly initialTab: SettingsTab;
  onTabChange(tab: SettingsTab): void;
  /** Démarre la capture d'une touche (le gestionnaire clavier de l'UI la reçoit). */
  beginCapture(action: ShortcutAction, index: number, apply: (binding: string) => void): void;
}

export interface ConfigScreen {
  readonly element: HTMLElement;
  /** Donne le focus à l'onglet actif (à appeler une fois l'écran dans le DOM). */
  focusActiveTab(): void;
}

type El = HTMLElement;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

let nextScreenId = 0;

/** Les durées de fondu se règlent au dixième de seconde (« Durée 15 » = 1,5 s dans l'original). */
const FADE_STEP_MS = 100;

export function createConfigScreen(
  settings: Readonly<GameSettings>,
  availableLanguages: readonly GameLanguage[],
  host: ConfigScreenHost,
): ConfigScreen {
  const screenId = ++nextScreenId;
  const { commands } = host;

  // Copies locales : `Partial<GameSettings>` est superficiel, on renvoie les groupes entiers.
  const display = { ...settings.display };
  const audio = { ...settings.audio };
  const shortcuts = cloneShortcuts(settings.shortcuts);
  let language = settings.language;
  let skipUnread = settings.skipUnread;
  let revealAll = settings.flowchartRevealAll;
  let tab: SettingsTab = host.initialTab;

  const updateView = (): void => {
    host.setView({
      screen: "settings",
      settings: {
        ...settings,
        display: { ...display },
        audio: { ...audio },
        shortcuts: cloneShortcuts(shortcuts),
        language,
        skipUnread,
        flowchartRevealAll: revealAll,
      },
      availableLanguages,
    });
  };
  const pushDisplay = (): void => {
    updateView();
    commands.updateSettings({ display: { ...display } });
  };
  const pushAudio = (): void => {
    updateView();
    commands.updateSettings({ audio: { ...audio } });
  };
  const pushShortcuts = (): void => {
    updateView();
    commands.updateSettings({ shortcuts: cloneShortcuts(shortcuts) });
  };

  const reducedMotion = (): boolean =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── Cadre ──

  const root = h("section", "mh-cfg");
  root.setAttribute("aria-label", t("config.title"));

  const header = h("header", "mh-cfg-header");
  const title = h("h2", "mh-cfg-title", t("config.title"));
  const titleDeco = h("span", "mh-cfg-title-deco", t("config.title.deco"));
  titleDeco.setAttribute("aria-hidden", "true");
  header.append(title, titleDeco);

  const tabs = h("nav", "mh-cfg-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", t("config.tabsLabel"));
  const tabLabels: Record<SettingsTab, string> = {
    system: t("config.tab.system"),
    message: t("config.tab.message"),
    sound: t("config.tab.sound"),
    shortcuts: t("config.tab.shortcuts"),
  };
  const tabDeco: Record<SettingsTab, string> = {
    system: t("config.tab.system.deco"),
    message: t("config.tab.message.deco"),
    sound: t("config.tab.sound.deco"),
    shortcuts: t("config.tab.shortcuts.deco"),
  };
  const heading = h("div", "mh-cfg-heading");
  heading.setAttribute("aria-hidden", "true");
  const body = h("div", "mh-cfg-body");
  body.setAttribute("role", "tabpanel");

  const tabButtons = new Map<SettingsTab, HTMLButtonElement>();
  for (const id of SETTINGS_TABS) {
    const b = h("button", "mh-ui-tab mh-cfg-tab", tabLabels[id]);
    b.type = "button";
    b.id = `mh-cfg-${screenId}-tab-${id}`;
    b.dataset.tab = id;
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => {
      if (host.isInputEnabled()) selectTab(id);
    });
    tabButtons.set(id, b);
    tabs.appendChild(b);
  }
  // Clavier : ← → Début Fin déplacent et activent l'onglet (tablist avec tabindex itinérant).
  tabs.addEventListener("keydown", (e) => {
    const index = SETTINGS_TABS.indexOf(tab);
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % SETTINGS_TABS.length;
    else if (e.key === "ArrowLeft") next = (index + SETTINGS_TABS.length - 1) % SETTINGS_TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = SETTINGS_TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!host.isInputEnabled()) return;
    selectTab(SETTINGS_TABS[next]!);
    tabButtons.get(tab)?.focus();
  });

  const footer = h("footer", "mh-cfg-footer");
  const back = h("button", "mh-ui-back mh-cfg-back", t("common.back"));
  back.type = "button";
  back.addEventListener("click", () => {
    if (host.isInputEnabled()) commands.closeScreen();
  });
  const reset = h("button", "mh-ui-reset mh-cfg-reset", t("config.reset"));
  reset.type = "button";
  reset.addEventListener("click", () => {
    if (!host.isInputEnabled()) return;
    // Action destructrice : « Non » est présélectionné.
    void host.confirm(t("config.resetConfirm")).then((ok) => {
      if (ok && host.isInputEnabled()) commands.resetSettings();
    });
  });
  footer.append(back, reset);

  root.append(header, tabs, heading, body, footer);

  function selectTab(id: SettingsTab): void {
    tab = id;
    host.onTabChange(id);
    updateView();
    renderTab();
  }

  // ── Constructeurs de contrôles ──

  const guard = (fn: () => void) => (): void => {
    if (host.isInputEnabled()) fn();
  };

  /** Colonne de panneaux. */
  const column = (cls: string): El => h("div", `mh-cfg-col ${cls}`);

  /** Panneau bordé : le libellé est la `legend` d'un `fieldset`, centrée sur le bord haut. */
  const panel = (parent: El, label: string, cls = ""): El => {
    const f = h("fieldset", `mh-cfg-panel ${cls}`.trim());
    f.appendChild(h("legend", "mh-cfg-legend", label));
    const inner = h("div", "mh-cfg-panel-body");
    f.appendChild(inner);
    parent.appendChild(f);
    return inner;
  };

  const row = (parent: El, label: string, cls = ""): { row: El; label: El } => {
    const r = h("div", `mh-cfg-row ${cls}`.trim());
    const l = h("span", "mh-cfg-label", label);
    r.appendChild(l);
    parent.appendChild(r);
    return { row: r, label: l };
  };

  /** Boutons à bascule : actif = sarcelle, inactif = gris. */
  const toggles = <T extends string>(
    parent: El,
    label: string,
    name: string,
    options: readonly { value: T; label: string }[],
    value: T,
    onChange: (v: T) => void,
  ): void => {
    const { row: r } = row(parent, label);
    const group = h("div", "mh-cfg-toggles");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);
    const buttons: HTMLButtonElement[] = [];
    const mark = (selected: string): void => {
      for (const b of buttons) {
        const on = b.dataset.value === selected;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", String(on));
      }
    };
    for (const option of options) {
      const b = h("button", "mh-cfg-toggle", option.label);
      b.type = "button";
      b.name = name;
      b.dataset.value = option.value;
      b.addEventListener(
        "click",
        guard(() => {
          mark(option.value);
          onChange(option.value);
        }),
      );
      buttons.push(b);
      group.appendChild(b);
    }
    mark(value);
    r.appendChild(group);
  };

  /** Radios noires à anneau gris (choix Oui / Non). */
  const radios = <T extends string>(
    parent: El,
    label: string,
    name: string,
    options: readonly { value: T; label: string }[],
    value: T,
    onChange: (v: T) => void,
  ): void => {
    const { row: r } = row(parent, label);
    const group = h("div", "mh-cfg-radios");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", label);
    for (const option of options) {
      const l = h("label", "mh-cfg-radio");
      const input = h("input");
      input.type = "radio";
      input.name = name;
      input.value = option.value;
      input.checked = option.value === value;
      input.addEventListener("change", guard(() => {
        if (input.checked) onChange(option.value);
      }));
      l.append(input, h("span", "mh-cfg-radio-text", option.label));
      group.appendChild(l);
    }
    r.appendChild(group);
  };

  /** Interrupteur (case native, habillée en bascule sarcelle/gris). */
  const check = (parent: El, label: string, name: string, value: boolean, onChange: (v: boolean) => void): void => {
    const r = h("label", "mh-cfg-row mh-cfg-row-check");
    const input = h("input", "mh-cfg-switch");
    input.type = "checkbox";
    input.name = name;
    input.checked = value;
    input.addEventListener("change", guard(() => onChange(input.checked)));
    r.append(h("span", "mh-cfg-label", label), input);
    parent.appendChild(r);
  };

  /** Curseur : piste noire à 5 repères, pastille sphérique argent. */
  const slider = (
    parent: El,
    label: string,
    name: string,
    min: number,
    max: number,
    step: number,
    value: number,
    onInput: (v: number) => void,
    format: (v: number) => string = (v) => String(v),
  ): void => {
    const { row: r, label: l } = row(parent, label, "mh-cfg-row-slider");
    const output = h("span", "mh-cfg-value", format(value));
    l.appendChild(output);
    const input = h("input");
    input.type = "range";
    input.name = name;
    input.setAttribute("aria-label", label);
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener("input", () => {
      if (!host.isInputEnabled()) return;
      const v = Number(input.value);
      output.textContent = format(v);
      onInput(v);
    });
    const track = h("div", "mh-cfg-range");
    track.appendChild(input);
    r.appendChild(track);
  };

  /** Spinner −/+ à deux chiffres (durée et opacité du fondu). Clavier : ↑ ↓ PageUp PageDown Début Fin. */
  const spinner = (
    parent: El,
    label: string,
    name: string,
    min: number,
    max: number,
    value: number,
    onChange: (v: number) => void,
    valueText: (v: number) => string,
  ): void => {
    const { row: r } = row(parent, label, "mh-cfg-row-spinner");
    const wrap = h("div", "mh-cfg-spinner");
    const less = h("button", "mh-cfg-spin-btn", "−");
    const more = h("button", "mh-cfg-spin-btn", "+");
    less.type = more.type = "button";
    less.tabIndex = more.tabIndex = -1;
    less.setAttribute("aria-label", t("config.spinner.less"));
    more.setAttribute("aria-label", t("config.spinner.more"));
    const box = h("div", "mh-cfg-spin-value");
    box.tabIndex = 0;
    box.dataset.name = name;
    box.setAttribute("role", "spinbutton");
    box.setAttribute("aria-label", label);
    box.setAttribute("aria-valuemin", String(min));
    box.setAttribute("aria-valuemax", String(max));
    let current = Math.min(max, Math.max(min, value));
    const render = (): void => {
      box.textContent = String(current).padStart(2, "0");
      box.setAttribute("aria-valuenow", String(current));
      box.setAttribute("aria-valuetext", valueText(current));
      less.disabled = current <= min;
      more.disabled = current >= max;
    };
    const set = (v: number): void => {
      const next = Math.min(max, Math.max(min, Math.round(v)));
      if (next === current) return;
      current = next;
      render();
      onChange(next);
    };
    less.addEventListener("click", guard(() => set(current - 1)));
    more.addEventListener("click", guard(() => set(current + 1)));
    box.addEventListener("keydown", (e) => {
      let handled = true;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") set(current + 1);
      else if (e.key === "ArrowDown" || e.key === "ArrowLeft") set(current - 1);
      else if (e.key === "PageUp") set(current + 5);
      else if (e.key === "PageDown") set(current - 5);
      else if (e.key === "Home") set(min);
      else if (e.key === "End") set(max);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    render();
    wrap.append(less, box, more);
    r.appendChild(wrap);
  };

  const select = <T extends string>(
    parent: El,
    label: string,
    name: string,
    options: readonly { value: T; label: string }[],
    value: T,
    onChange: (v: T) => void,
  ): void => {
    const { row: r } = row(parent, label);
    const el = h("select", "mh-cfg-select");
    el.name = name;
    el.setAttribute("aria-label", label);
    for (const option of options) {
      const o = h("option", undefined, option.label);
      o.value = option.value;
      el.appendChild(o);
    }
    el.value = value;
    el.addEventListener("change", guard(() => onChange(el.value as T)));
    r.appendChild(el);
  };

  const action = (parent: El, label: string, text: string, cls: string, onClick: () => void): void => {
    const { row: r, label: l } = row(parent, label, "mh-cfg-row-action");
    if (!label) l.remove();
    const b = h("button", `mh-cfg-button ${cls}`, text);
    b.type = "button";
    b.addEventListener("click", guard(onClick));
    r.appendChild(b);
  };

  const keyRow = (parent: El, id: ShortcutAction, label: string, onChanged: () => void): void => {
    const r = h("div", "mh-cfg-keyrow");
    r.appendChild(h("span", "mh-cfg-label", label));
    const keys = h("div", "mh-cfg-keys");
    for (let index = 0; index < 2; index++) {
      const b = h("button", "mh-ui-key mh-cfg-key", formatBinding(shortcuts[id][index] ?? ""));
      b.type = "button";
      b.dataset.action = id;
      b.dataset.index = String(index);
      b.addEventListener(
        "click",
        guard(() => {
          host.beginCapture(id, index, (binding) => {
            shortcuts[id][index] = binding;
            pushShortcuts();
            onChanged();
          });
          b.textContent = t("config.shortcuts.capturing");
          b.classList.add("capturing");
        }),
      );
      keys.appendChild(b);
    }
    r.appendChild(keys);
    parent.appendChild(r);
  };

  const fmtMs = (v: number): string => t("config.unit.ms", { value: v });
  const fmtPercent = (v: number): string => t("config.unit.percent", { value: v });
  const fmtMsPerChar = (v: number): string => t("config.unit.msPerChar", { value: v });

  /** Zone d'aperçu noire : la ligne « déjà lue » rejoue le fondu réglé au-dessus. */
  const preview = (parent: El): (() => void) => {
    const zone = h("div", "mh-cfg-preview");
    zone.tabIndex = 0;
    zone.setAttribute("role", "group");
    zone.setAttribute("aria-label", t("config.preview.label"));
    zone.title = t("config.preview.hint");
    const current = h("p", "mh-cfg-preview-line", t("config.preview.current"));
    const read = h("p", "mh-cfg-preview-line mh-cfg-preview-read", t("config.preview.read"));
    zone.append(read, current);
    const play = (): void => {
      const target = display.readFade ? display.readFadeOpacity : 1;
      read.style.transition = "none";
      read.style.opacity = "1";
      if (reducedMotion()) {
        read.style.opacity = String(target);
        return;
      }
      void read.offsetWidth; // fige l'état de départ avant d'animer
      read.style.transition = `opacity ${display.readFadeDuration}ms linear`;
      read.style.opacity = String(target);
    };
    zone.addEventListener("click", play);
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        play();
      }
    });
    parent.appendChild(zone);
    // État final dès l'ouverture, sans animation.
    read.style.opacity = String(display.readFade ? display.readFadeOpacity : 1);
    return play;
  };

  // ── Contenu des onglets ──

  function renderSystem(left: El, right: El): void {
    const screen = panel(left, t("config.screen.section"));
    action(screen, "", t("config.screen.fullscreenButton"), "mh-ui-fullscreen", () => commands.toggleFullscreen());
    toggles(screen, t("config.screen.fullscreen"), "fullscreenMode", [
      { value: "fit", label: t("config.screen.fit") },
      { value: "fill", label: t("config.screen.fill") },
      { value: "none", label: t("config.screen.none") },
    ], display.fullscreenMode, (v) => {
      display.fullscreenMode = v;
      pushDisplay();
    });
    const windowSizes = WINDOW_SIZE_OPTIONS.map((o) => (o.value === "fit" ? { ...o, label: t("config.screen.windowSizeFit") } : o));
    select(screen, t("config.screen.windowSize"), "windowSize", windowSizes, display.windowSize, (v) => {
      display.windowSize = v;
      pushDisplay();
    });

    const mouse = panel(left, t("config.mouse.section"));
    toggles(mouse, t("config.mouse.rightClick"), "mouseMode", [
      { value: "menu", label: t("config.mouse.menu") },
      { value: "hideThenMenu", label: t("config.mouse.hideThenMenu") },
    ], display.mouseMode, (v) => {
      display.mouseMode = v;
      pushDisplay();
    });
    check(mouse, t("config.mouse.autoHideCursor"), "autoHideCursor", display.autoHideCursor, (v) => {
      display.autoHideCursor = v;
      pushDisplay();
    });

    const flow = panel(left, t("config.flowchart.section"));
    check(flow, t("config.flowchart.revealAll"), "flowchartRevealAll", revealAll, (v) => {
      revealAll = v;
      updateView();
      commands.updateSettings({ flowchartRevealAll: v });
    });

    const text = panel(right, t("config.textFx.section"));
    let replay: () => void = () => {};
    toggles(text, t("config.textFx.display"), "textAnimation", [
      { value: "fade", label: t("config.textFx.on") },
      { value: "none", label: t("config.textFx.off") },
    ], display.textAnimation, (v) => {
      display.textAnimation = v;
      pushDisplay();
    });
    toggles(text, t("config.textFx.read"), "readFade", [
      { value: "fade", label: t("config.textFx.readFade") },
      { value: "none", label: t("config.textFx.off") },
    ], display.readFade ? "fade" : "none", (v) => {
      display.readFade = v === "fade";
      pushDisplay();
      replay();
    });
    spinner(text, t("config.textFx.fadeDuration"), "readFadeDuration", 0, 3000 / FADE_STEP_MS, Math.round(display.readFadeDuration / FADE_STEP_MS), (v) => {
      display.readFadeDuration = v * FADE_STEP_MS;
      pushDisplay();
      replay();
    }, (v) => fmtMs(v * FADE_STEP_MS));
    spinner(text, t("config.textFx.readOpacity"), "readFadeOpacity", 0, 100, Math.round(display.readFadeOpacity * 100), (v) => {
      display.readFadeOpacity = v / 100;
      pushDisplay();
      replay();
    }, fmtPercent);
    replay = preview(text);

    const layout = panel(right, t("config.box.section"));
    slider(layout, t("config.box.fontScale"), "fontScale", 0.5, 2, 0.1, display.fontScale, (v) => {
      display.fontScale = v;
      pushDisplay();
    }, (v) => t("config.unit.times", { value: v.toFixed(1) }));
    slider(layout, t("config.box.opacity"), "textboxOpacity", 0, 1, 0.05, display.textboxOpacity, (v) => {
      display.textboxOpacity = v;
      pushDisplay();
    }, (v) => fmtPercent(Math.round(v * 100)));
  }

  function renderMessage(left: El, right: El): void {
    const unread = panel(left, t("config.unread.section"));
    slider(unread, t("config.speed"), "textSpeedUnread", 0, 100, 1, display.textSpeedUnread, (v) => {
      display.textSpeedUnread = v;
      pushDisplay();
    }, fmtMsPerChar);
    check(unread, t("config.wholePage"), "instantUnreadPage", display.instantUnreadPage, (v) => {
      display.instantUnreadPage = v;
      pushDisplay();
    });

    const read = panel(left, t("config.read.section"));
    slider(read, t("config.speed"), "textSpeedRead", 0, 100, 1, display.textSpeedRead, (v) => {
      display.textSpeedRead = v;
      pushDisplay();
    }, fmtMsPerChar);
    check(read, t("config.wholePage"), "instantReadPage", display.instantReadPage, (v) => {
      display.instantReadPage = v;
      pushDisplay();
    });

    const auto = panel(left, t("config.auto.section"));
    slider(auto, t("config.auto.pageDelay"), "autoPageDelay", 0, 6000, 100, display.autoPageDelay, (v) => {
      display.autoPageDelay = v;
      pushDisplay();
    }, fmtMs);
    slider(auto, t("config.auto.lineDelay"), "autoLineDelay", 0, 6000, 100, display.autoLineDelay, (v) => {
      display.autoLineDelay = v;
      pushDisplay();
    }, fmtMs);
    toggles(auto, t("config.auto.click"), "autoClick", [
      { value: "skip", label: t("config.auto.clickSkip") },
      { value: "cancel", label: t("config.auto.clickCancel") },
    ], display.autoClick, (v) => {
      display.autoClick = v;
      pushDisplay();
    });

    const skipping = panel(right, t("config.skip.section"));
    toggles(skipping, t("config.skip.autoSkipRead"), "autoSkipRead", [
      { value: "off", label: t("config.skip.off") },
      { value: "on", label: t("config.skip.on") },
    ], display.autoSkipRead ? "on" : "off", (v) => {
      display.autoSkipRead = v === "on";
      pushDisplay();
    });
    check(skipping, t("config.skip.confirm"), "autoSkipConfirm", display.autoSkipConfirm, (v) => {
      display.autoSkipConfirm = v;
      pushDisplay();
    });
    toggles(skipping, t("config.skip.fastKey"), "fastForwardKey", [
      { value: "enter", label: t("config.skip.keyEnter") },
      { value: "shift", label: t("config.skip.keyShift") },
      { value: "ctrl", label: t("config.skip.keyCtrl") },
    ], display.fastForwardKey, (v) => {
      display.fastForwardKey = v;
      pushDisplay();
    });
    toggles(skipping, t("config.skip.scope"), "fastForwardScope", [
      { value: "all", label: t("config.skip.scopeAll") },
      { value: "read", label: t("config.skip.scopeRead") },
    ], display.fastForwardScope, (v) => {
      display.fastForwardScope = v;
      pushDisplay();
    });
    check(skipping, t("config.skip.skipUnread"), "skipUnread", skipUnread, (v) => {
      skipUnread = v;
      updateView();
      commands.updateSettings({ skipUnread: v });
    });

    const font = panel(right, t("config.font.section"));
    select(font, t("config.font.family"), "fontFamily", [
      { value: "", label: t("config.font.default") },
      { value: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif', label: t("config.font.serifJa") },
      { value: '"Noto Sans JP", "Hiragino Sans", sans-serif', label: t("config.font.sansSerif") },
      { value: "monospace", label: t("config.font.monospace") },
    ], display.fontFamily, (v) => {
      display.fontFamily = v;
      pushDisplay();
    });

    const lang = panel(right, t("config.language.section"));
    select(
      lang,
      t("config.language.label"),
      "language",
      availableLanguages.map((value) => ({ value, label: LANGUAGE_NAMES[value] })),
      language,
      (v) => {
        language = v;
        updateView();
        commands.updateSettings({ language: v });
      },
    );
  }

  function renderSound(left: El, right: El): void {
    const volumeBlock = (
      title: string,
      volumeName: "bgm" | "se" | "system",
      muteName: "bgmMuted" | "seMuted" | "systemMuted",
      withTest: boolean,
    ): void => {
      const p = panel(left, title);
      slider(p, t("config.sound.volume"), volumeName, 0, 100, 5, Math.round(audio[volumeName] * 100), (v) => {
        audio[volumeName] = v / 100;
        pushAudio();
      }, fmtPercent);
      check(p, t("config.sound.mute"), muteName, audio[muteName], (v) => {
        audio[muteName] = v;
        pushAudio();
      });
      if (withTest) {
        const r = h("div", "mh-cfg-row mh-cfg-row-action");
        const b = h("button", "mh-cfg-button mh-ui-test-se", t("config.sound.test"));
        b.type = "button";
        b.addEventListener("click", guard(() => commands.testSe()));
        r.appendChild(b);
        p.appendChild(r);
      }
    };
    volumeBlock(t("config.sound.bgm"), "bgm", "bgmMuted", false);
    volumeBlock(t("config.sound.se"), "se", "seMuted", true);
    volumeBlock(t("config.sound.system"), "system", "systemMuted", false);

    const effects = panel(right, t("config.effects.section"));
    const yesNo = [
      { value: "yes", label: t("common.yes") },
      { value: "no", label: t("common.no") },
    ] as const;
    const effect = (key: "config.effects.instant" | "config.effects.stopAnimations" | "config.effects.clearText" | "config.effects.special", name: "instantEffects" | "stopAnimations" | "clearTextOnPageChange" | "specialEffects"): void => {
      radios(effects, t(key), name, yesNo, display[name] ? "yes" : "no", (v) => {
        display[name] = v === "yes";
        pushDisplay();
      });
    };
    effect("config.effects.instant", "instantEffects");
    effect("config.effects.stopAnimations", "stopAnimations");
    effect("config.effects.clearText", "clearTextOnPageChange");
    effect("config.effects.special", "specialEffects");
  }

  function renderShortcuts(wide: El): void {
    const keys = panel(wide, t("config.shortcuts.section"), "mh-cfg-panel-wide");
    keys.appendChild(h("p", "mh-cfg-hint", t("config.shortcuts.hint")));
    const grid = h("div", "mh-cfg-keygrid");
    for (const definition of SHORTCUT_DEFINITIONS) {
      keyRow(grid, definition.id, t(`shortcut.${definition.id}`), () => renderTab(`[data-action="${definition.id}"]`));
    }
    keys.appendChild(grid);
  }

  /** Reconstruit le corps pour l'onglet courant ; `refocus` redonne le focus à un contrôle (après une capture). */
  function renderTab(refocus?: string): void {
    for (const [id, b] of tabButtons) {
      const on = id === tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    heading.textContent = tabDeco[tab];
    body.setAttribute("aria-labelledby", `mh-cfg-${screenId}-tab-${tab}`);
    body.dataset.panel = tab;
    body.replaceChildren();
    if (tab === "shortcuts") {
      const wide = column("mh-cfg-col-wide");
      renderShortcuts(wide);
      body.appendChild(wide);
    } else {
      const left = column("mh-cfg-col-left");
      const right = column("mh-cfg-col-right");
      if (tab === "system") renderSystem(left, right);
      else if (tab === "message") renderMessage(left, right);
      else renderSound(left, right);
      body.append(left, right);
    }
    if (refocus) body.querySelector<HTMLElement>(refocus)?.focus();
  }

  renderTab();

  return {
    element: root,
    focusActiveTab: () => tabButtons.get(tab)?.focus({ preventScroll: true }),
  };
}
