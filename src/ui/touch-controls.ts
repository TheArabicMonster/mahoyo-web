import { DEFAULT_GESTURE_CONFIG, GestureRecognizer, type GestureConfig, type GestureKind } from "@/ui/gestures.js";
import { t, type MessageKey } from "@/ui/i18n.js";
import type { PlayerCommands, PlayerStatus, UIView } from "@/ui/types.js";
import "./touch-controls.css";

/**
 * Commandes tactiles (WEB-01, #203 ; docs/ANALYSE_HUD_ORIGINAL.md §2.4, §2.5, écarts E24 et E25 ;
 * docs/DESIGN.md §9.8).
 *
 * L'original se joue à la souris (clic droit = menu). Sur écran tactile, ce module ajoute :
 * - un bouton de menu persistant et discret (coin haut-droit, plus visible juste après un toucher) ;
 * - l'appui long sur la scène = menu système, le balayage vers le haut = historique ; l'appui simple
 *   garde son comportement (le `click` natif fait avancer le texte, géré par `DomUIManager`) ;
 * - une barre d'actions rapides (Q.Save, Q.Load, Auto, Skip, Historique, Plein écran). Pas de bouton Exit
 *   (décision 3 du propriétaire).
 *
 * Tout cela n'existe **que** sur appareil tactile : `pointer: coarse`, ou un toucher réellement observé
 * (appareil hybride) tant qu'aucun clic de souris ne l'a démenti. Sur desktop souris, aucun nœud n'est
 * créé. Le clic droit et les raccourcis clavier ne sont pas touchés.
 *
 * Composant autonome : il ne connaît pas `DomUIManager`, seulement les commandes du player et quelques
 * sondes. La reconnaissance des gestes est dans `gestures.ts` (module pur).
 */

/** Cible tactile en pixels d'écran réels (DESIGN §10 : 44 px minimum ; 48 px pour le confort). */
export const TOUCH_TARGET_PX = 48;
/** Durée pendant laquelle les commandes restent bien visibles après un toucher, en ms. */
export const AWAKE_MS = 3000;
/** Après un geste reconnu, le `click` synthétique qui suit le relâchement est supprimé pendant ce délai (ms). */
export const CLICK_SUPPRESS_MS = 400;
/** Un `contextmenu` natif tactile survenant dans ce délai après un appui long reconnu est un doublon (ms). */
const LONG_PRESS_DEDUPE_MS = 800;
/** Un `contextmenu` est tactile s'il suit un toucher de moins de ce délai (ms). */
const RECENT_TOUCH_MS = 1500;
/** Bornes du facteur d'échelle lu sur le viewport (évite des cibles démesurées si la mesure est aberrante). */
const SCALE_MIN = 0.25;
const SCALE_MAX = 4;

/** Éléments sur lesquels un geste ne doit pas partir (même règle que `DomUIManager.onInteractive`). */
const INTERACTIVE = ".mh-ui-panel, button, input, select, a";

export type TouchActionId = "qsave" | "qload" | "auto" | "skip" | "backlog" | "fullscreen";

export interface TouchControlsContext {
  readonly commands: PlayerCommands;
  /** État courant du player (lu au moment du toucher, pas au rendu). */
  readonly getStatus: () => Readonly<PlayerStatus>;
  /** Vrai en jeu, entrées actives et sans boîte de confirmation (même condition que le clic). */
  readonly isPlaying: () => boolean;
}

export interface TouchControlsEnv {
  /** Sonde `pointer: coarse` (défaut : `matchMedia`). Peut notifier d'un changement. */
  readonly matchMedia?: (query: string) => MediaQueryList;
  /** Horloge en ms (défaut : `performance.now`). */
  readonly now?: () => number;
  /** Le navigateur sait-il passer en plein écran ? (défaut : `requestFullscreen` existe). Absent sur iPhone. */
  readonly fullscreenSupported?: () => boolean;
  readonly gestures?: GestureConfig;
}

export interface TouchControls {
  /** Vrai si l'interface tactile est active (nœuds créés). */
  readonly active: boolean;
  /** Met à jour la visibilité et les états (appelé à chaque changement d'écran ou de statut). */
  sync(screen: UIView["screen"], status: Readonly<PlayerStatus>): void;
  dispose(): void;
}

interface ActionDef {
  readonly id: TouchActionId;
  readonly labelKey: Extract<MessageKey, `touch.${string}` | `systemMenu.entry.${string}`>;
  /** Verrouillée par `@lockquickmenu`. */
  readonly lockedByQuickMenu?: boolean;
  readonly pressed?: (status: Readonly<PlayerStatus>) => boolean;
  readonly run: (ctx: TouchControlsContext) => void;
}

/** Actions de la barre, dans l'ordre d'affichage. Ajouter ou retirer un bouton = une ligne ici. */
export const TOUCH_ACTIONS: readonly ActionDef[] = [
  { id: "qsave", labelKey: "touch.qsave", lockedByQuickMenu: true, run: (c) => void c.commands.save("quick") },
  // Comme le raccourci clavier « chargement rapide » : on ouvre l'écran, on ne remplace pas la partie sans demander.
  { id: "qload", labelKey: "touch.qload", lockedByQuickMenu: true, run: (c) => c.commands.openScreen("load") },
  {
    id: "auto",
    labelKey: "systemMenu.entry.auto",
    pressed: (s) => s.mode === "auto",
    run: (c) => c.commands.setMode(c.getStatus().mode === "auto" ? "normal" : "auto"),
  },
  {
    id: "skip",
    labelKey: "systemMenu.entry.skip",
    pressed: (s) => s.mode === "skip",
    run: (c) => c.commands.setMode(c.getStatus().mode === "skip" ? "normal" : "skip"),
  },
  { id: "backlog", labelKey: "systemMenu.entry.backlog", run: (c) => c.commands.openScreen("backlog") },
  { id: "fullscreen", labelKey: "touch.fullscreen", run: (c) => c.commands.toggleFullscreen() },
];

/** Geste → action. Seuls l'appui long et le balayage vers le haut sont câblés ; l'appui simple avance via `click`. */
export function actionForGesture(gesture: GestureKind): "menu" | "backlog" | null {
  switch (gesture) {
    case "long-press":
      return "menu";
    case "swipe-up":
      return "backlog";
    default:
      return null;
  }
}

/** Un toucher active l'interface tactile ; un clic de souris (ou le stylet) la désactive ; le reste ne change rien. */
export function nextTouchSeen(previous: boolean, pointerType: string): boolean {
  if (pointerType === "touch") return true;
  if (pointerType === "mouse") return false;
  return previous;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}

export function createTouchControls(
  overlay: HTMLElement,
  ctx: TouchControlsContext,
  env: TouchControlsEnv = {},
): TouchControls {
  const now = env.now ?? (() => performance.now());
  const fullscreenSupported =
    env.fullscreenSupported ?? (() => typeof document.documentElement.requestFullscreen === "function");
  const mediaFn = env.matchMedia ?? (typeof matchMedia === "function" ? (q: string) => matchMedia(q) : null);
  const coarseQuery = mediaFn ? mediaFn("(pointer: coarse)") : null;
  const recognizer = new GestureRecognizer(env.gestures ?? DEFAULT_GESTURE_CONFIG);

  let coarse = coarseQuery?.matches ?? false;
  let touchSeen = false;
  let root: HTMLElement | null = null;
  let lastScreen: UIView["screen"] = "game";
  let lastStatus: Readonly<PlayerStatus> | null = null;
  let awakeTimer: ReturnType<typeof setTimeout> | undefined;
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  let suppressClickUntil = 0;
  let lastLongPressAt = -Infinity;
  let lastTouchAt = -Infinity;
  let rafId: number | undefined;
  let disposed = false;

  const isActive = (): boolean => coarse || touchSeen;

  // ── Construction ──

  function build(): HTMLElement {
    const host = el("div", "mh-touch");
    host.id = "ui-touch";

    const menu = el("button", "mh-touch-menu");
    menu.type = "button";
    menu.dataset.touch = "menu";
    menu.setAttribute("aria-label", t("touch.menuButton"));
    for (let i = 0; i < 3; i++) menu.appendChild(el("span", "mh-touch-menu-bar"));
    menu.addEventListener("click", () => {
      if (ctx.isPlaying()) ctx.commands.openScreen("pause");
    });
    host.appendChild(menu);

    const bar = el("div", "mh-touch-bar");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", t("touch.barLabel"));
    for (const action of TOUCH_ACTIONS) {
      if (action.id === "fullscreen" && !fullscreenSupported()) continue;
      const btn = el("button", "mh-touch-action");
      btn.type = "button";
      btn.dataset.touch = action.id;
      btn.textContent = t(action.labelKey);
      btn.addEventListener("click", () => {
        if (ctx.isPlaying()) action.run(ctx);
      });
      bar.appendChild(btn);
    }
    host.appendChild(bar);
    return host;
  }

  function applyScale(): void {
    if (!root) return;
    const logical = overlay.offsetWidth;
    const real = overlay.getBoundingClientRect().width;
    let scale = logical > 0 && real > 0 ? real / logical : 1;
    scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale));
    // Sur l'overlay : le badge Auto/Skip, frère de la racine, en dépend aussi.
    overlay.style.setProperty("--mh-ui-scale", String(scale));
    overlay.style.setProperty("--mh-touch-target-px", String(TOUCH_TARGET_PX));
  }

  function clearScale(): void {
    overlay.style.removeProperty("--mh-ui-scale");
    overlay.style.removeProperty("--mh-touch-target-px");
  }

  function scheduleScale(): void {
    applyScale();
    if (typeof requestAnimationFrame !== "function") return;
    if (rafId !== undefined) cancelAnimationFrame(rafId);
    // Le player applique l'échelle au même événement `resize` : on relit une fois la mise en page à jour.
    rafId = requestAnimationFrame(() => {
      rafId = undefined;
      applyScale();
    });
  }

  function render(): void {
    if (disposed) return;
    const active = isActive();
    overlay.classList.toggle("mh-ui-touch", active);
    if (!active) {
      root?.remove();
      root = null;
      clearScale();
      return;
    }
    if (!root) {
      root = build();
      overlay.appendChild(root);
      scheduleScale();
    }
    const status = lastStatus;
    const visible = lastScreen === "game" && !!status && status.inGame && !status.userHidden;
    root.hidden = !visible;
    root.querySelector(".mh-touch-menu")?.setAttribute("aria-label", t("touch.menuButton"));
    root.querySelector(".mh-touch-bar")?.setAttribute("aria-label", t("touch.barLabel"));
    if (!status) return;
    for (const action of TOUCH_ACTIONS) {
      const btn = root.querySelector<HTMLButtonElement>(`.mh-touch-action[data-touch="${action.id}"]`);
      if (!btn) continue;
      btn.textContent = t(action.labelKey); // suit la langue de l'interface
      if (action.lockedByQuickMenu) {
        btn.disabled = status.quickMenuLocked;
        btn.title = status.quickMenuLocked ? t("systemMenu.quickMenuLocked") : "";
      }
      if (action.pressed) {
        const on = action.pressed(status);
        btn.setAttribute("aria-pressed", String(on));
        btn.classList.toggle("is-active", on);
      }
    }
  }

  function wake(): void {
    if (!root) return;
    root.classList.add("is-awake");
    clearTimeout(awakeTimer);
    awakeTimer = setTimeout(() => root?.classList.remove("is-awake"), AWAKE_MS);
  }

  // ── Gestes ──

  function runGesture(gesture: GestureKind | null): void {
    if (!gesture) return;
    const action = actionForGesture(gesture);
    if (!action || !ctx.isPlaying()) return;
    if (action === "menu") {
      lastLongPressAt = now();
      ctx.commands.openScreen("pause");
    } else {
      ctx.commands.openScreen("backlog");
    }
    suppressClickUntil = now() + CLICK_SUPPRESS_MS;
  }

  function armLongPress(): void {
    clearTimeout(longPressTimer);
    const due = recognizer.longPressDueAt;
    if (due === null) return;
    longPressTimer = setTimeout(
      () => {
        // Le minuteur peut partir un peu avant l'échéance (arrondis) : on laisse `checkLongPress` trancher.
        runGesture(recognizer.checkLongPress(Math.max(now(), due)));
      },
      Math.max(0, Math.ceil(due - now())),
    );
  }

  function interactive(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(INTERACTIVE) !== null;
  }

  function onPointerDown(e: Event): void {
    const pe = e as PointerEvent;
    const was = isActive();
    touchSeen = nextTouchSeen(touchSeen, pe.pointerType);
    if (pe.pointerType === "touch") lastTouchAt = now();
    if (was !== isActive()) render();
    if (pe.pointerType !== "touch" || !root) return;
    wake();
    if (interactive(pe.target) || !ctx.isPlaying()) return;
    recognizer.pointerDown({ id: pe.pointerId, x: pe.clientX, y: pe.clientY, t: now() });
    armLongPress();
  }

  function onPointerMove(e: Event): void {
    const pe = e as PointerEvent;
    if (pe.pointerType !== "touch") return;
    recognizer.pointerMove({ id: pe.pointerId, x: pe.clientX, y: pe.clientY, t: now() });
  }

  function onPointerUp(e: Event): void {
    const pe = e as PointerEvent;
    if (pe.pointerType !== "touch") return;
    lastTouchAt = now();
    clearTimeout(longPressTimer);
    runGesture(recognizer.pointerUp({ id: pe.pointerId, x: pe.clientX, y: pe.clientY, t: now() }));
  }

  function onPointerCancel(e: Event): void {
    const pe = e as PointerEvent;
    if (pe.pointerType !== "touch") return;
    clearTimeout(longPressTimer);
    recognizer.pointerCancel(pe.pointerId);
  }

  /** `click` synthétique qui suit un geste reconnu : ne doit pas faire avancer le texte. */
  function onClickCapture(e: Event): void {
    if (now() >= suppressClickUntil) return;
    e.stopPropagation();
    e.preventDefault();
  }

  /**
   * Appui long natif (Android émet `contextmenu`) : jamais traité comme un clic droit souris (il refermerait
   * le menu que notre minuteur vient d'ouvrir). S'il arrive avant notre minuteur, il vaut appui long.
   */
  function onContextMenuCapture(e: Event): void {
    const pe = e as PointerEvent;
    const fromTouch = pe.pointerType === "touch" || (pe.pointerType !== "mouse" && now() - lastTouchAt < RECENT_TOUCH_MS);
    if (!fromTouch || !isActive()) return;
    e.preventDefault();
    e.stopPropagation();
    if (!interactive(e.target) && now() - lastLongPressAt > LONG_PRESS_DEDUPE_MS) runGesture("long-press");
  }

  const onViewportChange = (): void => scheduleScale();
  const onCoarseChange = (): void => {
    coarse = coarseQuery?.matches ?? false;
    render();
  };

  overlay.addEventListener("pointerdown", onPointerDown);
  overlay.addEventListener("pointermove", onPointerMove);
  overlay.addEventListener("pointerup", onPointerUp);
  overlay.addEventListener("pointercancel", onPointerCancel);
  overlay.addEventListener("click", onClickCapture, true);
  overlay.addEventListener("contextmenu", onContextMenuCapture, true);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("orientationchange", onViewportChange);
  document.addEventListener("fullscreenchange", onViewportChange);
  coarseQuery?.addEventListener?.("change", onCoarseChange);
  render();

  return {
    get active() {
      return isActive();
    },
    sync(screen, status) {
      lastScreen = screen;
      lastStatus = status;
      render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(awakeTimer);
      clearTimeout(longPressTimer);
      if (rafId !== undefined && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
      overlay.removeEventListener("pointerdown", onPointerDown);
      overlay.removeEventListener("pointermove", onPointerMove);
      overlay.removeEventListener("pointerup", onPointerUp);
      overlay.removeEventListener("pointercancel", onPointerCancel);
      overlay.removeEventListener("click", onClickCapture, true);
      overlay.removeEventListener("contextmenu", onContextMenuCapture, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", onViewportChange);
      document.removeEventListener("fullscreenchange", onViewportChange);
      coarseQuery?.removeEventListener?.("change", onCoarseChange);
      overlay.classList.remove("mh-ui-touch");
      root?.remove();
      root = null;
      clearScale();
    },
  };
}
