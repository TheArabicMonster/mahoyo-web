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

export type TextAnimation = "fade" | "none";
export type AutoClickAction = "skip" | "cancel";
export type FastForwardKey = "enter" | "shift" | "ctrl";
export type FastForwardScope = "all" | "read";
export type FullscreenMode = "fit" | "fill" | "none";
export type WindowSize =
  | "fit"
  | "1024x576"
  | "1920x1080"
  | "1600x900"
  | "1440x810"
  | "1280x720"
  | "800x450"
  | "640x360";
export type MouseMode = "menu" | "hideThenMenu";

export type DisplaySettings = {
  /** ms par caractère pour une page non lue, 0 = instantané. */
  textSpeedUnread: Ms;
  /** ms par caractère pour une page déjà lue, 0 = instantané. */
  textSpeedRead: Ms;
  /** Afficher toute la page d'un coup (texte non lu / déjà lu). */
  instantUnreadPage: boolean;
  instantReadPage: boolean;
  /** Délai après la fin d'une page en mode auto (ms). */
  autoPageDelay: Ms;
  /** Délai après une attente de ligne `[l]` en mode auto (ms). */
  autoLineDelay: Ms;
  /** Clic en mode auto : sauter l'animation ou arrêter l'auto. */
  autoClick: AutoClickAction;
  /** Entrer en skip automatiquement sur une page déjà lue. */
  autoSkipRead: boolean;
  /** Demander confirmation avant ce skip automatique. */
  autoSkipConfirm: boolean;
  /** Touche maintenue pour accélérer la frappe. */
  fastForwardKey: FastForwardKey;
  /** Portée de l'avance rapide. */
  fastForwardScope: FastForwardScope;
  /** Fondu d'apparition de la page de texte. */
  textAnimation: TextAnimation;
  /** Atténuer le texte déjà lu, avec un fondu de `readFadeDuration`. */
  readFade: boolean;
  readFadeDuration: Ms;
  readFadeOpacity: number;
  /** Pile CSS de la police du texte ("" = police du port). */
  fontFamily: string;
  /** Multiplicateur de taille de police (1 = défaut). */
  fontScale: number;
  /** Opacité de la textbox entre 0 et 1. */
  textboxOpacity: number;
  /** Échelle appliquée en plein écran. */
  fullscreenMode: FullscreenMode;
  /** Taille d'affichage maximale en fenêtre (adaptation web). */
  windowSize: WindowSize;
  /** Clic droit : menu direct, ou masquer le texte puis menu. */
  mouseMode: MouseMode;
  /** Masquer le curseur après inactivité. */
  autoHideCursor: boolean;
  /** À la fin d'une page, amener les effets en cours à leur état final. */
  instantEffects: boolean;
  /** Un clic peut-il interrompre une animation/transition en cours ? */
  stopAnimations: boolean;
  /** Un `clearText` de changement de page vide le texte. */
  clearTextOnPageChange: boolean;
  /** Afficher les effets spéciaux (noise, haze, tremblements). */
  specialEffects: boolean;
  /**
   * Réduire les animations de l'interface (#99) : fondus d'écrans/panneaux neutralisés (tokens de
   * mouvement à 0 et attribut `data-reduce-motion` sur <html>), en plus de `prefers-reduced-motion`.
   * La frappe du texte reste pilotée par les réglages de texte du jeu.
   */
  reduceMotion: boolean;
};

export type AudioSettings = {
  /** Tous les volumes en 0..1. */
  master: number;
  bgm: number;
  se: number;
  /** Sons d'interface (menu, clics). */
  system: number;
  voice: number;
  muted: boolean;
  bgmMuted: boolean;
  seMuted: boolean;
  systemMuted: boolean;
};

/** Valeurs par défaut des réglages d'affichage (#177), partagées par le player et le renderer. */
export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  textSpeedUnread: 36,
  textSpeedRead: 26,
  instantUnreadPage: false,
  instantReadPage: false,
  autoPageDelay: 3000,
  autoLineDelay: 2200,
  autoClick: "cancel",
  autoSkipRead: false,
  autoSkipConfirm: true,
  fastForwardKey: "shift",
  fastForwardScope: "read",
  textAnimation: "fade",
  readFade: true,
  readFadeDuration: 1500,
  readFadeOpacity: 0.4,
  fontFamily: "",
  fontScale: 1,
  textboxOpacity: 0.8,
  fullscreenMode: "fit",
  windowSize: "fit",
  mouseMode: "menu",
  autoHideCursor: false,
  instantEffects: false,
  // Le port garde le clic qui saute les animations (comportement historique) ; la capture
  // d'origine montre « Non », réglable dans l'onglet Son/Effet.
  // Capture d'origine (#316) : « Non » — un clic ne doit pas couper les fondus de scène.
  stopAnimations: false,
  clearTextOnPageChange: true,
  specialEffects: true,
  reduceMotion: false,
};

/** Valeurs par défaut audio (#177). */
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  master: 1,
  bgm: 0.7,
  se: 0.6,
  system: 0.5,
  voice: 1,
  muted: false,
  bgmMuted: false,
  seMuted: false,
  systemMuted: false,
};

// ── Options communes ──

export type RunOptions = {
  /**
   * true = mode skip ou restauration : état final appliqué immédiatement,
   * sans typewriter, transition ni animation (les boucles infinies restent actives).
   */
  instant: boolean;
  /** Vitesse de frappe de cette page (ms/caractère) ; absent = vitesse non lue. */
  textSpeed?: Ms;
  /**
   * Annulation (load, retour titre). Après un abort, les promesses se RÉSOLVENT
   * (elles ne rejettent pas) et le renderer reste dans un état cohérent.
   * Concerne aussi la frappe du texte en cours (`runTypewriter`) : elle s'arrête
   * sans attendre la fin de la page, sinon un retour au titre pendant une longue
   * page reste suspendu à la durée de frappe restante (#231).
   */
  signal: AbortSignal;
};

// ── Rendu visuel ──

/** Dépendances injectées dans StageRenderer. */
export type StageRendererDeps = {
  resolver: AssetResolver;
  /** Manifeste des dimensions d'images (#315), chargé au démarrage ; absent = décodage à la volée. */
  imageDimensions?: Record<string, { width: number; height: number }>;
  /**
   * Effets d'ambiance `envcolor.ksc` (`effect=屋外深夜`…), chargés par le player quand les
   * données du jeu sont installées. Absent : ces effets ne sont pas appliqués (avertissement).
   */
  envEffects?: import("@/kag/envcolor.js").EnvColorTable;
};

/** Factory pour instancier un StageRenderer. */
export type StageRendererFactory = (deps: StageRendererDeps) => StageRenderer;

/** État lu par le mode revue (#400) : calques de timeline et transition en cours. */
export type StageReviewState = {
  transition: { method: string; timeMs: number; elapsedMs: number } | null;
  timelineLayers: { id: string; storage: string; x: number; y: number; opacity: number; z: number }[];
};

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
  waitFor(
    what: Exclude<Awaitable, "audio" | "bgmFade">,
    target: string | undefined,
    signal: AbortSignal,
  ): Promise<void>;

  /** Lecture seule pour le mode revue (#400) : calques de timeline et transition en cours. */
  reviewState?(): StageReviewState;

  /** Clic utilisateur : termine le typewriter et amène les effets à leur état final. */
  hurry(): void;

  /**
   * Termine **uniquement** la frappe en cours (texte), sans couper une transition/effet en cours
   * (#316) : un clic pendant la frappe ne doit pas tronquer un fondu.
   */
  hurryText?(): void;

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

  /**
   * Prépare une image (lookahead) : décodage mutualisé, cache LRU alimenté seulement au succès
   * (#386). `decode:false` se contente de charger/référencer.
   */
  prepare?(url: string, opts?: { decode?: boolean }): Promise<void>;

  /** Capture de l'écran courant pour les vignettes de sauvegarde. */
  captureThumbnail(maxWidth: number): Promise<Blob | null>;

  /**
   * Résout quand le fond courant est affiché **et décodé** (deux rAF), pour les tests/e2e (#373).
   * Résout immédiatement sans fond, ou après au plus 1 s si le chargement échoue.
   */
  whenReady?(): Promise<void>;

  setSettings(settings: Readonly<DisplaySettings>): void;

  /** Écran vide (retour titre, nouvelle partie). */
  clear(): void;

  dispose(): void;
}

// ── Audio ──

/** Dépendances injectées dans AudioPlayer. */
export type AudioPlayerDeps = {
  resolver: AssetResolver;
  /** Cache partagé des médias préchargés (lookahead #394) : un seul élément par URL. */
  audioPreloads?: Map<string, HTMLAudioElement>;
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

  /**
   * [wb] : résout à la fin du fondu du canal (immédiatement si aucun fondu en cours).
   * Différent de `waitFor` (fin de lecture) : ici on attend la fin d'un `fadeOut`/`fadeIn`.
   */
  waitForFade(channel: AudioChannel, signal: AbortSignal): Promise<void>;

  restore(snapshot: AudioSnapshot): void;

  /**
   * Abonnement à la fin naturelle d'un canal (ou erreur) : le player libère le canal SE du pool
   * du runtime (#358). Retourne la fonction de désabonnement.
   */
  onChannelEnded?(listener: (channel: AudioChannel) => void): () => void;

  stopAll(fadeOut?: Ms): void;

  /** Bip synthétique de test au volume SE courant (aucun asset requis). */
  testSe(): void;

  setSettings(settings: Readonly<AudioSettings>): void;

  /** Onglet masqué ou pause. Appelé par le player sur `visibilitychange`. */
  suspend(): void;
  resume(): void;

  dispose(): void;
}
