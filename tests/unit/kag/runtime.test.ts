import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RenderEvent, StopReason } from "@/kag/events.js";

const SAMPLE = `
*page0|
@bg time=100 storage=black
@fg storage=青子 center=512 vcenter=288 index=1000
こんにちは。[r]
青子です。
@pg
*page1|
@bg time=100 storage=white
@clall
さようなら。
@pg
`;

function findEvent<T extends RenderEvent["kind"]>(events: readonly RenderEvent[], kind: T): Extract<RenderEvent, { kind: T }> | undefined {
  return events.find((e): e is Extract<RenderEvent, { kind: T }> => e.kind === kind);
}

function expectClick(stop: StopReason, style: "line" | "page") {
  expect(stop.kind).toBe("click");
  if (stop.kind !== "click") throw new Error("unexpected stop kind");
  expect(stop.style).toBe(style);
}

describe("Runtime", () => {
  it("advances through pages", () => {
    const script = parse(lex(SAMPLE));
    const runtime = new Runtime(script);

    const step0 = runtime.step();
    expectClick(step0.stop, "page");

    const textEvent = findEvent(step0.events, "text");
    expect(textEvent).toBeDefined();
    if (textEvent) {
      expect(textEvent.segments.some((s) => "text" in s && s.text.includes("こんにちは"))).toBe(true);
    }

    const sceneEvents0 = step0.events.filter((e): e is Extract<RenderEvent, { kind: "scene" }> => e.kind === "scene");
    expect(sceneEvents0.length).toBeGreaterThan(0);
    const lastScene0 = sceneEvents0[sceneEvents0.length - 1];
    expect(lastScene0.scene.bg).toBe("black");
    expect(lastScene0.scene.sprites[0]?.storage).toBe("青子");

    const step1 = runtime.step();
    expectClick(step1.stop, "page");

    const sceneEvents1 = step1.events.filter((e): e is Extract<RenderEvent, { kind: "scene" }> => e.kind === "scene");
    expect(sceneEvents1.length).toBeGreaterThan(0);
    const lastScene1 = sceneEvents1[sceneEvents1.length - 1];
    expect(lastScene1.scene.bg).toBe("white");
    expect(lastScene1.scene.sprites.length).toBe(0);

    const step2 = runtime.step();
    expect(step2.stop.kind).toBe("end");
  });

  it("jumps to a label", () => {
    const script = parse(lex(SAMPLE));
    const runtime = new Runtime(script);
    expect(runtime.jump("page1")).toBe(true);

    const step = runtime.step();
    expectClick(step.stop, "page");

    const textEvent = findEvent(step.events, "text");
    expect(textEvent).toBeDefined();
    if (textEvent) {
      expect(textEvent.segments.some((s) => "text" in s && s.text.includes("さようなら"))).toBe(true);
    }
  });

  it("supports fore/back layer model with @trans", () => {
    const TRANS_SAMPLE = `
*page0|
@bg page=back storage=sunset
@fg page=back storage=青子 center=512 vcenter=288 index=1000
@trans time=1200
夕焼けだ。[r]
@pg
`;
    const script = parse(lex(TRANS_SAMPLE));
    const runtime = new Runtime(script);

    // @trans sans nowait : bloque sur waitFor transition.
    const transStep = runtime.step();
    expect(transStep.stop?.kind).toBe("waitFor");
    if (transStep.stop?.kind !== "waitFor") throw new Error("unexpected stop");
    expect(transStep.stop.what).toBe("transition");

    const sceneEvents = transStep.events.filter((e): e is Extract<RenderEvent, { kind: "scene" }> => e.kind === "scene");
    expect(sceneEvents.length).toBe(1);
    expect(sceneEvents[0].scene.bg).toBe("sunset");
    expect(sceneEvents[0].scene.sprites[0]?.storage).toBe("青子");
    expect(sceneEvents[0].transition.method).toBe("crossfade");
    if (sceneEvents[0].transition.method === "crossfade") {
      expect(sceneEvents[0].transition.time).toBe(1200);
    }

    // Une fois la transition terminée, le prochain step() reprend : texte + [r] + @pg → arrêt page.
    const textStep = runtime.step();
    expectClick(textStep.stop, "page");
  });

  it("supports multi-script loading via @call storage=", async () => {
    const MAIN_SCRIPT = `
*page0|
メインスクリプト。
@call storage=sub.ks
*page1|
メインに戻った。
@pg
`;
    const SUB_SCRIPT = `
*page0|
サブスクリプトだ。
@return
`;
    const mainScript = parse(lex(MAIN_SCRIPT));
    const subScript = parse(lex(SUB_SCRIPT));
    const runtime = new Runtime(mainScript, "main.ks");

    runtime.scriptLoader = async (storage: string) => {
      if (storage === "sub.ks") return subScript;
      return null;
    };

    const step1 = runtime.step();
    expect(step1.stop.kind).toBe("loadScript");
    if (step1.stop.kind !== "loadScript") throw new Error("unexpected stop kind");
    expect(step1.stop.file).toBe("sub.ks");

    const textEvent = findEvent(step1.events, "text");
    expect(textEvent).toBeDefined();
    if (textEvent) {
      expect(textEvent.segments.some((s) => "text" in s && s.text.includes("メインスクリプト"))).toBe(true);
    }

    const loaded = await runtime.loadScript("sub.ks");
    expect(loaded).toBe(true);

    const step2 = runtime.step();
    // Après @return, le runtime reprend l'exécution dans le script appelant
    // jusqu'au prochain point d'arrêt. Il contient donc le texte du sub-script
    // et celui de la page suivante du main.
    expectClick(step2.stop, "page");
    const allText2 = step2.events
      .filter((e): e is Extract<RenderEvent, { kind: "text" }> => e.kind === "text")
      .flatMap((e) => e.segments)
      .filter((s) => "text" in s)
      .map((s) => s.text)
      .join("");
    expect(allText2).toContain("サブスクリプト");
    expect(allText2).toContain("メインに戻った");

    const step3 = runtime.step();
    expect(step3.stop.kind).toBe("end");
  });

  it("clears a specific layer with @clfg", () => {
    const CLFG_SAMPLE = `
*page0|
@fg storage=青子 center=512 vcenter=288 index=1000
@fg storage=有珠 center=300 vcenter=288 index=2000
@clfg storage=青子
@pg
`;
    const script = parse(lex(CLFG_SAMPLE));
    const runtime = new Runtime(script);
    const step = runtime.step();

    const sceneEvents = step.events.filter((e): e is Extract<RenderEvent, { kind: "scene" }> => e.kind === "scene");
    expect(sceneEvents.length).toBeGreaterThan(0);
    const lastScene = sceneEvents[sceneEvents.length - 1];
    expect(lastScene.scene.sprites.length).toBe(1);
    expect(lastScene.scene.sprites[0]?.storage).toBe("有珠");
  });

  it("copies fore to back with @backlay", () => {
    const BACKLAY_SAMPLE = `
*page0|
@bg storage=sunset
@fg storage=青子 center=512 vcenter=288 index=1000
@backlay
@bg storage=night
@clall
@trans time=100
@pg
`;
    const script = parse(lex(BACKLAY_SAMPLE));
    const runtime = new Runtime(script);
    const step = runtime.step();

    const sceneEvent = findEvent(step.events, "scene");
    expect(sceneEvent).toBeDefined();
    if (sceneEvent) {
      expect(sceneEvent.scene.bg).toBe("sunset");
    }
  });

  it("emits audio events for @play, @playstop and @fadebgm", () => {
    const AUDIO_SAMPLE = `
*page0|
@play storage=m19
@playstop
@pg
*page1|
@play storage=m20
@fadebgm time=2000
@pg
`;
    const script = parse(lex(AUDIO_SAMPLE));
    const runtime = new Runtime(script);

    const step0 = runtime.step();
    const audioEvents0 = step0.events.filter((e): e is Extract<RenderEvent, { kind: "audio" }> => e.kind === "audio");
    expect(audioEvents0.length).toBe(2);
    expect(audioEvents0[0].event.kind).toBe("play");
    if (audioEvents0[0].event.kind === "play") {
      expect(audioEvents0[0].event.channel).toBe("bgm");
    }
    expect(audioEvents0[1].event.kind).toBe("stop");
    if (audioEvents0[1].event.kind === "stop") {
      expect(audioEvents0[1].event.channel).toBe("bgm");
    }

    const step1 = runtime.step();
    const audioEvents1 = step1.events.filter((e): e is Extract<RenderEvent, { kind: "audio" }> => e.kind === "audio");
    expect(audioEvents1.length).toBe(2);
    expect(audioEvents1[0].event.kind).toBe("play");
    expect(audioEvents1[1].event.kind).toBe("fade");
    if (audioEvents1[1].event.kind === "fade") {
      expect(audioEvents1[1].event.volume).toBe(0);
      expect(audioEvents1[1].event.time).toBe(2000);
    }
  });

  it("emits audio event for @sestop", () => {
    const SE_SAMPLE = `
*page0|
@se storage=se01
@sestop storage=se01 time=500
@pg
`;
    const script = parse(lex(SE_SAMPLE));
    const runtime = new Runtime(script);
    const step = runtime.step();

    const audioEvents = step.events.filter((e): e is Extract<RenderEvent, { kind: "audio" }> => e.kind === "audio");
    expect(audioEvents.length).toBe(2);
    expect(audioEvents[0].event.kind).toBe("play");
    if (audioEvents[0].event.kind === "play") {
      expect(audioEvents[0].event.channel).toBe("se:0");
    }
    expect(audioEvents[1].event.kind).toBe("stop");
    if (audioEvents[1].event.kind === "stop") {
      expect(audioEvents[1].event.fadeOut).toBe(500);
    }
  });

  it("toggles textbox visibility with @textoff and @texton", () => {
    const TEXTBOX_SAMPLE = `
*page0|
@textoff
@pg
*page1|
@texton
@pg
`;
    const script = parse(lex(TEXTBOX_SAMPLE));
    const runtime = new Runtime(script);

    const step0 = runtime.step();
    const textbox0 = findEvent(step0.events, "textbox");
    expect(textbox0).toBeDefined();
    if (textbox0) {
      expect(textbox0.state.visible).toBe(false);
    }

    const step1 = runtime.step();
    const textbox1 = findEvent(step1.events, "textbox");
    expect(textbox1).toBeDefined();
    if (textbox1) {
      expect(textbox1.state.visible).toBe(true);
    }
  });

  it("emits quake effect for @quake", () => {
    const QUAKE_SAMPLE = `
*page0|
@quake vmax=10 hmax=2 time=500 interval=40
@pg
`;
    const script = parse(lex(QUAKE_SAMPLE));
    const runtime = new Runtime(script);
    const step = runtime.step();

    const quake = findEvent(step.events, "quake");
    expect(quake).toBeDefined();
    if (quake && quake.quake) {
      expect(quake.quake.vmax).toBe(10);
      expect(quake.quake.hmax).toBe(2);
      expect(quake.quake.time).toBe(500);
    }
  });

  it("stops on [l] pause markers", () => {
    const PAUSE_SAMPLE = `
*page0|
Première ligne.[l]
Deuxième ligne.
@pg
`;
    const script = parse(lex(PAUSE_SAMPLE));
    const runtime = new Runtime(script);

    const step1 = runtime.step();
    expectClick(step1.stop, "line");

    const step2 = runtime.step();
    expectClick(step2.stop, "page");
  });

  it("stops on @wait", () => {
    const WAIT_SAMPLE = `
*page0|
@wait time=800
@pg
`;
    const script = parse(lex(WAIT_SAMPLE));
    const runtime = new Runtime(script);

    const step = runtime.step();
    expect(step.stop.kind).toBe("wait");
    if (step.stop.kind === "wait") {
      expect(step.stop.time).toBe(800);
    }
  });
});
