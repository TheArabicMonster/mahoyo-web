/**
 * Attente de décodage d'une image avant de démarrer une transition (#362, PERF-03).
 *
 * Correctif #386 : le cache ne reçoit une entrée **qu'après** un décodage réussi. Les décodages
 * concurrents d'une même URL partagent une seule `Image` et une seule promesse (`inflight`) : un
 * second appel n'est donc ni un hit ni une image non prête. Un échec/timeout/abandon ne met rien
 * en cache et ne compte pas comme hit.
 */

/** Sous-ensemble d'`HTMLImageElement` utilisé ici (injectable en test). */
export type DecodableImage = {
  src: string;
  decoding?: string;
  fetchPriority?: string;
  complete?: boolean;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  decode?: () => Promise<void>;
};

/** Contrat minimal de cache accepté : une `Map` simple ou le LRU borné en octets (#368). */
export interface DecodeCacheLike {
  readonly size: number;
  /** Vrai si le cache gère lui-même son éviction (LRU en octets) : pas de plafond en nombre. */
  readonly evicts?: boolean;
  get(url: string): DecodableImage | object | undefined;
  set(url: string, image: DecodableImage | object): unknown;
  delete(url: string): boolean;
  keys(): Iterable<string>;
}

/** Décodages en cours, partagés par URL (une seule `Image` par URL). */
export type InflightDecodes = Map<string, Promise<DecodableImage | null>>;

export type EnsureDecodedOptions = {
  /** Délai maximal d'attente (défaut : 1 s). */
  timeoutMs?: number;
  /** Cache des images **décodées** (jamais alimenté avant succès). */
  cache?: DecodeCacheLike;
  /** Map des décodages en cours ; fournir la même instance pour mutualiser les appels. */
  inflight?: InflightDecodes;
  /** Fabrique d'image (tests) ; défaut : `new Image()`. */
  createImage?: () => DecodableImage;
  /** Priorité réseau demandée pour cette image (défaut : high). */
  fetchPriority?: "high" | "low";
};

/** Nombre maximal d'images conservées dans une `Map` simple (le LRU #368 gère son plafond). */
export const DECODED_CACHE_LIMIT = 24;

/** Attend une promesse partagée en abandonnant sans la casser si `signal` est annulé. */
function abortable(promise: Promise<DecodableImage | null>, signal?: AbortSignal): Promise<DecodableImage | null> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then((image) => {
      signal.removeEventListener("abort", onAbort);
      resolve(image);
    });
  });
}

/**
 * Décode une image ; résout avec l'image si le décodage a réussi, sinon `null` (timeout, erreur,
 * `decode()` absent/rejeté, abandon). Jamais de rejet.
 */
export function decodeImage(
  url: string,
  signal?: AbortSignal,
  options: EnsureDecodedOptions = {},
): Promise<DecodableImage | null> {
  if (!url || signal?.aborted) return Promise.resolve(null);

  const cache = options.cache;
  const cached = cache?.get(url) as DecodableImage | undefined;
  if (cached) return Promise.resolve(cached);

  const inflight = options.inflight;
  const existing = inflight?.get(url);
  if (existing) return abortable(existing, signal);

  const timeoutMs = options.timeoutMs ?? 1000;
  const createImage = options.createImage ?? (() => new Image() as unknown as DecodableImage);
  const img = createImage();
  img.decoding = "async";
  img.fetchPriority = options.fetchPriority ?? "high";

  const promise = new Promise<DecodableImage | null>((resolve) => {
    let settled = false;
    const finish = (success: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      if (!success) {
        resolve(null);
        return;
      }
      // Entrée LRU seulement après décodage réussi (#386) ; alimente les stats au bon moment.
      cache?.set(url, img);
      if (cache && !cache.evicts && cache.size > DECODED_CACHE_LIMIT) {
        const oldest = [...cache.keys()][0];
        if (oldest !== undefined) cache.delete(oldest);
      }
      resolve(img);
    };

    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    // `src` d'abord : `decode()` doit porter sur l'image demandée (un appel avant chargement rejette).
    img.src = url;

    if (typeof img.decode === "function") {
      // Repli `onload` : le navigateur peut rejeter `decode()` (EncodingError/Safari) alors que
      // l'image se charge ; on n'échoue jamais, le timeout borne l'attente.
      void img.decode().then(
        () => finish(true),
        () => {
          /* onload ou timeout terminera */
        },
      );
    }
  });

  if (inflight) {
    inflight.set(url, promise);
    void promise.finally(() => {
      if (inflight.get(url) === promise) inflight.delete(url);
    });
  }

  return abortable(promise, signal);
}

/** Résout quand `url` est décodée (ou au plus tard après `timeoutMs`), sans rejeter. */
export async function ensureDecoded(
  url: string,
  signal?: AbortSignal,
  options: EnsureDecodedOptions = {},
): Promise<void> {
  await decodeImage(url, signal, options);
}
