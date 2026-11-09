import "./transitions.css";

/**
 * Transitions plein écran standard (HUD-14, #205 ; `docs/ANALYSE_HUD_ORIGINAL.md` §2.12,
 * `docs/DESIGN.md` §7).
 *
 * Trois passages passent par un fondu au noir chronométré, aux durées mesurées sur l'original :
 *
 * | Transition        | Fondu au noir | Noir | Apparition |
 * |-------------------|---------------|------|------------|
 * | titre → jeu       | 1,2 s         | 0,2 s| 0,85 s     |
 * | jeu → titre       | 0,4 s         | 0,1 s| 0,8 s      |
 * | chargement → scène| 0,4 s         | —    | 0,85 s     |
 *
 * Le rideau (`.mh-ui-transition`, `transitions.css`) est peint au-dessus de l'interface et bloqué
 * pendant son activité ; `#ui-loading` (z-index 300, `docs/layout.md`), qui reste au-dessus, sert
 * d'écran de chargement stylé si les assets ne sont pas prêts avant la fin du fondu.
 *
 * Les durées sont **lues dans les tokens `--mh-dur-*`** via `transitions.css` (résolution des
 * variables CSS par `getComputedStyle`) : sous `prefers-reduced-motion`, `tokens.css` les ramène
 * toutes à 0 ms et le module ne joue alors aucune transition. Les constantes `FALLBACK_TIMINGS` ne
 * servent que de repli quand les variables ne sont pas résolvables (jsdom, feuille non chargée) ;
 * un test unitaire vérifie qu'elles restent égales aux tokens.
 */

/** Type de passage plein écran. */
export type TransitionKind = "title-to-game" | "game-to-title" | "loading-to-scene";

/** Durées d'une transition, en millisecondes. */
export type TransitionTimings = {
  /** Fondu au noir (opacité 0 → 1). */
  out: number;
  /** Maintien à l'écran noir avant l'apparition (≈ 0,2 s / 0,1 s mesurés). */
  hold: number;
  /** Apparition de l'écran (opacité 1 → 0). */
  in: number;
};

/**
 * Repli des durées, égal aux tokens de `tokens.css` (`--mh-dur-scene-out`, etc.) et aux constantes
 * de `transitions.css`. Utilisé seulement quand `getComputedStyle` ne résout pas les variables.
 */
export const FALLBACK_TIMINGS: Readonly<Record<TransitionKind, TransitionTimings>> = {
  "title-to-game": { out: 1200, hold: 200, in: 850 },
  "game-to-title": { out: 400, hold: 100, in: 800 },
  "loading-to-scene": { out: 400, hold: 0, in: 850 },
};

/** Classe du rideau (doit rester alignée avec `transitions.css`). */
export const TRANSITION_CLASS = "mh-ui-transition";
/** Classe posée sur le parent pendant la transition (écran de chargement stylé). */
export const TRANSITION_RUNNING_CLASS = "mh-ui-transition-running";

/** Poignée d'une transition en cours : `black` pour échanger les écrans, `reveal()` pour finir. */
export interface ScreenTransition {
  /**
   * Résolue quand le noir est complet : c'est le moment d'échanger les écrans (titre ↔ jeu), pour
   * que le changement ne soit pas visible pendant le fondu. Résolue aussi après `cancel()`.
   */
  readonly black: Promise<void>;
  /** Révèle l'écran préchargé, puis résout quand la transition est terminée. */
  reveal(): Promise<void>;
  /** Abandonne la transition (erreur) : le rideau disparaît immédiatement, `reveal()` résout sans animer. */
  cancel(): void;
}

/** Fabrique de transitions (injectable dans le player pour les tests). */
export interface ScreenTransitions {
  /** Démarre le fondu au noir du type demandé, concurrent avec le préchargement. */
  start(kind: TransitionKind): ScreenTransition;
  dispose(): void;
}

export type ScreenTransitionsOptions = {
  /** Racine du player (`#viewport`) : le rideau est posé dans `#ui-overlay` s'il existe. */
  host: HTMLElement;
  /** Sonde de `prefers-reduced-motion` (défaut : `matchMedia`). Vrai = aucune transition. */
  prefersReducedMotion?: () => boolean;
};

/** Transition inerte : aucune animation, `black` puis `reveal()` immédiats (reduced motion, tokens à 0, module disposé). */
const INSTANT_TRANSITION: ScreenTransition = {
  black: Promise.resolve(),
  reveal: () => Promise.resolve(),
  cancel: () => {},
};

function systemPrefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Lit une durée CSS (`1200ms`, `1.2s`, `0s`) en millisecondes.
 * Retourne `null` si la valeur est absente ou invalide (repli de l'appelant).
 */
export function parseCssDuration(value: string): number | null {
  const match = /^\s*(-?[\d.]+)(ms|s)\s*$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return match[2] === "s" ? amount * 1000 : amount;
}

/**
 * Regroupe les temporisations annulables d'une transition. `cancel()` résout les attentes en cours :
 * une poignée abandonnée ne laisse ni minuteur actif ni promesse pendante.
 */
class Sleepers {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly resolvers = new Set<() => void>();

  wait(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        this.resolvers.delete(done);
        resolve();
      };
      this.resolvers.add(done);
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        done();
      }, ms);
      this.timers.add(timer);
    });
  }

  cancel(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const resolve of [...this.resolvers]) resolve();
    this.resolvers.clear();
  }
}

/**
 * Rideau plein écran en DOM. Une seule transition active à la fois : `start()` interrompt la
 * précédente (elle est alors révélée sans animation) avant d'en démarrer une nouvelle.
 */
export class DomScreenTransitions implements ScreenTransitions {
  /** Rideau (`id="ui-transition"`), exposé pour les tests et le diagnostic. */
  readonly element: HTMLDivElement;
  /** Parent recevant `mh-ui-transition-running` : `#ui-overlay` en usage réel, la racine sinon. */
  readonly parent: HTMLElement;

  private readonly reduced: () => boolean;
  private current: ScreenTransition | null = null;
  private disposed = false;

  constructor(options: ScreenTransitionsOptions) {
    this.reduced = options.prefersReducedMotion ?? systemPrefersReducedMotion;
    const doc = options.host.ownerDocument;
    this.element = doc.createElement("div");
    this.element.id = "ui-transition";
    this.element.className = TRANSITION_CLASS;
    this.element.setAttribute("aria-hidden", "true");
    this.element.dataset.phase = "idle";
    // L'écran de chargement `#ui-loading` (z-index 300) doit rester au-dessus du rideau (250) :
    // on pose le rideau dans l'overlay plutôt qu'à la racine du viewport.
    const overlay = options.host.querySelector<HTMLElement>("#ui-overlay");
    this.parent = overlay ?? options.host;
    this.parent.appendChild(this.element);
  }

  /** Vrai pendant une transition (rideau visible ou en cours de fondu). */
  get active(): boolean {
    return this.current !== null;
  }

  /** Phase courante du rideau (`idle` hors transition). */
  get phase(): string {
    return this.element.dataset.phase ?? "idle";
  }

  /**
   * Durées du type demandé : variables CSS `--mh-transition-*` de `transitions.css` (elles-mêmes
   * des `var(--mh-dur-*)` de `tokens.css`), avec `FALLBACK_TIMINGS` comme repli.
   */
  timings(kind: TransitionKind): TransitionTimings {
    const fallback = FALLBACK_TIMINGS[kind];
    let style: CSSStyleDeclaration | null = null;
    try {
      style = typeof getComputedStyle === "function" ? getComputedStyle(this.element) : null;
    } catch {
      style = null;
    }
    const read = (name: string, fallbackMs: number): number => parseCssDuration(style?.getPropertyValue(name) ?? "") ?? fallbackMs;
    return {
      out: read("--mh-transition-out", fallback.out),
      hold: read("--mh-transition-hold", fallback.hold),
      in: read("--mh-transition-in", fallback.in),
    };
  }

  start(kind: TransitionKind): ScreenTransition {
    if (this.disposed) return INSTANT_TRANSITION;
    // Une transition précédente (erreur de chargement, navigation rapide) est abandonnée avant la nouvelle.
    this.current?.cancel();
    this.element.dataset.kind = kind;
    const timings: TransitionTimings = this.reduced() ? { out: 0, hold: 0, in: 0 } : this.timings(kind);
    if (timings.out <= 0 && timings.hold <= 0 && timings.in <= 0) {
      // Aucune transition (prefers-reduced-motion ou tokens à 0) : l'écran est déjà à jour quand
      // beginScript/returnToTitle/load rendent la main. Le rideau reste en phase idle.
      delete this.element.dataset.kind;
      return INSTANT_TRANSITION;
    }

    const sleepers = new Sleepers();
    let finished = false;
    let outDoneResolve: (() => void) | null = null;
    const outDone = new Promise<void>((resolve) => {
      outDoneResolve = resolve;
    });

    const setPhase = (phase: string): void => {
      this.element.dataset.phase = phase;
    };

    const finish = (): void => {
      if (finished) return;
      finished = true;
      sleepers.cancel();
      outDoneResolve?.(); // une transition annulée ne laisse jamais `black` en attente
      setPhase("idle");
      this.parent.classList.remove(TRANSITION_RUNNING_CLASS);
      delete this.parent.dataset.transitionKind;
      if (this.current === handle) this.current = null;
    };

    const handle: ScreenTransition = {
      black: outDone,
      async reveal(): Promise<void> {
        if (finished) return;
        await outDone;
        if (finished) return;
        await sleepers.wait(timings.hold);
        if (finished) return;
        setPhase("in");
        await sleepers.wait(timings.in);
        if (finished) return;
        finish();
      },
      cancel(): void {
        finish();
      },
    };

    this.current = handle;
    this.parent.classList.add(TRANSITION_RUNNING_CLASS);
    this.parent.dataset.transitionKind = kind;
    this.element.dataset.phase = "idle"; // départ depuis opacity:0
    // Force un reflow : sans lui, le navigateur peut fusionner opacity:0 et opacity:1 et ne rien animer.
    void this.element.offsetWidth;
    setPhase("out");

    // Fin du fondu au noir : le noir est complet, l'écran de chargement peut apparaître.
    const markBlack = (): void => {
      if (finished) return;
      setPhase("black");
      outDoneResolve?.();
    };
    if (timings.out <= 0) markBlack();
    else void sleepers.wait(timings.out).then(markBlack);

    return handle;
  }

  dispose(): void {
    this.disposed = true;
    this.current?.cancel();
    this.current = null;
    this.element.remove();
  }
}

/** Fabrique par défaut, branchée par le player sur `#viewport`. */
export function createScreenTransitions(options: ScreenTransitionsOptions): DomScreenTransitions {
  return new DomScreenTransitions(options);
}
