/**
 * Sonde de performance « scene-ready » (PERF-01 / #360, docs/PERF_PLAN_OPUS.md §1).
 *
 * Instrumentation **désactivée par défaut** : sans `?perf=1` dans l'URL, ce module ne pose aucun
 * marqueur, aucun `PerformanceObserver` et n'écrit rien sur `window` : il renvoie un objet no-op
 * partagé (coût nul pour le reste du player).
 *
 * Avec `?perf=1` :
 * - `performance.mark` `mh:img:request|fetched|decoded|painted` par image de scène ;
 * - `fetched` lit Resource Timing (`transferSize`, `workerStart`) pour classer **cache chaud/froid**
 *   et `preloaded` (via `markPreloaded`) ;
 * - `fetched → painted` donne la métrique `scene-ready` ;
 * - blocages : `PerformanceObserver` sur `long-animation-frame` (repli `longtask`), entrées > 50 ms ;
 * - INP : `PerformanceObserver` sur `event` (durée des interactions) ;
 * - mémoire : `measureUserAgentSpecificMemory()` si disponible + estimation w×h×4 quand les
 *   dimensions sont fournies (`noteDimensions`) ;
 * - tout est agrégé dans un tampon circulaire exposé sur `window.__mhPerf` (Playwright).
 *
 * Module pur : aucun accès au DOM en dehors de `window`/`performance`, testable en jsdom.
 */

/** Nombre maximal d'entrées conservées par tampon circulaire (marqueurs, blocages, événements). */
export const PERF_BUFFER_LIMIT = 2000;
/** Seuil des blocages retenus (ms), plan §1. */
export const LONG_FRAME_MS = 50;

export type PerfImageRecord = {
  url: string;
  request: number | null;
  fetched: number | null;
  decoded: number | null;
  painted: number | null;
  /** request → painted (ms), la métrique clé du plan. */
  sceneReady: number | null;
  /** true/false si Resource Timing est exploitable, null sinon. */
  cached: boolean | null;
  preloaded: boolean;
  /** transferSize / workerStart de Resource Timing quand disponibles. */
  transferSize: number | null;
  workerStart: number | null;
  /** Estimation mémoire w×h×4 (octets) si les dimensions sont connues. */
  bytes: number | null;
  /** Classification `preloaded-cache` | `preloaded` | `cold-cache` | `cold`. */
  kind: "preloaded-cache" | "preloaded" | "cold-cache" | "cold" | null;
};

export type PerfLongFrame = {
  startTime: number;
  duration: number;
  blockingDuration?: number;
  source: "long-animation-frame" | "longtask";
};

export type PerfEventEntry = { name: string; startTime: number; duration: number };

/** Stats du cache décodé LRU (PERF-05 / #368), injectées par le renderer. */
export type PerfImageCacheStats = {
  entries: number;
  bytes: number;
  limitBytes: number;
  hits: number;
  misses: number;
  evictions: number;
};

export type PerfBootName = "load-start" | "manifest-fetched" | "title-painted" | "first-text" | "load-end";
export type PerfTransitionWaitOutcome = "ready" | "waiting" | "timeout";
export type PerfTransitionWait = { duration: number; outcome: PerfTransitionWaitOutcome; at: number };
export type PerfAudioKind = "bgm" | "se";
export type PerfAudioPhase = "request" | "fetched" | "played" | "rejected";
export type PerfAudioCounters = { request: number; fetched: number; played: number; rejected: number };
export type PerfAudioSummary = { bgm: PerfAudioCounters; se: PerfAudioCounters };

export type PerfSummary = {
  enabled: boolean;
  images: number;
  sceneReady: { count: number; p50: number | null; p95: number | null; max: number | null };
  kinds: Record<string, number>;
  longFrames: number;
  events: number;
  inp: number | null;
  /** Stats du cache décodé (#368) quand le renderer l'a branché, sinon null. */
  imageCache: PerfImageCacheStats | null;
  /** Marqueurs `mh:boot:*` (temps depuis le chargement, ms) — PERF-V2-01 / #385. */
  boot: Partial<Record<PerfBootName, number>>;
  /** Attentes de décodage avant transition (#362) : durée et issue. */
  transitionWait: {
    count: number;
    ready: number;
    waiting: number;
    timeout: number;
    p50: number | null;
    max: number | null;
    last: PerfTransitionWait | null;
  };
  /** Demandes/lectures audio (BGM/SE) — PERF-V2-01 / #385. */
  audio: PerfAudioSummary;
};

/** Contenu public exposé sur `window.__mhPerf` (lu par Playwright). */
export type PerfGlobal = {
  readonly enabled: true;
  readonly limit: number;
  readonly images: PerfImageRecord[];
  readonly longFrames: PerfLongFrame[];
  readonly events: PerfEventEntry[];
  memory: { bytes: number | null; supported: boolean } | null;
  readonly boot: Partial<Record<PerfBootName, number>>;
  readonly transitionWaits: readonly PerfTransitionWait[];
  readonly audio: PerfAudioSummary;
  summary(): PerfSummary;
};

export type PerfProbeEnv = {
  /** `location.search` à la place de l'URL réelle (tests). */
  readonly search?: string;
  /** Horloge (ms), défaut `performance.now`. */
  readonly now?: () => number;
  /** Deux rAF (tests : synchrone). */
  readonly nextFrame?: (fn: () => void) => void;
  /** Entrée Resource Timing pour une URL (tests : injectable). */
  readonly resourceEntry?: (url: string) => { transferSize?: number; workerStart?: number } | undefined;
  /** Taille du tampon circulaire (tests). */
  readonly limit?: number;
};

export interface PerfProbe {
  readonly enabled: boolean;
  /** À appeler quand la scène applique une image (bg, sprite, calque de timeline). */
  markRequest(url: string): void;
  markFetched(url: string): void;
  markDecoded(url: string): void;
  markPainted(url: string): void;
  /** Image déjà préchargée par le lookahead (classification). */
  markPreloaded(url: string): void;
  /** Dimensions natives pour l'estimation mémoire w×h×4 (image-dimensions.json). */
  noteDimensions(url: string, width: number, height: number): void;
  /**
   * Marque la requête puis suit l'image : `<img>` existant (sprite/calque, pas de requête
   * supplémentaire) ou, à défaut, une image de sonde créée pour un fond CSS.
   */
  trackImage(url: string, img?: HTMLImageElement): void;
  /** Branche les stats du cache décodé (no-op sans `?perf=1`, aucun coût). */
  setImageCacheStats(getter: () => PerfImageCacheStats | null): void;
  /** Marqueur `mh:boot:*` (idempotent) : manifest, titre peint, premier texte, chargement. */
  markBoot(name: PerfBootName): void;
  /** Attente de décodage avant transition (#362) : durée + issue (prête/attente/délai dépassé). */
  markTransitionWait(durationMs: number, outcome: PerfTransitionWaitOutcome): void;
  /** Marqueur `mh:audio:*` : demande/arrivée/lecture/rejet d'un BGM ou SE. */
  markAudio(kind: PerfAudioKind, phase: PerfAudioPhase, detail?: { url?: string }): void;
  /** Résumé calculé (même objet que `window.__mhPerf.summary()`). */
  summary(): PerfSummary;
}

/** Sonde inerte : aucune marque, aucun observer, aucun accès à `window`. */
const NOOP: PerfProbe = Object.freeze({
  enabled: false,
  markRequest: () => {},
  markFetched: () => {},
  markDecoded: () => {},
  markPainted: () => {},
  markPreloaded: () => {},
  noteDimensions: () => {},
  trackImage: () => {},
  setImageCacheStats: () => {},
  markBoot: () => {},
  markTransitionWait: () => {},
  markAudio: () => {},
  summary: () => EMPTY_SUMMARY,
});

const EMPTY_SUMMARY: PerfSummary = {
  enabled: false,
  images: 0,
  sceneReady: { count: 0, p50: null, p95: null, max: null },
  kinds: {},
  longFrames: 0,
  events: 0,
  inp: null,
  imageCache: null,
  boot: {},
  transitionWait: { count: 0, ready: 0, waiting: 0, timeout: 0, p50: null, max: null, last: null },
  audio: {
    bgm: { request: 0, fetched: 0, played: 0, rejected: 0 },
    se: { request: 0, fetched: 0, played: 0, rejected: 0 },
  },
};

const NOOP_PROBE = NOOP;

let sharedProbe: PerfProbe | null = null;

/**
 * Sonde partagée de production (main/player/renderer/audio/UI) : une seule instance pour éviter
 * plusieurs observers. Retourne le no-op si `?perf=1` est absent (aucun coût, aucun nœud DOM).
 */
export function getPerfProbe(): PerfProbe {
  if (!sharedProbe) sharedProbe = createPerfProbe();
  return sharedProbe;
}

/** Vrai si l'URL demande la sonde (`?perf=1`), sinon false. */
export function perfEnabled(search: string): boolean {
  try {
    return new URLSearchParams(search).get("perf") === "1";
  } catch {
    return false;
  }
}

function defaultSearch(): string {
  return typeof window !== "undefined" && typeof window.location?.search === "string" ? window.location.search : "";
}

function defaultNextFrame(fn: () => void): void {
  if (typeof requestAnimationFrame !== "function") return fn();
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index]! * 100) / 100;
}

/** Pousse dans un tampon circulaire (garde les `limit` dernières entrées). */
function pushCircular<T>(buffer: T[], value: T, limit: number): void {
  buffer.push(value);
  if (buffer.length > limit) buffer.splice(0, buffer.length - limit);
}

/** Agrège les attentes de décodage (durée et issue) pour le résumé. */
export function summarizeTransitionWaits(waits: readonly PerfTransitionWait[]): PerfSummary["transitionWait"] {
  const durations = waits.map((w) => w.duration);
  const count = (outcome: PerfTransitionWaitOutcome): number => waits.filter((w) => w.outcome === outcome).length;
  return {
    count: waits.length,
    ready: count("ready"),
    waiting: count("waiting"),
    timeout: count("timeout"),
    p50: percentile(durations, 50),
    max: durations.length ? Math.round(Math.max(...durations) * 100) / 100 : null,
    last: waits[waits.length - 1] ?? null,
  };
}

/**
 * Crée la sonde. Retourne le no-op partagé si `?perf=1` est absent.
 * Aucun observer n'est installé dans ce cas (exigence #360).
 */
export function createPerfProbe(env: PerfProbeEnv = {}): PerfProbe {
  const search = env.search ?? defaultSearch();
  if (!perfEnabled(search)) return NOOP_PROBE;

  const now = env.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const nextFrame = env.nextFrame ?? defaultNextFrame;
  const limit = env.limit ?? PERF_BUFFER_LIMIT;
  const resourceEntry =
    env.resourceEntry ??
    ((url: string) => {
      if (typeof performance === "undefined" || typeof performance.getEntriesByName !== "function") return undefined;
      const entries = performance.getEntriesByName(url, "resource") as PerformanceResourceTiming[];
      return entries[entries.length - 1];
    });

  const records = new Map<string, PerfImageRecord>();
  const images: PerfImageRecord[] = [];
  const longFrames: PerfLongFrame[] = [];
  const events: PerfEventEntry[] = [];
  const dimensions = new Map<string, { width: number; height: number }>();
  const preloaded = new Set<string>();
  let memory: { bytes: number | null; supported: boolean } | null = null;
  let imageCacheStats: (() => PerfImageCacheStats | null) | null = null;
  const boot: Partial<Record<PerfBootName, number>> = {};
  const transitionWaits: PerfTransitionWait[] = [];
  const audio: PerfAudioSummary = {
    bgm: { request: 0, fetched: 0, played: 0, rejected: 0 },
    se: { request: 0, fetched: 0, played: 0, rejected: 0 },
  };

  const mark = (name: string, url: string): number => {
    const time = now();
    try {
      if (typeof performance !== "undefined" && typeof performance.mark === "function") {
        performance.mark(name, { detail: { url } });
      }
    } catch {
      // jsdom / vieux navigateurs : le tampon ci-dessous reste la source de vérité.
    }
    return time;
  };

  const recordFor = (url: string): PerfImageRecord => {
    let record = records.get(url);
    if (record) return record;
    record = {
      url,
      request: null,
      fetched: null,
      decoded: null,
      painted: null,
      sceneReady: null,
      cached: null,
      preloaded: preloaded.has(url),
      transferSize: null,
      workerStart: null,
      bytes: null,
      kind: null,
    };
    records.set(url, record);
    pushCircular(images, record, limit);
    return record;
  };

  const classify = (record: PerfImageRecord): void => {
    const dims = dimensions.get(record.url);
    if (dims) record.bytes = dims.width * dims.height * 4;
    record.preloaded = record.preloaded || preloaded.has(record.url);
    if (record.cached === null && record.kind === null) return;
    if (record.preloaded && record.cached) record.kind = "preloaded-cache";
    else if (record.preloaded) record.kind = "preloaded";
    else if (record.cached) record.kind = "cold-cache";
    else record.kind = "cold";
  };

  const touchGlobal = (): void => {
    if (typeof window === "undefined") return;
    (window as unknown as { __mhPerf?: PerfGlobal }).__mhPerf = global;
  };

  const summary = (): PerfSummary => {
    const ready = images.map((r) => r.sceneReady).filter((v): v is number => typeof v === "number");
    const kinds: Record<string, number> = {};
    for (const record of images) if (record.kind) kinds[record.kind] = (kinds[record.kind] ?? 0) + 1;
    const inp = events.reduce((max, e) => Math.max(max, e.duration), 0);
    return {
      enabled: true,
      images: images.length,
      sceneReady: { count: ready.length, p50: percentile(ready, 50), p95: percentile(ready, 95), max: ready.length ? Math.round(Math.max(...ready) * 100) / 100 : null },
      kinds,
      longFrames: longFrames.length,
      events: events.length,
      inp: events.length ? Math.round(inp * 100) / 100 : null,
      imageCache: imageCacheStats ? imageCacheStats() : null,
      boot: { ...boot },
      transitionWait: summarizeTransitionWaits(transitionWaits),
      audio: { bgm: { ...audio.bgm }, se: { ...audio.se } },
    };
  };

  const global: PerfGlobal = {
    enabled: true,
    limit,
    images,
    longFrames,
    events,
    memory,
    boot,
    transitionWaits,
    audio,
    summary,
  };

  // ── PerformanceObserver : blocages + INP ──

  const observe = (type: string, onEntry: (entry: PerformanceEntry) => void): void => {
    if (typeof PerformanceObserver !== "function") return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) onEntry(entry);
      });
      observer.observe({ type, buffered: false } as PerformanceObserverInit);
    } catch {
      // Type non supporté par ce navigateur : repli géré par l'appelant.
    }
  };

  observe("long-animation-frame", (entry) => {
    const loaf = entry as PerformanceEntry & { blockingDuration?: number };
    if (entry.duration <= LONG_FRAME_MS) return;
    pushCircular(longFrames, { startTime: entry.startTime, duration: entry.duration, blockingDuration: loaf.blockingDuration, source: "long-animation-frame" }, limit);
    touchGlobal();
  });
  // Repli si `long-animation-frame` n'est pas supporté (Firefox/Safari) : ne double pas Chromium
  // (le premier observer reçoit les entrées, le second reste inerte).
  if (typeof PerformanceObserver !== "function" || !("supportedEntryTypes" in PerformanceObserver) || !PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) {
    observe("longtask", (entry) => {
      if (entry.duration <= LONG_FRAME_MS) return;
      pushCircular(longFrames, { startTime: entry.startTime, duration: entry.duration, source: "longtask" }, limit);
      touchGlobal();
    });
  }
  observe("event", (entry) => {
    const name = (entry as PerformanceEntry & { name: string }).name;
    pushCircular(events, { name, startTime: entry.startTime, duration: entry.duration }, limit);
    touchGlobal();
  });

  // Mémoire : API Chromium expérimentale, seulement si le flag est actif.
  if (typeof performance !== "undefined" && typeof (performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> }).measureUserAgentSpecificMemory === "function") {
    (performance as Performance & { measureUserAgentSpecificMemory: () => Promise<{ bytes: number }> })
      .measureUserAgentSpecificMemory()
      .then((result) => {
        memory = { bytes: result.bytes, supported: true };
        global.memory = memory;
        touchGlobal();
      })
      .catch(() => {
        memory = { bytes: null, supported: false };
        global.memory = memory;
        touchGlobal();
      });
  }

  const probe: PerfProbe = {
    enabled: true,
    markRequest(url) {
      const record = recordFor(url);
      if (record.request !== null) return; // une seule requête par image suivie
      record.request = mark("mh:img:request", url);
      touchGlobal();
    },
    markFetched(url) {
      const record = recordFor(url);
      if (record.fetched !== null) return;
      record.fetched = mark("mh:img:fetched", url);
      const rt = resourceEntry(url);
      if (rt) {
        record.transferSize = typeof rt.transferSize === "number" ? rt.transferSize : null;
        record.workerStart = typeof rt.workerStart === "number" ? rt.workerStart : null;
        record.cached = record.transferSize === 0;
      }
      classify(record);
      touchGlobal();
    },
    markDecoded(url) {
      const record = recordFor(url);
      if (record.decoded !== null) return;
      record.decoded = mark("mh:img:decoded", url);
      touchGlobal();
    },
    markPainted(url) {
      const record = recordFor(url);
      if (record.painted !== null) return;
      record.painted = mark("mh:img:painted", url);
      if (record.request !== null) record.sceneReady = Math.round((record.painted - record.request) * 100) / 100;
      classify(record);
      touchGlobal();
    },
    markPreloaded(url) {
      preloaded.add(url);
      const record = records.get(url);
      if (record) record.preloaded = true;
    },
    noteDimensions(url, width, height) {
      dimensions.set(url, { width, height });
      const record = records.get(url);
      if (record) {
        record.bytes = width * height * 4;
        classify(record);
        touchGlobal();
      }
    },
    setImageCacheStats(getter) {
      imageCacheStats = getter;
      touchGlobal();
    },
    markBoot(name) {
      if (boot[name] !== undefined) return; // idempotent : premier événement gagnant
      boot[name] = Math.round(now() * 100) / 100;
      try {
        performance.mark(`mh:boot:${name}`);
      } catch {
        /* tampon = source de vérité */
      }
      touchGlobal();
    },
    markTransitionWait(durationMs, outcome) {
      const entry: PerfTransitionWait = {
        duration: Math.round(Math.max(0, durationMs) * 100) / 100,
        outcome,
        at: Math.round(now() * 100) / 100,
      };
      pushCircular(transitionWaits, entry, limit);
      try {
        performance.mark("mh:transition:wait", { detail: { duration: entry.duration, outcome } });
      } catch {
        /* ignore */
      }
      touchGlobal();
    },
    markAudio(kind, phase, detail) {
      audio[kind][phase] += 1;
      try {
        performance.mark(`mh:audio:${phase}`, { detail: { kind, ...detail } });
      } catch {
        /* ignore */
      }
      touchGlobal();
    },
    trackImage(url, elem) {
      probe.markRequest(url);
      const img = elem ?? (typeof Image === "function" ? new Image() : null);
      if (!img) {
        // Pas de DOM (tests) : on marque ce qui est observable sans image.
        probe.markFetched(url);
        probe.markDecoded(url);
        nextFrame(() => probe.markPainted(url));
        return;
      }
      const finish = (): void => {
        probe.markFetched(url);
        const done = (): void => {
          probe.markDecoded(url);
          nextFrame(() => probe.markPainted(url));
        };
        if (typeof img.decode === "function") img.decode().then(done).catch(done);
        else done();
      };
      if (img.complete && img.naturalWidth > 0) finish();
      else if (elem) img.addEventListener("load", finish, { once: true });
      else {
        img.addEventListener("load", finish, { once: true });
        img.src = url;
      }
    },
    summary,
  };

  touchGlobal();
  return probe;
}
