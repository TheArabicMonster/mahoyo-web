/**
 * Reconnaissance de gestes tactiles (WEB-01, #203). Module pur : aucun accès au DOM ni aux minuteurs,
 * les événements de pointeur lui sont transmis avec leur horodatage (ms). Il se teste seul.
 *
 * Gestes reconnus pour un doigt unique :
 * - `tap` : appui bref sans déplacement (le navigateur émet déjà le `click` qui fait avancer le texte) ;
 * - `long-press` : doigt maintenu `longPressMs` sans bouger (émis une seule fois, pendant l'appui) ;
 * - `swipe-up|down|left|right` : déplacement net (≥ `swipeMinPx`) et rapide (≤ `swipeMaxMs`), dont l'axe
 *   dominant l'emporte d'au moins `axisRatio` sur l'autre.
 * Un second doigt invalide le geste en cours (pincement) jusqu'à ce que tous les doigts soient levés.
 * Les distances sont en pixels d'écran (CSS réels), pas en pixels logiques 1280×720.
 */

export type GestureKind = "tap" | "long-press" | "swipe-up" | "swipe-down" | "swipe-left" | "swipe-right";

export interface GestureConfig {
  /** Durée d'appui avant « appui long », en ms. */
  readonly longPressMs: number;
  /** Déplacement toléré pour un appui (tremblement du doigt), en px. */
  readonly slopPx: number;
  /** Distance minimale d'un balayage, en px. */
  readonly swipeMinPx: number;
  /** Durée maximale d'un balayage, en ms (au-delà : glissement lent, ignoré). */
  readonly swipeMaxMs: number;
  /** Rapport minimal entre l'axe dominant et l'autre axe pour un balayage net. */
  readonly axisRatio: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  longPressMs: 500,
  slopPx: 12,
  swipeMinPx: 56,
  swipeMaxMs: 700,
  axisRatio: 1.5,
};

export interface PointerSample {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** Horodatage en ms (par ex. `event.timeStamp`). */
  readonly t: number;
}

interface Track {
  readonly id: number;
  readonly x0: number;
  readonly y0: number;
  readonly t0: number;
  moved: boolean;
  longPressed: boolean;
}

export class GestureRecognizer {
  private track: Track | null = null;
  /** Vrai tant qu'un second doigt a touché : le geste en cours est abandonné. */
  private invalid = false;
  private down = new Set<number>();

  constructor(private readonly config: GestureConfig = DEFAULT_GESTURE_CONFIG) {}

  /** Instant (ms) où l'appui long sera dû, ou null s'il n'y a rien à attendre. Sert à armer un minuteur. */
  get longPressDueAt(): number | null {
    const tr = this.track;
    if (!tr || this.invalid || tr.moved || tr.longPressed) return null;
    return tr.t0 + this.config.longPressMs;
  }

  pointerDown(p: PointerSample): void {
    this.down.add(p.id);
    if (this.track || this.down.size > 1) {
      // Deuxième doigt : le geste de pincement n'est ni un appui, ni un balayage.
      this.invalid = true;
      return;
    }
    this.invalid = false;
    this.track = { id: p.id, x0: p.x, y0: p.y, t0: p.t, moved: false, longPressed: false };
  }

  /** Suit le doigt : un déplacement au-delà de la tolérance annule l'appui (et donc l'appui long). */
  pointerMove(p: PointerSample): void {
    const tr = this.track;
    if (!tr || tr.id !== p.id || tr.moved) return;
    if (Math.hypot(p.x - tr.x0, p.y - tr.y0) > this.config.slopPx) tr.moved = true;
  }

  /** À appeler quand le minuteur d'appui long expire : renvoie `long-press` une seule fois, si dû. */
  checkLongPress(now: number): GestureKind | null {
    const tr = this.track;
    if (!tr || this.invalid || tr.moved || tr.longPressed) return null;
    if (now < tr.t0 + this.config.longPressMs) return null; // même expression que `longPressDueAt` (pas de dérive flottante)
    tr.longPressed = true;
    return "long-press";
  }

  pointerUp(p: PointerSample): GestureKind | null {
    this.down.delete(p.id);
    const tr = this.track;
    if (!tr || tr.id !== p.id) {
      if (this.down.size === 0) this.reset();
      return null;
    }
    const wasInvalid = this.invalid;
    this.reset();
    if (wasInvalid) return null;
    // Appui long déjà émis : le relâchement ne produit rien (et le `click` suivant est à supprimer).
    if (tr.longPressed) return null;

    const dx = p.x - tr.x0;
    const dy = p.y - tr.y0;
    const dist = Math.hypot(dx, dy);
    const duration = p.t - tr.t0;
    if (!tr.moved && dist <= this.config.slopPx) {
      return p.t >= tr.t0 + this.config.longPressMs ? "long-press" : "tap";
    }
    if (dist < this.config.swipeMinPx || duration > this.config.swipeMaxMs) return null;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ay >= ax * this.config.axisRatio) return dy < 0 ? "swipe-up" : "swipe-down";
    if (ax >= ay * this.config.axisRatio) return dx < 0 ? "swipe-left" : "swipe-right";
    return null;
  }

  pointerCancel(id: number): void {
    this.down.delete(id);
    if (this.track?.id === id || this.down.size === 0) this.reset();
  }

  private reset(): void {
    this.track = null;
    if (this.down.size === 0) this.invalid = false;
  }
}
