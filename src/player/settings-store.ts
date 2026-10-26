/**
 * Persistance des réglages et de la progression (localStorage).
 * Interface asynchrone pour pouvoir passer à IndexedDB sans toucher au player.
 */
import type { GameSettings, ScriptProgress } from "@/ui/types.js";

export const DEFAULT_SETTINGS: GameSettings = {
  display: { textSpeed: 30, autoDelay: 2000, fontScale: 1, textboxOpacity: 0.8 },
  audio: { master: 1, bgm: 0.6, se: 0.5, voice: 1, muted: false },
  skipUnread: false,
  language: "ja",
};

export interface SettingsStore {
  loadSettings(): Promise<GameSettings>;
  saveSettings(settings: Readonly<GameSettings>): Promise<void>;
  /** Clés de positions déjà lues (pour le skip). */
  loadRead(): Promise<Set<string>>;
  saveRead(read: ReadonlySet<string>): Promise<void>;
  loadProgress(): Promise<{ completed: string[] }>;
  saveProgress(progress: { completed: readonly string[] }): Promise<void>;
}

/** Fusionne un patch partiel (y compris les sous-objets) dans des réglages. */
export function mergeSettings(base: Readonly<GameSettings>, patch: Partial<GameSettings>): GameSettings {
  return {
    ...base,
    ...patch,
    display: { ...base.display, ...patch.display },
    audio: { ...base.audio, ...patch.audio },
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
  };
}

/** Store en mémoire (tests, navigation privée). */
export function createMemorySettingsStore(): SettingsStore {
  let settings = DEFAULT_SETTINGS;
  let read = new Set<string>();
  let progress: { completed: string[] } = { completed: [] };
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
  };
}
