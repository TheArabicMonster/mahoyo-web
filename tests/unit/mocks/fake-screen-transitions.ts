import type { ScreenTransition, ScreenTransitions, TransitionKind } from "@/ui/transitions.js";

/**
 * Double instantané des transitions plein écran (HUD-14, #205) pour les tests du player :
 * il enregistre les appels mais ne pose ni nœud DOM ni minuteur (horloge des tests préservée).
 *
 * Par défaut, `black` est déjà résolue (comme une transition instantanée). Passer `autoBlack` à
 * `false` permet de vérifier que le player n'échange les écrans qu'une fois le noir complet.
 */
export class FakeScreenTransitions implements ScreenTransitions {
  /** Types de transition demandés, dans l'ordre. */
  kinds: TransitionKind[] = [];
  /** Nombre d'appels à `reveal()`. */
  reveals = 0;
  /** Nombre d'appels à `cancel()`. */
  cancels = 0;
  /** Transitions encore en cours (entre `start` et `reveal`/`cancel`). */
  active = 0;
  /** Maximum de transitions simultanées (doit rester 1). */
  maxActive = 0;
  disposed = false;
  /** Résout immédiatement `black` (défaut) ; `false` laisse le test décider du moment du noir. */
  autoBlack = true;
  /** Résolveurs des `black` encore en attente (quand `autoBlack` est faux). */
  pendingBlack: (() => void)[] = [];
  /** Callback observé au moment de `reveal()` : permet de vérifier l'ordre avec l'état du player. */
  onReveal: (() => void) | null = null;

  start(kind: TransitionKind): ScreenTransition {
    this.kinds.push(kind);
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    let settled = false;
    let resolveBlack!: () => void;
    const black = new Promise<void>((resolve) => {
      resolveBlack = resolve;
    });
    const markBlack = (): void => resolveBlack();
    if (this.autoBlack) markBlack();
    else this.pendingBlack.push(markBlack);
    const finish = (): void => {
      if (settled) return;
      settled = true;
      this.active--;
    };
    return {
      black,
      reveal: async () => {
        this.reveals++;
        this.onReveal?.();
        finish();
      },
      cancel: () => {
        this.cancels++;
        markBlack(); // une transition annulée ne laisse pas `black` en attente
        finish();
      },
    };
  }

  dispose(): void {
    this.disposed = true;
  }
}
