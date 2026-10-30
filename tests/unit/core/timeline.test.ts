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
