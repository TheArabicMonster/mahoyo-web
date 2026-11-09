/**
 * Persistance des réglages et de la progression (localStorage).
 * Interface asynchrone pour pouvoir passer à IndexedDB sans toucher au player.
 */
import { isGameLanguage, type GameLanguage } from "@/core/language.js";
import { defaultShortcuts, mergeShortcuts } from "@/core/shortcuts.js";
import { DEFAULT_AUDIO_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "@/renderer/types.js";
import type { GameSettings, ScriptProgress, StoryProgress } from "@/ui/types.js";
import { emptyStoryProgress, normalizeStoryProgress } from "./story-progress.js";

export const DEFAULT_SETTINGS: GameSettings = {
  display: { ...DEFAULT_DISPLAY_SETTINGS },
  audio: { ...DEFAULT_AUDIO_SETTINGS },
  skipUnread: false,
  // Français par défaut ; le player retombe sur "ja" si aucune traduction n'est installée.
  language: "fr",
  shortcuts: defaultShortcuts(),
  // Anti-spoiler actif par défaut : seules les scènes visitées sont révélées.
  flowchartRevealAll: false,
};

export interface SettingsStore {
  loadSettings(): Promise<GameSettings>;
  saveSettings(settings: Readonly<GameSettings>): Promise<void>;
  /** Clés de positions déjà lues (pour le skip). */
  loadRead(): Promise<Set<string>>;
  saveRead(read: ReadonlySet<string>): Promise<void>;
  loadProgress(): Promise<{ completed: string[] }>;
  saveProgress(progress: { completed: readonly string[] }): Promise<void>;
  /** Progression par scène (flowchart) ; vide si absente, partielle ou corrompue. */
  loadStoryProgress(): Promise<StoryProgress>;
  saveStoryProgress(progress: Readonly<StoryProgress>): Promise<void>;
  /**
   * Clés des CG déjà vues (galerie, HUD-15 / #208) ; vide si absente, partielle ou corrompue.
   * Donnée de progression de l'utilisateur, jamais un asset : seules des clés du manifeste.
   */
  loadSeenCg(): Promise<Set<string>>;
  saveSeenCg(seen: ReadonlySet<string>): Promise<void>;
}

/**
 * Normalise une valeur stockée en ensemble de clés de CG : seules les chaînes non vides sont
 * gardées (donnée locale éventuellement corrompue ou d'une ancienne version).
 */
export function normalizeSeenCg(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && item.trim() !== "") seen.add(item);
  }
  return seen;
}

type LegacyDisplay = Partial<GameSettings["display"]> & {
  /** Anciens réglages plats (#177) : migrés vers les vitesses lu/non lu. */
  textSpeed?: number;
  autoDelay?: number;
};

/** Fusionne un patch partiel (y compris les sous-objets) dans des réglages. */
export function mergeSettings(base: Readonly<GameSettings>, patch: Partial<GameSettings>): GameSettings {
  const language: GameLanguage =
    patch.language && isGameLanguage(patch.language) ? patch.language : base.language;
  const displayBase = base.display as LegacyDisplay;
  const displayPatch = (patch.display ?? {}) as LegacyDisplay;
  const display: LegacyDisplay = {
    ...DEFAULT_SETTINGS.display,
    ...displayBase,
    ...displayPatch,
  };
  // Migration des anciennes sauvegardes : textSpeed/autoDelay → vitesses et délais séparés.
  if (displayPatch.textSpeed !== undefined && displayPatch.textSpeedUnread === undefined) {
    display.textSpeedUnread = displayPatch.textSpeed;
    if (displayPatch.textSpeedRead === undefined) {
      display.textSpeedRead = Math.max(0, displayPatch.textSpeed - 10);
    }
  }
  if (displayPatch.autoDelay !== undefined) {
    display.autoPageDelay = displayPatch.autoDelay;
    if (displayPatch.autoLineDelay === undefined) display.autoLineDelay = displayPatch.autoDelay;
  }
  delete display.textSpeed;
  delete display.autoDelay;

  const audio = { ...DEFAULT_SETTINGS.audio, ...base.audio, ...patch.audio };
  // Ancien « Muet » global : le convertir en mutes par canal (l'écran d'origine n'a pas de
  // mute global, et un `muted: true` orphelin laisserait le jeu silencieux sans contrôle).
  if (audio.muted && patch.audio?.bgmMuted === undefined) {
    audio.bgmMuted = true;
    audio.seMuted = true;
    audio.systemMuted = true;
    audio.muted = false;
  }

  return {
    ...base,
    ...patch,
    language,
    display: display as GameSettings["display"],
    audio,
    shortcuts: mergeShortcuts(base.shortcuts ?? defaultShortcuts(), patch.shortcuts),
    // Anciennes sauvegardes : champ absent ou invalide -> valeur de base, puis `false`.
    flowchartRevealAll:
      typeof patch.flowchartRevealAll === "boolean"
        ? patch.flowchartRevealAll
        : typeof base.flowchartRevealAll === "boolean"
          ? base.flowchartRevealAll
          : false,
  };
}

/** Calcule l'état de progression affiché par le flowchart. */
export function toScriptProgress(orderedIds: readonly string[], completed: readonly string[]): ScriptProgress {
  const done = new Set(completed);
  let lastDone = -1;
  orderedIds.forEach((id, i) => {
    if (done.has(id)) lastDone = i;
  });
  return { unlocked: orderedIds.slice(0, lastDone + 2), completed: [...completed] };
}

function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function createLocalSettingsStore(storage: Storage = localStorage, prefix = "mahoyo."): SettingsStore {
  return {
    async loadSettings() {
      return mergeSettings(DEFAULT_SETTINGS, readJson<Partial<GameSettings>>(storage, `${prefix}settings`) ?? {});
    },
    async saveSettings(settings) {
      storage.setItem(`${prefix}settings`, JSON.stringify(settings));
    },
    async loadRead() {
      return new Set(readJson<string[]>(storage, `${prefix}read`) ?? []);
    },
    async saveRead(read) {
      storage.setItem(`${prefix}read`, JSON.stringify([...read]));
    },
    async loadProgress() {
      return readJson<{ completed: string[] }>(storage, `${prefix}progress`) ?? { completed: [] };
    },
    async saveProgress(progress) {
      storage.setItem(`${prefix}progress`, JSON.stringify(progress));
    },
    async loadStoryProgress() {
      return normalizeStoryProgress(readJson<unknown>(storage, `${prefix}story-progress`));
    },
    async saveStoryProgress(progress) {
      // Normalisation à l'écriture : seuls des identifiants de scripts sont persistés.
      storage.setItem(`${prefix}story-progress`, JSON.stringify(normalizeStoryProgress(progress)));
    },
    async loadSeenCg() {
      return normalizeSeenCg(readJson<unknown>(storage, `${prefix}cg`));
    },
    async saveSeenCg(seen) {
      storage.setItem(`${prefix}cg`, JSON.stringify([...seen]));
    },
  };
}

/** Store en mémoire (tests, navigation privée). */
export function createMemorySettingsStore(): SettingsStore {
  let settings = DEFAULT_SETTINGS;
  let read = new Set<string>();
  let progress: { completed: string[] } = { completed: [] };
  let story = emptyStoryProgress();
  let seenCg = new Set<string>();
  return {
    async loadSettings() {
      return settings;
    },
    async saveSettings(s) {
      settings = { ...s };
    },
    async loadRead() {
      return new Set(read);
    },
    async saveRead(r) {
      read = new Set(r);
    },
    async loadProgress() {
      return { completed: [...progress.completed] };
    },
    async saveProgress(p) {
      progress = { completed: [...p.completed] };
    },
    async loadStoryProgress() {
      return normalizeStoryProgress(story);
    },
    async saveStoryProgress(p) {
      story = normalizeStoryProgress(p);
    },
    async loadSeenCg() {
      return new Set(seenCg);
    },
    async saveSeenCg(seen) {
      seenCg = new Set(seen);
    },
  };
}
