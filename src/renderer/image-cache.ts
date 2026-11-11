/**
 * Cache d'images **décodées** borné en octets (PERF-05 / #368, docs/PERF_PLAN_OPUS.md §3.B).
 *
 * Une `HTMLImageElement` référencée garde son décodage : une image déjà décodée peut être
 * réaffichée sans re-décodage (le navigateur peut sinon libérer le décodage entre deux scènes).
 * Le cache est une **LRU** plafonnée en octets :
 * - coût d'une entrée = `width × height × 4` (RGBA) quand les dimensions natives sont connues
 *   (`image-dimensions.json`, déjà chargé au démarrage), sinon estimation de repli ;
 * - plafond **192 Mo desktop / 64 Mo mobile** (iOS ou `navigator.deviceMemory ≤ 4`) ;
 * - éviction des entrées les moins récemment utilisées jusqu'à repasser sous le plafond ;
 * - statistiques `entries/bytes/limitBytes/hits/misses/evictions` pour la sonde `?perf=1` (#360).
 *
 * Module pur (aucun DOM hors `navigator`/`Image`), testable en jsdom.
 */

/** Coût mémoire d'un pixel décodé (RGBA, 4 octets). */
export const BYTES_PER_PIXEL = 4;
/** Plafond desktop du cache décodé (192 Mo), plan §3.B. */
export const DESKTOP_CACHE_BYTES = 192 * 1024 * 1024;
/** Plafond mobile (64 Mo), plan §3.B. */
export const MOBILE_CACHE_BYTES = 64 * 1024 * 1024;
/** Estimation de repli quand la taille native est inconnue : un fond 1024×576 en RGBA. */
export const FALLBACK_IMAGE_BYTES = 1024 * 576 * BYTES_PER_PIXEL;

export type ImageCacheStats = {
  entries: number;
  bytes: number;
  limitBytes: number;
  hits: number;
  misses: number;
  evictions: number;
};

export type CacheLimitEnv = {
  deviceMemory?: number;
  /** `true` = iPhone/iPad (Safari tue l'onglet au-delà de ~1 Go) → plafond mobile. */
  isIos?: boolean;
};

/** Détecte iOS sans dépendre de l'API iPadOS récente (`platform === "MacIntel"` + tactile). */
export function detectIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1;
}

/** Plafond du cache décodé selon la plateforme : 64 Mo mobile (iOS ou deviceMemory ≤ 4), 192 Mo sinon. */
export function decodedCacheLimitBytes(env: CacheLimitEnv = {}): number {
  const isMobile = env.isIos ?? detectIos();
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }) : null;
  const memory = env.deviceMemory ?? (typeof nav?.deviceMemory === "number" ? nav.deviceMemory : undefined);
  return isMobile || (typeof memory === "number" && memory <= 4) ? MOBILE_CACHE_BYTES : DESKTOP_CACHE_BYTES;
}

export type DecodedCacheEntry = {
  image: object;
  bytes: number;
};

export type DecodedImageCacheOptions = {
  /** Plafond en octets (défaut : `decodedCacheLimitBytes()`). */
  limitBytes?: number;
  /** Estimation des octets pour une URL (sinon `FALLBACK_IMAGE_BYTES`). */
  estimateBytes?: (url: string) => number | null;
};

/**
 * LRU d'images décodées, bornée en octets. L'ordre d'itération de `Map` sert d'ordre LRU :
 * la première clé est la moins récemment utilisée, `get`/`set` réinsèrent en fin.
 */
export class DecodedImageCache {
  /** Vrai : le cache gère lui-même l'éviction (pas de plafond en nombre). */
  readonly evicts = true;
  private readonly limitBytes: number;
  private readonly estimateBytes: (url: string) => number | null;
  private readonly entries = new Map<string, DecodedCacheEntry>();
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: DecodedImageCacheOptions = {}) {
    this.limitBytes = Math.max(1, options.limitBytes ?? decodedCacheLimitBytes());
    this.estimateBytes = options.estimateBytes ?? (() => null);
  }

  get size(): number {
    return this.entries.size;
  }

  get(url: string): object | undefined {
    const entry = this.entries.get(url);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    // Réinsertion = marque comme récemment utilisée.
    this.entries.delete(url);
    this.entries.set(url, entry);
    return entry.image;
  }

  /** Lecture sans toucher aux statistiques ni à l'ordre LRU. */
  peek(url: string): object | undefined {
    return this.entries.get(url)?.image;
  }

  has(url: string): boolean {
    return this.entries.has(url);
  }

  /** Retire une entrée (utilisé par `ensureDecoded` pour réordonner la LRU). */
  delete(url: string): boolean {
    const entry = this.entries.get(url);
    if (!entry) return false;
    this.entries.delete(url);
    this.bytes -= entry.bytes;
    return true;
  }

  /**
   * Ajoute (ou remplace) une image décodée. Les entrées LRU sont évincées jusqu'à tenir dans le
   * plafond ; une image plus grosse que le plafond n'est pas conservée (elle sera re-décodée).
   */
  set(url: string, image: object, bytes?: number | null): void {
    const cost = Math.max(1, Math.round(bytes ?? this.resolveCost(url)));
    const previous = this.entries.get(url);
    if (previous) {
      this.entries.delete(url);
      this.bytes -= previous.bytes;
    }
    if (cost > this.limitBytes) {
      // Trop grosse à elle seule : inutile de vider le cache pour elle.
      return;
    }
    while (this.bytes + cost > this.limitBytes && this.entries.size > 0) {
      this.evictOldest();
    }
    this.entries.set(url, { image, bytes: cost });
    this.bytes += cost;
  }

  /** Dimensions natives connues (`image-dimensions.json`) : coût `w×h×4` pour l'URL. */
  noteDimensions(url: string, width: number, height: number): void {
    const cost = Math.max(1, Math.round(width * height * BYTES_PER_PIXEL));
    const entry = this.entries.get(url);
    if (entry) {
      this.bytes -= entry.bytes;
      entry.bytes = cost;
      this.bytes += cost;
      while (this.bytes > this.limitBytes && this.entries.size > 0) this.evictOldest();
      return;
    }
    // Mémorise le coût pour le prochain `set`.
    this.knownCosts.set(url, cost);
  }

  clear(): void {
    this.entries.clear();
    this.knownCosts.clear();
    this.bytes = 0;
  }

  /** URLs dans l'ordre LRU, de la plus ancienne à la plus récente (tests/diagnostic). */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  stats(): ImageCacheStats {
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      limitBytes: this.limitBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  private knownCosts = new Map<string, number>();

  private evictOldest(): void {
    const oldest = this.entries.keys().next().value;
    if (oldest === undefined) return;
    const entry = this.entries.get(oldest);
    this.entries.delete(oldest);
    if (entry) this.bytes -= entry.bytes;
    this.evictions += 1;
  }

  /** Coût effectif utilisé par `set` quand `bytes` est omis. */
  private resolveCost(url: string): number {
    return this.knownCosts.get(url) ?? this.estimateBytes(url) ?? FALLBACK_IMAGE_BYTES;
  }
}
