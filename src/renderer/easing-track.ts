/**
 * Accélération moteur et échantillonnage des pistes unifiées (#317).
 *
 * KAG `accel` n'est pas une courbe CSS standard : `accel > 0` = t^n, `accel < 0` = 1-(1-t)^|n|,
 * `accel = 0` = linéaire. WAAPI n'accepte pas cette fonction directement : on échantillonne la piste
 * en keyframes linéaires intermédiaires (assez fin pour être visuellement continu).
 */
import type { TrackKeyframe, TrackSpec } from "@/kag/events.js";

/** Progression temporelle moteur : t ∈ [0,1], accel moteur. */
export function accelProgress(t: number, accel = 0): number {
  const clamped = Math.min(1, Math.max(0, t));
  if (accel === 0) return clamped;
  if (accel > 0) return clamped ** accel;
  return 1 - (1 - clamped) ** Math.abs(accel);
}

type TrackValues = {
  left?: number;
  top?: number;
  zoomx?: number;
  zoomy?: number;
  rotate?: number;
  opacity?: number;
};

function interpolate(a: number | undefined, b: number | undefined, k: number): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  const from = a ?? b ?? 0;
  const to = b ?? a ?? 0;
  return from + (to - from) * k;
}

/** Valeurs de la piste au temps `time` (ms), interpolation linéaire entre keyframes. */
export function trackValuesAt(track: TrackSpec, time: number): TrackValues {
  const kfs = track.keyframes;
  if (kfs.length === 0) return {};
  if (time <= kfs[0]!.time) return pick(kfs[0]!);
  const last = kfs[kfs.length - 1]!;
  if (time >= last.time) return pick(last);
  let i = 1;
  while (i < kfs.length && kfs[i]!.time < time) i++;
  const a = kfs[i - 1]!;
  const b = kfs[i]!;
  const span = b.time - a.time;
  const k = span <= 0 ? 1 : (time - a.time) / span;
  return {
    left: interpolate(a.left, b.left, k),
    top: interpolate(a.top, b.top, k),
    zoomx: interpolate(a.zoomx, b.zoomx, k),
    zoomy: interpolate(a.zoomy, b.zoomy, k),
    rotate: interpolate(a.rotate, b.rotate, k),
    opacity: interpolate(a.opacity, b.opacity, k),
  };
}

function pick(kf: TrackKeyframe): TrackValues {
  return {
    ...(kf.left === undefined ? {} : { left: kf.left }),
    ...(kf.top === undefined ? {} : { top: kf.top }),
    ...(kf.zoomx === undefined ? {} : { zoomx: kf.zoomx }),
    ...(kf.zoomy === undefined ? {} : { zoomy: kf.zoomy }),
    ...(kf.rotate === undefined ? {} : { rotate: kf.rotate }),
    ...(kf.opacity === undefined ? {} : { opacity: kf.opacity }),
  };
}

/**
 * Échantillonne une piste selon l'accélération moteur. Chaque point renvoie les valeurs à
 * `offset = progress` (temps moteur), afin que WAAPI (linéaire entre échantillons) reproduise
 * la courbe t^n / 1-(1-t)^|n|.
 */
export function sampleTrack(track: TrackSpec, steps = 24): { offset: number; values: TrackValues }[] {
  const samples: { offset: number; values: TrackValues }[] = [];
  if (track.duration <= 0) return [{ offset: 1, values: trackValuesAt(track, track.keyframes[track.keyframes.length - 1]?.time ?? 0) }];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const time = accelProgress(t, track.accel) * track.duration;
    samples.push({ offset: t, values: trackValuesAt(track, time) });
  }
  return samples;
}
