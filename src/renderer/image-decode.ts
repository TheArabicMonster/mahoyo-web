/**
 * Attente de décodage d'une image avant de démarrer une transition (#362, PERF-03).
 *
 * Le fond est posé en `background-image` : sans attendre le décodage, le fondu démarre vers une
 * image pas encore prête (saut/freeze au premier rendu). On garde une petite référence des images
 * préchargées/décodées pour que le navigateur ne libère pas le décodage, avec un plafond borné.
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

export type EnsureDecodedOptions = {
  /** Délai maximal d'attente (défaut : 1 s). */
  timeoutMs?: number;
  /** Cache des images décodées (référence conservée, bornée par l'appelant). */
  cache?: DecodeCacheLike;
  /** Fabrique d'image (tests) ; défaut : `new Image()`. */
  createImage?: () => DecodableImage;
};

/** Nombre maximal d'images conservées dans le cache de décodage. */
export const DECODED_CACHE_LIMIT = 24;

/**
 * Résout quand `url` est décodée (ou au plus tard après `timeoutMs`), sans rejeter :
 * timeout, erreur de chargement, `decode()` indisponible/rejeté (repli `onload`) et abort
 * résolvent tous la promesse pour ne jamais bloquer le jeu.
 */
export function ensureDecoded(
  url: string,
  signal?: AbortSignal,
  options: EnsureDecodedOptions = {},
): Promise<void> {
  if (!url || signal?.aborted) return Promise.resolve();
  const cache = options.cache;
  const cached = cache?.get(url) as DecodableImage | undefined;
  if (cached) {
    // LRU simplifiée : réinsérer la clé la place en fin.
    cache!.delete(url);
    cache!.set(url, cached);
    return Promise.resolve();
  }

  const timeoutMs = options.timeoutMs ?? 1000;
  const createImage = options.createImage ?? (() => new Image() as unknown as DecodableImage);
  const img = createImage();
  img.decoding = "async";
  img.fetchPriority = "high";
  cache?.set(url, img);
  // Le LRU en octets (#368) évince lui-même ; une `Map` simple garde l'ancien plafond en nombre.
  if (cache && !cache.evicts && cache.size > DECODED_CACHE_LIMIT) {
    const oldest = [...cache.keys()][0];
    if (oldest !== undefined) cache.delete(oldest);
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    const onAbort = () => done();
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      img.onload = null;
      img.onerror = null;
      resolve();
    };

    img.onload = done;
    img.onerror = done;
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(done, timeoutMs);
    // `src` d'abord : `decode()` doit porter sur l'image demandée (un appel avant chargement rejette).
    img.src = url;

    if (typeof img.decode === "function") {
      // Repli `onload` : le navigateur peut rejeter `decode()` (EncodingError/Safari) alors que
      // l'image se charge ; on n'échoue jamais, le timeout borne l'attente.
      void img.decode().then(done, () => {
        /* onload ou timeout terminera */
      });
    }
  });
}
