/**
 * Compilateur d'animations KAG → Web Animations API (WAAPI).
 *
 * Prend un `AnimationDef` (issu de `@fgact`/`@movefg`, parsé par
 * `src/kag/action.ts`) et produit des keyframes WAAPI + une liste de
 * changements discrets programmés dans le temps.
 *
 * Sémantique (figée par docs/KAG_MAHOYO_SEMANTICS.md) :
 * - `time` (absolu ms) → `offset` WAAPI (0..1) relatif à la durée totale.
 * - `interp` : `l`=linear, `n`=steps(1, end) palier, `~`=warning (linear).
 * - `loop=1` → `iterations: Infinity`.
 * - Props continues (center/vcenter/opacity/zoomx/zoomy/rotate) interpolées.
 * - Props discrètes (storage/effect/contrast/visible/type) appliquées
 *   instantanément au bon moment via un scheduler (pas interpolables).
 * - `absolute` = z-index : appliqué discrètement (pas interpolé).
 */
import type { AnimKeyframe, AnimationDef } from "@/kag/types.js";

/** Un changement discret à appliquer à un instant t (ms). */
export type DiscreteChange = {
  time: number;
  field: "storage" | "effect" | "contrast" | "visible" | "type" | "absolute";
  value: string | number | boolean;
};

/** Résultat de la compilation. */
export type CompiledAction = {
  /** Keyframes WAAPI (props continues). Vide si aucune prop continue. */
  keyframes: Keyframe[];
  /** Durée totale en ms (temps absolu de la dernière keyframe). */
  duration: number;
  /** Nombre d'itérations : Infinity si loop, sinon 1. */
  iterations: number;
  /** Changements discrets programmés (storage/effect/etc). */
  discrete: DiscreteChange[];
};

const DISCRETE_FIELDS = new Set(["storage", "effect", "contrast", "visible", "type", "absolute"]);

/** True si la prop est continue (interpolable). */
function isContinuous(field: string): boolean {
  return field === "center" || field === "vcenter" || field === "opacity" || field === "zoomx" || field === "zoomy" || field === "rotate";
}

/**
 * Compile un `AnimationDef` en structure prête pour `Element.animate()`.
 *
 * Retourne `null` si l'animation est vide ou ne dure pas (duration <= 0).
 */
export function compileAction(def: AnimationDef): CompiledAction | null {
  const kfs = def.keyframes;
  if (kfs.length === 0) return null;
  const total = kfs[kfs.length - 1].time;
  if (total <= 0) {
    // Animation instantanée : on applique juste l'état final, pas de WAAPI.
    return null;
  }

  const waKeyframes: Keyframe[] = [];
  const discrete: DiscreteChange[] = [];

  for (const kf of kfs) {
    const offset = total > 0 ? kf.time / total : 0;
    const frame: Keyframe = {
      offset,
      // easing = interp pour ATTEINDRE cette keyframe (sémantique WAAPI).
      easing: interpToEasing(kf.interp),
    };

    // Props continues → keyframe WAAPI.
    if (kf.center !== undefined) frame.left = `${kf.center}px`;
    if (kf.vcenter !== undefined) frame.top = `${kf.vcenter}px`;
    if (kf.opacity !== undefined) frame.opacity = kf.opacity;
    const transforms: string[] = [];
    if (kf.zoomx !== undefined || kf.zoomy !== undefined) {
      transforms.push(`scale(${kf.zoomx ?? 1}, ${kf.zoomy ?? 1})`);
    }
    if (kf.rotate !== undefined) transforms.push(`rotate(${kf.rotate}deg)`);
    if (transforms.length > 0) frame.transform = transforms.join(" ");

    // Props discrètes → scheduler.
    for (const field of DISCRETE_FIELDS) {
      const value = (kf as unknown as Record<string, unknown>)[field];
      if (value !== undefined) {
        discrete.push({
          time: kf.time,
          field: field as DiscreteChange["field"],
          value: value as string | number | boolean,
        });
      }
    }

    // N'ajoute la keyframe WAAPI que si elle a au moins une prop continue.
    if (frame.left !== undefined || frame.top !== undefined || frame.opacity !== undefined || frame.transform !== undefined) {
      waKeyframes.push(frame);
    }
  }

  // WAAPI exige que la 1ʳᵉ keyframe ait offset 0 et la dernière offset 1.
  if (waKeyframes.length > 0) {
    if (waKeyframes[0].offset !== 0) {
      waKeyframes.unshift({ offset: 0, easing: "linear" });
    }
    if (waKeyframes[waKeyframes.length - 1].offset !== 1) {
      waKeyframes.push({ offset: 1, easing: "linear" });
    }
  }

  return {
    keyframes: waKeyframes,
    duration: total,
    iterations: def.loop ? Infinity : 1,
    discrete,
  };
}

function interpToEasing(interp: AnimKeyframe["interp"]): string {
  switch (interp) {
    case "n":
      return "steps(1, end)";
    case "~":
      return "linear"; // warning → linear par défaut
    case "l":
    default:
      return "linear";
  }
}

/** Extrait les changements discrets d'un def (utile pour tests/oracle). */
export function extractDiscrete(def: AnimationDef): DiscreteChange[] {
  const compiled = compileAction(def);
  return compiled?.discrete ?? [];
}
