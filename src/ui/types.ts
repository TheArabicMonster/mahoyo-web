/**
 * Contrat UI : écrans hors jeu, entrées utilisateur et commandes vers le player.
 */
import type { Ms, StageSnapshot } from "@/kag/events.js";
import type { AudioSettings, DisplaySettings } from "@/renderer/types.js";

// ── Réglages et état du player ──

export type GameLanguage = "ja" | "en" | "fr";

export type GameSettings = {
  display: DisplaySettings;
  audio: AudioSettings;
  /** false = le skip s'arrête sur le texte non lu. */
  skipUnread: boolean;
  language: GameLanguage;
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
  toggleFullscreen(): void;
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
  | { screen: "flowchart"; scripts: readonly ScriptSummary[]; progress: ScriptProgress };

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
