/**
 * Journal d'exécution pour le diagnostic de fidélité (#318).
 *
 * Le runtime n'écrit ce journal que si `Runtime.onJournal` est défini (défaut : `null`, aucun
 * surcoût en production). Chaque entrée décrit une commande pertinente pour la comparaison
 * alignée par événement : paramètres du script, état résolu (pages fore/back), durée déclarée et
 * durée effective après facteur de vitesse, keyframes normalisés (`@bgact`, animations), et
 * transition résolue.
 *
 * L'outil de comparaison (`tools/journal-compare.ts`) aligne deux journaux sur le **n-ième
 * événement** de chaque commande (`@trans`, `@bgact`, …) au lieu de métriques « par seconde »,
 * biaisées par le rythme de lecture/langue. Aucun texte du jeu n'est journalisé.
 */
import type { AnimKeyframe, Instruction, PageLayer } from "./types.js";
import type { PageState } from "./runtime.js";
import type { StopReason, TransitionSpec } from "./events.js";

/** Commandes journalisées (visuel/fond/transition/timeline). */
export const JOURNAL_COMMANDS: ReadonlySet<string> = new Set([
  "trans",
  "bg",
  "bgact",
  "playtimeline",
  "fg",
  "chgfg",
  "partbg",
  "animate",
  "movefg",
  "movepartbg",
  "infg",
  "outfg",
  "layopt",
  "action",
  "dispclock",
  "tickclock",
]);

/** Résumé d'un calque (pas de DOM ni de tokens : entrée JSON compacte). */
export type JournalLayer = {
  id: string;
  storage: string;
  x: number;
  y: number;
  z: number;
  opacity: number;
  zoomx?: number;
  zoomy?: number;
  rotate?: number;
  /** Identité du partbg parent (clipage) le cas échéant. */
  partbgId?: string;
  crop?: { width: number; height: number; srcLeft: number; srcTop: number; srcZoomX: number; srcZoomY: number; bgStorage?: string };
};

/** Résumé d'une page (fond + calques triés par z). */
export type JournalPage = {
  background: string;
  bgLeft?: number;
  bgTop?: number;
  bgZoomX?: number;
  bgZoomY?: number;
  bgRotate?: number;
  layers: JournalLayer[];
};

/** Keyframe normalisé : temps absolu et durée depuis la keyframe précédente, propriétés séparées. */
export type JournalKeyframe = {
  time: number;
  duration: number;
  interp: "l" | "n" | "~";
  accel: number;
  props: Record<string, number | string | boolean>;
};

/** Entrée du journal d'exécution. */
export type RuntimeJournalEntry = {
  /** Numéro d'occurrence de cette commande dans l'exécution (1 = première). */
  occurrence: number;
  /** Nom de commande (kind interne ou nom brut pour raw/noop). */
  command: string;
  position: { scriptName: string; page: number; instruction: number; line?: number };
  /** Paramètres du script (champs scalaires ; keyframes/def résumés à part). */
  params: Record<string, unknown>;
  /** Page visée (`fore`/`back`), ou null pour une commande sans page. */
  page: PageLayer | null;
  /** Durée déclarée par le script (ms), ou null si la commande n'est pas minutée. */
  durationMs: number | null;
  /** Facteur de vitesse appliqué pour calculer la durée effective (1 = normal). */
  speedFactor: number;
  /** Durée effective = durée déclarée / facteur de vitesse. */
  effectiveDurationMs: number | null;
  /** Transition effectivement résolue (scene émise), si la commande en déclenche une. */
  transition: TransitionSpec | null;
  /** Keyframes normalisés (`@bgact`, animations). */
  keyframes?: JournalKeyframe[];
  /** État affiché (fore) après la commande. */
  fore: JournalPage;
  /** État préparé (back) après la commande. */
  back: JournalPage;
};

/** Copie compacte d'un `PageState` (sans les champs de rendu non pertinents). */
export function summarizePage(page: PageState, line = 0): JournalPage {
  void line;
  return {
    background: page.background,
    ...(page.bgLeft === undefined ? {} : { bgLeft: page.bgLeft }),
    ...(page.bgTop === undefined ? {} : { bgTop: page.bgTop }),
    ...(page.bgZoomX === undefined ? {} : { bgZoomX: page.bgZoomX }),
    ...(page.bgZoomY === undefined ? {} : { bgZoomY: page.bgZoomY }),
    ...(page.bgRotate === undefined ? {} : { bgRotate: page.bgRotate }),
    layers: [...page.layers]
      .sort((a, b) => a.index - b.index)
      .map((layer) => ({
        id: layer.id,
        storage: layer.storage,
        x: layer.center,
        y: layer.vcenter,
        z: layer.index,
        opacity: layer.opacity,
        ...(layer.zoomx === undefined ? {} : { zoomx: layer.zoomx }),
        ...(layer.zoomy === undefined ? {} : { zoomy: layer.zoomy }),
        ...(layer.rotate === undefined ? {} : { rotate: layer.rotate }),
        ...(layer.partbgId === undefined ? {} : { partbgId: layer.partbgId }),
        ...(layer.crop === undefined
          ? {}
          : {
              crop: {
                width: layer.crop.width,
                height: layer.crop.height,
                srcLeft: layer.crop.srcLeft,
                srcTop: layer.crop.srcTop,
                srcZoomX: layer.crop.srcZoomX,
                srcZoomY: layer.crop.srcZoomY,
                ...(layer.crop.bgStorage === undefined ? {} : { bgStorage: layer.crop.bgStorage }),
              },
            }),
      })),
  };
}

const KEYFRAME_PROPS = [
  "center",
  "vcenter",
  "left",
  "top",
  "opacity",
  "zoomx",
  "zoomy",
  "rotate",
  "absolute",
  "srcleft",
  "srctop",
  "srczoomx",
  "srczoomy",
  "brightness",
  "blurx",
  "blury",
] as const;

const KEYFRAME_DISCRETE = ["storage", "visible", "type", "effect", "contrast"] as const;

/** Normalise des keyframes d'animation pour le journal (temps absolu + propriétés séparées). */
export function normalizeJournalKeyframes(keyframes: readonly AnimKeyframe[]): JournalKeyframe[] {
  return keyframes.map((frame) => {
    const props: Record<string, number | string | boolean> = {};
    const record = frame as unknown as Record<string, unknown>;
    for (const prop of KEYFRAME_PROPS) {
      const value = record[prop];
      if (typeof value === "number") props[prop] = value;
    }
    for (const prop of KEYFRAME_DISCRETE) {
      const value = record[prop];
      if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") props[prop] = value;
    }
    return { time: frame.time, duration: frame.duration, interp: frame.interp, accel: frame.accel, props };
  });
}

/** Paramètres du script utiles au journal (champs scalaires, sans les tableaux volumineux). */
export function journalParams(instruction: Instruction): Record<string, unknown> {
  const record = instruction as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "kind" || key === "keyframes" || key === "def" || key === "crop") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  if (instruction.kind === "partbg" && instruction.crop) out.crop = instruction.crop;
  if (instruction.kind === "animate") {
    const def = instruction.def;
    out.animation = {
      storage: def.storage,
      page: def.page,
      id: def.id,
      loop: def.loop ?? false,
      partbgid: def.partbgid,
    };
  }
  return out;
}

/** Durée déclarée d'une commande (ms), ou null si elle n'est pas minutée. */
export function journalDurationMs(
  instruction: Instruction,
  stop?: StopReason | null,
): number | null {
  switch (instruction.kind) {
    case "trans":
    case "bg":
    case "partbg":
    case "fg":
    case "chgfg":
      return instruction.time ?? null;
    case "infg":
    case "outfg":
      return instruction.time;
    case "action":
      return instruction.time;
    case "animate":
      return instruction.def.keyframes[instruction.def.keyframes.length - 1]?.time ?? null;
    case "bgact":
      return instruction.keyframes[instruction.keyframes.length - 1]?.time ?? null;
    case "playtimeline":
      return stop?.kind === "timeline" ? stop.duration : null;
    default:
      return null;
  }
}

/** Transition résolue par une commande, lue dans les événements émis (scene). */
export function journalTransition(
  instruction: Instruction,
  events: readonly { kind: string; transition?: TransitionSpec }[],
): TransitionSpec | null {
  const scene = events.find((event) => event.kind === "scene") as { transition?: TransitionSpec } | undefined;
  if (!scene?.transition) return null;
  // Une scène « none » sans time n'est pas une transition : on ne la journalise pas.
  if (scene.transition.method === "none") return null;
  void instruction;
  return scene.transition;
}
