/**
 * Contrat UI : écrans hors jeu, entrées utilisateur et commandes vers le player.
 */
import type { Ms, StageSnapshot } from "@/kag/events.js";
import type { ShortcutBindings } from "@/core/shortcuts.js";
import type { AudioSettings, DisplaySettings, MouseMode } from "@/renderer/types.js";

// ── Réglages et état du player ──

export type GameLanguage = "ja" | "en" | "fr";

export type GameSettings = {
  display: DisplaySettings;
  audio: AudioSettings;
  /** false = le skip s'arrête sur le texte non lu. */
  skipUnread: boolean;
  language: GameLanguage;
  shortcuts: ShortcutBindings;
  /**
   * Flowchart : true = révèle tous les nœuds (désactive l'anti-spoiler).
   * Défaut false : seules les scènes visitées sont dévoilées.
   */
  flowchartRevealAll: boolean;
};

export type PlayMode = "normal" | "auto" | "skip";

/** État du player poussé vers l'UI. */
export type PlayerStatus = {
  mode: PlayMode;
  inGame: boolean;
  userHidden: boolean;
  canRollback: boolean;
  /** Menu rapide verrouillé par le script (@lockquickmenu) : pas de sauvegarde ni de chargement. */
  quickMenuLocked: boolean;
  /** Avance automatique suspendue par le script (@pauseautomode) ; `mode` reste le choix du joueur. */
  autoPaused: boolean;
  /** Comportement du clic droit (menu direct ou masquer puis menu). */
  mouseMode: MouseMode;
  /** Masquer le curseur après inactivité. */
  autoHideCursor: boolean;
  /** Touche d'avance rapide choisie. */
  fastForwardKey: "enter" | "shift" | "ctrl";
  /** Raccourcis actifs, poussés avec le statut pour être disponibles en jeu. */
  shortcuts: ShortcutBindings;
};

export type SlotId = number | "quick" | "auto";

// ── Commandes UI → player ──

/**
 * Commandes que l'UI peut envoyer au player.
 *
 * Le player DOIT appeler `audio.unlock()` de façon synchrone dans les handlers
 * `advance`, `startScript` et `load` pour respecter la politique autoplay.
 */
export interface PlayerCommands {
  /** Clic, Espace, Entrée. Le player décide : hurry, avancer, ou rien. */
  advance(): void;
  /** Avance rapide (touche maintenue) ; true si l'appui a été consommé. */
  hurryText(): boolean;
  setMode(mode: PlayMode): void;
  toggleUserHide(): void;
  rollback(): void;
  choose(index: number): void;

  // Navigation
  startScript(file: string, label?: string): void;
  openScreen(screen: OverlayScreen): void;
  closeScreen(): void;
  returnToTitle(): void;

  // Sauvegardes
  save(slot: SlotId): Promise<void>;
  load(slot: SlotId): Promise<void>;
  deleteSave(slot: SlotId): Promise<void>;

  // Système
  updateSettings(patch: Partial<GameSettings>): void;
  resetSettings(): void;
  toggleFullscreen(): void;
  /** Joue un bip de test au volume SE courant. */
  testSe(): void;
}

// ── Données affichées ──

export type ScriptSummary = {
  id: string;
  label: string;
  file: string;
  arc: string;
  /** Position dans le flowchart (unités logiques). */
  x: number;
  y: number;
};

export type ScriptProgress = {
  unlocked: readonly string[];
  completed: readonly string[];
};

/** Arête de choix prise : scripts uniquement, jamais le libellé de l'option. */
export type TakenChoice = { from: string; to: string };

/**
 * Progression par scène (script) pour le flowchart. Persistée dans `mahoyo.story-progress`.
 * Données anciennes ou partielles : les champs absents valent vide.
 */
export type StoryProgress = {
  /** Scripts ouverts au moins une fois. */
  visited: readonly string[];
  /** Scripts lus jusqu'au `@return`. */
  finished: readonly string[];
  /** Arêtes de choix prises (script d'origine -> script cible). */
  choices: readonly TakenChoice[];
  /** Scripts terminaux (fins) atteints. */
  endings: readonly string[];
};

export type SaveSlot = {
  id: SlotId;
  /** null = slot vide. */
  data: {
    scriptFile: string;
    timestamp: number;
    previewText: string;
    thumbnailUrl: string | null;
    stage: StageSnapshot;
  } | null;
};

export type BacklogEntry = {
  text: string;
  /** Voix rejouable, si présente. */
  voice?: string;
};

// ── Écrans ──

export type OverlayScreen = "pause" | "save" | "load" | "settings" | "backlog" | "flowchart";

/** Vue déclarative : l'UI affiche exactement ce qu'on lui donne. */
export type UIView =
  | { screen: "title"; scripts: readonly ScriptSummary[]; hasContinue: boolean }
  | { screen: "game" }
  | { screen: "pause" }
  | { screen: "save" | "load"; slots: readonly SaveSlot[] }
  | { screen: "settings"; settings: Readonly<GameSettings>; availableLanguages: readonly GameLanguage[] }
  | { screen: "backlog"; entries: readonly BacklogEntry[] }
  | {
      screen: "flowchart";
      scripts: readonly ScriptSummary[];
      progress: ScriptProgress;
      /** Identifiant du script en cours (nom sans extension, minuscules) ; null au titre. */
      currentScript?: string | null;
      /** Progression par scène (cumulative, indépendante de la sauvegarde chargée). */
      story?: StoryProgress;
    };

export interface UIManager {
  /** Commandes injectées une seule fois. Installe aussi les listeners clavier et souris. */
  init(root: HTMLElement, commands: PlayerCommands): void;

  show(view: UIView): void;

  /** Mise à jour des indicateurs (auto, skip, rollback…). */
  setStatus(status: Readonly<PlayerStatus>): void;

  /** Affiche les choix. La sélection passe par `commands.choose`. */
  showChoices(options: readonly string[]): void;
  hideChoices(): void;

  confirm(message: string): Promise<boolean>;
  toast(message: string, duration?: Ms): void;

  /** Bloque les entrées (chargement en cours). */
  setInputEnabled(enabled: boolean): void;

  dispose(): void;
}
