/**
 * Enregistrement du service worker et gestion de la mise à jour (issue #96).
 *
 * Choix : **rechargement contrôlé** (pas d'invite UI) — quand une nouvelle
 * version est installée, on laisse le worker s'activer (`SKIP_WAITING`) puis on
 * recharge la page une seule fois, protégé par un drapeau de session pour éviter
 * toute boucle. La première installation ne recharge pas (pas de contrôleur).
 */

export const SW_URL = "/sw.js";
/** Clé de session empêchant une boucle de rechargement lors d'une mise à jour. */
export const RELOAD_GUARD_KEY = "mahoyo-pwa-reloaded";

export interface PwaWorkerLike {
  postMessage(message: unknown): void;
}

export interface PwaRegisterLike {
  waiting: PwaWorkerLike | null;
  installing: PwaWorkerLike | null;
  addEventListener(type: "updatefound", listener: () => void): void;
}

export interface PwaUpdateControllerDeps {
  /** Envoie `{type:"SKIP_WAITING"}` au worker installé. */
  postSkipWaiting(worker: PwaWorkerLike): void;
  /** Recharge la page (une seule fois). */
  reload(): void;
  storage: Pick<Storage, "getItem" | "setItem">;
}

/**
 * Machine à états testable de la mise à jour : une nouvelle version installée
 * est activée, puis la page est rechargée une seule fois. La première
 * installation (pas de contrôleur) est ignorée par l'appelant.
 */
export function createPwaUpdateController(deps: PwaUpdateControllerDeps): {
  /** À appeler quand un nouveau worker est installé ET qu'un contrôleur existe. */
  notifyUpdateInstalled(worker: PwaWorkerLike): void;
  /** À appeler sur `controllerchange`. */
  handleControllerChange(): void;
} {
  let pendingReload = false;
  return {
    notifyUpdateInstalled(worker: PwaWorkerLike): void {
      if (pendingReload) return;
      pendingReload = true;
      deps.postSkipWaiting(worker);
    },
    handleControllerChange(): void {
      if (!pendingReload) return; // première installation : ne pas recharger
      pendingReload = false;
      if (deps.storage.getItem(RELOAD_GUARD_KEY) === "1") return;
      deps.storage.setItem(RELOAD_GUARD_KEY, "1");
      deps.reload();
    },
  };
}

export interface PwaRegisterOptions {
  /** Force/annule l'enregistrement (défaut : uniquement en production). */
  enabled?: boolean;
  logger?: Pick<Console, "warn" | "info">;
}

/**
 * Enregistre le service worker (production uniquement par défaut) et branche la
 * mise à jour contrôlée. Ne bloque pas le démarrage ; retourne null si non
 * supporté/désactivé.
 */
export async function registerPwa(
  options: PwaRegisterOptions = {},
): Promise<ServiceWorkerRegistration | null> {
  const enabled = options.enabled ?? import.meta.env.PROD;
  const logger = options.logger ?? console;
  if (!enabled) return null;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;

  try {
    const registration = (await navigator.serviceWorker.register(SW_URL)) as unknown as PwaRegisterLike &
      ServiceWorkerRegistration;
    const controller = createPwaUpdateController({
      postSkipWaiting: (worker) => worker.postMessage({ type: "SKIP_WAITING" }),
      reload: () => window.location.reload(),
      storage: window.sessionStorage,
    });

    const hasController = (): boolean => Boolean(navigator.serviceWorker.controller);
    // Mise à jour déjà en attente (session précédente).
    if (registration.waiting && hasController()) controller.notifyUpdateInstalled(registration.waiting);
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if ((installing as unknown as { state?: string }).state === "installed" && hasController()) {
          controller.notifyUpdateInstalled(installing);
        }
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => controller.handleControllerChange());
    logger.info("[pwa] service worker enregistré");
    return registration as unknown as ServiceWorkerRegistration;
  } catch (err) {
    logger.warn("[pwa] enregistrement du service worker impossible :", err);
    return null;
  }
}

/** Lance l'enregistrement PWA sans bloquer le démarrage de l'application. */
export function installPwa(options: PwaRegisterOptions = {}): void {
  void registerPwa(options);
}
