/**
 * Contrat de sortie du runtime KAG.
 *
 * Données pures, sérialisables en JSON, sans DOM.
 * Ce fichier n'importe que depuis ./types.js.
 */
import type { AnimationDef, TextSegment } from "./types.js";

/** Durée en millisecondes. */
export type Ms = number;

/**
 * Chemin logique d'un asset tel qu'écrit dans le script.
 * La résolution en URL est faite côté renderer/player via `AssetResolver`.
 */
export type AssetRef = string;

/** Position stable d'un point d'arrêt dans le déroulement du jeu. */
export type Position = {
  /** Nom du script courant (ex: "1-0.ks"). */
  scriptName: string;
  /** Index de la page dans le script. */
  page: number;
  /** Index de l'instruction dans la page. */
  instruction: number;
  /** Index du segment dans l'instruction texte (utile pour les pauses [l]). */
  segment?: number;
};

// ── Scène (état affiché, normalisé : pas de fore/back) ──

/** État d'un sprite / layer tel qu'il doit être affiché.
 *
 * Les coordonnées x/y sont exprimées dans la résolution de référence 1280×720.
 * Le renderer applique le scaling nécessaire pour l'affichage réel.
 */
export type SpriteState = {
  /** Identifiant stable du layer KAG (valeur de `layer=` ou index). */
  id: string;
  storage: AssetRef;
  /** Position horizontale (center), en pixels dans la résolution 1280×720. */
  x: number;
  /** Position verticale (vcenter), en pixels dans la résolution 1280×720. */
  y: number;
  /** Ordre d'empilement, plus grand = devant. */
  z: number;
  /** Opacité entre 0 et 1. */
  opacity: number;
  /** `@layopt visible=0` : sprite masqué sans être retiré de la scène. Absent = visible. */
  visible?: boolean;
  /**
   * Zoom en % (100 = taille d'origine, négatif = miroir) et rotation en degrés (sens horaire),
   * autour du centre du sprite. Absents = neutres.
   */
  zoomx?: number;
  zoomy?: number;
  rotate?: number;
  /** Si défini, ce sprite est un partbg (crop viewport @partbg). */
  crop?: {
    width: number;
    height: number;
    srcLeft: number;
    srcTop: number;
    srcZoomX: number;
    srcZoomY: number;
    bgStorage?: string;
  };
  /** Pour @fg/@fgact partbgid= : id du partbg parent (clipage). */
  partbgId?: string;
  /**
   * Apparence du calque, telle que le moteur la lit (`type=`, `effect=`, `blur`, `brightness`,
   * `contrast`). Absents = valeurs par défaut (fusion alpha, aucun filtre).
   */
  type?: number;
  effect?: string;
  brightness?: number;
  contrast?: number;
  blurx?: number;
  blury?: number;
};

/** Effet visuel appliqué sur la scène.
 *
 * `null` dans `SceneState.effect` signifie "aucun effet".
 * Pour arrêter un effet, le runtime émet `{ kind: "effect", effect: null }`.
 */
export type EffectState =
  | { kind: "noise"; opacity: number; monocro?: boolean }
  | { kind: "haze"; power: number; delta: number; omega: number }
  /**
   * Lignes de concentration (`@focusline`, focuslineplugin.tjs) — approximation : lignes radiales
   * dessinées en canvas autour de (`cx`, `cy`), longueurs et nombre tirés dans les bornes.
   * `opacity` 0..1 ; `appear` = durée d'apparition (ms) avant figement.
   */
  | {
      kind: "focusline";
      cx: number;
      cy: number;
      minLength: number;
      maxLength: number;
      minLines: number;
      maxLines: number;
      appear: Ms;
      color: string;
      opacity: number;
    };

/**
 * Secousse d'écran (`@shake` / `@swing`, override `tagex.tjs`) : oscillation appliquée à la scène
 * entière. `time: null` = continue jusqu'à l'arrêt (`@stopswing`).
 */
export type ScreenShakeSpec =
  | { mode: "shake"; vmax: number; hmax: number; cycle: Ms; time: Ms | null }
  | {
      mode: "swing";
      minCycle: Ms;
      maxCycle: Ms;
      minVibration: number;
      maxVibration: number;
      rate: number;
      time: Ms | null;
    };

/** État complet de la scène à afficher. */
export type SceneState = {
  bg: AssetRef | null;
  /** Position explicite du fond (pixels, repère 1024×576). */
  bgLeft?: number;
  bgTop?: number;
  /**
   * Zoom du fond en % (100 = taille d'origine) et rotation en degrés, autour du centre de
   * l'image placée en (`bgLeft`, `bgTop`). Absents = neutres.
   */
  bgZoomX?: number;
  bgZoomY?: number;
  bgRotate?: number;
  sprites: readonly SpriteState[];
  /**
   * Apparence du fond (`@bg type=/effect=/blur/brightness/contrast`) ; absente = défauts
   * (fusion alpha, aucun filtre). Même sémantique que `SpriteState` (voir `AppearanceArgs`).
   */
  bgType?: number;
  bgEffect?: string;
  bgBrightness?: number;
  bgContrast?: number;
  /**
   * `@bindbg enabled=1` : les calques de la page suivent les panoramiques du fond (`bgMove`).
   * Approximation : le décalage est visuel (transient), les positions logiques sauvegardées ne
   * sont pas déplacées.
   */
  bindChildren?: boolean;
  bgBlurX?: number;
  bgBlurY?: number;
  /** null = aucun effet actif. */
  effect: EffectState | null;
};

/** Spécification d'une transition entre deux scènes.
 *
 * `time` est toujours en millisecondes.
 * `vague` est une valeur sans unité (0–255) contrôlant la netteté de la rule.
 */
export type TransitionSpec =
  | { method: "none" }
  | { method: "crossfade"; time: Ms }
  | { method: "universal"; time: Ms; rule: AssetRef; vague: number };

/** Spécification d'un tremblement d'écran.
 *
 * `time` en millisecondes ; `null` = jusqu'à un événement `quake: null`.
 * `hmax` et `vmax` sont en pixels dans la résolution 1280×720.
 */
export type QuakeSpec = {
  time: Ms | null;
  hmax: number;
  vmax: number;
};

/**
 * Calque d'une timeline (@playtimeline) : carton de générique, personnage, image en
 * surimpression. Coordonnées du centre de l'image dans le repère 1024×576.
 * Ces calques sont transitoires : ils n'appartiennent pas à `SceneState` et
 * disparaissent à la fin de la séquence.
 */
export type TimelineLayerState = {
  id: string;
  storage: AssetRef;
  x: number;
  y: number;
  /** Opacité 0..1. */
  opacity: number;
  /** Ordre d'empilement, plus grand = devant. */
  z: number;
  /** Pluie animée par-dessus l'image. */
  rain?: boolean;
  /** Zoom en % (100 par défaut ; négatif = miroir), rotation en degrés (0 par défaut). */
  zoomx?: number;
  zoomy?: number;
  rotate?: number;
  /** Point d'ancrage du zoom et de la rotation, en px dans l'image ; absent = centre. */
  afx?: number;
  afy?: number;
};

/**
 * État de la textbox et de son cadre.
 * - `frame` : cadre affiché (`@visibleframe`) ou masqué (`@invisibleframe`).
 * - `frameImage` : image de cadre posée par `@position frame=…` (`txtwindow00/01/02`) ; absente
 *   tant qu'aucun script ne l'a fixée (le renderer applique alors son cadre par défaut), `""` pour
 *   un cadre sans image (#173).
 */
export type TextboxState = { visible: boolean; frame: boolean; frameImage?: string };

/**
 * Bulle « ploy » active (scripts omake). `mode` est la valeur brute de
 * `@ploysay mode=...` ; `ox`/`oy` sont les décalages en pixels (repère 1024×576).
 */
export type PloyState = { mode: string; ox: number; oy: number };

/** État du staffroll.
 *
 * `time` est la durée totale du défilement en millisecondes.
 * `elapsed` est le temps déjà écoulé en millisecondes.
 */
export type StaffrollState = {
  lines: readonly {
    text: string;
    y: number;
    size: number;
    face?: string;
    cmx?: number;
    /** Couleur du texte au moment du @staffrolltext (style courant `@font`), sinon blanc. */
    color?: string;
  }[];
  face?: string;
  running: boolean;
  height: number;
  time: number;
  /**
   * Couleur de fond demandée par `@staffrollsetting bgcolor=…`. Le plugin d'origine stocke
   * cette valeur mais ne l'utilise jamais (aucun `fillRect` avec `bgcolor`) : c'est un paramètre
   * mort, conservé dans l'état mais **non peint** (aucun effet dans le jeu d'origine, #286).
   */
  bgcolor?: string;
  elapsed: number;
};

// ── Audio ──

export type AudioChannel = "bgm" | "voice" | `se:${number}`;

export type AudioEvent =
  | { kind: "play"; channel: AudioChannel; storage: AssetRef; loop: boolean; volume: number; fadeIn?: Ms; delay?: Ms }
  | { kind: "stop"; channel: AudioChannel | "allSe"; fadeOut?: Ms }
  | { kind: "fade"; channel: AudioChannel; volume: number; time: Ms }
  /** Met un canal en pause (fondu vers le silence, puis la lecture est suspendue en gardant sa position). */
  | { kind: "pause"; channel: AudioChannel; fadeOut?: Ms }
  /** Reprend un canal en pause là où il s'était arrêté, avec un fondu d'entrée vers `volume`. */
  | { kind: "resume"; channel: AudioChannel; volume: number; fadeIn?: Ms };

/** Instantané audio utile pour les sauvegardes.
 *
 * Seuls les sons en boucle sont persistés (BGM + SE loopés).
 */
export type AudioSnapshot = {
  loops: readonly { channel: AudioChannel; storage: AssetRef; volume: number }[];
};

// ── Événements de rendu ──

export type RenderEvent =
  /** Passe à la scène cible. */
  | { kind: "scene"; scene: SceneState; transition: TransitionSpec }
  /**
   * Déplace le fond affiché jusqu'à (left, top) en `time` ms, en ligne droite ou accélérée
   * (panoramique d'une timeline). Repère 1024×576, comme `SceneState.bgLeft`. Avec `zoomx`,
   * `zoomy` ou `rotate` (zoom en %, rotation en degrés), le fond est aussi zoomé et tourné
   * autour du centre de son image. Le renderer remet le zoom à 100 et la rotation à 0 à
   * chaque nouveau fond ; un événement sans ces champs les laisse inchangés.
   */
  | { kind: "bgMove"; left: number; top: number; time: Ms; accel?: number; zoomx?: number; zoomy?: number; rotate?: number }
  /**
   * Pose un calque de timeline (`time` = 0) ou le fait glisser jusqu'à cet état en `time` ms
   * (position, opacité, zoom et rotation), en ligne droite ou avec l'accélération `accel`.
   */
  | { kind: "timelineLayer"; layer: TimelineLayerState; time: Ms; accel?: number }
  /** Retire tous les calques de timeline (fin de la séquence). */
  | { kind: "timelineLayerClear" }
  /** Lance une animation sur un sprite. */
  | { kind: "animate"; target: string; def: AnimationDef }
  /** Arrête une animation. */
  | { kind: "stopAnimation"; target?: string }
  /** Termine immédiatement la transition en cours. */
  | { kind: "stopTransition" }
  /** Démarre ou arrête un tremblement d'écran. */
  | { kind: "quake"; quake: QuakeSpec | null }
  /** Démarre ou arrête une secousse d'écran (`@shake`/`@swing`/`@stopswing`). */
  | { kind: "screenShake"; shake: ScreenShakeSpec | null }
  /**
   * Animation des propriétés du bruit (`@noiseact`) : fondu d'opacité `from` → `opacity` en `time`
   * ms, monocro appliqué à l'arrivée. Le runtime a déjà normalisé la cible.
   */
  | { kind: "noiseAct"; opacity: number; monocro: boolean; from: number; time: Ms }
  /** Affiche ou masque la textbox et sa bordure. */
  | { kind: "textbox"; state: TextboxState; time: Ms }
  /** Vide la textbox. */
  | { kind: "clearText" }
  /** Ajoute du texte (le typewriter est géré côté renderer). */
  | { kind: "text"; segments: readonly TextSegment[] }
  /** Saut de ligne explicite. */
  | { kind: "lineBreak" }
  /** Met à jour le staffroll (`null` = terminé/libéré par `@staffrolluninit`). */
  | { kind: "staffroll"; state: StaffrollState | null }
  /** Effet visuel (noise / haze). `null` dans SceneState = aucun effet. */
  | { kind: "effect"; effect: EffectState | null }
  /** Active (ou, avec `null`, retire) la bulle « ploy ». */
  | { kind: "ploy"; ploy: PloyState | null }
  /**
   * Verrouille (@lockquickmenu) ou déverrouille le menu rapide : sauvegarde, chargement et
   * leurs boutons. Sans effet sur l'écran : c'est le player qui l'applique.
   */
  | { kind: "quickMenu"; locked: boolean }
  /**
   * Suspend (@pauseautomode) ou reprend (@resumeautomode) l'avance automatique. Le mode choisi
   * par le joueur ne change pas : seul le déclenchement automatique est suspendu.
   */
  | { kind: "autoMode"; paused: boolean }
  /**
   * Réglages de skip (`@clickskip`, `@effectskip`) : comportements du player (clic, effets).
   * Absent = inchangé ; `true` = autorisé, `false` = interdit (sémantique KAG3).
   */
  | { kind: "skipSetting"; clickSkip?: boolean; effectSkip?: boolean }
  /** `@cancelskip` : sort du mode skip en cours (le player repasse en lecture normale). */
  | { kind: "cancelSkip" }
  /** Événement audio. */
  | { kind: "audio"; event: AudioEvent };

// ── Points d'arrêt ──

export type Awaitable =
  | "transition"
  | "animation"
  | "quake"
  | "audio"
  | "bgmFade"
  | "staffroll";

/** Événements à appliquer à un instant donné d'une séquence minutée. */
export type TimelineEntry = { at: Ms; events: readonly RenderEvent[] };

export type StopReason =
  /** [l] = "line", [p] = "page". */
  | { kind: "click"; style: "line" | "page" }
  /** @wait */
  | { kind: "wait"; time: Ms; skippable: boolean }
  /** [wt] / [wa] / [wq] / [ws]. */
  | { kind: "waitFor"; what: Awaitable; target?: string; skippable: boolean }
  /**
   * Séquence minutée (@playtimeline) : le player joue le calendrier d'événements
   * jusqu'à `duration`, ou d'un coup si le joueur la saute.
   */
  | { kind: "timeline"; schedule: readonly TimelineEntry[]; duration: Ms }
  /** Choix multiple. */
  | { kind: "choice"; options: readonly { label: string; target: string }[] }
  /** Le runtime a besoin d'un script non chargé. */
  | { kind: "loadScript"; file: string; label?: string; pushCallStack?: boolean }
  /** Fin du script. */
  | { kind: "end" };

/** Résultat d'un `runtime.step()` : exécution jusqu'au prochain point bloquant. */
export type Step = {
  /** Position dans le script où le runtime s'est arrêté. */
  position: Position;
  events: readonly RenderEvent[];
  stop: StopReason;
};

/** Ce qu'il faut pour réafficher instantanément l'écran (save, load, rollback). */
export type StageSnapshot = {
  scene: SceneState;
  textbox: TextboxState;
  text: readonly TextSegment[];
  staffroll: StaffrollState | null;
};
