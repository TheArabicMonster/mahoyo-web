import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import { RecordingStageRenderer } from "../renderer/recording-stage-renderer.js";
import type { RenderEvent } from "@/kag/events.js";

describe("Runtime + Renderer contract", () => {
  it("produces a scene event for @bg and stops on click", () => {
    const source = `
*page0|
@bg storage=black time=100
Hello.
@pg
`;
    const runtime = new Runtime(parse(lex(source)));
    const renderer = new RecordingStageRenderer();
    const controller = new AbortController();

    const step = runtime.step();
    renderer.apply(step.events, { instant: false, signal: controller.signal });

    expect(step.stop.kind).toBe("click");
    const scene = renderer.events.find((e): e is Extract<RenderEvent, { kind: "scene" }> => e.kind === "scene");
    expect(scene).toBeDefined();
    expect(scene?.scene.bg).toBe("black");
    expect(scene?.transition.method).toBe("crossfade");
  });

  it("stops on [l] and emits text in two steps", () => {
    const source = `
*page0|
First line.[l]
Second line.
@pg
`;
    const runtime = new Runtime(parse(lex(source)));
    const renderer = new RecordingStageRenderer();
    const controller = new AbortController();

    const step1 = runtime.step();
    renderer.apply(step1.events, { instant: false, signal: controller.signal });
    expect(step1.stop.kind).toBe("click");
    if (step1.stop.kind === "click") {
      expect(step1.stop.style).toBe("line");
    }

    const step2 = runtime.step();
    renderer.apply(step2.events, { instant: false, signal: controller.signal });
    expect(step2.stop.kind).toBe("click");
    if (step2.stop.kind === "click") {
      expect(step2.stop.style).toBe("page");
    }

    const allText = renderer.events
      .filter((e): e is Extract<RenderEvent, { kind: "text" }> => e.kind === "text")
      .flatMap((e) => e.segments)
      .filter((s) => "text" in s)
      .map((s) => s.text)
      .join("");
    expect(allText).toContain("First line.");
    expect(allText).toContain("Second line.");
  });

  it("routes audio events to a separate audio player", () => {
    const source = `
*page0|
@play storage=m01
@se storage=se01
@pg
`;
    const runtime = new Runtime(parse(lex(source)));
    const renderer = new RecordingStageRenderer();
    const controller = new AbortController();

    const step = runtime.step();
    // Le renderer ignore les events audio ; le player les route vers AudioPlayer.
    renderer.apply(step.events, { instant: false, signal: controller.signal });

    const audioEvents = step.events.filter((e): e is Extract<RenderEvent, { kind: "audio" }> => e.kind === "audio");
    expect(audioEvents.length).toBe(2);
    expect(renderer.events.some((e) => e.kind === "audio")).toBe(false);
  });
});
