import { describe, it, expect } from "vitest";
import { reduceStage, reduceAudio } from "@/kag/stage-state.js";
import type { RenderEvent } from "@/kag/events.js";

describe("stage-state reducers", () => {
  it("reconstructs a scene from events", () => {
    const events: RenderEvent[] = [
      { kind: "scene", scene: { bg: "black", sprites: [], effect: null }, transition: { method: "none" } },
      {
        kind: "scene",
        scene: {
          bg: "room",
          sprites: [{ id: "1000", storage: "青子", x: 512, y: 288, z: 1000, opacity: 1 }],
          effect: null,
        },
        transition: { method: "none" },
      },
    ];
    const snapshot = reduceStage(events);
    expect(snapshot.scene.bg).toBe("room");
    expect(snapshot.scene.sprites[0]?.storage).toBe("青子");
  });

  it("un panoramique (bgMove) met à jour la position du fond", () => {
    const snapshot = reduceStage([
      { kind: "scene", scene: { bg: "pano", bgLeft: -99, bgTop: -48, sprites: [], effect: null }, transition: { method: "none" } },
      { kind: "bgMove", left: -167, top: -48, time: 5000 },
    ]);
    expect(snapshot.scene).toMatchObject({ bg: "pano", bgLeft: -167, bgTop: -48 });
  });

  it("tracks text across clearText and text events", () => {
    const events: RenderEvent[] = [
      { kind: "clearText" },
      { kind: "text", segments: [{ text: "Hello" }] },
      { kind: "lineBreak" },
      { kind: "text", segments: [{ text: "World" }] },
    ];
    const snapshot = reduceStage(events);
    const text = snapshot.text
      .filter((s) => "text" in s)
      .map((s) => s.text)
      .join("");
    expect(text).toBe("Hello\nWorld");
  });

  it("tracks current effect", () => {
    const events: RenderEvent[] = [
      { kind: "effect", effect: { kind: "noise", opacity: 0.5 } },
    ];
    const snapshot = reduceStage(events);
    expect(snapshot.scene.effect).toEqual({ kind: "noise", opacity: 0.5 });
  });

  it("clears effect with null", () => {
    const events: RenderEvent[] = [
      { kind: "effect", effect: { kind: "noise", opacity: 0.5 } },
      { kind: "effect", effect: null },
    ];
    const snapshot = reduceStage(events);
    expect(snapshot.scene.effect).toBeNull();
  });

  it("reconstructs audio loops", () => {
    const events: RenderEvent[] = [
      { kind: "audio", event: { kind: "play", channel: "bgm", storage: "m01", loop: true, volume: 0.8 } },
      { kind: "audio", event: { kind: "play", channel: "se:0", storage: "se01", loop: false, volume: 0.5 } },
    ];
    const snapshot = reduceAudio(events);
    expect(snapshot.loops).toHaveLength(1);
    expect(snapshot.loops[0]?.channel).toBe("bgm");
    expect(snapshot.loops[0]?.storage).toBe("m01");
  });

  it("removes stopped loops", () => {
    const events: RenderEvent[] = [
      { kind: "audio", event: { kind: "play", channel: "bgm", storage: "m01", loop: true, volume: 0.8 } },
      { kind: "audio", event: { kind: "stop", channel: "bgm" } },
    ];
    const snapshot = reduceAudio(events);
    expect(snapshot.loops).toHaveLength(0);
  });
});
