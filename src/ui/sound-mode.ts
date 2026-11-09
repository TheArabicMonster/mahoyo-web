/**
 * Sound mode (HUD-16, #209 ; docs/ANALYSE_HUD_ORIGINAL.md §2.10, docs/DESIGN.md §8 et §9.16).
 *
 * Galerie sonore ouverte depuis le sous-menu Extra du titre : liste de BGM en grille responsive,
 * lecture / pause / stop / précédent / suivant, répétition d'un morceau ou de tous, aléatoire,
 * volume, barre de progression `<input type="range">` avec temps `m:ss`.
 *
 * Les morceaux viennent du **manifeste de l'utilisateur** (`AssetResolver.audioEntries()`) : titres
 * et compositeurs sont des métadonnées facultatives fournies par l'utilisateur, jamais commitées.
 * Sans métadonnée, l'interface affiche un libellé neutre (« Morceau N ») et ne prétend rien savoir.
 *
 * Le module est autonome : il reçoit le lecteur (`SoundEngine`, `src/renderer/audio-manager.ts`),
 * la liste des pistes et l'action de retour. Il ne connaît ni le gestionnaire d'UI ni le player.
 */
import type { SoundEngine, SoundPosition } from "@/renderer/audio-manager.js";
import { t } from "./i18n.js";
import { NIGHT_CLASS } from "./night.js";
import "./sound-mode.css";

/** Morceau de la galerie : une clé du manifeste, son URL résolue et les métadonnées utilisateur. */
export type SoundTrack = {
  key: string;
  url: string;
  /** Titre fourni par l'utilisateur (manifeste) ; absent = libellé neutre. */
  title?: string;
  /** Compositeur fourni par l'utilisateur ; absent = non affiché. */
  composer?: string;
};

/** Mode de répétition : aucun, morceau courant, ou liste complète. */
export type RepeatMode = "off" | "one" | "all";

/** Volume initial par défaut (égal au réglage BGM de `DEFAULT_AUDIO_SETTINGS`). */
export const SOUND_DEFAULT_VOLUME = 0.7;
/** Nombre de positions du volume d'origine (10 pastilles). */
export const SOUND_VOLUME_STEPS = 10;
/** Nombre de colonnes de la grille (aligné sur `sound-mode.css`), pour le clavier. */
export const SOUND_COLUMNS_MAX = 3;

/** Formate une durée en secondes au format `m:ss` (NaN/négatif → `0:00`). */
export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/** Libellé neutre d'une piste sans métadonnées ; n'utilise jamais un titre du jeu. */
export function trackTitle(track: SoundTrack, index: number): string {
  return track.title && track.title.trim() !== "" ? track.title : t("sound.track", { n: String(index + 1) });
}

export type SoundPlayerState = {
  track: SoundTrack | null;
  index: number;
  playing: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  volume: number;
  position: SoundPosition;
};

export type SoundPlayerOptions = {
  tracks: readonly SoundTrack[];
  audio: SoundEngine;
  /** Volume initial 0..1 (défaut : `SOUND_DEFAULT_VOLUME`). */
  volume?: number;
  /** Source aléatoire injectable (tests) ; défaut `Math.random`. */
  random?: () => number;
};

export type SoundPlayer = {
  state(): SoundPlayerState;
  /** Joue la piste `index` (défaut : piste courante). */
  play(index?: number): void;
  /** Alterne lecture / pause de la piste courante. */
  toggle(): void;
  stop(): void;
  next(): void;
  previous(): void;
  /** Bascule un mode de répétition : ré-appuyer sur le même mode le désactive. */
  toggleRepeat(mode: Exclude<RepeatMode, "off">): void;
  toggleShuffle(): void;
  setVolume(volume: number): void;
  seek(seconds: number): void;
  subscribe(listener: (state: SoundPlayerState) => void): () => void;
  destroy(): void;
};

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * Contrôleur du lecteur (sans DOM) : toute la logique de transport, répétition, aléatoire et
 * volume est testable seule. Le lecteur audio est injecté (`SoundEngine`).
 */
export function createSoundPlayer(options: SoundPlayerOptions): SoundPlayer {
  const tracks = options.tracks;
  const audio = options.audio;
  const random = options.random ?? Math.random;
  const listeners = new Set<(state: SoundPlayerState) => void>();

  let index = tracks.length > 0 ? 0 : -1;
  let playing = false;
  let repeat: RepeatMode = "off";
  let shuffle = false;
  let volume = clamp01(options.volume ?? SOUND_DEFAULT_VOLUME);
  let position: SoundPosition = { current: 0, duration: 0 };
  let destroyed = false;

  audio.setVolume(volume);

  const state = (): SoundPlayerState => ({
    track: tracks[index] ?? null,
    index,
    playing,
    repeat,
    shuffle,
    volume,
    position: { ...position },
  });

  const emit = (): void => {
    if (destroyed) return;
    const snapshot = state();
    for (const listener of [...listeners]) listener(snapshot);
  };

  const select = (next: number): void => {
    if (tracks.length === 0) return;
    index = ((next % tracks.length) + tracks.length) % tracks.length;
    position = { current: 0, duration: 0 };
  };

  const start = (): void => {
    const track = tracks[index];
    if (!track) return;
    playing = true;
    void audio.play(track.url);
    emit();
  };

  const playAt = (next: number): void => {
    if (tracks.length === 0) return;
    select(next);
    start();
  };

  /** Piste suivante au hasard, différente de la courante quand la liste le permet. */
  const randomIndex = (): number => {
    if (tracks.length <= 1) return 0;
    const picked = Math.min(tracks.length - 1, Math.max(0, Math.floor(random() * tracks.length)));
    return picked === index ? (index + 1) % tracks.length : picked;
  };

  const handleEnded = (): void => {
    if (destroyed) return;
    if (!playing) return;
    if (repeat === "one") {
      position = { current: 0, duration: 0 };
      start();
      return;
    }
    if (repeat === "all") {
      playAt(index + 1);
      return;
    }
    if (shuffle) {
      playAt(randomIndex());
      return;
    }
    if (index < tracks.length - 1) {
      playAt(index + 1);
      return;
    }
    // Fin de liste sans répétition : arrêt propre.
    playing = false;
    audio.stop();
    position = { current: 0, duration: 0 };
    emit();
  };

  const unsubscribePosition = audio.subscribe((next) => {
    position = next;
    emit();
  });
  const unsubscribeEnded = audio.onEnded(handleEnded);

  return {
    state,
    play(next?: number): void {
      if (next === undefined) {
        if (!playing) start();
      } else {
        playAt(next);
      }
    },
    toggle(): void {
      if (destroyed || tracks.length === 0) return;
      if (playing) {
        audio.pause();
        playing = false;
        emit();
      } else {
        start();
      }
    },
    stop(): void {
      if (destroyed) return;
      audio.stop();
      playing = false;
      position = { current: 0, duration: 0 };
      emit();
    },
    next(): void {
      if (destroyed || tracks.length === 0) return;
      playAt(shuffle ? randomIndex() : index + 1);
    },
    previous(): void {
      if (destroyed || tracks.length === 0) return;
      playAt(index - 1);
    },
    toggleRepeat(mode: Exclude<RepeatMode, "off">): void {
      repeat = repeat === mode ? "off" : mode;
      emit();
    },
    toggleShuffle(): void {
      shuffle = !shuffle;
      emit();
    },
    setVolume(next: number): void {
      volume = clamp01(next);
      audio.setVolume(volume);
      emit();
    },
    seek(seconds: number): void {
      if (tracks.length === 0) return;
      const { duration } = position;
      const target = Number.isFinite(seconds) ? Math.max(0, Math.min(seconds, duration > 0 ? duration : seconds)) : 0;
      position = { current: target, duration };
      audio.seek(target);
      emit();
    },
    subscribe(listener: (state: SoundPlayerState) => void): () => void {
      listeners.add(listener);
      listener(state());
      return () => void listeners.delete(listener);
    },
    destroy(): void {
      if (destroyed) return;
      audio.stop();
      playing = false;
      position = { current: 0, duration: 0 };
      destroyed = true;
      unsubscribePosition();
      unsubscribeEnded();
      listeners.clear();
    },
  };
}

/** Classe de l'écran (doit rester alignée avec `sound-mode.css`). */
export const SOUND_SCREEN_CLASS = "mh-sound-screen";

export type SoundModeOptions = {
  tracks: readonly SoundTrack[];
  audio: SoundEngine;
  volume?: number;
  random?: () => number;
  /** Retour au sous-menu Extra (bouton Retour ou Échap). */
  onClose(): void;
};

export type SoundMode = {
  element: HTMLElement;
  focusFirst(): void;
  destroy(): void;
  /** Contrôleur exposé (tests et diagnostic). */
  readonly player: SoundPlayer;
};

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function button(cls: string, label: string, ariaLabel?: string): HTMLButtonElement {
  const btn = h("button", cls, label);
  btn.type = "button";
  if (ariaLabel) btn.setAttribute("aria-label", ariaLabel);
  return btn;
}

/** Colonnes effectives de la grille (fallback 3 hors mise en page). */
function gridColumns(grid: HTMLElement): number {
  try {
    const value = getComputedStyle(grid).gridTemplateColumns;
    const count = value.split(/\s+/).filter(Boolean).length;
    return count >= 2 ? Math.min(count, SOUND_COLUMNS_MAX) : SOUND_COLUMNS_MAX;
  } catch {
    return SOUND_COLUMNS_MAX;
  }
}

export function createSoundMode(options: SoundModeOptions): SoundMode {
  const { tracks, onClose } = options;
  const player = createSoundPlayer({ tracks, audio: options.audio, volume: options.volume, random: options.random });
  let destroyed = false;

  const screen = h("section", `${SOUND_SCREEN_CLASS} ${NIGHT_CLASS}`);
  screen.setAttribute("role", "dialog");
  screen.setAttribute("aria-modal", "true");
  screen.setAttribute("aria-label", t("sound.title"));

  // ── En-tête ──
  const header = h("header", "mh-sound-header");
  header.appendChild(h("h2", "mh-sound-title", t("sound.title")));
  const subtitle = h("p", "mh-sound-subtitle mh-sound-subtitle-deco", t("sound.title.deco"));
  subtitle.setAttribute("aria-hidden", "true");
  header.appendChild(subtitle);
  screen.appendChild(header);

  // ── Liste des morceaux ──
  const scroll = h("div", "mh-sound-scroll");
  const grid = h("ul", "mh-sound-grid");
  grid.setAttribute("role", "list");
  grid.setAttribute("aria-label", t("sound.list"));
  const empty = h("p", "mh-sound-empty", t("sound.empty"));
  empty.hidden = tracks.length > 0;
  scroll.append(grid, empty);
  screen.appendChild(scroll);

  // ── Ligne d'information (compositeur / titre) ──
  const info = h("p", "mh-sound-info");
  info.setAttribute("aria-live", "polite");
  screen.appendChild(info);

  // ── Commandes ──
  const transport = h("div", "mh-sound-transport");
  transport.setAttribute("role", "toolbar");
  transport.setAttribute("aria-label", t("sound.controls"));
  const play = button("mh-sound-button mh-sound-play", "▶", t("sound.play"));
  const stop = button("mh-sound-button mh-sound-stop", "■", t("sound.stop"));
  const prev = button("mh-sound-button mh-sound-prev", "|◀", t("sound.previous"));
  const next = button("mh-sound-button mh-sound-next", "▶|", t("sound.next"));
  const repeatOne = button("mh-sound-toggle mh-sound-repeat-one", "1", t("sound.repeatOne"));
  repeatOne.setAttribute("aria-pressed", "false");
  const repeatAll = button("mh-sound-toggle mh-sound-repeat-all", "∞", t("sound.repeatAll"));
  repeatAll.setAttribute("aria-pressed", "false");
  const shuffle = button("mh-sound-toggle mh-sound-shuffle", "⤨", t("sound.shuffle"));
  shuffle.setAttribute("aria-pressed", "false");
  transport.append(play, stop, prev, next, repeatOne, repeatAll, shuffle);

  const progress = h("div", "mh-sound-progress");
  const progressRange = document.createElement("input");
  progressRange.type = "range";
  progressRange.className = "mh-sound-progress-range";
  progressRange.min = "0";
  progressRange.max = "0";
  progressRange.step = "1";
  progressRange.value = "0";
  progressRange.disabled = true;
  progressRange.setAttribute("aria-label", t("sound.progress"));
  const currentTime = h("span", "mh-sound-time mh-sound-time-current", formatTime(0));
  const totalTime = h("span", "mh-sound-time mh-sound-time-total", formatTime(0));
  progress.append(progressRange, currentTime, totalTime);
  transport.appendChild(progress);

  const volumeGroup = h("div", "mh-sound-volume");
  const volumeLabel = h("label", "mh-sound-volume-label", t("sound.volume"));
  volumeLabel.htmlFor = "ui-sound-volume";
  const volumeRange = document.createElement("input");
  volumeRange.type = "range";
  volumeRange.id = "ui-sound-volume";
  volumeRange.className = "mh-sound-volume-range";
  volumeRange.min = "0";
  volumeRange.max = "100";
  volumeRange.step = String(100 / SOUND_VOLUME_STEPS);
  volumeRange.setAttribute("aria-label", t("sound.volume"));
  volumeGroup.append(volumeLabel, volumeRange);
  transport.appendChild(volumeGroup);
  screen.appendChild(transport);

  // ── Pied ──
  const footer = h("footer", "mh-sound-footer");
  const back = button("mh-sound-back", t("common.back"));
  footer.appendChild(back);
  screen.appendChild(footer);

  // ── Grille ──
  const tiles: HTMLButtonElement[] = [];
  let selectedKey: string | null = tracks[0]?.key ?? null;
  if (tracks.length > 0) {
    tracks.forEach((track, index) => {
      const li = document.createElement("li");
      li.className = "mh-sound-cell";
      const title = h("span", "mh-sound-track-title", trackTitle(track, index));
      const composer = h("span", "mh-sound-track-composer", track.composer?.trim() ?? "");
      composer.hidden = !track.composer || track.composer.trim() === "";
      const marker = h("span", "mh-sound-track-marker", "▶");
      marker.setAttribute("aria-hidden", "true");
      const tile = h("button", "mh-sound-track");
      tile.type = "button";
      tile.dataset.key = track.key;
      tile.dataset.index = String(index);
      tile.setAttribute("aria-label", track.composer ? `${trackTitle(track, index)} — ${track.composer}` : trackTitle(track, index));
      tile.append(title, composer, marker);
      tile.addEventListener("click", () => player.play(index));
      li.appendChild(tile);
      grid.appendChild(li);
      tiles.push(tile);
    });
  }

  const select = (key: string | null): void => {
    selectedKey = key;
    for (const tile of tiles) {
      const selected = tile.dataset.key === key;
      tile.classList.toggle("is-selected", selected);
      if (selected) tile.setAttribute("aria-current", "true");
      else tile.removeAttribute("aria-current");
    }
  };
  const selectIndex = (index: number): void => {
    if (tiles.length === 0) return;
    const wrapped = ((index % tiles.length) + tiles.length) % tiles.length;
    select(tiles[wrapped]!.dataset.key ?? null);
    tiles[wrapped]!.focus();
  };

  const focusTile = (index: number): void => {
    const clamped = Math.min(tiles.length - 1, Math.max(0, index));
    tiles[clamped]?.focus();
  };

  grid.addEventListener("focusin", (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(".mh-sound-track");
    if (!target) return;
    select(target.dataset.key ?? null);
  });

  // ── Rendu de l'état du lecteur ──
  const render = (state: ReturnType<SoundPlayer["state"]>): void => {
    if (destroyed) return;
    play.textContent = state.playing ? "❚❚" : "▶";
    play.setAttribute("aria-label", state.playing ? t("sound.pause") : t("sound.play"));
    play.setAttribute("aria-pressed", state.playing ? "true" : "false");
    repeatOne.setAttribute("aria-pressed", state.repeat === "one" ? "true" : "false");
    repeatAll.setAttribute("aria-pressed", state.repeat === "all" ? "true" : "false");
    shuffle.setAttribute("aria-pressed", state.shuffle ? "true" : "false");

    const { position } = state;
    const duration = Math.max(0, Math.round(position.duration));
    const current = Math.min(Math.max(0, Math.round(position.current)), duration > 0 ? duration : Math.round(position.current));
    progressRange.max = String(Math.max(duration, 0));
    progressRange.value = String(current);
    progressRange.disabled = duration <= 0;
    currentTime.textContent = formatTime(current);
    totalTime.textContent = formatTime(duration);

    const percent = Math.round(state.volume * 100);
    volumeRange.value = String(percent);
    volumeRange.setAttribute("aria-valuetext", t("sound.volumeValue", { n: String(percent) }));

    for (const tile of tiles) {
      const isCurrent = state.track !== null && tile.dataset.key === state.track.key;
      tile.classList.toggle("is-current", isCurrent);
      tile.classList.toggle("is-playing", isCurrent && state.playing);
    }

    if (state.track) {
      // La sélection (`aria-current`) suit le focus : ne pas la déplacer à chaque tick de position.
      const composer = state.track.composer?.trim() ?? "";
      const title = state.track.title?.trim() ?? "";
      // Aucune métadonnée utilisateur : ne pas prétendre connaître le morceau (libellé neutre).
      info.textContent =
        composer === "" && title === ""
          ? t("sound.noMetadata")
          : [composer, title !== "" ? title : trackTitle(state.track, state.index)]
              .filter((part) => part !== "")
              .join(" / ");
    } else {
      info.textContent = t("sound.noMetadata");
    }
    stop.disabled = state.track === null;
    prev.disabled = tracks.length === 0;
    next.disabled = tracks.length === 0;
    play.disabled = tracks.length === 0;
    repeatOne.disabled = tracks.length === 0;
    repeatAll.disabled = tracks.length === 0;
    shuffle.disabled = tracks.length === 0;
    volumeRange.disabled = tracks.length === 0;
  };

  play.addEventListener("click", () => player.toggle());
  stop.addEventListener("click", () => player.stop());
  prev.addEventListener("click", () => player.previous());
  next.addEventListener("click", () => player.next());
  repeatOne.addEventListener("click", () => player.toggleRepeat("one"));
  repeatAll.addEventListener("click", () => player.toggleRepeat("all"));
  shuffle.addEventListener("click", () => player.toggleShuffle());
  progressRange.addEventListener("input", () => player.seek(Number(progressRange.value)));
  volumeRange.addEventListener("input", () => player.setVolume(Number(volumeRange.value) / 100));
  back.addEventListener("click", () => onClose());

  const unsubscribe = player.subscribe(render);

  // ── Clavier global (capture : l'écran prime sur le menu du titre) ──
  const onKeyDown = (event: KeyboardEvent): void => {
    if (destroyed) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const target = event.target as HTMLElement | null;
    const inField = target !== null && target.closest("input, select, textarea") !== null;
    if (event.key === " " && !inField) {
      // Espace = lecture/pause, comme demandé par l'issue (sauf dans un contrôle de formulaire).
      event.preventDefault();
      event.stopPropagation();
      player.toggle();
      return;
    }
    if (inField) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const current = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const columns = gridColumns(grid);
    switch (event.key) {
      case "ArrowRight":
        focusTile(current + 1);
        break;
      case "ArrowLeft":
        focusTile(current - 1);
        break;
      case "ArrowDown":
        focusTile(current + columns);
        break;
      case "ArrowUp":
        focusTile(current - columns);
        break;
      case "Home":
        focusTile(0);
        break;
      case "End":
        focusTile(tiles.length - 1);
        break;
    }
  };
  document.addEventListener("keydown", onKeyDown, true);

  // Marque la piste 1 comme sélectionnée au départ, sans voler le focus.
  select(selectedKey);
  render(player.state());

  return {
    element: screen,
    focusFirst(): void {
      (tiles[0] ?? back).focus();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      document.removeEventListener("keydown", onKeyDown, true);
      unsubscribe();
      player.destroy();
    },
    get player(): SoundPlayer {
      return player;
    },
  };
}
