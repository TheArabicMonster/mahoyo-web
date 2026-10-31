/**
 * Contrats de sortie navigateur : rendu visuel et audio.
 *
 * Les implémentations sont passives : aucune gestion d'entrée utilisateur,
 * aucune décision de flux. Le player est l'unique orchestrateur.
 */
import type { AssetResolver } from "@/core/asset-resolver.js";
import type {
  AssetRef,
  AudioChannel,
  AudioEvent,
  AudioSnapshot,
  Awaitable,
  Ms,
  RenderEvent,
  StageSnapshot,
} from "@/kag/events.js";

// ── Réglages ──

export type DisplaySettings = {
  /** ms par caractère, 0 = instantané. */
  textSpeed: Ms;
  /** Délai après la fin du texte en mode auto (ms). */
  autoDelay: Ms;
  /** Multiplicateur de taille de police (1 = défaut). */
  fontScale: number;
  /** Opacité de la textbox entre 0 et 1. */
  textboxOpacity: number;
};

export type AudioSettings = {
  /** Tous les volumes en 0..1. */
  master: number;
  bgm: number;
  se: number;
  voice: number;
  muted: boolean;
};

// ── Options communes ──

export type RunOptions = {
  /**
   * true = mode skip ou restauration : état final appliqué immédiatement,
   * sans typewriter, transition ni animation (les boucles infinies restent actives).
   */
  instant: boolean;
  /**
   * Annulation (load, retour titre). Après un abort, les promesses se RÉSOLVENT
   * (elles ne rejettent pas) et le renderer reste dans un état cohérent.
   */
  signal: AbortSignal;
};

// ── Rendu visuel ──

/** Dépendances injectées dans StageRenderer. */
export type StageRendererDeps = {
  resolver: AssetResolver;
};

/** Factory pour instancier un StageRenderer. */
export type StageRendererFactory = (deps: StageRendererDeps) => StageRenderer;

export interface StageRenderer {
  /** Attache le rendu au DOM. Appelé une seule fois. */
  mount(root: HTMLElement): void;

  /**
   * Applique un lot d'événements (les événements `audio` sont ignorés : le player les route).
   * Résout quand le TEXTE est entièrement affiché. Les transitions, animations et
   * tremblements continuent ensuite en arrière-plan : utiliser `waitFor` pour les attendre.
   *
   * Le player ne peut appeler `apply()` qu'une fois à la fois (pas de concurrence).
   */
  apply(events: readonly RenderEvent[], opts: RunOptions): Promise<void>;

  /**
   * Résout quand l'effet ciblé est terminé ([wt], [wa], [wq]).
   * Résout immédiatement si rien n'est en cours.
   */
  waitFor(what: Exclude<Awaitable, "audio">, target: string | undefined, signal: AbortSignal): Promise<void>;

  /** Clic utilisateur : termine le typewriter et amène les effets à leur état final. */
  hurry(): void;

  /** Indicateur d'attente de clic, null = masqué. */
  setClickIndicator(style: "line" | "page" | null): void;

  /**
   * Indicateur d'attente non interruptible (`@wait canskip=0`…) : un petit anneau discret, visible même
   * quand la boîte de texte est masquée, pour que l'écran ne paraisse pas figé.
   */
  setWaitIndicator(active: boolean): void;

  /** Un clic a été ignoré par une attente non interruptible : fait réagir l'indicateur (un « pouls »). */
  nudgeWaitIndicator(): void;

  /** Masquage par l'utilisateur (clic droit), indépendant de l'état `textbox` du script. */
  setUserHidden(hidden: boolean): void;

  /** Réaffiche instantanément un snapshot (load, rollback). Précharge les assets nécessaires. */
  restore(snapshot: StageSnapshot, signal: AbortSignal): Promise<void>;

  /** Précharge et décode des images. Ne rejette pas : un asset manquant est loggé. */
  preload(assets: readonly AssetRef[], signal?: AbortSignal): Promise<void>;

  /** Capture de l'écran courant pour les vignettes de sauvegarde. */
  captureThumbnail(maxWidth: number): Promise<Blob | null>;

  setSettings(settings: Readonly<DisplaySettings>): void;

  /** Écran vide (retour titre, nouvelle partie). */
  clear(): void;

  dispose(): void;
}

// ── Audio ──

/** Dépendances injectées dans AudioPlayer. */
export type AudioPlayerDeps = {
  resolver: AssetResolver;
};

/** Factory pour instancier un AudioPlayer. */
export type AudioPlayerFactory = (deps: AudioPlayerDeps) => AudioPlayer;

export interface AudioPlayer {
  /**
   * Débloque l'AudioContext. DOIT être appelé de façon synchrone depuis
   * un handler de geste utilisateur (politique autoplay des navigateurs).
   */
  unlock(): Promise<void>;

  /** En mode instant, les fondus sont réduits à zéro et les effets non bouclés ignorés. */
  apply(event: AudioEvent, opts: { instant: boolean }): void;

  /**
   * [ws] : résout quand le son du canal est terminé (immédiatement si le canal boucle ou est vide).
   * Le player convertit la `target` string en `AudioChannel` avant d'appeler cette méthode.
   */
  waitFor(channel: AudioChannel, signal: AbortSignal): Promise<void>;

  restore(snapshot: AudioSnapshot): void;

  stopAll(fadeOut?: Ms): void;

  setSettings(settings: Readonly<AudioSettings>): void;

  /** Onglet masqué ou pause. Appelé par le player sur `visibilitychange`. */
  suspend(): void;
  resume(): void;

  dispose(): void;
}
