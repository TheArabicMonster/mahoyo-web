import {
  actionForEvent,
  bindingFromEvent,
  defaultShortcuts,
  type ShortcutAction,
} from "@/core/shortcuts.js";
import type { Ms } from "@/kag/events.js";
import type {
  BacklogEntry,
  ConfirmOptions,
  GameLanguage,
  GameSettings,
  OverlayScreen,
  PlayerCommands,
  PlayerStatus,
  SaveSlot,
  ScriptSummary,
  UIManager,
  UIView,
} from "@/ui/types.js";
import { createBacklogScreen } from "@/ui/backlog-screen.js";
import { buildCgCatalog, cgCatalogSize, createCgMode, type CgCatalog, type CgImage, type CgMode } from "@/ui/cg-mode.js";
import { createSoundMode, type SoundMode, type SoundTrack } from "@/ui/sound-mode.js";
import type { SoundEngine } from "@/renderer/audio-manager.js";
import { createConfigScreen, type ConfigScreen, type SettingsTab } from "@/ui/config-screen.js";
import { openConfirmDialog, type ConfirmDialog } from "@/ui/confirm-dialog.js";
import { getUiLanguage, onUiLanguageChange, t } from "@/ui/i18n.js";
import { createSaveLoadScreen, type SaveLoadScreen, type SaveTransferActions } from "@/ui/save-load-screen.js";
import { ToastStack } from "@/ui/toast.js";
import { renderFlowchartScreen } from "@/ui/flowchart-view.js";
import { syncNightDemo } from "@/ui/night.js";
import { focusSystemMenu, renderSystemMenu, syncSystemMenu, syncSystemMenuVeil } from "@/ui/system-menu.js";
import { createTitleScreen, TITLE_ASSET_KEYS } from "@/ui/title-screen.js";
import { createTouchControls, type TouchControls } from "@/ui/touch-controls.js";
import { createUiAssets, UI_ASSET_KEYS, type UiAssets, type UiImageSource } from "@/ui/ui-assets.js";
import "./ui-manager.css";

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

/** Galerie CG (HUD-15, #208) : catalogue calculé à l'exécution et progression des CG vues. */
export type CgGallerySource = {
  /** Images du manifeste de l'utilisateur (`AssetResolver.imageEntries`), aucune n'est versionnée. */
  images(): readonly CgImage[];
  /** Clés des CG déjà vues (progression persistée, `src/player/cg-seen.ts`). */
  seen(): ReadonlySet<string>;
};

/** Galerie sonore (HUD-16, #209) : pistes du manifeste utilisateur et lecteur indépendant. */
export type SoundGallerySource = {
  /** Morceaux (BGM) du manifeste de l'utilisateur, métadonnées facultatives comprises. */
  tracks(): readonly SoundTrack[];
  /** Lecteur de la galerie (`createSoundEngine`), indépendant des canaux du jeu. */
  audio: SoundEngine;
};

export type DomUIManagerOptions = {
  /** Source des images d'interface (le résolveur d'assets) ; absente = repli CSS partout (HUD-03, #189). */
  resolver?: UiImageSource;
  /** Export et import JSON des sauvegardes, proposés dans l'écran de sauvegarde/chargement (WEB-03, #198). */
  saveTransfer?: SaveTransferActions;
  /**
   * Galerie CG (HUD-15, #208) ; absente ou vide = l'entrée Cgmode du sous-menu Extra reste grisée.
   */
  cgGallery?: CgGallerySource;
  /**
   * Galerie sonore (HUD-16, #209) ; absente ou vide = l'entrée Soundmode du sous-menu Extra reste grisée.
   */
  soundGallery?: SoundGallerySource;
};

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
  private cgEl!: El;
  private soundEl!: El;
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

  private confirmDialog: ConfirmDialog | null = null;
  private saveLoad: SaveLoadScreen | null = null;
  /** Écran CG ouvert (HUD-15, #208) ; null = fermé. */
  private cgMode: CgMode | null = null;
  /** Catalogue CG calculé une fois depuis le manifeste (immuable pendant la session). */
  private cgCatalog: CgCatalog | null = null;
  /** Écran Sound mode ouvert (HUD-16, #209) ; null = fermé. */
  private soundMode: SoundMode | null = null;
  /** Pistes de la galerie sonore, lues une fois depuis le manifeste. */
  private soundTracks: readonly SoundTrack[] | null = null;
  private touch: TouchControls | null = null;
  private cleanups: (() => void)[] = [];
  private previousDocumentLang: string | null = null;
  private readonly uiAssets: UiAssets;
  private readonly saveTransfer: SaveTransferActions | undefined;
  private readonly cgGallery: CgGallerySource | undefined;
  private readonly soundGallery: SoundGallerySource | undefined;

  constructor(options: DomUIManagerOptions = {}) {
    this.uiAssets = createUiAssets(options.resolver);
    this.saveTransfer = options.saveTransfer;
    this.cgGallery = options.cgGallery;
    this.soundGallery = options.soundGallery;
  }

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
    this.uiAssets.apply(this.overlay, [...UI_ASSET_KEYS, ...TITLE_ASSET_KEYS]);
    this.applyLang();
    this.overlay.replaceChildren();
    this.menu = this.slot("ui-menu", "mh-ui-menu");
    this.flowchart = this.slot("ui-flowchart", "mh-ui-flowchart");
    this.pause = this.slot("ui-pause", "mh-ui-pause");
    this.cgEl = this.slot("ui-cg", "mh-ui-cg");
    this.soundEl = this.slot("ui-sound", "mh-ui-sound");
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

    // Commandes tactiles (WEB-01, #203) : n'existent que sur appareil tactile.
    this.touch = createTouchControls(this.overlay, {
      commands,
      getStatus: () => this.status,
      isPlaying: () => this.playing,
    });

    this.show(this.view);
    this.renderStatus();
  }

  dispose(): void {
    this.closeCgMode(false);
    this.closeSoundMode(false);
    this.soundGallery?.audio.dispose();
    this.touch?.dispose();
    this.touch = null;
    for (const off of this.cleanups) off();
    this.cleanups = [];
    this.toasts?.dispose();
    this.toasts = null;
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    this.resolveConfirm(false);
    if (this.root) {
      this.overlay.replaceChildren();
      this.uiAssets.clear(this.overlay);
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
    // Un changement d'écran referme les galeries CG et sonore (elles recouvrent le titre, pas la vue).
    this.closeCgMode(false);
    this.closeSoundMode(false);
    if (this.refreshSaveLoad(view)) return;
    this.saveLoad = null;
    this.menu.replaceChildren();
    this.flowchart.replaceChildren();
    this.pause.replaceChildren();
    syncNightDemo(this.menu, view.screen);
    this.overlay.dataset.screen = view.screen;

    switch (view.screen) {
      case "game":
        break;
      case "title":
        this.renderTitle(view.scripts, view.hasContinue, view.unlockedChapters);
        break;
      case "pause":
        if (this.commands) this.pause.appendChild(this.renderSystemMenu(this.commands));
        break;
      case "save":
      case "load":
        this.menu.appendChild(this.renderSaveLoad(view.screen, view.slots));
        break;
      case "settings":
        this.settings = view.settings;
        {
          const screen = this.renderSettings(view.settings, view.availableLanguages);
          this.menu.appendChild(screen.element);
          screen.focusActiveTab();
        }
        break;
      case "backlog":
        this.renderBacklog(view.entries);
        break;
      case "flowchart":
        this.flowchart.appendChild(this.renderFlowchart(view));
        break;
    }
    syncSystemMenuVeil(this.pause);
    if (view.screen === "pause") focusSystemMenu(this.pause);
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

  confirm(message: string, options?: ConfirmOptions): Promise<boolean> {
    if (!this.root) return Promise.resolve(false);
    this.resolveConfirm(false);
    const dialog = openConfirmDialog(this.overlay, {
      message,
      yesLabel: t("common.yes"),
      noLabel: t("common.no"),
      defaultButton: options?.defaultButton,
    });
    this.confirmDialog = dialog;
    this.confirmEl = dialog.element;
    void dialog.result.then(() => {
      if (this.confirmDialog !== dialog) return;
      this.confirmDialog = null;
      this.confirmEl = null;
    });
    return dialog.result;
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
    const dialog = this.confirmDialog;
    this.confirmDialog = null;
    this.confirmEl = null;
    dialog?.close(value);
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
    // Menu système : verrou du menu rapide, bascules auto et skip.
    syncSystemMenu(this.pause, this.status);
    this.touch?.sync(this.view.screen, this.status);
    if (inGame && this.status.canRollback) {
      this.statusEl.appendChild(h("span", "mh-ui-badge mh-ui-badge-rollback", "↶"));
    }
  }

  // ── Galerie CG (HUD-15, #208) ──

  /** Catalogue CG (calculé une fois) : vide sans manifeste ou sans image de CG. */
  private cgCatalogFor(): CgCatalog {
    if (this.cgCatalog === null) {
      this.cgCatalog = this.cgGallery ? buildCgCatalog(this.cgGallery.images()) : { event: [], background: [] };
    }
    return this.cgCatalog;
  }

  /** Ouvre la galerie dans son slot, au-dessus de l'écran titre (qui reste monté). */
  private openCgMode(): void {
    if (!this.root || !this.cgGallery || !this.inputEnabled) return;
    this.closeCgMode(false);
    const view = createCgMode({
      catalog: this.cgCatalogFor(),
      seen: this.cgGallery.seen(),
      onClose: () => this.closeCgMode(),
    });
    this.cgEl.appendChild(view.element);
    this.cgMode = view;
    view.focusFirst();
  }

  /** Ferme la galerie et rend le focus à l'entrée Cgmode du sous-menu Extra. */
  private closeCgMode(restoreFocus = true): void {
    const view = this.cgMode;
    if (!view) return;
    this.cgMode = null;
    view.destroy();
    this.cgEl.replaceChildren();
    if (restoreFocus) {
      this.menu.querySelector<HTMLElement>('[data-entry="cgmode"]')?.focus();
    }
  }

  // ── Galerie sonore (HUD-16, #209) ──

  /** Pistes de la galerie (calculées une fois) : vide sans manifeste ou sans BGM. */
  private soundTracksFor(): readonly SoundTrack[] {
    if (this.soundTracks === null) {
      this.soundTracks = this.soundGallery
        ? this.soundGallery.tracks().filter((track) => track.url !== "")
        : [];
    }
    return this.soundTracks;
  }

  /** Ouvre la galerie sonore dans son slot, au-dessus de l'écran titre (qui reste monté). */
  private openSoundMode(): void {
    if (!this.root || !this.soundGallery || !this.inputEnabled) return;
    this.closeSoundMode(false);
    const view = createSoundMode({
      tracks: this.soundTracksFor(),
      audio: this.soundGallery.audio,
      onClose: () => this.closeSoundMode(),
    });
    this.soundEl.appendChild(view.element);
    this.soundMode = view;
    view.focusFirst();
  }

  /** Ferme la galerie sonore, coupe la lecture et rend le focus à l'entrée Soundmode. */
  private closeSoundMode(restoreFocus = true): void {
    const view = this.soundMode;
    if (!view) return;
    this.soundMode = null;
    view.destroy();
    this.soundEl.replaceChildren();
    if (restoreFocus) {
      this.menu.querySelector<HTMLElement>('[data-entry="soundmode"]')?.focus();
    }
  }

  // ── Écrans ──

  private renderTitle(scripts: readonly ScriptSummary[], hasContinue: boolean, unlockedChapters?: readonly string[]): void {
    // Les actions passent par la garde `inputEnabled` (entrées bloquées pendant un chargement).
    const run = (fn: (c: PlayerCommands) => void): void => {
      if (this.inputEnabled && this.commands) fn(this.commands);
    };
    const screen = createTitleScreen({
      scripts,
      hasContinue,
      unlockedChapters,
      uiAssets: this.uiAssets,
      actions: {
        start: (file) => run((c) => c.startScript(file)),
        startChapter: (file) => run((c) => c.startScript(file)),
        continueGame: () => run((c) => void c.load("auto")),
        load: () => run((c) => c.openScreen("load")),
        flowchart: () => run((c) => c.openScreen("flowchart")),
        config: () => run((c) => c.openScreen("settings")),
        // HUD-15 (#208) : la galerie n'est proposée que si le manifeste contient des CG.
        ...(cgCatalogSize(this.cgCatalogFor()) > 0 ? { cgMode: () => run(() => this.openCgMode()) } : {}),
        // HUD-16 (#209) : Sound mode n'est proposé que si le manifeste contient des BGM.
        ...(this.soundTracksFor().length > 0 ? { soundMode: () => run(() => this.openSoundMode()) } : {}),
      },
    });
    this.menu.appendChild(screen.el);
    screen.focusMenu();
  }

  private renderSystemMenu(commands: PlayerCommands): El {
    return renderSystemMenu(
      {
        commands,
        getStatus: () => this.status,
        confirmReturnToTitle: () =>
          void this.confirm(t("confirm.returnToTitle")).then((ok) => {
            if (ok) commands.returnToTitle();
          }),
      },
      () => this.inputEnabled,
    );
  }

  /**
   * Écran de sauvegarde/chargement (HUD-10, #196). Une action du joueur (suppression, verrou…) fait renvoyer la
   * même vue par le player : on met alors la grille à jour sur place (page, focus et saisie conservés).
   */
  private refreshSaveLoad(view: UIView): boolean {
    if ((view.screen !== "save" && view.screen !== "load") || this.saveLoad?.mode !== view.screen) return false;
    if (!this.menu.contains(this.saveLoad.element)) return false;
    this.saveLoad.setSlots(view.slots);
    return true;
  }

  private renderSaveLoad(mode: "save" | "load", slots: readonly SaveSlot[]): El {
    const screen = createSaveLoadScreen({
      mode,
      commands: this.commands!,
      confirm: (message, options) => this.confirm(message, options),
      toast: (message) => this.toast(message),
      transfer: this.saveTransfer,
      isInputEnabled: () => this.inputEnabled,
    });
    screen.setSlots(slots);
    this.saveLoad = screen;
    return screen.element;
  }

  /** Écran refait en HUD-09 (#200) : voir `config-screen.ts`. */
  private renderSettings(settings: Readonly<GameSettings>, availableLanguages: readonly GameLanguage[]): ConfigScreen {
    const screen = createConfigScreen(settings, availableLanguages, {
      commands: this.commands!,
      isInputEnabled: () => this.inputEnabled,
      confirm: (message, options) => this.confirm(message, options),
      setView: (view) => {
        this.view = view;
      },
      initialTab: this.settingsTab,
      onTabChange: (tab) => {
        this.settingsTab = tab;
      },
      beginCapture: (action, index, apply) => {
        this.capturing = { action, index };
        this.captureApply = apply;
      },
    });
    return screen;
  }

  /** Écran refait en HUD-12 (#201) : voir `backlog-screen.ts`. */
  private renderBacklog(entries: readonly BacklogEntry[]): void {
    const screen = createBacklogScreen({ entries, commands: this.commands! });
    this.menu.appendChild(screen.element);
    screen.mount();
  }

  /** Écran refait en FLOW-05 (#197) : voir `flowchart-view.ts`. */
  private renderFlowchart(view: Extract<UIView, { screen: "flowchart" }>): El {
    return renderFlowchartScreen(
      {
        graph: view.graph,
        chapters: view.scripts,
        currentScript: view.currentScript,
        story: view.story,
        revealAll: view.revealAll ?? false,
        thumbnail: view.thumbnail,
        // « Relire depuis ici » (#202) : confirmation puis `startScript` (même garde que le titre).
        confirm: (message, options) => this.confirm(message, options),
        replay: (node) => {
          if (this.inputEnabled) this.commands?.startScript(node.file);
        },
      },
      () => {
        if (this.inputEnabled) this.commands?.closeScreen();
      },
    );
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
    if (this.cgMode || this.soundMode || !this.playing || this.choiceCount > 0 || this.onInteractive(e.target)) return;
    if (e.button !== 0) return;
    this.commands?.advance();
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (this.cgMode || this.soundMode) return;
    // Menu système ouvert : un nouveau clic droit le referme (comme l'original).
    if (this.view.screen === "pause" && this.inputEnabled && this.confirmEl === null) {
      this.commands?.closeScreen();
      return;
    }
    if (!this.playing) return;
    // Réglage d'origine : menu direct, ou masquer le texte puis menu (#177).
    if (this.status.mouseMode === "hideThenMenu" && !this.status.userHidden) {
      this.commands?.toggleUserHide();
      return;
    }
    this.commands?.openScreen("pause");
  }

  private onWheel(e: WheelEvent): void {
    if (this.cgMode || this.soundMode || !this.playing || this.choiceCount > 0 || e.deltaY === 0) return;
    if (this.onInteractive(e.target)) return;
    if (e.deltaY < 0) this.commands?.rollback();
    else this.commands?.advance();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.commands) return;
    // Les galeries CG et sonore gèrent elles-mêmes leur clavier (Échap, flèches, zoom, Espace)
    // et le stoppent en phase capture.
    if (this.cgMode || this.soundMode) return;
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
