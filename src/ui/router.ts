/**
 * Routes d'URL des écrans (WEB-04, #204).
 *
 * Deux couches :
 * - fonctions pures (`parseRoute`, `serializeRoute`, `resolveRoute`, `viewRoute`, `overlayOfRoute`) sans DOM ;
 * - `HistoryRouter`, adaptateur très fin sur `location` / `history` (injectables pour les tests), qui ne lève
 *   jamais : toute API d'historique est entourée d'un try/catch.
 *
 * L'URL ne décrit qu'un **écran** : jamais de script, de libellé, de progression ni d'identifiant de scénario.
 * Hash (`#/load`) plutôt que chemin : aucun `base` n'est configuré (Vite sert à la racine) et un hébergement
 * statique ne sait pas réécrire `/load` vers `index.html` ; le hash n'a pas besoin de configuration serveur.
 */
import type { OverlayScreen } from "./types.js";

/** Écrans adressables. `pause` (menu système) partage la route `game` : c'est un état transitoire de la partie. */
export type Route = "title" | "game" | "load" | "save" | "config" | "backlog" | "flowchart";

export const ROUTES: readonly Route[] = ["title", "game", "load", "save", "config", "backlog", "flowchart"];

const OVERLAY_OF_ROUTE: Readonly<Partial<Record<Route, OverlayScreen>>> = {
  load: "load",
  save: "save",
  config: "settings",
  backlog: "backlog",
  flowchart: "flowchart",
};

const ROUTE_OF_OVERLAY: Readonly<Record<OverlayScreen, Route>> = {
  pause: "game",
  load: "load",
  save: "save",
  settings: "config",
  backlog: "backlog",
  flowchart: "flowchart",
};

/** Écran de recouvrement d'une route (undefined pour `title` et `game`). */
export function overlayOfRoute(route: Route): OverlayScreen | undefined {
  return OVERLAY_OF_ROUTE[route];
}

/** `true` si la route est un écran ouvert au-dessus du titre ou de la partie. */
export function isOverlayRoute(route: Route): boolean {
  return OVERLAY_OF_ROUTE[route] !== undefined;
}

/** `true` si l'écran n'a de sens qu'avec une partie en cours (sinon : repli sur le titre). */
export function routeRequiresGame(route: Route): boolean {
  return route === "game" || route === "save" || route === "backlog";
}

/** `#/load` -> `"load"` ; tolère la casse, une barre finale et `#load`. Tout le reste (chemin, requête, inconnu) : `null`. */
export function parseRoute(hash: string): Route | null {
  if (typeof hash !== "string") return null;
  const match = /^#\/?([a-z]+)\/?$/i.exec(hash.trim());
  if (!match) return null;
  const name = match[1]!.toLowerCase();
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : null;
}

/** `"load"` -> `"#/load"`. */
export function serializeRoute(route: Route): string {
  return `#/${route}`;
}

/**
 * Route effectivement atteignable : une route inconnue (`null`) ou qui exige une partie sans partie en cours
 * retombe sur le titre.
 */
export function resolveRoute(target: Route | null, ctx: { inGame: boolean }): Route {
  if (target === null) return "title";
  if (routeRequiresGame(target) && !ctx.inGame) return "title";
  return target;
}

/** Route décrivant la vue actuelle du player (déduite de l'état et de l'écran du dessus de la pile). */
export function viewRoute(ctx: { inGame: boolean; top: OverlayScreen | undefined }): Route {
  if (ctx.top) return ROUTE_OF_OVERLAY[ctx.top];
  return ctx.inGame ? "game" : "title";
}

// ── Adaptateur historique ──

/** Sous-ensemble de `Window` utilisé (injectable pour les tests). */
export interface RouterHost {
  location: { hash: string; pathname: string; search: string };
  history: {
    state: unknown;
    pushState(state: unknown, unused: string, url?: string | null): void;
    replaceState(state: unknown, unused: string, url?: string | null): void;
    back(): void;
  };
  addEventListener(type: "hashchange", listener: () => void): void;
  removeEventListener(type: "hashchange", listener: () => void): void;
}

/** Contrat vu par le `Player`. */
export interface ScreenRouter {
  /**
   * Démarre le routage : lit l'URL, installe la base d'historique (un lien direct vers un écran est précédé du
   * titre, pour que « précédent » le ferme) et renvoie la route d'arrivée. `onNavigate` est appelé quand le
   * navigateur change d'URL (précédent, suivant, hash modifié à la main). Renvoie une fonction de détachement.
   */
  start(onNavigate: (route: Route | null) => void, ctx: { inGame: boolean }): { initial: Route; stop: () => void };
  /** Publie la vue actuelle du player (idempotent). */
  publish(route: Route): void;
}

/** Marqueur posé dans `history.state` ; ne contient que la profondeur dans la pile de cette application. */
type HistoryMark = { mahoyo: number };

function readDepth(state: unknown): number | null {
  const mark = state as Partial<HistoryMark> | null | undefined;
  return mark && typeof mark.mahoyo === "number" && Number.isInteger(mark.mahoyo) && mark.mahoyo >= 0 ? mark.mahoyo : null;
}

/** Délai après lequel un `history.back()` sans `hashchange` en retour n'est plus attendu. */
const BACK_SETTLE_MS = 500;

/**
 * Routeur à base de hash. L'entrée d'historique courante est toujours celle de la dernière vue publiée ;
 * ouvrir un écran empile une entrée, le fermer la dépile (`history.back()`) quand elle est la nôtre, sinon
 * remplace l'entrée : jamais de boucle ni de croissance de l'historique à chaque aller-retour.
 */
export class HistoryRouter implements ScreenRouter {
  private current: Route = "title";
  /** Routes des entrées d'historique créées par cette session ; l'index est la profondeur. */
  private stack: Route[] = ["title"];
  private depth = 0;
  private onNavigate: ((route: Route | null) => void) | null = null;
  private navigating = false;
  private pendingBacks = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: RouterHost = window) {}

  start(onNavigate: (route: Route | null) => void, ctx: { inGame: boolean }): { initial: Route; stop: () => void } {
    this.onNavigate = onNavigate;
    const initial = resolveRoute(this.readLocation(), ctx);
    if (isOverlayRoute(initial)) {
      // Lien direct vers un écran : le titre est la base, l'écran est empilé par-dessus.
      this.stack = ["title", initial];
      this.depth = 1;
      this.write("replace", "title", 0);
      this.write("push", initial, 1);
    } else {
      this.stack = [initial];
      this.depth = 0;
      this.write("replace", initial, 0);
    }
    this.current = initial;
    this.host.addEventListener("hashchange", this.onHashChange);
    return {
      initial,
      stop: () => {
        this.host.removeEventListener("hashchange", this.onHashChange);
        this.onNavigate = null;
        this.clearPending();
      },
    };
  }

  publish(route: Route): void {
    if (route === this.current) return;
    this.current = route;
    if (this.navigating) {
      // Réaction du player à une navigation du navigateur : l'entrée existe déjà, on ne fait que la réaligner.
      this.stack[this.depth] = route;
      if (this.readLocation() !== route) this.write("replace", route, this.depth);
      return;
    }
    if (isOverlayRoute(route)) {
      // Ouverture d'un écran : nouvelle entrée.
      this.depth += 1;
      this.stack.length = this.depth;
      this.stack[this.depth] = route;
      this.write("push", route, this.depth);
      return;
    }
    if (this.depth > 0 && this.stack[this.depth - 1] === route) {
      // Fermeture d'un écran empilé par nous (ou retour au titre) : on revient à l'entrée précédente.
      this.depth -= 1;
      this.stack.length = this.depth + 1;
      this.back();
      return;
    }
    this.stack[this.depth] = route;
    this.write("replace", route, this.depth);
  }

  // ── Interne ──

  private readLocation(): Route | null {
    try {
      return parseRoute(this.host.location.hash);
    } catch {
      return null;
    }
  }

  /** Écrit l'URL (`#/route`) en conservant chemin et requête ; aucune API d'historique ne doit lever. */
  private write(mode: "push" | "replace", route: Route, depth: number): void {
    try {
      const { pathname, search } = this.host.location;
      const url = `${pathname}${search}${serializeRoute(route)}`;
      const mark: HistoryMark = { mahoyo: depth };
      if (mode === "push") this.host.history.pushState(mark, "", url);
      else this.host.history.replaceState(mark, "", url);
    } catch {
      /* historique indisponible (iframe sandbox, file://...) : les écrans restent utilisables sans URL */
    }
  }

  private back(): void {
    this.pendingBacks += 1;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => this.clearPending(), BACK_SETTLE_MS);
    try {
      this.host.history.back();
    } catch {
      this.clearPending();
    }
  }

  private clearPending(): void {
    this.pendingBacks = 0;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
  }

  private readonly onHashChange = (): void => {
    const target = this.readLocation();
    if (this.pendingBacks > 0) {
      // Retour déclenché par nous (fermeture d'un écran) : le player est déjà à jour.
      this.pendingBacks -= 1;
      if (this.pendingBacks === 0) this.clearPending();
      if (target !== this.current) this.write("replace", this.current, this.depth);
      return;
    }
    if (target !== null && target === this.current) {
      this.syncDepth(target);
      return;
    }
    // Navigation du navigateur : le player applique la route, puis l'URL est réalignée sur la vue réelle
    // (repli sur le titre, écran refusé, confirmation en attente...).
    this.syncDepth(target);
    this.navigating = true;
    try {
      this.onNavigate?.(target);
    } finally {
      this.navigating = false;
    }
    this.reconcile();
  };

  /** Recale la profondeur sur `history.state` quand l'entrée est une des nôtres. */
  private syncDepth(target: Route | null): void {
    let depth: number | null = null;
    try {
      depth = readDepth(this.host.history.state);
    } catch {
      depth = null;
    }
    if (depth !== null && depth < this.stack.length && this.stack[depth] === target) {
      this.depth = depth;
    } else {
      // Entrée inconnue (hash tapé à la main, session précédente) : on repart de cette entrée.
      this.stack = [target ?? this.current];
      this.depth = 0;
    }
  }

  /** Après une navigation, aligne l'entrée courante sur la route réellement affichée. */
  private reconcile(): void {
    const actual = this.current;
    const located = this.readLocation();
    if (located !== actual) {
      this.stack[this.depth] = actual;
      this.write("replace", actual, this.depth);
    }
  }
}
