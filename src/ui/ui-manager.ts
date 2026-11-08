import { WINDOW_SIZE_OPTIONS } from "@/core/display.js";
import {
  actionForEvent,
  bindingFromEvent,
  cloneShortcuts,
  defaultShortcuts,
  formatBinding,
  SHORTCUT_DEFINITIONS,
  type ShortcutAction,
} from "@/core/shortcuts.js";
import type { Ms } from "@/kag/events.js";
import type {
  BacklogEntry,
  GameLanguage,
  GameSettings,
  OverlayScreen,
  PlayerCommands,
  PlayerStatus,
  SaveSlot,
  ScriptProgress,
  ScriptSummary,
  SlotId,
  UIManager,
  UIView,
} from "@/ui/types.js";
import { getUiLanguage, LANGUAGE_NAMES, onUiLanguageChange, t, uiLocale } from "@/ui/i18n.js";
import { ToastStack } from "@/ui/toast.js";
import "./ui-manager.css";

/** Taille logique du viewport, utilisée pour positionner le flowchart. */
const LOGICAL_W = 1280;
const LOGICAL_H = 720;

const DEFAULT_STATUS: PlayerStatus = {
  mode: "normal",
  inGame: false,
  userHidden: false,
  canRollback: false,
  quickMenuLocked: false,
  autoPaused: false,
  mouseMode: "menu",
  autoHideCursor: false,
  fastForwardKey: "shift",
  shortcuts: defaultShortcuts(),
};

type SettingsTab = "system" | "message" | "sound" | "shortcuts";

type El = HTMLElement;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function slotKey(id: SlotId): string {
  return String(id);
}

function slotLabel(id: SlotId): string {
  if (id === "quick") return t("slot.quick");
  if (id === "auto") return t("slot.auto");
  return t("slot.numbered", { n: id });
}

/**
 * Implémentation DOM de UIManager.
 *
 * Déclarative : `show(view)` remplace l'écran affiché. Toutes les entrées
 * utilisateur sont traduites en appels `PlayerCommands`.
 */
export class DomUIManager implements UIManager {
  private root: El | null = null;
  private commands: PlayerCommands | null = null;

  private overlay!: El;
  private menu!: El;
  private flowchart!: El;
  private pause!: El;
  private choicesEl!: El;
  private toasts: ToastStack | null = null;
  private loading!: El;
  private statusEl!: El;
  private confirmEl: El | null = null;
  private ownsOverlay = false;

  private view: UIView = { screen: "game" };
  private status: PlayerStatus = { ...DEFAULT_STATUS };
  private settings: GameSettings | null = null;
  private choiceCount = 0;
  private inputEnabled = true;

  private ctrlSkip = false;
  private modeBeforeCtrl: PlayerStatus["mode"] = "normal";
  private settingsTab: SettingsTab = "system";
  private capturing: { action: ShortcutAction; index: number } | null = null;
  private captureApply: ((binding: string) => void) | null = null;
  private cursorTimer: ReturnType<typeof setTimeout> | undefined;

  private pendingConfirm: ((v: boolean) => void) | null = null;
  private cleanups: (() => void)[] = [];
  private previousDocumentLang: string | null = null;

  // ── Cycle de vie ──

  init(root: HTMLElement, commands: PlayerCommands): void {
    if (this.root) this.dispose();
    this.root = root;
    this.commands = commands;

    const existing = root.querySelector<HTMLElement>("#ui-overlay");
    this.ownsOverlay = !existing;
    this.overlay = existing ?? h("div");
    this.overlay.id = "ui-overlay";
    this.overlay.classList.add("mh-ui-overlay");
    this.applyLang();
    this.overlay.replaceChildren();
    this.menu = this.slot("ui-menu", "mh-ui-menu");
    this.flowchart = this.slot("ui-flowchart", "mh-ui-flowchart");
    this.pause = this.slot("ui-pause", "mh-ui-pause");
    this.choicesEl = this.slot("ui-choices", "mh-ui-choices");
    this.toasts = new ToastStack(this.slot("ui-toast", "mh-ui-toast"));
    this.loading = this.slot("ui-loading", "mh-ui-loading");
    this.statusEl = h("div", "mh-ui-status");
    this.overlay.appendChild(this.statusEl);
    this.loading.hidden = true;
    if (!existing) root.appendChild(this.overlay);

    this.listen(this.overlay, "click", (e) => this.onClick(e as MouseEvent));
    this.listen(this.overlay, "contextmenu", (e) => this.onContextMenu(e as MouseEvent));
    this.listen(this.overlay, "wheel", (e) => this.onWheel(e as WheelEvent));
    this.listen(document, "keydown", (e) => this.onKeyDown(e as KeyboardEvent));
    this.listen(document, "keyup", (e) => this.onKeyUp(e as KeyboardEvent));
    this.listen(document, "mousemove", () => this.resetCursorTimer());
    this.listen(window, "blur", () => this.releaseCtrlSkip());
    // Changement de langue : on pose `lang` et on redessine l'écran courant dans la nouvelle langue.
    this.cleanups.push(
      onUiLanguageChange(() => {
        this.applyLang();
        this.show(this.view);
      }),
    );

    this.show(this.view);
    this.renderStatus();
  }

  dispose(): void {
    for (const off of this.cleanups) off();
    this.cleanups = [];
    this.toasts?.dispose();
    this.toasts = null;
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    this.resolveConfirm(false);
    if (this.root) {
      this.overlay.replaceChildren();
      this.overlay.classList.remove("mh-ui-overlay", "mh-ui-user-hidden", "mh-ui-disabled");
      this.overlay.removeAttribute("lang");
      if (this.previousDocumentLang !== null) document.documentElement.lang = this.previousDocumentLang;
      this.previousDocumentLang = null;
      if (this.ownsOverlay) this.overlay.remove();
    }
    this.root = null;
    this.commands = null;
    this.ctrlSkip = false;
    this.choiceCount = 0;
    this.status = { ...DEFAULT_STATUS };
  }

  // ── API UIManager ──

  show(view: UIView): void {
    this.view = view;
    if (!this.root) return;
    this.menu.replaceChildren();
    this.flowchart.replaceChildren();
    this.pause.replaceChildren();
    this.menu.classList.toggle("mh-ui-settings-open", view.screen === "settings");
    this.overlay.dataset.screen = view.screen;

    switch (view.screen) {
      case "game":
        break;
      case "title":
        this.menu.appendChild(this.renderTitle(view.scripts, view.hasContinue));
        break;
      case "pause":
        this.pause.appendChild(this.renderPause());
        break;
      case "save":
      case "load":
        this.menu.appendChild(this.renderSlots(view.screen, view.slots));
        break;
      case "settings":
        this.settings = view.settings;
        this.menu.appendChild(this.renderSettings(view.settings, view.availableLanguages));
        break;
      case "backlog":
        this.menu.appendChild(this.renderBacklog(view.entries));
        break;
      case "flowchart":
        this.flowchart.appendChild(this.renderFlowchart(view.scripts, view.progress));
        break;
    }
    this.renderStatus();
  }

  setStatus(status: Readonly<PlayerStatus>): void {
    this.status = { ...status };
    // Le player fait foi : si le mode revient à autre chose que skip, le Ctrl temporaire est caduc.
    if (this.ctrlSkip && status.mode !== "skip") this.ctrlSkip = false;
    this.renderStatus();
    this.resetCursorTimer();
  }

  /** Masquage automatique du curseur après 2 s d'inactivité en jeu (#177). */
  private resetCursorTimer(): void {
    if (!this.overlay) return;
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    this.overlay.classList.remove("mh-ui-cursor-hidden");
    if (!this.status.autoHideCursor || this.view.screen !== "game") return;
    this.cursorTimer = setTimeout(() => {
      if (this.status.autoHideCursor && this.view.screen === "game") {
        this.overlay.classList.add("mh-ui-cursor-hidden");
      }
    }, 2000);
  }

  showChoices(options: readonly string[]): void {
    if (!this.root) return;
    this.choicesEl.replaceChildren();
    this.choiceCount = options.length;
    options.forEach((label, i) => {
      const btn = h("button", "mh-ui-choice", label);
      btn.type = "button";
      btn.dataset.index = String(i);
      btn.addEventListener("click", () => this.choose(i));
      this.choicesEl.appendChild(btn);
    });
    this.renderStatus();
  }

  hideChoices(): void {
    this.choiceCount = 0;
    if (!this.root) return;
    this.choicesEl.replaceChildren();
    this.renderStatus();
  }

  confirm(message: string): Promise<boolean> {
    if (!this.root) return Promise.resolve(false);
    this.resolveConfirm(false);
    return new Promise<boolean>((resolve) => {
      this.pendingConfirm = resolve;
      const box = h("div", "mh-ui-confirm mh-ui-panel");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      const dialog = h("div", "mh-ui-confirm-box");
      dialog.appendChild(h("p", "mh-ui-confirm-message", message));
      const row = h("div", "mh-ui-row");
      const no = this.button(t("common.no"), () => this.resolveConfirm(false), "mh-ui-confirm-no");
      const yes = this.button(t("common.yes"), () => this.resolveConfirm(true), "mh-ui-confirm-yes");
      row.append(no, yes);
      dialog.appendChild(row);
      box.appendChild(dialog);
      this.confirmEl = box;
      this.overlay.appendChild(box);
      yes.focus();
    });
  }

  toast(message: string, duration?: Ms): void {
    if (!this.root) return;
    this.toasts?.show(message, duration);
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (!this.root) return;
    this.loading.hidden = enabled;
    this.overlay.classList.toggle("mh-ui-disabled", !enabled);
    if (!enabled) this.releaseCtrlSkip(false);
  }

  // ── Helpers internes ──

  /** Pose `lang` sur la racine de l'interface et sur le document (lecteurs d'écran, césure, polices CJK). */
  private applyLang(): void {
    const lang = getUiLanguage();
    this.overlay.lang = lang;
    if (this.previousDocumentLang === null) this.previousDocumentLang = document.documentElement.lang;
    document.documentElement.lang = lang;
  }

  private slot(id: string, cls: string): El {
    const el = h("div", cls);
    el.id = id;
    this.overlay.appendChild(el);
    return el;
  }

  private listen(
    target: EventTarget,
    type: string,
    handler: (e: Event) => void,
  ): void {
    target.addEventListener(type, handler);
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }

  private button(label: string, onClick: () => void, cls = ""): HTMLButtonElement {
    const btn = h("button", `mh-ui-button ${cls}`.trim(), label);
    btn.type = "button";
    btn.addEventListener("click", () => {
      if (this.inputEnabled) onClick();
    });
    return btn;
  }

  private panel(title: string, cls: string): El {
    const p = h("section", `mh-ui-panel ${cls}`);
    p.appendChild(h("h2", "mh-ui-title", title));
    return p;
  }

  private backButton(): HTMLButtonElement {
    return this.button(t("common.back"), () => this.commands?.closeScreen(), "mh-ui-back");
  }

  private resolveConfirm(value: boolean): void {
    const resolve = this.pendingConfirm;
    this.pendingConfirm = null;
    this.confirmEl?.remove();
    this.confirmEl = null;
    resolve?.(value);
  }

  private choose(index: number): void {
    if (!this.inputEnabled || !this.commands) return;
    this.commands.choose(index);
  }

  private renderStatus(): void {
    if (!this.root) return;
    const inGame = this.view.screen === "game";
    const hidden = this.status.userHidden && inGame;
    this.overlay.classList.toggle("mh-ui-user-hidden", hidden);
    this.choicesEl.hidden = hidden;

    this.statusEl.replaceChildren();
    this.statusEl.hidden = !inGame || hidden;
    if (this.status.mode !== "normal") {
      // Auto suspendu par le script : le choix du joueur reste affiché, marqué « en pause ».
      const suspended = this.status.mode === "auto" && this.status.autoPaused;
      const badge = h(
        "span",
        `mh-ui-badge mh-ui-badge-${this.status.mode}${suspended ? " mh-ui-badge-suspended" : ""}`,
        suspended ? t("status.autoPaused") : t(this.status.mode === "auto" ? "status.auto" : "status.skip"),
      );
      this.statusEl.appendChild(badge);
    }
    // Menu rapide verrouillé : Sauvegarder et Charger du menu pause ne sont plus utilisables.
    for (const btn of this.overlay.querySelectorAll<HTMLButtonElement>("[data-quick-menu]")) {
      btn.disabled = this.status.quickMenuLocked;
      btn.title = this.status.quickMenuLocked ? t("pause.quickMenuLocked") : "";
    }
    if (inGame && this.status.canRollback) {
      this.statusEl.appendChild(h("span", "mh-ui-badge mh-ui-badge-rollback", "↶"));
    }
  }

  // ── Écrans ──

  private renderTitle(scripts: readonly ScriptSummary[], hasContinue: boolean): El {
    const p = this.panel(t("common.gameTitle"), "mh-ui-title-screen");
    const menu = h("div", "mh-ui-col");
    const first = scripts[0];
    if (first) {
      menu.appendChild(this.button(t("title.newGame"), () => this.commands?.startScript(first.file), "mh-ui-new-game"));
    }
    if (hasContinue) {
      menu.appendChild(this.button(t("title.continue"), () => void this.commands?.load("auto"), "mh-ui-continue"));
    }
    menu.append(
      this.button(t("title.load"), () => this.commands?.openScreen("load")),
      this.button(t("title.settings"), () => this.commands?.openScreen("settings")),
      this.button(t("title.flowchart"), () => this.commands?.openScreen("flowchart")),
    );
    p.appendChild(menu);

    const list = h("ul", "mh-ui-scripts");
    for (const s of scripts) {
      const li = h("li");
      const btn = this.button(s.label, () => this.commands?.startScript(s.file), "mh-ui-script");
      btn.dataset.file = s.file;
      li.appendChild(btn);
      list.appendChild(li);
    }
    p.appendChild(list);
    return p;
  }

  private renderPause(): El {
    const p = this.panel(t("pause.title"), "mh-ui-pause-screen");
    const col = h("div", "mh-ui-col");
    const open = (s: OverlayScreen) => () => this.commands?.openScreen(s);
    // Sauvegarder et Charger appartiennent au menu rapide : verrouillés par @lockquickmenu.
    const quick = (label: string, screen: OverlayScreen): El => {
      const btn = this.button(label, open(screen));
      btn.dataset.quickMenu = screen;
      btn.disabled = this.status.quickMenuLocked;
      if (btn.disabled) btn.title = t("pause.quickMenuLocked");
      return btn;
    };
    col.append(
      this.button(t("pause.resume"), () => this.commands?.closeScreen(), "mh-ui-resume"),
      quick(t("pause.save"), "save"),
      quick(t("pause.load"), "load"),
      this.button(t("pause.settings"), open("settings")),
      this.button(t("pause.history"), open("backlog")),
      this.button(t("pause.flowchart"), open("flowchart")),
      this.button(
        t("pause.returnToTitle"),
        () =>
          void this.confirm(t("confirm.returnToTitle")).then(
            (ok) => {
              if (ok) this.commands?.returnToTitle();
            },
          ),
        "mh-ui-to-title",
      ),
    );
    p.appendChild(col);
    return p;
  }

  private renderSlots(mode: "save" | "load", slots: readonly SaveSlot[]): El {
    const p = this.panel(mode === "save" ? t("slots.saveTitle") : t("slots.loadTitle"), `mh-ui-slots-screen mh-ui-${mode}`);
    const grid = h("div", "mh-ui-slots");
    for (const slot of slots) {
      const card = h("div", "mh-ui-slot");
      card.dataset.slot = slotKey(slot.id);
      card.appendChild(h("div", "mh-ui-slot-label", slotLabel(slot.id)));

      const d = slot.data;
      if (d) {
        if (d.thumbnailUrl) {
          const img = h("img", "mh-ui-slot-thumb");
          img.src = d.thumbnailUrl;
          img.alt = "";
          card.appendChild(img);
        }
        card.appendChild(h("div", "mh-ui-slot-date", new Date(d.timestamp).toLocaleString(uiLocale())));
        card.appendChild(h("div", "mh-ui-slot-preview", d.previewText));
      } else {
        card.classList.add("mh-ui-slot-empty");
        card.appendChild(h("div", "mh-ui-slot-preview", t("slot.empty")));
      }

      const row = h("div", "mh-ui-row");
      if (mode === "save") {
        row.appendChild(
          this.button(t("slot.saveHere"), () => void this.saveInto(slot), "mh-ui-slot-action"),
        );
      } else {
        const load = this.button(t("slot.load"), () => void this.commands?.load(slot.id), "mh-ui-slot-action");
        load.disabled = !d;
        row.appendChild(load);
      }
      if (d) {
        row.appendChild(
          this.button(t("slot.delete"), () => void this.deleteSlot(slot.id), "mh-ui-slot-delete"),
        );
      }
      card.appendChild(row);
      grid.appendChild(card);
    }
    p.append(grid, this.backButton());
    return p;
  }

  private async saveInto(slot: SaveSlot): Promise<void> {
    if (slot.data && !(await this.confirm(t("slot.confirmOverwrite", { name: slotLabel(slot.id) })))) return;
    await this.commands?.save(slot.id);
  }

  private async deleteSlot(id: SlotId): Promise<void> {
    if (await this.confirm(t("slot.confirmDelete", { name: slotLabel(id) }))) await this.commands?.deleteSave(id);
  }

  private renderSettings(settings: Readonly<GameSettings>, availableLanguages: readonly GameLanguage[]): El {
    const p = h("section", "mh-ui-panel mh-ui-settings-screen");
    const header = h("header", "mh-ui-config-header");
    const brand = h("div", "mh-ui-config-brand");
    brand.append(h("h2", "mh-ui-title", t("config.title")), h("p", "mh-ui-config-subtitle", t("config.subtitle")));
    header.appendChild(brand);
    const tabs = h("nav", "mh-ui-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", t("config.tabsLabel"));
    const content = h("div", "mh-ui-config");
    content.setAttribute("role", "tabpanel");
    // Copies locales : `Partial<GameSettings>` est superficiel, on renvoie les groupes entiers.
    const display = { ...settings.display };
    const audio = { ...settings.audio };
    const shortcuts = cloneShortcuts(settings.shortcuts);
    let language = settings.language;
    let skipUnread = settings.skipUnread;
    const updateView = () => {
      this.view = {
        screen: "settings",
        settings: {
          ...settings,
          display: { ...display },
          audio: { ...audio },
          shortcuts: cloneShortcuts(shortcuts),
          language,
          skipUnread,
        },
        availableLanguages,
      };
    };
    const pushDisplay = () => {
      updateView();
      this.commands?.updateSettings({ display: { ...display } });
    };
    const pushAudio = () => {
      updateView();
      this.commands?.updateSettings({ audio: { ...audio } });
    };
    const pushShortcuts = () => {
      updateView();
      this.commands?.updateSettings({ shortcuts: cloneShortcuts(shortcuts) });
    };
    const refresh = () => this.show(this.view);

    const tabDefs: readonly [SettingsTab, string][] = [
      ["system", t("config.tab.system")],
      ["message", t("config.tab.message")],
      ["sound", t("config.tab.sound")],
      ["shortcuts", t("config.tab.shortcuts")],
    ];
    for (const [id, label] of tabDefs) {
      const tab = this.button(label, () => {
        updateView();
        this.settingsTab = id;
        this.show(this.view);
      }, "mh-ui-tab");
      tab.dataset.tab = id;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(id === this.settingsTab));
      if (id === this.settingsTab) tab.classList.add("active");
      tabs.appendChild(tab);
    }
    header.appendChild(tabs);
    p.appendChild(header);
    const currentLabel = tabDefs.find(([id]) => id === this.settingsTab)?.[1] ?? "";
    content.appendChild(h("div", "mh-ui-config-heading", currentLabel));

    const section = (title: string): El => {
      const s = h("section", "mh-ui-config-section");
      s.appendChild(h("h3", "mh-ui-config-title", title));
      content.appendChild(s);
      return s;
    };
    const field = (parent: El, label: string): El => {
      const row = h("div", "mh-ui-field");
      row.appendChild(h("span", "mh-ui-field-label", label));
      parent.appendChild(row);
      return row;
    };
    const segmented = <T extends string>(
      parent: El,
      label: string,
      name: string,
      options: readonly { value: T; label: string }[],
      value: T,
      onChange: (v: T) => void,
    ) => {
      const row = field(parent, label);
      const group = h("div", "mh-ui-segments");
      const buttons: HTMLButtonElement[] = [];
      for (const option of options) {
        const b = this.button(option.label, () => {
          onChange(option.value);
          for (const other of buttons) other.classList.toggle("active", other === b);
        }, "mh-ui-segment");
        b.name = name;
        b.dataset.value = option.value;
        if (option.value === value) b.classList.add("active");
        buttons.push(b);
        group.appendChild(b);
      }
      row.appendChild(group);
    };
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
    ) => {
      const row = field(parent, label);
      row.classList.add("mh-ui-field-slider");
      const labelEl = row.querySelector<HTMLElement>(".mh-ui-field-label");
      const output = h("span", "mh-ui-field-value", format(value));
      labelEl?.appendChild(output);
      const input = h("input");
      input.type = "range";
      input.name = name;
      input.setAttribute("aria-label", label);
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      input.addEventListener("input", () => {
        if (!this.inputEnabled) return;
        const v = Number(input.value);
        output.textContent = format(v);
        onInput(v);
      });
      const controls = h("div", "mh-ui-range");
      controls.append(h("span", "mh-ui-range-mark", "−"), input, h("span", "mh-ui-range-mark", "+"));
      row.appendChild(controls);
    };
    const check = (parent: El, label: string, name: string, value: boolean, onChange: (v: boolean) => void) => {
      const row = h("label", "mh-ui-field mh-ui-field-check");
      const input = h("input");
      input.type = "checkbox";
      input.name = name;
      input.checked = value;
      input.addEventListener("change", () => {
        if (this.inputEnabled) onChange(input.checked);
      });
      row.append(h("span", "mh-ui-field-label", label), input);
      parent.appendChild(row);
    };
    const yesNo = (parent: El, label: string, name: string, value: boolean, onChange: (v: boolean) => void) => {
      segmented(parent, label, name, [{ value: "yes", label: t("common.yes") }, { value: "no", label: t("common.no") }], value ? "yes" : "no", (v) => onChange(v === "yes"));
    };
    const select = <T extends string>(
      parent: El,
      label: string,
      name: string,
      options: readonly { value: T; label: string }[],
      value: T,
      onChange: (v: T) => void,
    ) => {
      const row = field(parent, label);
      const el = h("select");
      el.name = name;
      el.setAttribute("aria-label", label);
      for (const option of options) {
        const o = h("option", undefined, option.label);
        o.value = option.value;
        el.appendChild(o);
      }
      el.value = value;
      el.addEventListener("change", () => {
        if (this.inputEnabled) onChange(el.value as T);
      });
      row.appendChild(el);
    };
    const keyRow = (parent: El, action: ShortcutAction, label: string) => {
      const row = h("div", "mh-ui-shortcut-row");
      row.appendChild(h("span", "mh-ui-shortcut-label", label));
      const keys = h("div", "mh-ui-shortcut-keys");
      for (let index = 0; index < 2; index++) {
        const b = this.button(formatBinding(shortcuts[action][index] ?? ""), () => {
          this.capturing = { action, index };
          this.captureApply = (binding) => {
            shortcuts[action][index] = binding;
            pushShortcuts();
            refresh();
          };
          b.textContent = t("config.shortcuts.capturing");
          b.classList.add("capturing");
        }, "mh-ui-key");
        b.dataset.action = action;
        b.dataset.index = String(index);
        keys.appendChild(b);
      }
      row.appendChild(keys);
      parent.appendChild(row);
    };

    const fmtMs = (v: number) => t("config.unit.ms", { value: v });
    const fmtPercent = (v: number) => t("config.unit.percent", { value: v });
    const fmtMsPerChar = (v: number) => t("config.unit.msPerChar", { value: v });

    if (this.settingsTab === "system") {
      const screen = section(t("config.screen.section"));
      const fullscreenRow = h("div", "mh-ui-field");
      fullscreenRow.appendChild(this.button(t("config.screen.fullscreenButton"), () => this.commands?.toggleFullscreen(), "mh-ui-fullscreen"));
      screen.appendChild(fullscreenRow);
      segmented(screen, t("config.screen.fullscreen"), "fullscreenMode", [
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

      const text = section(t("config.textFx.section"));
      segmented(text, t("config.textFx.display"), "textAnimation", [
        { value: "fade", label: t("config.textFx.on") },
        { value: "none", label: t("config.textFx.off") },
      ], display.textAnimation, (v) => {
        display.textAnimation = v;
        pushDisplay();
      });
      segmented(text, t("config.textFx.read"), "readFade", [
        { value: "fade", label: t("config.textFx.readFade") },
        { value: "none", label: t("config.textFx.off") },
      ], display.readFade ? "fade" : "none", (v) => {
        display.readFade = v === "fade";
        pushDisplay();
      });
      slider(text, t("config.textFx.fadeDuration"), "readFadeDuration", 0, 3000, 100, display.readFadeDuration, (v) => {
        display.readFadeDuration = v;
        pushDisplay();
      }, fmtMs);
      slider(text, t("config.textFx.readOpacity"), "readFadeOpacity", 0, 100, 5, Math.round(display.readFadeOpacity * 100), (v) => {
        display.readFadeOpacity = v / 100;
        pushDisplay();
      }, fmtPercent);

      const mouse = section(t("config.mouse.section"));
      segmented(mouse, t("config.mouse.rightClick"), "mouseMode", [
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

      const layout = section(t("config.box.section"));
      slider(layout, t("config.box.fontScale"), "fontScale", 0.5, 2, 0.1, display.fontScale, (v) => {
        display.fontScale = v;
        pushDisplay();
      }, (v) => t("config.unit.times", { value: v.toFixed(1) }));
      slider(layout, t("config.box.opacity"), "textboxOpacity", 0, 1, 0.05, display.textboxOpacity, (v) => {
        display.textboxOpacity = v;
        pushDisplay();
      }, (v) => fmtPercent(Math.round(v * 100)));
    } else if (this.settingsTab === "message") {
      const unread = section(t("config.unread.section"));
      slider(unread, t("config.speed"), "textSpeedUnread", 0, 100, 1, display.textSpeedUnread, (v) => {
        display.textSpeedUnread = v;
        pushDisplay();
      }, fmtMsPerChar);
      check(unread, t("config.wholePage"), "instantUnreadPage", display.instantUnreadPage, (v) => {
        display.instantUnreadPage = v;
        pushDisplay();
      });

      const read = section(t("config.read.section"));
      slider(read, t("config.speed"), "textSpeedRead", 0, 100, 1, display.textSpeedRead, (v) => {
        display.textSpeedRead = v;
        pushDisplay();
      }, fmtMsPerChar);
      check(read, t("config.wholePage"), "instantReadPage", display.instantReadPage, (v) => {
        display.instantReadPage = v;
        pushDisplay();
      });

      const auto = section(t("config.auto.section"));
      slider(auto, t("config.auto.pageDelay"), "autoPageDelay", 0, 6000, 100, display.autoPageDelay, (v) => {
        display.autoPageDelay = v;
        pushDisplay();
      }, fmtMs);
      slider(auto, t("config.auto.lineDelay"), "autoLineDelay", 0, 6000, 100, display.autoLineDelay, (v) => {
        display.autoLineDelay = v;
        pushDisplay();
      }, fmtMs);
      segmented(auto, t("config.auto.click"), "autoClick", [
        { value: "skip", label: t("config.auto.clickSkip") },
        { value: "cancel", label: t("config.auto.clickCancel") },
      ], display.autoClick, (v) => {
        display.autoClick = v;
        pushDisplay();
      });

      const skipping = section(t("config.skip.section"));
      segmented(skipping, t("config.skip.autoSkipRead"), "autoSkipRead", [
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
      segmented(skipping, t("config.skip.fastKey"), "fastForwardKey", [
        { value: "enter", label: t("config.skip.keyEnter") },
        { value: "shift", label: t("config.skip.keyShift") },
        { value: "ctrl", label: t("config.skip.keyCtrl") },
      ], display.fastForwardKey, (v) => {
        display.fastForwardKey = v;
        pushDisplay();
      });
      segmented(skipping, t("config.skip.scope"), "fastForwardScope", [
        { value: "all", label: t("config.skip.scopeAll") },
        { value: "read", label: t("config.skip.scopeRead") },
      ], display.fastForwardScope, (v) => {
        display.fastForwardScope = v;
        pushDisplay();
      });
      check(skipping, t("config.skip.skipUnread"), "skipUnread", skipUnread, (v) => {
        skipUnread = v;
        updateView();
        this.commands?.updateSettings({ skipUnread: v });
      });

      const font = section(t("config.font.section"));
      select(font, t("config.font.family"), "fontFamily", [
        { value: "", label: t("config.font.default") },
        { value: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif', label: t("config.font.serifJa") },
        { value: '"Noto Sans JP", "Hiragino Sans", sans-serif', label: t("config.font.sansSerif") },
        { value: "monospace", label: t("config.font.monospace") },
      ], display.fontFamily, (v) => {
        display.fontFamily = v;
        pushDisplay();
      });

      const languageSection = section(t("config.language.section"));
      select(
        languageSection,
        t("config.language.label"),
        "language",
        availableLanguages.map((value) => ({ value, label: LANGUAGE_NAMES[value] })),
        language,
        (v) => {
          language = v;
          updateView();
          this.commands?.updateSettings({ language: v });
        },
      );
    } else if (this.settingsTab === "sound") {
      const bgm = section(t("config.sound.bgm"));
      slider(bgm, t("config.sound.volume"), "bgm", 0, 100, 5, Math.round(audio.bgm * 100), (v) => {
        audio.bgm = v / 100;
        pushAudio();
      }, fmtPercent);
      check(bgm, t("config.sound.mute"), "bgmMuted", audio.bgmMuted, (v) => {
        audio.bgmMuted = v;
        pushAudio();
      });

      const se = section(t("config.sound.se"));
      slider(se, t("config.sound.volume"), "se", 0, 100, 5, Math.round(audio.se * 100), (v) => {
        audio.se = v / 100;
        pushAudio();
      }, fmtPercent);
      check(se, t("config.sound.mute"), "seMuted", audio.seMuted, (v) => {
        audio.seMuted = v;
        pushAudio();
      });
      const testRow = h("div", "mh-ui-field mh-ui-field-action");
      testRow.append(
        h("span", "mh-ui-field-label", ""),
        this.button(t("config.sound.test"), () => this.commands?.testSe(), "mh-ui-test-se"),
      );
      se.appendChild(testRow);

      const system = section(t("config.sound.system"));
      slider(system, t("config.sound.volume"), "system", 0, 100, 5, Math.round(audio.system * 100), (v) => {
        audio.system = v / 100;
        pushAudio();
      }, fmtPercent);
      check(system, t("config.sound.mute"), "systemMuted", audio.systemMuted, (v) => {
        audio.systemMuted = v;
        pushAudio();
      });

      const effects = section(t("config.effects.section"));
      yesNo(effects, t("config.effects.instant"), "instantEffects", display.instantEffects, (v) => {
        display.instantEffects = v;
        pushDisplay();
      });
      yesNo(effects, t("config.effects.stopAnimations"), "stopAnimations", display.stopAnimations, (v) => {
        display.stopAnimations = v;
        pushDisplay();
      });
      yesNo(effects, t("config.effects.clearText"), "clearTextOnPageChange", display.clearTextOnPageChange, (v) => {
        display.clearTextOnPageChange = v;
        pushDisplay();
      });
      yesNo(effects, t("config.effects.special"), "specialEffects", display.specialEffects, (v) => {
        display.specialEffects = v;
        pushDisplay();
      });
    } else {
      const keys = section(t("config.shortcuts.section"));
      keys.classList.add("mh-ui-shortcuts-section");
      keys.appendChild(
        h("p", "mh-ui-hint", t("config.shortcuts.hint")),
      );
      for (const definition of SHORTCUT_DEFINITIONS) {
        keyRow(keys, definition.id, t(`shortcut.${definition.id}`));
      }
    }

    const footer = h("div", "mh-ui-config-footer");
    footer.append(
      this.backButton(),
      this.button(t("config.reset"), () => this.commands?.resetSettings(), "mh-ui-reset"),
    );
    p.append(content, footer);
    return p;
  }

  private renderBacklog(entries: readonly BacklogEntry[]): El {
    const p = this.panel(t("history.title"), "mh-ui-backlog-screen");
    const list = h("ol", "mh-ui-backlog");
    for (const e of entries) {
      const li = h("li", "mh-ui-backlog-entry", e.text);
      if (e.voice) li.dataset.voice = e.voice;
      list.appendChild(li);
    }
    p.append(list, this.backButton());
    // Dernier texte lu en bas, visible par défaut.
    queueMicrotask(() => {
      list.scrollTop = list.scrollHeight;
    });
    return p;
  }

  private renderFlowchart(scripts: readonly ScriptSummary[], progress: ScriptProgress): El {
    const p = this.panel(t("flowchart.title"), "mh-ui-flowchart-screen");
    const unlocked = new Set(progress.unlocked);
    const completed = new Set(progress.completed);
    const map = h("div", "mh-ui-flow-map");
    for (const s of scripts) {
      const node = this.button(s.label, () => this.commands?.startScript(s.file), "mh-ui-flow-node");
      node.dataset.id = s.id;
      node.title = s.arc;
      node.style.left = `${(s.x / LOGICAL_W) * 100}%`;
      node.style.top = `${(s.y / LOGICAL_H) * 100}%`;
      const isUnlocked = unlocked.has(s.id) || completed.has(s.id);
      node.disabled = !isUnlocked;
      node.classList.toggle("mh-ui-flow-locked", !isUnlocked);
      node.classList.toggle("mh-ui-flow-done", completed.has(s.id));
      map.appendChild(node);
    }
    p.append(map, this.backButton());
    return p;
  }

  // ── Entrées ──

  /** Vrai si l'événement vient d'un élément interactif ou d'un panneau (pas du fond de jeu). */
  private onInteractive(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(".mh-ui-panel, button, input, select, a") !== null;
  }

  private get playing(): boolean {
    return this.view.screen === "game" && this.inputEnabled && this.confirmEl === null;
  }

  private onClick(e: MouseEvent): void {
    if (!this.playing || this.choiceCount > 0 || this.onInteractive(e.target)) return;
    if (e.button !== 0) return;
    this.commands?.advance();
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (!this.playing) return;
    // Réglage d'origine : menu direct, ou masquer le texte puis menu (#177).
    if (this.status.mouseMode === "hideThenMenu" && !this.status.userHidden) {
      this.commands?.toggleUserHide();
      return;
    }
    this.commands?.openScreen("pause");
  }

  private onWheel(e: WheelEvent): void {
    if (!this.playing || this.choiceCount > 0 || e.deltaY === 0) return;
    if (this.onInteractive(e.target)) return;
    if (e.deltaY < 0) this.commands?.rollback();
    else this.commands?.advance();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.commands) return;
    if (this.capturing) {
      this.handleCapture(e);
      return;
    }
    // Une touche maintenue ne doit ni enchaîner les pages, ni faire clignoter une bascule (B1).
    // Ctrl et Shift sont exclus : ils servent à l'avance rapide maintenue.
    if (e.repeat && e.key !== "Control" && e.key !== "Shift") return;
    if (!this.inputEnabled || this.confirmEl) {
      if (e.key === "Escape") this.onEscape();
      return;
    }

    const screen = this.view.screen;
    const inOverlay = screen !== "game" && screen !== "title";
    // Échap ferme toujours un écran superposé, même si le raccourci « menu » a été changé.
    if (e.key === "Escape" && inOverlay) {
      this.onEscape();
      return;
    }

    const field = e.target instanceof Element && e.target.closest("input, select, textarea") !== null;
    if (field) return;

    const shortcuts = screen === "settings" ? this.view.settings.shortcuts : this.status.shortcuts;
    const action = actionForEvent(e, shortcuts);
    if (action) {
      e.preventDefault();
      this.runShortcut(action);
      return;
    }

    // Touche d'avance rapide : termine la frappe en cours (#177).
    if (this.isFastKey(e) && this.commands.hurryText()) {
      e.preventDefault();
      return;
    }
    if (this.isFastKey(e) && e.key !== "Enter") return;

    // Rétrocompatibilité : Ctrl maintenu = skip, sauf s'il est devenu la touche d'avance rapide.
    if (e.key === "Control" && this.status.fastForwardKey !== "ctrl") {
      if (!this.ctrlSkip && screen === "game") {
        this.ctrlSkip = true;
        this.modeBeforeCtrl = this.status.mode;
        if (this.status.mode !== "skip") this.commands.setMode("skip");
      }
      return;
    }

    if (screen !== "game") return;
    const onButton = e.target instanceof Element && e.target.closest("button") !== null;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (this.choiceCount > 0) {
      const n = Number(key);
      if (Number.isInteger(n) && n >= 1 && n <= Math.min(9, this.choiceCount)) this.choose(n - 1);
      return;
    }
    switch (key) {
      case " ":
      case "Enter":
        if (onButton) return; // le navigateur déclenchera le clic du bouton
        e.preventDefault();
        this.commands.advance();
        break;
      case "ArrowLeft":
        e.preventDefault();
        this.commands.rollback();
        break;
    }
  }

  private isFastKey(e: KeyboardEvent): boolean {
    if (this.status.fastForwardKey === "enter") return e.key === "Enter";
    if (this.status.fastForwardKey === "ctrl") return e.key === "Control";
    return e.key === "Shift";
  }

  private handleCapture(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      this.capturing = null;
      this.captureApply = null;
      this.show(this.view);
      return;
    }
    const binding = bindingFromEvent(e);
    if (!binding) return;
    const apply = this.captureApply;
    this.capturing = null;
    this.captureApply = null;
    apply?.(binding);
  }

  private runShortcut(action: ShortcutAction): void {
    if (!this.commands) return;
    const screen = this.view.screen;
    if (screen === "title") {
      if (action !== "fullscreen" && action !== "options") return;
    } else if (screen !== "game" && !["fullscreen", "options", "menu", "history"].includes(action)) {
      return;
    }
    switch (action) {
      case "saveMenu":
        this.commands.openScreen("save");
        break;
      case "loadMenu":
        this.commands.openScreen("load");
        break;
      case "quickSave":
        void this.commands.save("quick");
        break;
      case "quickLoad":
        this.commands.openScreen("load");
        break;
      case "loadLatest":
        void this.commands.load("auto");
        break;
      case "hideText":
        this.commands.toggleUserHide();
        break;
      case "fullscreen":
        this.commands.toggleFullscreen();
        break;
      case "options":
        this.commands.openScreen("settings");
        break;
      case "menu":
        this.commands.openScreen("pause");
        break;
      case "auto":
        this.commands.setMode(this.status.mode === "auto" ? "normal" : "auto");
        break;
      case "advanceRead":
        this.commands.setMode("skip");
        break;
      case "history":
        this.commands.openScreen("backlog");
        break;
      case "returnTitle":
        void this.confirm(t("confirm.returnToTitle")).then((ok) => {
          if (ok) this.commands?.returnToTitle();
        });
        break;
      case "quit":
        window.close();
        if (!window.closed) this.toast(t("toast.closeRefused"));
        break;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.key === "Control") this.releaseCtrlSkip();
  }

  private releaseCtrlSkip(notify = true): void {
    if (!this.ctrlSkip) return;
    this.ctrlSkip = false;
    if (notify && this.status.mode === "skip" && this.modeBeforeCtrl !== "skip") {
      this.commands?.setMode(this.modeBeforeCtrl);
    }
  }

  private onEscape(): void {
    if (this.confirmEl) {
      this.resolveConfirm(false);
      return;
    }
    if (!this.inputEnabled || !this.commands) return;
    const screen = this.view.screen;
    // En jeu, l'ouverture du menu passe par le raccourci configurable « Ouvrir le menu ».
    if (screen !== "game" && screen !== "title") this.commands.closeScreen();
  }
}
