/**
 * Suivi des CG vues (HUD-15, #208 ; docs/ANALYSE_HUD_ORIGINAL.md §2.11 et §8).
 *
 * Le jeu d'origine conserve la liste des CG déjà affichées pour déverrouiller la galerie. Ici,
 * cette donnée est une **progression de l'utilisateur** persistée par le store de réglages
 * (`SettingsStore.loadSeenCg` / `saveSeenCg`, stockage de WEB-03) : uniquement des clés du
 * manifeste, jamais une image.
 *
 * `trackCgImages` enveloppe le résolveur d'assets : à chaque image réellement demandée par le
 * rendu (fond `@bg`, image `@fg`/timeline), la clé est marquée comme vue. Le catalogue de la
 * galerie filtre ensuite sur ces clés (`src/ui/cg-mode.ts`).
 *
 * Les écritures sont groupées (débounce) : une scène peut demander plusieurs images d'un coup, et
 * la galerie n'a pas besoin d'une écriture synchrone par image. `flush()` force l'écriture.
 */
import type { AssetResolver } from "@/core/asset-resolver.js";
import { storageKey } from "@/core/storage-key.js";
import type { SettingsStore } from "./settings-store.js";

/** Délai de regroupement des écritures (ms). */
export const CG_SEEN_DEBOUNCE_MS = 250;

/** Sous-ensemble du store de réglages utilisé par le suivi (tests : store en mémoire). */
export type CgSeenStore = Pick<SettingsStore, "loadSeenCg" | "saveSeenCg">;

export interface CgProgress {
  /** Clés des CG vues, telles que connues en mémoire (copie immuable). */
  seen(): ReadonlySet<string>;
  /** Charge la progression persistée (idempotent) ; renvoie l'ensemble à jour. */
  load(): Promise<ReadonlySet<string>>;
  /** Marque une clé comme vue (forme brute d'une référence KAG : normalisée par `storageKey`). */
  mark(storage: string): void;
  /** Écrit immédiatement les marques en attente et attend la fin des écritures. */
  flush(): Promise<void>;
  /** Annule le minuteur en attente (les marques déjà planifiées ne sont plus écrites). */
  dispose(): void;
}

/**
 * Crée le suivi des CG vues. `options.debounceMs` facilite les tests à horloge simulée.
 */
export function createCgProgress(
  store: CgSeenStore,
  options: { debounceMs?: number } = {},
): CgProgress {
  const debounceMs = options.debounceMs ?? CG_SEEN_DEBOUNCE_MS;
  const seen = new Set<string>();
  let loaded: Promise<ReadonlySet<string>> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> = Promise.resolve();
  let disposed = false;

  const persist = (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    const snapshot = new Set(seen);
    saving = saving
      .then(() => store.saveSeenCg(snapshot))
      .catch((err: unknown) => {
        // Une persistance en échec (quota, mode privé) ne doit jamais bloquer la lecture.
        console.warn("cg progress save failed", err);
      });
    return saving;
  };

  const schedule = (): void => {
    if (disposed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void persist();
    }, debounceMs);
  };

  return {
    seen(): ReadonlySet<string> {
      return new Set(seen);
    },
    load(): Promise<ReadonlySet<string>> {
      loaded ??= store
        .loadSeenCg()
        .then((stored) => {
          for (const key of stored) seen.add(key);
          return new Set(seen);
        })
        .catch(() => new Set(seen));
      return loaded;
    },
    mark(storage: string): void {
      const key = storageKey(storage);
      if (key === "" || seen.has(key)) return;
      seen.add(key);
      schedule();
    },
    async flush(): Promise<void> {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
        await persist();
      }
      await saving;
    },
    dispose(): void {
      disposed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}

/**
 * Enveloppe le résolveur : toute image demandée par le rendu est marquée comme vue.
 * Les méthodes sont des fermetures (aucun `this`), l'étalement conserve donc le résolveur intact.
 */
export function trackCgImages<T extends Pick<AssetResolver, "background" | "image">>(
  resolver: T,
  progress: Pick<CgProgress, "mark">,
): T {
  return {
    ...resolver,
    background(storage: string): string {
      progress.mark(storage);
      return resolver.background(storage);
    },
    image(storage: string): string {
      progress.mark(storage);
      return resolver.image(storage);
    },
  };
}
