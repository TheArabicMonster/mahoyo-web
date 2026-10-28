import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RenderEvent, StopReason } from "@/kag/events.js";
import type { Instruction } from "@/kag/types.js";

const SAMPLE = `
*page0|
@bg page=fore time=100 storage=black
@fg page=fore storage=青子 center=512 vcenter=288 index=1000
こんにちは。[r]
青子です。
@pg
*page1|
@bg page=fore time=100 storage=white
@clall page=fore
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

  it("jumps to an intra-page label", () => {
    const script = parse(lex(
      "@bg storage=black\n" +
      "@jump target=*target\n" +
      "*target|\n" +
      "@fg page=fore storage=red center=512 vcenter=288 index=1000\n" +
      "@pg",
    ));
    const runtime = new Runtime(script);

    const step = runtime.step();
    expectClick(step.stop, "page");
    const scene = step.events.find((e) => e.kind === "scene");
    expect(scene).toBeDefined();
    expect(scene?.scene.sprites.some((s) => s.storage === "red")).toBe(true);
  });

  it("calls an intra-page label", () => {
    const script = parse(lex(
      "@call target=*target\n" +
      "@pg\n" +
      "*target|\n" +
      "@fg page=fore storage=red center=512 vcenter=288 index=1000\n" +
      "@return\n" +
      "@pg",
    ));
    const runtime = new Runtime(script);

    const step = runtime.step();
    expectClick(step.stop, "page");
    expect(step.events.some((e) => e.kind === "scene" && e.scene.sprites.some((s) => s.storage === "red"))).toBe(true);
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
@fg page=fore storage=青子 center=512 vcenter=288 index=1000
@fg page=fore storage=有珠 center=300 vcenter=288 index=2000
@clfg page=fore storage=青子
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
@bg page=fore storage=sunset
@fg page=fore storage=青子 center=512 vcenter=288 index=1000
@backlay
@bg page=fore storage=night
@clall page=fore
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

  it("back par défaut : @fg sans page écrit sur back, @trans révèle sur fore", () => {
    // Critère d'acceptation issue #49 : @bg page=back + @fg red index=2000 + @trans
    // → fore.layers contient red z=2000.
    const SRC = `
*page0|
@bg page=back storage=bgA
@fg storage=red center=512 vcenter=288 index=2000
@trans time=100
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    // @trans bloque sur waitFor transition.
    expect(step.stop.kind).toBe("waitFor");
    const scene = findEvent(step.events, "scene");
    expect(scene).toBeDefined();
    if (scene) {
      expect(scene.scene.bg).toBe("bga");
      const red = scene.scene.sprites.find((s) => s.storage === "red");
      expect(red).toBeDefined();
      expect(red?.z).toBe(2000);
    }
  });

  it("trans implicite : @fg ×4 + @bg time=300 noclear=1 → une scène crossfade avec les 4 calques", () => {
    // Critère d'acceptation issue #49 : préparation back puis @bg time+rule sans page
    // déclenche un trans implicite back→fore avec tous les calques préparés.
    const SRC = `
*page0|
@fg storage=s1 center=100 vcenter=100 index=1000
@fg storage=s2 center=200 vcenter=100 index=1100
@fg storage=s3 center=300 vcenter=100 index=1200
@fg storage=s4 center=400 vcenter=100 index=1300
@bg rule=crossfade time=300 storage=black noclear=1
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    // Trans implicite bloquant (pas de nowait sur le @bg).
    expect(step.stop.kind).toBe("waitFor");
    const scenes = step.events.filter((e): e is Extract<RenderEvent, { kind: "scene" }> => e.kind === "scene");
    // Une seule scène émise (la trans implicite), contenant les 4 calques.
    expect(scenes.length).toBe(1);
    expect(scenes[0].scene.sprites.length).toBe(4);
    expect(scenes[0].transition.method).toBe("crossfade");
    expect(scenes[0].scene.bg).toBe("black");
  });

  it("@trans conserve back (pas de vidage après trans)", () => {
    // Critère d'acceptation issue #49 : après un @trans, back n'est pas vidé.
    // On prépare back (bg+sprite), on trans (fore=back, back conserved),
    // puis on ajoute un sprite sur back et on re-trans : le bg et le 1er sprite
    // doivent toujours être là (back n'a pas été vidé par le 1er trans).
    const SRC = `
*page0|
@bg page=back storage=bgx
@fg page=back storage=red center=512 vcenter=288 index=2000
@trans time=100 nowait=1
@fg page=back storage=blue center=400 vcenter=288 index=2100
@trans time=100
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    // Le 2e @trans (sans nowait) bloque.
    expect(step.stop.kind).toBe("waitFor");
    const scenes = step.events.filter((e): e is Extract<RenderEvent, { kind: "scene" }> => e.kind === "scene");
    const last = scenes[scenes.length - 1];
    expect(last).toBeDefined();
    // back conservé : bg + red toujours présents après le 2e trans.
    expect(last.scene.bg).toBe("bgx");
    expect(last.scene.sprites.some((s) => s.storage === "red")).toBe(true);
    expect(last.scene.sprites.some((s) => s.storage === "blue")).toBe(true);
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

  it("emits audio events for @playstop time, @fadebgm volume and @se loop+delay", () => {
    const SAMPLE = `
*page0|
@playstop time=500
@fadebgm time=2000 volume=50
@se storage=se01 loop=true delay=300
@pg
`;
    const script = parse(lex(SAMPLE));
    const runtime = new Runtime(script);
    const step = runtime.step();

    const audioEvents = step.events.filter((e): e is Extract<RenderEvent, { kind: "audio" }> => e.kind === "audio");
    expect(audioEvents.length).toBe(3);

    expect(audioEvents[0].event.kind).toBe("stop");
    if (audioEvents[0].event.kind === "stop") {
      expect(audioEvents[0].event.channel).toBe("bgm");
      expect(audioEvents[0].event.fadeOut).toBe(500);
    }

    expect(audioEvents[1].event.kind).toBe("fade");
    if (audioEvents[1].event.kind === "fade") {
      expect(audioEvents[1].event.channel).toBe("bgm");
      expect(audioEvents[1].event.volume).toBe(0.5);
      expect(audioEvents[1].event.time).toBe(2000);
    }

    expect(audioEvents[2].event.kind).toBe("play");
    if (audioEvents[2].event.kind === "play") {
      expect(audioEvents[2].event.channel).toBe("se:0");
      expect(audioEvents[2].event.loop).toBe(true);
      expect(audioEvents[2].event.delay).toBe(300);
      expect(audioEvents[2].event.volume).toBe(1);
    }
  });

  it("@fadebgm préserve state.bgm (ne tue plus la BGM)", () => {
    // R2 : @fadebgm ne doit pas nullifier state.bgm. La BGM continue de jouer
    // (volume fondé) et reste préservée pour la sauvegarde.
    const SRC = `
*page0|
@play storage=m19
@fadebgm time=2000 volume=50
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    runtime.step();
    const save = runtime.getSaveData();
    expect(save.state.bgm).toBe("m19");
  });

  it("@fadebgm volume=0 puis volume=100 : BGM toujours préservée", () => {
    const SRC = `
*page0|
@play storage=m19
@fadebgm time=100 volume=0
@fadebgm time=100 volume=100
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    runtime.step();
    const save = runtime.getSaveData();
    // La BGM n'est pas perdue même après un fade à 0.
    expect(save.state.bgm).toBe("m19");
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

  it("raw : warning bruyant + rawCount incrémenté", () => {
    // Une commande inconnue (@cm4pg) doit prévenir via onWarning et incrémenter
    // rawCount. Sans warning silencieux (AGENTS.md §6).
    const SRC = `
*page0|
@cm4pg
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const warnings: string[] = [];
    runtime.onWarning = (msg: string) => warnings.push(msg);
    runtime.step();
    expect(runtime.rawCount).toBe(1);
    expect(warnings).toEqual(["commande non gérée: @cm4pg"]);
  });

  it("raw : plusieurs commandes inconnues cumulent rawCount", () => {
    const SRC = `
*page0|
@cm4pg
@unknownCmd
@anotherUnknown
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const warnings: string[] = [];
    runtime.onWarning = (msg: string) => warnings.push(msg);
    runtime.step();
    expect(runtime.rawCount).toBe(3);
    expect(warnings.length).toBe(3);
    expect(warnings[0]).toContain("@cm4pg");
    expect(warnings[1]).toContain("@unknownCmd");
    expect(warnings[2]).toContain("@anotherUnknown");
  });

  it("@stoptrans émet un événement stopTransition", () => {
    const SRC = `
*page0|
@bg storage=bg1
@trans time=1000 nowait=1
@stoptrans
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    const stopTransEvent = step.events.find((e) => e.kind === "stopTransition");
    expect(stopTransEvent).toBeDefined();
    expect(stopTransEvent?.kind).toBe("stopTransition");
  });

  it("@movefg préserve z-index et cible fore (pas back)", () => {
    // Régression #50 : @movefg arrivait sur back au lieu de fore.
    // @fg sans page écrit sur back par défaut (@trans copie back→fore).
    const SRC = `
*page0|
@fg storage=red index=2000 opacity=0 center=512 vcenter=288
@trans time=100 nowait=1
@movefg storage=red time=3000 opacity=80
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    expect(step.events.find((e) => e.kind === "animate")).toBeDefined();
    const save = runtime.getSaveData();
    const foreRed = save.state.fore.layers.find((l) => l.id === "red");
    expect(foreRed).toBeDefined();
    expect(foreRed?.index).toBe(2000);
    expect(foreRed?.opacity).toBeCloseTo(80 / 255, 2);
  });

  it("@partbgact sans id cible le partbg existant (pas de double calque)", () => {
    // @partbg sans page → back. @partbgact avec ≥2 keyframes crée animate.
    // Sans id, on cherche par storage + crop.
    const SRC = `
*page0|
@partbg id=pb1 storage=im09 storagebg=black center=512 vcenter=288 index=2000 width=522 height=576 srcleft=542 srctop=0 srczoomx=100 srczoomy=100
@partbgact storage=im09 keys=(srcleft,542)(srcleft,0)
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    const animEvent = step.events.find((e) => e.kind === "animate");
    expect(animEvent).toBeDefined();
    if (animEvent?.kind === "animate") {
      // L'animation cible pb1 (id du partbg), pas un nouveau calque.
      expect(animEvent.target).toBe("pb1");
    }
    const save = runtime.getSaveData();
    const backLayers = save.state.back.layers.filter((l) => l.storage === "im09");
    expect(backLayers.length).toBe(1);
    expect(backLayers[0]?.crop).toBeDefined();
  });

  it("animate : keyframe 0 complétée depuis le calque existant", () => {
    // @fg center=512 vcenter=288 → @trans → @movefg sans center : kf0 = existing.
    // La keyframe 0 doit avoir les valeurs de DÉPART (calque existant), pas d'arrivée.
    const SRC = `
*page0|
@fg storage=red index=2000 opacity=50 center=512 vcenter=288
@trans time=100 nowait=1
@movefg storage=red time=100 center=100
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    const animEvent = step.events.find((e) => e.kind === "animate") as Extract<RenderEvent, { kind: "animate" }> | undefined;
    expect(animEvent).toBeDefined();
    if (animEvent) {
      const kf0 = animEvent.def.keyframes[0];
      // opacity absente dans @movefg → vient du calque existant (50/255).
      expect(kf0.opacity).toBeCloseTo(50 / 255, 2);
      // center/vcenter absents dans @movefg → viennent du calque existant.
      // (@movefg met center=100 dans kf1, pas kf0).
      expect(kf0.center).toBe(512);
      expect(kf0.vcenter).toBe(288);
    }
  });

  it("animate : keyframe 0 sans props = valeurs du calque existant", () => {
    // @movefg sans center → kf0.center = existing.center (512), pas la valeur finale.
    const SRC = `
*page0|
@fg storage=red index=2000 opacity=50 center=512 vcenter=288
@trans time=100 nowait=1
@movefg storage=red time=100 opacity=80
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    const animEvent = step.events.find((e) => e.kind === "animate") as Extract<RenderEvent, { kind: "animate" }> | undefined;
    expect(animEvent).toBeDefined();
    if (animEvent) {
      const kf0 = animEvent.def.keyframes[0];
      const kf1 = animEvent.def.keyframes[1];
      // kf0 : valeurs de DÉPART (calque existant).
      expect(kf0.center).toBe(512);
      expect(kf0.vcenter).toBe(288);
      expect(kf0.opacity).toBeCloseTo(50 / 255, 2);
      // kf1 : valeurs d'ARRIVÉE (instruction).
      expect(kf1.center).toBe(0); // @movefg sans center= → parser met 0 (parseIntArg default)
      expect(kf1.opacity).toBeCloseTo(80 / 255, 2);
    }
  });

  it("@trans sans canskip est skippable par défaut", () => {
    const SRC = `
*page0|
@bg page=back storage=bgx
@trans time=300
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    expect(step.stop.kind).toBe("waitFor");
    if (step.stop.kind === "waitFor") {
      expect(step.stop.what).toBe("transition");
      expect(step.stop.skippable).toBe(true);
    }
  });

  it("@trans time=300 canskip=0 → waitFor transition non skippable", () => {
    const SRC = `
*page0|
@bg page=back storage=bgx
@trans time=300 canskip=0
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    expect(step.stop.kind).toBe("waitFor");
    if (step.stop.kind === "waitFor") {
      expect(step.stop.what).toBe("transition");
      expect(step.stop.skippable).toBe(false);
    }
  });

  it("@trans time=300 nowait=1 n'émet pas de stop", () => {
    const SRC = `
*page0|
@bg page=back storage=bgx
@trans time=300 nowait=1
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    expect(step.stop.kind).toBe("click");
    const sceneEvents = step.events.filter((e): e is Extract<RenderEvent, { kind: "scene" }> => e.kind === "scene");
    expect(sceneEvents.length).toBeGreaterThan(0);
  });

  it("trans implicite @bg time=300 est skippable par défaut", () => {
    const SRC = `
*page0|
@fg storage=red center=512 vcenter=288 index=1000
@bg time=300 storage=bgx
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    expect(step.stop.kind).toBe("waitFor");
    if (step.stop.kind === "waitFor") {
      expect(step.stop.what).toBe("transition");
      expect(step.stop.skippable).toBe(true);
    }
  });

  it("trans implicite @bg time=300 canskip=0 est non skippable", () => {
    const SRC = `
*page0|
@fg storage=red center=512 vcenter=288 index=1000
@bg time=300 storage=bgx canskip=0
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    expect(step.stop.kind).toBe("waitFor");
    if (step.stop.kind === "waitFor") {
      expect(step.stop.what).toBe("transition");
      expect(step.stop.skippable).toBe(false);
    }
  });

  it("trans implicite @partbg time=300 canskip=0 est non skippable", () => {
    const SRC = `
*page0|
@partbg id=pb1 storage=im02 center=512 vcenter=288 index=2000 width=522 height=576 srcleft=0 srctop=0 srczoomx=100 srczoomy=100 time=300 canskip=0
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    expect(step.stop.kind).toBe("waitFor");
    if (step.stop.kind === "waitFor") {
      expect(step.stop.what).toBe("transition");
      expect(step.stop.skippable).toBe(false);
    }
  });

  it("trans implicite @partbg time=300 est skippable par défaut", () => {
    const SRC = `
*page0|
@partbg id=pb1 storage=im02 center=512 vcenter=288 index=2000 width=522 height=576 srcleft=0 srctop=0 srczoomx=100 srczoomy=100 time=300
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    expect(step.stop.kind).toBe("waitFor");
    if (step.stop.kind === "waitFor") {
      expect(step.stop.what).toBe("transition");
      expect(step.stop.skippable).toBe(true);
    }
  });

  it("l'instruction trans parsée porte canskip true/false selon l'argument", () => {
    const defaultScript = parse(lex(`*page0|\n@trans time=300\n@pg\n`));
    const transDefault = defaultScript.pages[0].instructions.find((i) => i.kind === "trans") as Extract<Instruction, { kind: "trans" }> | undefined;
    expect(transDefault).toBeDefined();
    expect(transDefault?.canskip).toBe(true);

    const falseScript = parse(lex(`*page0|\n@trans time=300 canskip=0\n@pg\n`));
    const transFalse = falseScript.pages[0].instructions.find((i) => i.kind === "trans") as Extract<Instruction, { kind: "trans" }> | undefined;
    expect(transFalse).toBeDefined();
    expect(transFalse?.canskip).toBe(false);
  });

  it("animate : instruction.def n'est pas muté", () => {
    const SRC = `
*page0|
@fg storage=red index=2000 opacity=50 center=512 vcenter=288
@trans time=100 nowait=1
@movefg storage=red time=100 center=100
@pg
`;
    const script = parse(lex(SRC));
    const animInstr = script.pages[0].instructions.find((i) => i.kind === "animate") as Extract<Instruction, { kind: "animate" }> | undefined;
    expect(animInstr).toBeDefined();
    const originalId = animInstr?.def.id;
    const originalKf0 = { ...animInstr!.def.keyframes[0] };

    const runtime = new Runtime(script);
    runtime.step();

    // L'instruction originale ne doit pas avoir été modifiée.
    expect(animInstr?.def.id).toBe(originalId);
    expect(animInstr?.def.keyframes[0]).toEqual(originalKf0);
  });
});
