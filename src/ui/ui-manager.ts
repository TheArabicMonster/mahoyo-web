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
import "./ui-manager.css";

const DEFAULT_TOAST_MS: Ms = 2500;
/** Taille logique du viewport, utilisée pour positionner le flowchart. */
const LOGICAL_W = 1280;
const LOGICAL_H = 720;

const DEFAULT_STATUS: PlayerStatus = {
  mode: "normal",
  inGame: false,
  userHidden: false,
  canRollback: false,
};

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
  if (id === "quick") return "Sauvegarde rapide";
  if (id === "auto") return "Sauvegarde auto";
  return `Slot ${id}`;
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
  private toastEl!: El;
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

  private pendingConfirm: ((v: boolean) => void) | null = null;
  private toastTimers = new Set<ReturnType<typeof setTimeout>>();
  private cleanups: (() => void)[] = [];

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
    this.overlay.replaceChildren();
    this.menu = this.slot("ui-menu", "mh-ui-menu");
    this.flowchart = this.slot("ui-flowchart", "mh-ui-flowchart");
    this.pause = this.slot("ui-pause", "mh-ui-pause");
    this.choicesEl = this.slot("ui-choices", "mh-ui-choices");
    this.toastEl = this.slot("ui-toast", "mh-ui-toast");
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
    this.listen(window, "blur", () => this.releaseCtrlSkip());

    this.show(this.view);
    this.renderStatus();
  }

  dispose(): void {
    for (const off of this.cleanups) off();
    this.cleanups = [];
    for (const t of this.toastTimers) clearTimeout(t);
    this.toastTimers.clear();
    this.resolveConfirm(false);
    if (this.root) {
      this.overlay.replaceChildren();
      this.overlay.classList.remove("mh-ui-overlay", "mh-ui-user-hidden", "mh-ui-disabled");
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
      const no = this.button("Non", () => this.resolveConfirm(false), "mh-ui-confirm-no");
      const yes = this.button("Oui", () => this.resolveConfirm(true), "mh-ui-confirm-yes");
      row.append(no, yes);
      dialog.appendChild(row);
      box.appendChild(dialog);
      this.confirmEl = box;
      this.overlay.appendChild(box);
      yes.focus();
    });
  }

  toast(message: string, duration: Ms = DEFAULT_TOAST_MS): void {
    if (!this.root) return;
    const el = h("div", "mh-ui-toast-item", message);
    el.setAttribute("role", "status");
    this.toastEl.appendChild(el);
    const timer = setTimeout(() => {
      this.toastTimers.delete(timer);
      el.remove();
    }, duration);
    this.toastTimers.add(timer);
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (!this.root) return;
    this.loading.hidden = enabled;
    this.overlay.classList.toggle("mh-ui-disabled", !enabled);
    if (!enabled) this.releaseCtrlSkip(false);
  }

  // ── Helpers internes ──

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
    return this.button("Retour", () => this.commands?.closeScreen(), "mh-ui-back");
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
      this.statusEl.appendChild(
        h("span", `mh-ui-badge mh-ui-badge-${this.status.mode}`, this.status.mode.toUpperCase()),
      );
    }
    if (inGame && this.status.canRollback) {
      this.statusEl.appendChild(h("span", "mh-ui-badge mh-ui-badge-rollback", "↶"));
    }
  }

  // ── Écrans ──

  private renderTitle(scripts: readonly ScriptSummary[], hasContinue: boolean): El {
    const p = this.panel("Mahoutsukai no Yoru", "mh-ui-title-screen");
    const menu = h("div", "mh-ui-col");
    const first = scripts[0];
    if (first) {
      menu.appendChild(this.button("Nouvelle partie", () => this.commands?.startScript(first.file), "mh-ui-new-game"));
    }
    if (hasContinue) {
      menu.appendChild(this.button("Continuer", () => void this.commands?.load("auto"), "mh-ui-continue"));
    }
    menu.append(
      this.button("Charger", () => this.commands?.openScreen("load")),
      this.button("Réglages", () => this.commands?.openScreen("settings")),
      this.button("Flowchart", () => this.commands?.openScreen("flowchart")),
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
    const p = this.panel("Pause", "mh-ui-pause-screen");
    const col = h("div", "mh-ui-col");
    const open = (s: OverlayScreen) => () => this.commands?.openScreen(s);
    col.append(
      this.button("Reprendre", () => this.commands?.closeScreen(), "mh-ui-resume"),
      this.button("Sauvegarder", open("save")),
      this.button("Charger", open("load")),
      this.button("Réglages", open("settings")),
      this.button("Historique", open("backlog")),
      this.button("Flowchart", open("flowchart")),
      this.button(
        "Retour au titre",
        () =>
          void this.confirm("Retourner au titre ? La progression non sauvegardée sera perdue.").then(
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
    const p = this.panel(mode === "save" ? "Sauvegarder" : "Charger", `mh-ui-slots-screen mh-ui-${mode}`);
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
        card.appendChild(h("div", "mh-ui-slot-date", new Date(d.timestamp).toLocaleString("fr-FR")));
        card.appendChild(h("div", "mh-ui-slot-preview", d.previewText));
      } else {
        card.classList.add("mh-ui-slot-empty");
        card.appendChild(h("div", "mh-ui-slot-preview", "— vide —"));
      }

      const row = h("div", "mh-ui-row");
      if (mode === "save") {
        row.appendChild(
          this.button("Sauvegarder ici", () => void this.saveInto(slot), "mh-ui-slot-action"),
        );
      } else {
        const load = this.button("Charger", () => void this.commands?.load(slot.id), "mh-ui-slot-action");
        load.disabled = !d;
        row.appendChild(load);
      }
      if (d) {
        row.appendChild(
          this.button("Supprimer", () => void this.deleteSlot(slot.id), "mh-ui-slot-delete"),
        );
      }
      card.appendChild(row);
      grid.appendChild(card);
    }
    p.append(grid, this.backButton());
    return p;
  }

  private async saveInto(slot: SaveSlot): Promise<void> {
    if (slot.data && !(await this.confirm(`Écraser « ${slotLabel(slot.id)} » ?`))) return;
    await this.commands?.save(slot.id);
  }

  private async deleteSlot(id: SlotId): Promise<void> {
    if (await this.confirm(`Supprimer « ${slotLabel(id)} » ?`)) await this.commands?.deleteSave(id);
  }

  private renderSettings(settings: Readonly<GameSettings>, availableLanguages: readonly GameLanguage[]): El {
    const p = this.panel("Réglages", "mh-ui-settings-screen");
    const form = h("div", "mh-ui-form");
    // Copies locales : `Partial<GameSettings>` est superficiel, on renvoie les groupes entiers.
    const display = { ...settings.display };
    const audio = { ...settings.audio };

    const range = (
      label: string,
      name: string,
      min: number,
      max: number,
      step: number,
      value: number,
      onInput: (v: number) => void,
    ) => {
      const row = h("label", "mh-ui-field");
      row.appendChild(h("span", "mh-ui-field-label", label));
      const input = h("input");
      input.type = "range";
      input.name = name;
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      input.addEventListener("input", () => {
        if (this.inputEnabled) onInput(Number(input.value));
      });
      row.appendChild(input);
      form.appendChild(row);
    };
    const check = (label: string, name: string, value: boolean, onChange: (v: boolean) => void) => {
      const row = h("label", "mh-ui-field");
      const input = h("input");
      input.type = "checkbox";
      input.name = name;
      input.checked = value;
      input.addEventListener("change", () => {
        if (this.inputEnabled) onChange(input.checked);
      });
      row.append(input, h("span", "mh-ui-field-label", label));
      form.appendChild(row);
    };
    const pushAudio = () => this.commands?.updateSettings({ audio: { ...audio } });
    const pushDisplay = () => this.commands?.updateSettings({ display: { ...display } });

    range("Volume général", "master", 0, 1, 0.05, audio.master, (v) => ((audio.master = v), pushAudio()));
    range("Musique", "bgm", 0, 1, 0.05, audio.bgm, (v) => ((audio.bgm = v), pushAudio()));
    range("Effets", "se", 0, 1, 0.05, audio.se, (v) => ((audio.se = v), pushAudio()));
    range("Voix", "voice", 0, 1, 0.05, audio.voice, (v) => ((audio.voice = v), pushAudio()));
    check("Muet", "muted", audio.muted, (v) => ((audio.muted = v), pushAudio()));
    range("Vitesse du texte (ms/caractère)", "textSpeed", 0, 100, 5, display.textSpeed, (v) => ((display.textSpeed = v), pushDisplay()));
    range("Délai auto (ms)", "autoDelay", 0, 5000, 100, display.autoDelay, (v) => ((display.autoDelay = v), pushDisplay()));
    range("Taille du texte", "fontScale", 0.5, 2, 0.1, display.fontScale, (v) => ((display.fontScale = v), pushDisplay()));
    range("Opacité de la boîte de texte", "textboxOpacity", 0, 1, 0.05, display.textboxOpacity, (v) => ((display.textboxOpacity = v), pushDisplay()));
    check("Skip : passer aussi le texte non lu", "skipUnread", settings.skipUnread, (v) =>
      this.commands?.updateSettings({ skipUnread: v }),
    );

    const lang = h("label", "mh-ui-field");
    lang.appendChild(h("span", "mh-ui-field-label", "Langue"));
    const select = h("select");
    select.name = "language";
    const languageOptions: { value: GameLanguage; text: string }[] = [
      { value: "ja", text: "日本語" },
      { value: "en", text: "English" },
      { value: "fr", text: "Français" },
    ];
    const available = new Set<GameLanguage>(availableLanguages);
    for (const { value, text } of languageOptions) {
      if (!available.has(value)) continue;
      const o = h("option", undefined, text);
      o.value = value;
      select.appendChild(o);
    }
    select.value = settings.language;
    select.addEventListener("change", () => {
      if (this.inputEnabled) this.commands?.updateSettings({ language: select.value as GameSettings["language"] });
    });
    lang.appendChild(select);
    form.appendChild(lang);

    p.append(form, this.backButton());
    return p;
  }

  private renderBacklog(entries: readonly BacklogEntry[]): El {
    const p = this.panel("Historique", "mh-ui-backlog-screen");
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
    const p = this.panel("Flowchart", "mh-ui-flowchart-screen");
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
    this.commands?.toggleUserHide();
  }

  private onWheel(e: WheelEvent): void {
    if (!this.playing || this.choiceCount > 0 || e.deltaY === 0) return;
    if (this.onInteractive(e.target)) return;
    if (e.deltaY < 0) this.commands?.rollback();
    else this.commands?.advance();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.commands) return;
    if (e.key === "Escape") {
      this.onEscape();
      return;
    }
    if (!this.inputEnabled || this.confirmEl) return;

    if (e.key === "Control") {
      if (!this.ctrlSkip && this.view.screen === "game") {
        this.ctrlSkip = true;
        this.modeBeforeCtrl = this.status.mode;
        if (this.status.mode !== "skip") this.commands.setMode("skip");
      }
      return;
    }

    const field = e.target instanceof Element && e.target.closest("input, select, textarea") !== null;
    if (field || e.ctrlKey || e.metaKey || e.altKey) return;
    const onButton = e.target instanceof Element && e.target.closest("button") !== null;

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === "f") {
      this.commands.toggleFullscreen();
      return;
    }
    if (this.view.screen !== "game") return;

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
      case "a":
        this.commands.setMode(this.status.mode === "auto" ? "normal" : "auto");
        break;
      case "s":
        this.commands.setMode(this.status.mode === "skip" ? "normal" : "skip");
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
    if (screen === "game") this.commands.openScreen("pause");
    else if (screen !== "title") this.commands.closeScreen();
  }
}
