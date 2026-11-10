/**
 * `accel` moteur et échantillonnage des pistes (#317) : t=0, 0.25, 0.5, 1.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { accelProgress, sampleTrack, trackValuesAt } from "@/renderer/easing-track.js";
import type { TrackSpec } from "@/kag/events.js";

const track: TrackSpec = {
  target: "bg",
  prop: "transform",
  duration: 1000,
  accel: 2,
  keyframes: [
    { time: 0, left: 0, top: 0, zoomx: 100, zoomy: 100, rotate: 0 },
    { time: 1000, left: 100, top: 50, zoomx: 120, zoomy: 120, rotate: 10 },
  ],
};

describe("accelProgress (#317)", () => {
  it("linéaire pour accel=0", () => {
    expect(accelProgress(0, 0)).toBe(0);
    expect(accelProgress(0.25, 0)).toBeCloseTo(0.25, 12);
    expect(accelProgress(0.5, 0)).toBeCloseTo(0.5, 12);
    expect(accelProgress(1, 0)).toBe(1);
  });

  it("accel>0 = t^n", () => {
    expect(accelProgress(0.5, 2)).toBeCloseTo(0.25, 12);
    expect(accelProgress(0.5, 3)).toBeCloseTo(0.125, 12);
    expect(accelProgress(0.25, 2)).toBeCloseTo(0.0625, 12);
  });

  it("accel<0 = 1-(1-t)^|n|", () => {
    expect(accelProgress(0.5, -2)).toBeCloseTo(0.75, 12);
    expect(accelProgress(0.5, -3)).toBeCloseTo(0.875, 12);
    expect(accelProgress(0.25, -2)).toBeCloseTo(0.4375, 12);
  });

  it("borne t hors [0,1]", () => {
    expect(accelProgress(-1, 2)).toBe(0);
    expect(accelProgress(2, 2)).toBe(1);
  });
});

describe("trackValuesAt / sampleTrack", () => {
  it("interpole les valeurs au temps moteur", () => {
    expect(trackValuesAt(track, 0)).toMatchObject({ left: 0, zoomx: 100 });
    expect(trackValuesAt(track, 500)).toMatchObject({ left: 50, top: 25, zoomx: 110, rotate: 5 });
    expect(trackValuesAt(track, 1000)).toMatchObject({ left: 100, top: 50, zoomx: 120, rotate: 10 });
  });

  it("accel=2 échantillonne la position au temps moteur (t=0, .25, .5, 1)", () => {
    const samples = sampleTrack(track, 4);
    expect(samples.map((sample) => sample.offset)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    // t=0.25 → temps moteur 0.25²=0.0625 → left=6.25 ; t=0.5 → 0.25 → left=25.
    expect(samples[1]!.values.left).toBeCloseTo(6.25, 6);
    expect(samples[2]!.values.left).toBeCloseTo(25, 6);
    expect(samples[4]!.values.left).toBeCloseTo(100, 6);
  });

  it("une piste instantanée renvoie l'état final", () => {
    const samples = sampleTrack({ ...track, duration: 0 }, 4);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.values.left).toBe(100);
  });
});
