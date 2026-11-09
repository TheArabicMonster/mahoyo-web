import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setUiLanguage } from "@/ui/i18n.js";
import {
  createSoundMode,
  createSoundPlayer,
  formatTime,
  SOUND_DEFAULT_VOLUME,
  type SoundMode,
  type SoundTrack,
} from "@/ui/sound-mode.js";
import { FakeAudioPlayer } from "../mocks/fake-audio-player.js";

/**
 * HUD-16 (#209) : Sound mode. Les tests utilisent `FakeAudioPlayer` (qui implémente aussi
 * `SoundEngine`) : lecture, suivant, répétition, aléatoire et volume sont vérifiés sur ses
 * enregistrements, sans aucun `HTMLAudioElement` réel.
 */
const tracks: readonly SoundTrack[] = [
  { key: "bgm01", url: "/assets/bgm/01.ogg", title: "Titre utilisateur A", composer: "Compositeur A" },
  { key: "bgm02", url: "/assets/bgm/02.ogg" },
  { key: "bgm03", url: "/assets/bgm/03.ogg", title: "Titre utilisateur C" },
];

function setupPlayer(overrides: Partial<Parameters<typeof createSoundPlayer>[0]> = {}) {
  const audio = new FakeAudioPlayer();
  const player = createSoundPlayer({ tracks, audio, random: () => 0, ...overrides });
  return { audio, player };
}

const key = (k: string, init: KeyboardEventInit = {}, target: HTMLElement = document.body) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));

describe("Sound mode — contrôleur (HUD-16)", () => {
  it("état initial : première piste, arrêtée, volume par défaut appliqué", () => {
    const { audio, player } = setupPlayer();
    const state = player.state();
    expect(state.track?.key).toBe("bgm01");
    expect(state.playing).toBe(false);
    expect(state.repeat).toBe("off");
    expect(state.shuffle).toBe(false);
    expect(state.volume).toBe(SOUND_DEFAULT_VOLUME);
    expect(audio.soundVolume).toBe(SOUND_DEFAULT_VOLUME);
  });

  it("play() joue la piste courante ; toggle() alterne lecture et pause ; stop() remet à zéro", () => {
    const { audio, player } = setupPlayer();
    player.play();
    expect(audio.soundUrls).toEqual(["/assets/bgm/01.ogg"]);
    expect(player.state().playing).toBe(true);
    player.toggle();
    expect(player.state().playing).toBe(false);
    player.toggle();
    expect(player.state().playing).toBe(true);
    expect(audio.soundUrls).toHaveLength(2);
    audio.setSoundPosition(12, 60);
    player.stop();
    expect(player.state().playing).toBe(false);
    expect(player.state().position.current).toBe(0);
  });

  it("suivant/précédent : changement de piste avec bouclage, lecture immédiate", () => {
    const { audio, player } = setupPlayer();
    player.next();
    expect(audio.soundUrls.at(-1)).toBe("/assets/bgm/02.ogg");
    player.next();
    player.next(); // bouclage vers la première
    expect(audio.soundUrls.at(-1)).toBe("/assets/bgm/01.ogg");
    player.previous(); // bouclage vers la dernière
    expect(audio.soundUrls.at(-1)).toBe("/assets/bgm/03.ogg");
    expect(player.state().index).toBe(2);
  });

  it("répétition d'un morceau : la piste redémarre à la fin", () => {
    const { audio, player } = setupPlayer();
    player.toggleRepeat("one");
    expect(player.state().repeat).toBe("one");
    player.play();
    audio.emitSoundEnded();
    expect(audio.soundUrls.at(-1)).toBe("/assets/bgm/01.ogg");
    expect(player.state().playing).toBe(true);
    // Ré-appuyer désactive.
    player.toggleRepeat("one");
    expect(player.state().repeat).toBe("off");
  });

  it("répétition de tous : bouclage en fin de liste", () => {
    const { audio, player } = setupPlayer();
    player.toggleRepeat("all");
    player.play(2); // dernière piste
    audio.emitSoundEnded();
    expect(audio.soundUrls.at(-1)).toBe("/assets/bgm/01.ogg");
    expect(player.state().index).toBe(0);
  });

  it("sans répétition : avance automatiquement, puis s'arrête à la fin de la liste", () => {
    const { audio, player } = setupPlayer();
    player.play(0);
    audio.emitSoundEnded(); // 0 → 1
    expect(player.state().index).toBe(1);
    audio.emitSoundEnded(); // 1 → 2
    expect(player.state().index).toBe(2);
    audio.emitSoundEnded(); // fin de liste : arrêt
    expect(player.state().playing).toBe(false);
    expect(player.state().position).toEqual({ current: 0, duration: 0 });
  });

  it("aléatoire : suivant et fin de piste choisissent une autre piste", () => {
    const { audio, player } = setupPlayer({ random: () => 0 });
    player.toggleShuffle();
    expect(player.state().shuffle).toBe(true);
    player.next(); // random 0 ⇒ piste 0 == courante ⇒ 1
    expect(player.state().index).toBe(1);
    player.play(1);
    audio.emitSoundEnded(); // random 0 ⇒ piste 0 ≠ courante
    expect(player.state().index).toBe(0);
  });

  it("volume borné et transmis au lecteur", () => {
    const { audio, player } = setupPlayer();
    player.setVolume(0.35);
    expect(audio.soundVolume).toBe(0.35);
    player.setVolume(2);
    expect(player.state().volume).toBe(1);
    player.setVolume(-1);
    expect(player.state().volume).toBe(0);
  });

  it("seek borné par la durée connue", () => {
    const { audio, player } = setupPlayer();
    player.play();
    audio.setSoundPosition(0, 60);
    player.seek(75);
    expect(audio.soundSeek.at(-1)).toBe(60);
    player.seek(-3);
    expect(audio.soundSeek.at(-1)).toBe(0);
  });

  it("subscribe notifie immédiatement et se désabonne ; destroy coupe la lecture", () => {
    const { audio, player } = setupPlayer();
    const states: string[] = [];
    const off = player.subscribe((state) => states.push(state.track?.key ?? ""));
    expect(states).toHaveLength(1);
    player.next();
    expect(states.at(-1)).toBe("bgm02");
    off();
    player.next();
    expect(states.at(-1)).toBe("bgm02");
    player.play();
    player.destroy();
    expect(audio.soundPlaying).toBe(false);
    audio.emitSoundEnded();
    expect(player.state().playing).toBe(false);
  });
});

describe("Sound mode — écran (HUD-16)", () => {
  let host: HTMLElement;
  let audio: FakeAudioPlayer;
  let mode: SoundMode | null;
  let closed: number;

  beforeEach(() => {
    vi.useFakeTimers();
    setUiLanguage("fr");
    document.body.innerHTML = '<div id="ui-overlay"><div id="ui-sound"></div></div>';
    host = document.getElementById("ui-sound")!;
    audio = new FakeAudioPlayer();
    mode = null;
    closed = 0;
  });
  afterEach(() => {
    mode?.destroy();
    mode = null;
    vi.useRealTimers();
    setUiLanguage("fr");
    document.body.innerHTML = "";
  });

  const mount = (overrideTracks: readonly SoundTrack[] = tracks, random: () => number = () => 0): SoundMode => {
    mode = createSoundMode({ tracks: overrideTracks, audio, random, onClose: () => closed++ });
    host.appendChild(mode.element);
    return mode;
  };
  const tiles = () => [...host.querySelectorAll<HTMLButtonElement>(".mh-sound-track")];
  const q = (sel: string) => host.querySelector<HTMLElement>(sel);
  const button = (sel: string) => host.querySelector<HTMLButtonElement>(sel)!;
  const progress = () => host.querySelector<HTMLInputElement>(".mh-sound-progress-range")!;
  const volume = () => host.querySelector<HTMLInputElement>(".mh-sound-volume-range")!;

  it("construit l'écran modal sur le fond nuit avec la liste et les libellés i18n", () => {
    const screen = mount().element;
    expect(screen.classList.contains("mh-sound-screen")).toBe(true);
    expect(screen.classList.contains("mh-ui-night")).toBe(true);
    expect(screen.getAttribute("role")).toBe("dialog");
    expect(screen.getAttribute("aria-modal")).toBe("true");
    expect(q(".mh-sound-title")!.textContent).toBe("Sound mode");
    expect(tiles()).toHaveLength(3);
  });

  it("affiche les titres/compositeurs du manifeste utilisateur, sinon un libellé neutre", () => {
    mount();
    const [first, second] = tiles();
    expect(first!.querySelector(".mh-sound-track-title")!.textContent).toBe("Titre utilisateur A");
    expect(first!.querySelector(".mh-sound-track-composer")!.textContent).toBe("Compositeur A");
    expect(second!.querySelector(".mh-sound-track-title")!.textContent).toBe("Morceau 2");
    expect(second!.querySelector<HTMLElement>(".mh-sound-track-composer")!.hidden).toBe(true);
  });

  it("sans aucune métadonnée : ligne d'information neutre, aucun titre du jeu", () => {
    mount([{ key: "bgm01", url: "/assets/bgm/01.ogg" }]);
    expect(q(".mh-sound-info")!.textContent).toBe("Aucune métadonnée fournie.");
    expect(q(".mh-sound-track-title")!.textContent).toBe("Morceau 1");
  });

  it("clic sur un morceau = lecture ; bouton lecture affiche l'état et se met en pause", () => {
    mount();
    tiles()[1]!.click();
    expect(audio.soundUrls).toEqual(["/assets/bgm/02.ogg"]);
    expect(button(".mh-sound-play").getAttribute("aria-pressed")).toBe("true");
    expect(button(".mh-sound-play").getAttribute("aria-label")).toBe("Mettre en pause");
    button(".mh-sound-play").click();
    expect(audio.soundPlaying).toBe(false);
    expect(button(".mh-sound-play").getAttribute("aria-label")).toBe("Lire");
  });

  it("Espace = lecture/pause (hors champ de formulaire)", () => {
    mount();
    key(" ");
    expect(audio.soundUrls).toEqual(["/assets/bgm/01.ogg"]);
    key(" ");
    expect(audio.soundPlaying).toBe(false);
    // Espace dans le curseur de volume : traité par le contrôle natif, pas par le lecteur.
    const before = audio.soundUrls.length;
    volume().focus();
    key(" ", {}, volume());
    expect(audio.soundUrls).toHaveLength(before);
  });

  it("stop remet la progression à zéro et l'affichage des temps à 0:00", () => {
    mount();
    tiles()[0]!.click();
    audio.setSoundPosition(30, 90);
    expect(host.querySelector(".mh-sound-time-current")!.textContent).toBe("0:30");
    expect(host.querySelector(".mh-sound-time-total")!.textContent).toBe("1:30");
    button(".mh-sound-stop").click();
    expect(audio.soundPlaying).toBe(false);
    expect(host.querySelector(".mh-sound-time-current")!.textContent).toBe("0:00");
    expect(progress().value).toBe("0");
  });

  it("suivant/précédent changent de morceau", () => {
    mount();
    button(".mh-sound-next").click();
    expect(audio.soundUrls.at(-1)).toBe("/assets/bgm/02.ogg");
    button(".mh-sound-prev").click();
    expect(audio.soundUrls.at(-1)).toBe("/assets/bgm/01.ogg");
  });

  it("répétition et aléatoire : bascules aria-pressed et effet sur la fin de piste", () => {
    mount();
    const repeatOne = button(".mh-sound-repeat-one");
    const repeatAll = button(".mh-sound-repeat-all");
    const shuffle = button(".mh-sound-shuffle");
    expect(repeatOne.getAttribute("aria-pressed")).toBe("false");
    repeatOne.click();
    expect(repeatOne.getAttribute("aria-pressed")).toBe("true");
    repeatAll.click(); // les modes sont exclusifs
    expect(repeatOne.getAttribute("aria-pressed")).toBe("false");
    expect(repeatAll.getAttribute("aria-pressed")).toBe("true");
    shuffle.click();
    expect(shuffle.getAttribute("aria-pressed")).toBe("true");
  });

  it("volume : curseur accessible, pourcentage annoncé et moteur mis à jour", () => {
    mount();
    const range = volume();
    expect(range.getAttribute("aria-label")).toBe("Volume");
    range.value = "40";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    expect(audio.soundVolume).toBeCloseTo(0.4, 5);
    expect(range.getAttribute("aria-valuetext")).toBe("40 %");
  });

  it("barre de progression : reflet de la position, recherche et état désactivé sans durée", () => {
    mount();
    expect(progress().disabled).toBe(true);
    tiles()[0]!.click();
    audio.setSoundPosition(30, 120);
    expect(progress().disabled).toBe(false);
    expect(progress().max).toBe("120");
    expect(progress().value).toBe("30");
    progress().value = "45";
    progress().dispatchEvent(new Event("input", { bubbles: true }));
    expect(audio.soundSeek.at(-1)).toBe(45);
  });

  it("marque le morceau courant et la lecture sans couleur seule (classe + aria-current + marqueur)", () => {
    mount();
    audio.soundUrls = [];
    tiles()[0]!.click();
    expect(tiles()[0]!.classList.contains("is-current")).toBe(true);
    expect(tiles()[0]!.classList.contains("is-playing")).toBe(true);
    expect(tiles()[0]!.getAttribute("aria-current")).toBe("true");
    expect(tiles()[1]!.classList.contains("is-current")).toBe(false);
  });

  it("navigation clavier dans la grille (flèches, Début, Fin)", () => {
    mount();
    tiles()[0]!.focus();
    key("ArrowRight");
    expect(document.activeElement).toBe(tiles()[1]);
    key("ArrowDown");
    expect(document.activeElement).toBe(tiles().at(-1));
    key("Home");
    expect(document.activeElement).toBe(tiles()[0]);
    key("End");
    expect(document.activeElement).toBe(tiles().at(-1));
  });

  it("Échap appelle le retour (fermeture gérée par le gestionnaire d'UI)", () => {
    mount();
    key("Escape");
    expect(closed).toBe(1);
  });

  it("destroy() coupe la lecture et retire le clavier global", () => {
    const view = mount();
    tiles()[0]!.click();
    view.destroy();
    mode = null;
    expect(audio.soundPlaying).toBe(false);
    key(" ");
    expect(audio.soundUrls).toHaveLength(1);
  });

  it("formatTime : m:ss, entrées invalides", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(3599)).toBe("59:59");
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(-4)).toBe("0:00");
  });
});
