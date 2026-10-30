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
};

/** Effet visuel appliqué sur la scène.
 *
 * `null` dans `SceneState.effect` signifie "aucun effet".
 * Pour arrêter un effet, le runtime émet `{ kind: "effect", effect: null }`.
 */
export type EffectState =
  | { kind: "noise"; opacity: number; monocro?: boolean }
  | { kind: "haze"; power: number; delta: number; omega: number };

/** État complet de la scène à afficher. */
export type SceneState = {
  bg: AssetRef | null;
  /** Position explicite du fond (pixels, repère 1024×576). */
  bgLeft?: number;
  bgTop?: number;
  sprites: readonly SpriteState[];
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

/** État de la textbox et de sa bordure. */
export type TextboxState = { visible: boolean; frame: boolean };

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
  lines: readonly { text: string; y: number; size: number; face?: string; cmx?: number }[];
  face?: string;
  running: boolean;
  height: number;
  time: number;
  elapsed: number;
} | null;

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
  /** Lance une animation sur un sprite. */
  | { kind: "animate"; target: string; def: AnimationDef }
  /** Arrête une animation. */
  | { kind: "stopAnimation"; target?: string }
  /** Termine immédiatement la transition en cours. */
  | { kind: "stopTransition" }
  /** Démarre ou arrête un tremblement d'écran. */
  | { kind: "quake"; quake: QuakeSpec | null }
  /** Affiche ou masque la textbox et sa bordure. */
  | { kind: "textbox"; state: TextboxState; time: Ms }
  /** Vide la textbox. */
  | { kind: "clearText" }
  /** Ajoute du texte (le typewriter est géré côté renderer). */
  | { kind: "text"; segments: readonly TextSegment[] }
  /** Saut de ligne explicite. */
  | { kind: "lineBreak" }
  /** Met à jour le staffroll. */
  | { kind: "staffroll"; state: StaffrollState }
  /** Effet visuel (noise / haze). `null` dans SceneState = aucun effet. */
  | { kind: "effect"; effect: EffectState | null }
  /** Active (ou, avec `null`, retire) la bulle « ploy ». */
  | { kind: "ploy"; ploy: PloyState | null }
  /** Événement audio. */
  | { kind: "audio"; event: AudioEvent };

// ── Points d'arrêt ──

export type Awaitable = "transition" | "animation" | "quake" | "audio";

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
  staffroll: StaffrollState;
};
