/**
 * Timelines d'animation (format « TLA » du jeu d'origine), version simplifiée.
 *
 * Certains scripts (`opening.ks`, les menus système) embarquent une timeline : un
 * projet d'animation avec des pistes audio et des objets visuels. Le pipeline en
 * extrait `timelines.json` ; ce module décrit et valide ces données. Le runtime les
 * rejoue sous forme d'un calendrier d'événements (voir `@playtimeline`).
 *
 * Seuls les fonds et les pistes audio sont repris ; les calques, panoramiques,
 * zooms et effets de la timeline d'origine ne le sont pas.
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

/** Un changement d'image de fond. */
export type TimelineBg = {
  at: number;
  storage: string;
  /** Position du fond (px, repère 1024×576) ; absentes = centré. */
  left?: number;
  top?: number;
};

export type TimelineScene = {
  name: string;
  /** Durée totale (ms). */
  duration: number;
  bg: TimelineBg[];
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
    (b.top === undefined || isNum(b.top))
  );
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
