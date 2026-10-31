/**
 * Timelines d'animation (format « TLA » du jeu d'origine), version simplifiée.
 *
 * Certains scripts (`opening.ks`, les menus système) embarquent une timeline : un
 * projet d'animation avec des pistes audio et des objets visuels. Le pipeline en
 * extrait `timelines.json` ; ce module décrit et valide ces données. Le runtime les
 * rejoue sous forme d'un calendrier d'événements (voir `@playtimeline`).
 *
 * Sont repris : le fond visible (dans l'ordre où les pages de la timeline le
 * montrent), ses panoramiques (`left`/`top` animés) et les pistes audio. Les
 * calques, zooms, rotations et effets de la timeline d'origine ne le sont pas.
 */

/** Une action audio de la timeline. */
export type TimelineAudio = {
  /** Instant (ms depuis le début de la timeline). */
  at: number;
  channel: "bgm" | "se";
  /** Piste concernée ; absent pour un simple changement de volume. */
  storage?: string;
  loop: boolean;
  /** Volume 0..1. */
  volume: number;
  /** `play` lance la piste ; `volume` ajuste la piste en cours. */
  action: "play" | "volume";
};

/** Un changement d'image de fond (un « plan » de la séquence). */
export type TimelineBg = {
  at: number;
  storage: string;
  /** Position du fond (px, repère 1024×576) ; absentes = centré. */
  left?: number;
  top?: number;
  /**
   * Durée du fondu enchaîné vers ce fond (ms) ; 0 = coupe franche. Absente (données
   * extraites avant #135) : le runtime applique son fondu par défaut.
   */
  fade?: number;
};

/** Panoramique : le fond affiché glisse jusqu'à une position, en ligne droite. */
export type TimelineMove = {
  at: number;
  /** Position atteinte (px, repère 1024×576). */
  left: number;
  top: number;
  /** Durée du déplacement (ms) ; 0 = saut immédiat. */
  time: number;
};

export type TimelineScene = {
  name: string;
  /** Durée totale (ms). */
  duration: number;
  bg: TimelineBg[];
  /** Panoramiques du fond affiché (absents des données extraites avant #135). */
  moves?: TimelineMove[];
  audio: TimelineAudio[];
};

export type TimelineData = {
  version: 1;
  /** Scènes par nom de script puis par identifiant de scène. */
  scripts: Record<string, Record<string, TimelineScene>>;
};

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isBg(v: unknown): v is TimelineBg {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    isNum(b.at) &&
    typeof b.storage === "string" &&
    b.storage.length > 0 &&
    (b.left === undefined || isNum(b.left)) &&
    (b.top === undefined || isNum(b.top)) &&
    (b.fade === undefined || (isNum(b.fade) && b.fade >= 0))
  );
}

function isMove(v: unknown): v is TimelineMove {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return isNum(m.at) && isNum(m.left) && isNum(m.top) && isNum(m.time) && m.time >= 0;
}

function isAudio(v: unknown): v is TimelineAudio {
  if (typeof v !== "object" || v === null) return false;
  const a = v as Record<string, unknown>;
  return (
    isNum(a.at) &&
    (a.channel === "bgm" || a.channel === "se") &&
    (a.storage === undefined || typeof a.storage === "string") &&
    typeof a.loop === "boolean" &&
    isNum(a.volume) &&
    (a.action === "play" || a.action === "volume")
  );
}

function isScene(v: unknown): v is TimelineScene {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.name === "string" &&
    isNum(s.duration) &&
    Array.isArray(s.bg) &&
    s.bg.every(isBg) &&
    (s.moves === undefined || (Array.isArray(s.moves) && s.moves.every(isMove))) &&
    Array.isArray(s.audio) &&
    s.audio.every(isAudio)
  );
}

/** Valide des données désérialisées ; null si elles n'ont pas la forme attendue. */
export function parseTimelineData(data: unknown): TimelineData | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.version !== 1 || typeof d.scripts !== "object" || d.scripts === null) return null;
  const scripts: TimelineData["scripts"] = {};
  for (const [script, scenes] of Object.entries(d.scripts as Record<string, unknown>)) {
    if (typeof scenes !== "object" || scenes === null) return null;
    const out: Record<string, TimelineScene> = {};
    for (const [id, scene] of Object.entries(scenes as Record<string, unknown>)) {
      if (!isScene(scene)) return null;
      out[id] = scene;
    }
    scripts[script] = out;
  }
  return { version: 1, scripts };
}

/** Retrouve une scène (nom de script insensible à la casse, comme KiriKiri). */
export function lookupTimeline(data: TimelineData | null | undefined, script: string, scene: number): TimelineScene | null {
  if (!data) return null;
  const lower = script.toLowerCase();
  for (const [name, scenes] of Object.entries(data.scripts)) {
    if (name.toLowerCase() === lower) return scenes[String(scene)] ?? null;
  }
  return null;
}
