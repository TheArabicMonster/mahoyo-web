import { describe, it, expect } from "vitest";
import { lookupTimeline, parseTimelineData, type TimelineData } from "@/core/timeline.js";

const scene = {
  name: "scène A",
  duration: 5000,
  bg: [{ at: 0, storage: "black" }, { at: 1000, storage: "img1", left: -10, top: -20 }],
  audio: [{ at: 500, channel: "bgm", storage: "m01", loop: false, volume: 1, action: "play" }],
};
const valid = { version: 1, scripts: { "opening.ks": { "4": scene } } };

describe("parseTimelineData", () => {
  it("accepte des données valides", () => {
    expect(parseTimelineData(valid)).toEqual(valid);
  });

  it("accepte des calques (#125), optionnels", () => {
    const layers = [{ at: 0, id: "L1", storage: "carton", x: 224, y: 217, opacity: 0.5, z: 3400, time: 0, rain: true }];
    const withLayers = { version: 1, scripts: { "opening.ks": { "4": { ...scene, layers } } } };
    expect(parseTimelineData(withLayers)).toEqual(withLayers);
    const bad = { version: 1, scripts: { "opening.ks": { "4": { ...scene, layers: [{ ...layers[0], storage: "" }] } } } };
    expect(parseTimelineData(bad)).toBeNull();
  });

  it("accepte accélération, zoom, rotation, ancrage et effet (phase 2), tous optionnels", () => {
    const layers = [{ at: 0, id: "L1", storage: "logo", x: 512, y: 288, opacity: 1, z: 1000, time: 500, accel: 3, zoomx: 60, zoomy: -80, rotate: 315, afx: 12.5, afy: 34, effect: "haze" }];
    const bg = [{ at: 0, storage: "logo", left: -48, top: -48, zoomx: 800, zoomy: 800, rotate: 0 }];
    const moves = [{ at: 0, left: -48, top: -149, time: 14500, accel: 20, zoomx: 100, zoomy: 100, rotate: 0 }];
    const full = { version: 1, scripts: { "logo.ks": { "4": { ...scene, bg, moves, layers } } } };
    expect(parseTimelineData(full)).toEqual(full);
    for (const bad of [
      { layers: [{ ...layers[0], accel: "x" }] },
      { layers: [{ ...layers[0], rotate: Number.NaN }] },
      { layers: [{ ...layers[0], afx: "1" }] },
      { layers: [{ ...layers[0], effect: 1 }] },
      { moves: [{ ...moves[0], accel: "x" }] },
      { moves: [{ ...moves[0], zoomx: "100" }] },
      { bg: [{ ...bg[0], rotate: "0" }] },
    ]) {
      expect(parseTimelineData({ version: 1, scripts: { "logo.ks": { "4": { ...scene, ...bad } } } })).toBeNull();
    }
  });

  it("refuse une forme inattendue", () => {
    expect(parseTimelineData(null)).toBeNull();
    expect(parseTimelineData({ version: 2, scripts: {} })).toBeNull();
    expect(parseTimelineData({ version: 1 })).toBeNull();
    expect(parseTimelineData({ version: 1, scripts: { "a.ks": { "1": { ...scene, duration: "long" } } } })).toBeNull();
    expect(parseTimelineData({ version: 1, scripts: { "a.ks": { "1": { ...scene, bg: [{ at: 0, storage: "" }] } } } })).toBeNull();
    expect(parseTimelineData({ version: 1, scripts: { "a.ks": { "1": { ...scene, audio: [{ at: 0, channel: "voice", loop: false, volume: 1, action: "play" }] } } } })).toBeNull();
    expect(parseTimelineData({ version: 1, scripts: { "a.ks": "x" } })).toBeNull();
  });
});

describe("lookupTimeline", () => {
  const data = parseTimelineData(valid) as TimelineData;

  it("retrouve une scène, nom de script insensible à la casse", () => {
    expect(lookupTimeline(data, "opening.ks", 4)?.name).toBe("scène A");
    expect(lookupTimeline(data, "OPENING.KS", 4)?.name).toBe("scène A");
  });

  it("renvoie null pour un script ou une scène inconnus, ou sans données", () => {
    expect(lookupTimeline(data, "autre.ks", 4)).toBeNull();
    expect(lookupTimeline(data, "opening.ks", 9)).toBeNull();
    expect(lookupTimeline(null, "opening.ks", 4)).toBeNull();
  });
});
