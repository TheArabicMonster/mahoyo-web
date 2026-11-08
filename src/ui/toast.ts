import "./toast.css";

/**
 * Toasts au design d'origine (HUD-13, #191) : cadre sarcelle ornementé en bas à droite,
 * entrée 0,2 s, maintien ≈ 2,5 s (docs/ANALYSE_HUD_ORIGINAL.md §2.6 et §2.12, docs/DESIGN.md §5).
 *
 * Composant autonome : il ne connaît que son conteneur. `DomUIManager.toast()` y délègue, l'API
 * des appelants (`toast(message, duration?)`) est inchangée. Le rendu est en CSS pur (`toast.css`).
 */

/** Durée de maintien par défaut, en ms (≈ 2,5 s mesurées sur l'original). */
export const TOAST_HOLD_MS = 2500;
/** Nombre maximal de toasts empilés : au-delà, le plus ancien disparaît. */
export const TOAST_MAX_STACK = 3;
/** Fondu de sortie, en ms. Doit rester égal à `--mh-dur-fast` (tokens.css) utilisé par `toast.css`. */
export const TOAST_LEAVE_MS = 150;

export interface ToastStackOptions {
  /** Pile maximale (défaut : 3). */
  max?: number;
  /** Maintien par défaut (défaut : 2500 ms). */
  holdMs?: number;
  /** Fondu de sortie (défaut : 150 ms). */
  leaveMs?: number;
  /** Sonde de `prefers-reduced-motion` (défaut : `matchMedia`). Vrai = suppression sans animation. */
  prefersReducedMotion?: () => boolean;
}

interface Entry {
  el: HTMLElement;
  timers: Set<ReturnType<typeof setTimeout>>;
}

function systemPrefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export class ToastStack {
  private readonly entries: Entry[] = [];
  private readonly max: number;
  private readonly holdMs: number;
  private readonly leaveMs: number;
  private readonly reduced: () => boolean;
  private disposed = false;

  constructor(
    private readonly host: HTMLElement,
    options: ToastStackOptions = {},
  ) {
    this.max = Math.max(1, options.max ?? TOAST_MAX_STACK);
    this.holdMs = options.holdMs ?? TOAST_HOLD_MS;
    this.leaveMs = options.leaveMs ?? TOAST_LEAVE_MS;
    this.reduced = options.prefersReducedMotion ?? systemPrefersReducedMotion;
    host.classList.add("mh-toast-host");
    // Région vivante présente avant les messages : les lecteurs d'écran annoncent les ajouts.
    host.setAttribute("aria-live", "polite");
    host.setAttribute("aria-relevant", "additions");
    host.setAttribute("aria-atomic", "false");
  }

  /** Nombre de toasts à l'écran (y compris ceux en train de s'effacer). */
  get count(): number {
    return this.entries.length;
  }

  /** Affiche `message` pendant `holdMs` (défaut 2,5 s), puis l'efface en fondu. */
  show(message: string, holdMs: number = this.holdMs): void {
    if (this.disposed) return;
    while (this.entries.length >= this.max) this.remove(this.entries[0]!);

    const el = this.host.ownerDocument.createElement("div");
    el.className = "mh-toast";
    el.textContent = message;
    this.host.appendChild(el);

    const entry: Entry = { el, timers: new Set() };
    this.entries.push(entry);
    this.schedule(entry, () => this.leave(entry), holdMs);
  }

  /** Retire tous les toasts immédiatement. */
  clear(): void {
    for (const entry of [...this.entries]) this.remove(entry);
  }

  /** Retire les toasts et rend le conteneur inerte. */
  dispose(): void {
    this.clear();
    this.disposed = true;
    this.host.classList.remove("mh-toast-host");
    this.host.removeAttribute("aria-live");
    this.host.removeAttribute("aria-relevant");
    this.host.removeAttribute("aria-atomic");
  }

  private leave(entry: Entry): void {
    if (!this.entries.includes(entry)) return;
    if (this.reduced() || this.leaveMs <= 0) {
      this.remove(entry);
      return;
    }
    entry.el.dataset.state = "leaving";
    this.schedule(entry, () => this.remove(entry), this.leaveMs);
  }

  private schedule(entry: Entry, fn: () => void, ms: number): void {
    const timer = setTimeout(() => {
      entry.timers.delete(timer);
      fn();
    }, ms);
    entry.timers.add(timer);
  }

  private remove(entry: Entry): void {
    for (const timer of entry.timers) clearTimeout(timer);
    entry.timers.clear();
    entry.el.remove();
    const i = this.entries.indexOf(entry);
    if (i >= 0) this.entries.splice(i, 1);
  }
}
