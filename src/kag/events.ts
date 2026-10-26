/**
 * Contrat de sortie du runtime KAG.
 *
 * Données pures, sérialisables en JSON, sans DOM.
 * Ce fichier n'importe que depuis ./types.js.
 */
import type { AnimationDef, Layer, TextSegment } from "./types.js";

/** Durée en millisecondes. */
export type Ms = number;

/**
 * Chemin logique d'un asset tel qu'écrit dans le script.
 * La résolution en URL est faite côté renderer/player.
 */
export type AssetRef = string;

// ── Scène (état affiché, normalisé : pas de fore/back) ──

/** État d'un sprite / layer tel qu'il doit être affiché. */
export type SpriteState = {
  /** Identifiant stable du layer KAG (valeur de `layer=` ou index). */
  id: string;
  storage: AssetRef;
  /** Position horizontale (center). */
  x: number;
  /** Position verticale (vcenter). */
  y: number;
  /** Ordre d'empilement, plus grand = devant. */
  z: number;
  /** Opacité entre 0 et 1. */
  opacity: number;
};

/** Effet visuel appliqué sur la scène. */
export type EffectState =
  | { kind: "noise"; opacity: number; monocro?: boolean }
  | { kind: "haze"; power: number; delta: number; omega: number }
  | { kind: "stophaze" };

/** État complet de la scène à afficher. */
export type SceneState = {
  bg: AssetRef | null;
  sprites: readonly SpriteState[];
  effect: EffectState | null;
};

/** Spécification d'une transition entre deux scènes. */
export type TransitionSpec =
  | { method: "none" }
  | { method: "crossfade"; time: Ms }
  | { method: "universal"; time: Ms; rule: AssetRef; vague: number };

/** Spécification d'un tremblement d'écran. */
export type QuakeSpec = {
  /** null = jusqu'à un événement quake: null. */
  time: Ms | null;
  hmax: number;
  vmax: number;
};

/** État de la textbox et de sa bordure. */
export type TextboxState = { visible: boolean; frame: boolean };

/** État du staffroll. */
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
  | { kind: "play"; channel: AudioChannel; storage: AssetRef; loop: boolean; volume: number; fadeIn?: Ms }
  | { kind: "stop"; channel: AudioChannel | "allSe"; fadeOut?: Ms }
  | { kind: "fade"; channel: AudioChannel; volume: number; time: Ms };

/** Instantané audio utile pour les sauvegardes. */
export type AudioSnapshot = {
  /** Sons en boucle actifs au moment du snapshot (BGM incluse). */
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
  /** Effet visuel (noise / haze) ou arrêt. */
  | { kind: "effect"; effect: EffectState }
  /** Événement audio. */
  | { kind: "audio"; event: AudioEvent };

// ── Points d'arrêt ──

export type Awaitable = "transition" | "animation" | "quake" | "audio";

export type StopReason =
  /** [l] = "line", [p] = "page". */
  | { kind: "click"; style: "line" | "page" }
  /** @wait */
  | { kind: "wait"; time: Ms; skippable: boolean }
  /** [wt] / [wa] / [wq] / [ws]. */
  | { kind: "waitFor"; what: Awaitable; target?: string; skippable: boolean }
  /** Choix multiple. */
  | { kind: "choice"; options: readonly { label: string; target: string }[] }
  /** Le runtime a besoin d'un script non chargé. */
  | { kind: "loadScript"; file: string; label?: string }
  /** Fin du script. */
  | { kind: "end" };

/** Résultat d'un `runtime.step()` : exécution jusqu'au prochain point bloquant. */
export type Step = {
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
