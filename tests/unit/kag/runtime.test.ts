// Registre des approximations (#295) — tests figés :
// approx:xchgbgm-volume — volume de piste (test @xchgbgm ci-dessous).
// approx:staffrollsetting-bgcolor — couleur stockée non peinte (tests crédits ci-dessous).
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
    expect(step.events.some((e) => e.kind === "scene" && e.scene.sprites.some((s) => s.storage === "red"))).toBe(true);
    // Après le @return de la sous-routine, l'exécution retombe dans *target ;
    // le second @return n'a plus d'appelant et termine le script (comme KAG).
    expect(step.stop.kind).toBe("end");
  });

  it("@return sans appelant termine le script au lieu de continuer", () => {
    const script = parse(lex("@fg page=fore storage=red center=512 vcenter=288 index=1000\n@return\n@fg page=fore storage=blue center=100 vcenter=100 index=2000\n@pg"));
    const runtime = new Runtime(script);

    const step = runtime.step();
    expect(step.stop.kind).toBe("end");
    const sprites = step.events.flatMap((e) => (e.kind === "scene" ? e.scene.sprites.map((s) => s.storage) : []));
    expect(sprites).toContain("red");
    expect(sprites).not.toContain("blue");
  });

  it("@return sans appelant, au milieu d'un @if, termine aussi le script", () => {
    const script = parse(lex("@if exp=true\n@return\n@endif\n@fg page=fore storage=blue center=100 vcenter=100 index=2000\n@pg"));
    const step = new Runtime(script).step();
    expect(step.stop.kind).toBe("end");
    expect(step.events.some((e) => e.kind === "scene" && e.scene.sprites.some((s) => s.storage === "blue"))).toBe(false);
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
    // Critère d'acceptation issue #49 : après un @trans bloquant (exchange + backlay,
    // sémantique moteur #253), back n'est pas vidé : le 2e @trans réutilise la page affichée.
    const SRC = `
*page0|
@bg page=back storage=bgx
@fg page=back storage=red center=512 vcenter=288 index=2000
@trans time=100
@fg page=back storage=blue center=400 vcenter=288 index=2100
@trans time=100
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    // 1er @trans bloquant (exchange + backlay) → waitFor transition.
    expect(runtime.step().stop.kind).toBe("waitFor");
    // Puis @fg page=back blue et 2e @trans bloquant.
    const step = runtime.step();
    expect(step.stop.kind).toBe("waitFor");
    const scenes = step.events.filter((e): e is Extract<RenderEvent, { kind: "scene" }> => e.kind === "scene");
    const last = scenes[scenes.length - 1];
    expect(last).toBeDefined();
    // back conservé : bg + red toujours présents après le 2e trans, + blue ajouté.
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
    // Une commande inconnue (@madeupcmd) doit prévenir via onWarning et incrémenter
    // rawCount. Sans warning silencieux (AGENTS.md §6).
    const SRC = `
*page0|
@madeupcmd
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const warnings: string[] = [];
    runtime.onWarning = (msg: string) => warnings.push(msg);
    runtime.step();
    expect(runtime.rawCount).toBe(1);
    expect(warnings).toEqual(["commande non gérée: @madeupcmd"]);
  });

  it("raw : plusieurs commandes inconnues cumulent rawCount", () => {
    const SRC = `
*page0|
@madeupcmd
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
    expect(warnings[0]).toContain("@madeupcmd");
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

  it("les @partbg se cumulent (montage) ; seul @bg sans noclear / @clpartbg / @clall les retire (#249)", () => {
    // Moteur (`PartBgPlugin`) : @partbg n'efface jamais les autres partbg ; noclear ne contrôle
    // que le backlay avant transition. 1-1.ks page 11 accumule ainsi 5 fenêtres id=pb1..pb5.
    const SRC = `
*page0|
@partbg storage=piece1 id=pb1 center=220 vcenter=288 index=1000 width=420 height=576
@partbg storage=piece2 id=pb2 center=515 vcenter=288 index=2000 width=420 height=576
@partbg storage=piece3 id=pb3 center=813 vcenter=288 index=3000 width=420 height=576
@trans time=100
@pg
*page1|
@clpartbg id=pb2
@pg
*page2|
@bg page=back storage=black noclear=0
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    runtime.step(); // @trans bloquant → waitFor transition
    // Après le @trans : les trois fenêtres sont visibles ensemble (montage).
    expect(runtime.getSaveData().state.fore.layers.filter((l) => l.crop).map((l) => l.id)).toEqual(["pb1", "pb2", "pb3"]);
    runtime.step(); // @pg de la page 0 → clic (fin de page)
    runtime.step(); // page 1
    // @clpartbg ne retire que la fenêtre ciblée.
    expect(runtime.getSaveData().state.back.layers.filter((l) => l.crop).map((l) => l.id)).toEqual(["pb1", "pb3"]);
    runtime.step(); // page 2
    // @bg sans noclear vide les calques de la page cible, partbg compris.
    expect(runtime.getSaveData().state.back.layers).toEqual([]);
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
      // @movefg sans center= → indéfini (conserver la position), pas 0 (#65).
      expect(kf1.center).toBeUndefined();
      expect(kf1.vcenter).toBeUndefined();
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

describe("Runtime — @movefg sans center (#65)", () => {
  it("conserve la position du calque quand center/vcenter sont absents", () => {
    const SRC = `
*page0|
@fg storage=red index=2000 opacity=50 center=300 vcenter=200
@trans time=100 nowait=1
@movefg storage=red time=100 opacity=80
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    runtime.step();
    const layer = runtime.getSaveData().state.fore.layers.find((l) => l.storage === "red");
    expect(layer?.center).toBe(300);
    expect(layer?.vcenter).toBe(200);
  });
});

describe("Runtime — apparence des calques (#252)", () => {
  it("@fg/@partbg/@bg : type, effect, blur, brightness, contrast dans l'état", () => {
    const SRC = `
*page0|
@bg page=fore storage=pano type=1 effect=monoff1313 blur=8 brightness=-20 contrast=40
@fg page=fore storage=perso index=1600 type=19 effect=nega xblur=4 yblur=2 brightness=-35 contrast=80
@partbg page=fore storage=pane width=420 height=576 type=13 effect=monocro
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    runtime.step();
    const state = runtime.getSaveData().state;
    expect(state.fore).toMatchObject({
      bgEffect: "monoff1313",
      bgBrightness: -20,
      bgContrast: 40,
      bgBlurX: 8,
      bgBlurY: 8,
    });
    const perso = state.fore.layers.find((l) => l.id === "perso")!;
    expect(perso).toMatchObject({ type: 19, effect: "nega", blurx: 4, blury: 2, brightness: -35, contrast: 80 });
    const pane = state.fore.layers.find((l) => l.storage === "pane")!;
    expect(pane).toMatchObject({ type: 13, effect: "monocro" });
  });

  it("@bg sans attributs d'apparence réinitialise ceux du fond précédent (comme @image)", () => {
    const SRC = `
*page0|
@bg page=fore storage=un effect=monocro blur=8 brightness=-20 contrast=40
@bg page=fore storage=deux
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    runtime.step();
    const fore = runtime.getSaveData().state.fore;
    expect(fore.background).toBe("deux");
    expect(fore.bgEffect).toBeUndefined();
    expect(fore.bgBrightness).toBeUndefined();
    expect(fore.bgContrast).toBeUndefined();
    expect(fore.bgBlurX).toBeUndefined();
  });

  it("@chgfg conserve l'apparence du calque sauf attributs précisés", () => {
    const SRC = `
*page0|
@fg page=fore storage=p1a index=1600 type=16 effect=monoff1313 blur=4
@chgfg page=fore storage=p1a|b
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    runtime.step();
    const layer = runtime.getSaveData().state.fore.layers.find((l) => l.id === "p1a")!;
    expect(layer.storage).toBe("p1a");
    expect(layer).toMatchObject({ type: 16, effect: "monoff1313", blurx: 4 });
  });

  it("@fgact : la dernière keyframe devient l'apparence du calque", () => {
    const SRC = `
*page0|
@fg page=fore storage=p1 index=1600
@fgact page=fore id=p1 props=-storage,-type,-effect,-visible keys=(0,0,l,p1,19,nega,1)(500,0,l,p1,16,monocro,1)
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    runtime.step();
    const layer = runtime.getSaveData().state.fore.layers.find((l) => l.id === "p1")!;
    expect(layer.type).toBe(16);
    expect(layer.effect).toBe("monocro");
  });
});

describe("Runtime — commandes KAG standard (#277)", () => {
  it("@image layer=base pose le fond de la page demandée, sans transition", () => {
    const SRC = `
*page0|
@bg page=fore storage=black
@image page=fore layer=base storage=white
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    // La scène émise par @image (fond blanc) suit celle de @bg dans le même pas.
    expect(step.events.filter((e) => e.kind === "scene").length).toBeGreaterThanOrEqual(2);
    expect(runtime.getSaveData().state.fore.background).toBe("white");
  });

  it("@image page=back prépare le fond sans toucher à la page affichée", () => {
    const SRC = `
*page0|
@bg page=fore storage=black
@image page=back layer=base storage=white
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    runtime.step();
    runtime.step();
    expect(runtime.getSaveData().state.fore.background).toBe("black");
    expect(runtime.getSaveData().state.back.background).toBe("white");
  });

  it("@s arrête le déroulement en attendant un clic", () => {
    const SRC = `
*page0|
@s
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    expect(step.stop).toEqual({ kind: "click", style: "line" });
  });

  it("@endif orphelin (4-3.ks) n'est plus signalé comme commande inconnue", () => {
    const SRC = `
*page0|
@endif
[ruby text=こえ char=1]言なき鳥が鳴く。
@pg
`;
    const warnings: string[] = [];
    const runtime = new Runtime(parse(lex(SRC)));
    runtime.onWarning = (message) => warnings.push(message);
    const step = runtime.step();
    expect(warnings.filter((w) => w.includes("commande non gérée"))).toEqual([]);
    // Le texte qui suit est bien produit (le no-op ne coupe pas la page).
    const segments = step.events.flatMap((e) => (e.kind === "text" ? e.segments : []));
    expect(segments).toContainEqual({ text: "言", ruby: "こえ" });
  });

  it("@ruby commande (5a-11.ks) affiche le texte de base avec le ruby réparti", () => {
    const SRC = `
*page0|
@ruby char="Abc" text="かんじです"
@pg
`;
    const runtime = new Runtime(parse(lex(SRC)));
    const step = runtime.step();
    const texts = step.events.flatMap((e) => (e.kind === "text" ? e.segments : []));
    expect(texts).toEqual([
      { text: "A", ruby: "かん" },
      { text: "b", ruby: "じ" },
      { text: "c", ruby: "です" },
    ]);
  });
});

describe("Runtime — crédits de fin (#286)", () => {
  const run = (src: string) => {
    const runtime = new Runtime(parse(lex(src)));
    return runtime;
  };

  it("@staffrollinit / @staffrolltext / @staffrollstart : défilement en cours, couleur de ligne", () => {
    const runtime = run(`
*page0|
@font color=0xFF000000
@staffrollinit face=serif
@staffrolltext size=19 y=100 text=Ligne1
@staffrolltext size=19 y=36 text=Ligne2
@staffrollstart height=5000 time=10000
@pg
`);
    const step = runtime.step();
    const state = runtime.getSaveData().state.staffroll;
    expect(state).toBeDefined();
    expect(state?.running).toBe(true);
    expect(state?.height).toBe(5000);
    expect(state?.time).toBe(10000);
    expect(state?.face).toBe("serif");
    expect(state?.lines.map((l) => l.text)).toEqual(["Ligne1", "Ligne2"]);
    expect(state?.lines[0]?.color).toBe("#000000");
    expect(step.events.some((e) => e.kind === "staffroll")).toBe(true);
  });

  it("@wstaffroll = point d'arrêt waitFor staffroll non skippable", () => {
    const runtime = run(`
*page0|
@staffrollinit
@staffrollstart height=100 time=50
@wstaffroll
@pg
`);
    let waitStop: { what?: string; skippable?: boolean } | null = null;
    for (let i = 0; i < 5 && !waitStop; i++) {
      const step = runtime.step();
      if (step.stop.kind === "waitFor" && step.stop.what === "staffroll") waitStop = step.stop;
      if (step.stop.kind === "end" || step.stop.kind === "click") break;
    }
    expect(waitStop).toMatchObject({ kind: "waitFor", what: "staffroll", skippable: false });
  });

  it("@staffrolluninit libère l'état et émet un événement null", () => {
    const runtime = run(`
*page0|
@staffrollinit
@staffrolltext text=Ligne y=10
@staffrollstart height=100 time=10
@staffrolluninit
@pg
`);
    let uninitEvent = false;
    for (let i = 0; i < 8; i++) {
      const step = runtime.step();
      if (step.events.some((e) => e.kind === "staffroll" && e.state === null)) uninitEvent = true;
      if (step.stop.kind === "end" || step.stop.kind === "click") break;
    }
    expect(uninitEvent).toBe(true);
    expect(runtime.getSaveData().state.staffroll).toBeUndefined();
  });

  it("@staffrollsetting conserve bgcolor dans l'état (sans effet de rendu)", () => {
    const runtime = run(`
*page0|
@staffrollinit
@staffrollsetting bgcolor=0xFF000000
@pg
`);
    runtime.step();
    expect(runtime.getSaveData().state.staffroll?.bgcolor).toBe("#000000");
  });
});

describe("Runtime — audio et déroulement (#285)", () => {
  const run = (src: string) => new Runtime(parse(lex(src)));

  it("@xchgbgm : arrêt fondu de l'ancienne BGM puis fondu entrant de la nouvelle", () => {
    const runtime = run(`
*page0|
@play storage=m01
@xchgbgm storage=m38 time=8000 overlap=7000 volume=80
@pg
`);
    const step = runtime.step();
    const audio = step.events.filter((e) => e.kind === "audio").map((e) => (e as { event: unknown }).event);
    expect(audio).toEqual([
      { kind: "play", channel: "bgm", storage: "m01", loop: true, volume: 1 },
      { kind: "stop", channel: "bgm", fadeOut: 8000 },
      { kind: "play", channel: "bgm", storage: "m38", loop: true, volume: 0.8, fadeIn: 8000, delay: 1000 },
    ]);
    expect(runtime.getSaveData().state.bgm).toBe("m38");
  });

  it("@xchgbgm sans BGM en cours : simple fondu entrant", () => {
    const runtime = run(`
*page0|
@xchgbgm storage=m38 time=4000 overlap=3000
@pg
`);
    const step = runtime.step();
    const audio = step.events.filter((e) => e.kind === "audio").map((e) => (e as { event: unknown }).event);
    expect(audio).toEqual([
      { kind: "play", channel: "bgm", storage: "m38", loop: true, volume: 1, fadeIn: 4000, delay: 1000 },
    ]);
  });

  it("@xchgbgm vers la BGM déjà en cours : aucun événement (moteur)", () => {
    const runtime = run(`
*page0|
@play storage=m38
@xchgbgm storage=m38 time=4000
@pg
`);
    const step = runtime.step();
    const audio = step.events.filter((e) => e.kind === "audio");
    expect(audio).toHaveLength(1); // seulement le @play initial
  });

  it("@wb : point d'arrêt waitFor bgmFade (non skippable par défaut)", () => {
    const runtime = run(`
*page0|
@play storage=m01
@playstop time=8000 nowait=1
@wb
@pg
`);
    let waitStop: { what?: string; skippable?: boolean } | null = null;
    for (let i = 0; i < 6 && !waitStop; i++) {
      const step = runtime.step();
      if (step.stop.kind === "waitFor") waitStop = step.stop;
      if (step.stop.kind === "end" || step.stop.kind === "click") break;
    }
    expect(waitStop).toMatchObject({ kind: "waitFor", what: "bgmFade", skippable: false });
  });

  it("@clickskip/@effectskip émettent les réglages ; @cancelskip émet cancelSkip", () => {
    const runtime = run(`
*page0|
@clickskip enabled=0
@effectskip enabled=false
@cancelskip
@pg
`);
    const step = runtime.step();
    expect(step.events).toContainEqual({ kind: "skipSetting", clickSkip: false });
    expect(step.events).toContainEqual({ kind: "skipSetting", effectSkip: false });
    expect(step.events).toContainEqual({ kind: "cancelSkip" });
  });
});

describe("Runtime — commandes visuelles secondaires (#85)", () => {
  const run = (src: string) => new Runtime(parse(lex(src)));

  it("@dispclock pose le fond d'horloge et 4 aiguilles (angles CSS, ombres mono/blur)", () => {
    const runtime = run(`
*page0|
@dispclock h=3 m=0 left=-800 top=-600 time=300 effect=monocro zoom=80
@pg
`);
    const allEvents: RenderEvent[] = [];
    for (let i = 0; i < 4; i++) {
      const step = runtime.step();
      allEvents.push(...step.events);
      if (step.stop.kind === "end" || step.stop.kind === "click") break;
    }
    // Transition implicite back→fore : la scène émise contient les aiguilles + le fond.
    expect(allEvents.some((e) => e.kind === "scene")).toBe(true);
    const fore = runtime.getSaveData().state.fore;
    expect(fore.background).toBe("im03lロビー時計(x2)");
    expect(fore.bgEffect).toBe("monocro");
    const ids = fore.layers.map((l) => l.id).sort();
    expect(ids).toEqual(["clock1", "clock2", "clock3", "clock4"]);
    const hour = fore.layers.find((l) => l.id === "clock1")!;
    // h=3, m=0 → aiguille des heures à 90° (sens horaire du port).
    expect(hour.rotate).toBe(90);
    expect(hour.afx).toBe(69);
    expect(hour.afy).toBe(621);
    expect(hour.zoomx).toBe(80);
    const shadow = fore.layers.find((l) => l.id === "clock3")!;
    expect(shadow.effect).toBe("mono000000");
    expect(shadow.blurx).toBe(2);
    expect(shadow.opacity).toBeCloseTo(64 / 255, 5);
    expect(runtime.getSaveData().state.clockHour).toBe(3);
  });

  it("@dispclock time=0 pose fond + 4 aiguilles sur la page affichée (fore), sans transition (#297)", () => {
    const runtime = run(`
*page0|
@dispclock h=3 m=0 left=-800 top=-600 time=0
@pg
`);
    const step = runtime.step();
    // Mise à jour immédiate : pas d'attente de transition (le script se poursuit jusqu'au @pg).
    expect(step.stop.kind).not.toBe("waitFor");
    const scenes = step.events.filter((event): event is Extract<RenderEvent, { kind: "scene" }> => event.kind === "scene");
    expect(scenes.length).toBeGreaterThan(0);
    // La DERNIÈRE scène de l'étape (après le fond) contient le fond d'horloge ET les 4 aiguilles.
    const last = scenes.at(-1)!;
    expect(last.scene.bg).toBe("im03lロビー時計(x2)");
    expect(last.scene.sprites.map((sprite) => sprite.id).sort()).toEqual([
      "clock1",
      "clock2",
      "clock3",
      "clock4",
    ]);
    const state = runtime.getSaveData().state;
    // État persisté cohérent : tout est sur fore, rien sur back (bug #297 : aiguilles invisibles).
    expect(state.fore.background).toBe("im03lロビー時計(x2)");
    expect(state.fore.layers.map((layer) => layer.id).sort()).toEqual([
      "clock1",
      "clock2",
      "clock3",
      "clock4",
    ]);
    expect(state.back.background).toBe("");
    expect(state.back.layers).toEqual([]);
    expect(state.clockHour).toBe(3);
  });

  it("@dispclock time>0 conserve la transition back→fore (#297 non-régression)", () => {
    const runtime = run(`
*page0|
@dispclock h=3 m=0 left=-800 top=-600 time=300
@pg
`);
    const step = runtime.step();
    expect(step.stop).toMatchObject({ kind: "waitFor", what: "transition" });
    const state = runtime.getSaveData().state;
    expect(state.fore.background).toBe("im03lロビー時計(x2)");
    expect(state.fore.layers.map((layer) => layer.id).sort()).toEqual([
      "clock1",
      "clock2",
      "clock3",
      "clock4",
    ]);
  });

  it("@tickclock anime les 4 aiguilles puis attend la fin des animations", () => {
    const runtime = run(`
*page0|
@dispclock h=3 m=0 left=-800 top=-600 time=0
@tickclock h=6 m=55
@pg
`);
    const events: RenderEvent[] = [];
    let waitStop: Extract<StopReason, { kind: "waitFor" }> | null = null;
    for (let i = 0; i < 4 && !waitStop; i++) {
      const step = runtime.step();
      events.push(...step.events);
      if (step.stop.kind === "waitFor" && step.stop.what === "animation") waitStop = step.stop;
      if (step.stop.kind === "end" || step.stop.kind === "click") break;
    }
    expect(events.some((e) => e.kind === "scene")).toBe(true);
    const animated = events.filter((e) => e.kind === "animate");
    expect(animated.map((e) => (e as { target: string }).target).sort()).toEqual([
      "clock1",
      "clock2",
      "clock3",
      "clock4",
    ]);
    expect(waitStop).toMatchObject({ kind: "waitFor", what: "animation" });
    expect(runtime.getSaveData().state.clockHour).toBe(6);
    expect(runtime.getSaveData().state.clockMinute).toBe(55);
  });

  it("@chgpartbg met à jour l'unique partbg de la page (image + flou)", () => {
    const runtime = run(`
*page0|
@partbg page=fore storage=paneold center=512 vcenter=288 index=1000 width=420 height=576
@chgpartbg page=fore storage=panenew blur=2
@pg
`);
    const step = runtime.step();
    expect(step.events.some((e) => e.kind === "scene")).toBe(true);
    const layer = runtime.getSaveData().state.fore.layers.find((l) => l.crop);
    expect(layer?.storage).toBe("panenew");
    expect(layer?.blurx).toBe(2);
  });

  it("@chgpartbg id= cible le bon partbg et transitionne avec time=", () => {
    const runtime = run(`
*page0|
@partbg page=back storage=p1 center=100 vcenter=100 index=1000 width=100 height=100 id=pb1
@partbg page=back storage=p2 center=200 vcenter=200 index=1100 width=100 height=100 id=pb2
@chgpartbg id=pb2 storage=p2b time=300
@pg
`);
    let waitStop: Extract<StopReason, { kind: "waitFor" }> | null = null;
    for (let i = 0; i < 4 && !waitStop; i++) {
      const step = runtime.step();
      if (step.stop.kind === "waitFor" && step.stop.what === "transition") waitStop = step.stop;
      if (step.stop.kind === "end" || step.stop.kind === "click") break;
    }
    // Transition back→fore (le moteur appelle partbg_object.doTrans).
    expect(waitStop).toMatchObject({ kind: "waitFor", what: "transition" });
    const fore = runtime.getSaveData().state.fore;
    expect(fore.layers.find((l) => l.id === "pb2")?.storage).toBe("p2b");
    expect(fore.layers.find((l) => l.id === "pb1")?.storage).toBe("p1");
  });

  it("@setdefaultmessageaction / reset : action continue des messages dans l'état", () => {
    const runtime = run(`
*page0|
@setdefaultmessageaction type=swing
@resetdefaultmessageaction
@pg
`);
    const step = runtime.step();
    const textboxEvents = step.events.filter((e) => e.kind === "textbox");
    expect(textboxEvents.length).toBeGreaterThanOrEqual(2);
    expect(runtime.getSaveData().state.textbox?.action).toBeUndefined();
    // Après la pose (premier événement), l'action est bien « swing ».
    const withAction = textboxEvents.find((e) => (e as { state: { action?: string } }).state.action === "swing");
    expect(withAction).toBeDefined();
  });
});

// Registre des approximations (#295) — test figé :
// approx:trans-nowait-timing — permutation exchange appliquée immédiatement pendant un nowait.
describe("Runtime — @trans exchange/backlay (#253)", () => {
  const setup = (transArgs: string) => `
*page0|
@bg page=fore storage=foreimg
@bg page=back storage=backimg
@trans time=100 rule=crossfade ${transArgs}
@pg
`;

  it("bloquant (défaut) : fore = back préparé, back = ce même contenu après backlay automatique", () => {
    const runtime = new Runtime(parse(lex(setup(""))));
    // Une seule étape exécute les deux @bg puis le @trans bloquant, qui rend le stop.
    const step = runtime.step();
    expect(step.stop).toMatchObject({ kind: "waitFor", what: "transition" });
    const state = runtime.getSaveData().state;
    expect(state.fore.background).toBe("backimg");
    expect(state.back.background).toBe("backimg");
    // La dernière scène émise (transition) montre le contenu préparé (fore).
    const scenes = step.events.filter((event): event is Extract<RenderEvent, { kind: "scene" }> => event.kind === "scene");
    expect(scenes.at(-1)!.scene.bg).toBe("backimg");
  });

  it("bloquant + noback=1 : fore = back préparé, back = ANCIEN fore (pas de backlay)", () => {
    const runtime = new Runtime(parse(lex(setup("noback=1"))));
    expect(runtime.step().stop).toMatchObject({ kind: "waitFor", what: "transition" });
    const state = runtime.getSaveData().state;
    expect(state.fore.background).toBe("backimg");
    expect(state.back.background).toBe("foreimg");
  });

  it("nowait : back = ancien fore, aucun @wt automatique ; @wt ultérieur exécute le backlay", () => {
    const runtime = new Runtime(parse(lex(setup("nowait=1"))));
    // nowait ne bloque pas : l'étape va jusqu'au @pg (clic).
    const step = runtime.step();
    expect(step.stop.kind).toBe("click");
    expect(runtime.getSaveData().state.fore.background).toBe("backimg");
    expect(runtime.getSaveData().state.back.background).toBe("foreimg");

    // Cas symétrique : un @wt dans le script copie fore→back après l'attente.
    const withWt = `
*page0|
@bg page=fore storage=foreimg
@bg page=back storage=backimg
@trans time=100 nowait=1
@wt
@pg
`;
    const runtime2 = new Runtime(parse(lex(withWt)));
    const step2 = runtime2.step();
    expect(step2.stop).toMatchObject({ kind: "waitFor", what: "transition" });
    expect(runtime2.getSaveData().state.back.background).toBe("backimg");
  });

  it("nowait + @wt noback=1 : back conserve l'ancien affichage", () => {
    const script = `
*page0|
@bg page=fore storage=foreimg
@bg page=back storage=backimg
@trans time=100 nowait=1
@wt noback=1
@pg
`;
    const runtime = new Runtime(parse(lex(script)));
    expect(runtime.step().stop).toMatchObject({ kind: "waitFor", what: "transition" });
    const state = runtime.getSaveData().state;
    expect(state.fore.background).toBe("backimg");
    expect(state.back.background).toBe("foreimg");
  });

  it("exchange=0 : comportement historique (fore = clone(back), back conservé)", () => {
    const runtime = new Runtime(parse(lex(setup("exchange=0"))));
    runtime.step();
    const state = runtime.getSaveData().state;
    expect(state.fore.background).toBe("backimg");
    expect(state.back.background).toBe("backimg");
  });
});

describe("@chgfg — sélection moteur et position (#315)", () => {
  const run = (src: string) => new Runtime(parse(lex(src)));

  it("sans page, sélectionne le calque du personnage sur fore et le copie sur back avec la nouvelle image", () => {
    const runtime = run(`
*page0|
@bg page=fore time=0 storage=bg
@fg page=fore storage=青子01 center=300 vcenter=200 index=1000
@chgfg storage=青子02
@pg
`);
    runtime.step();
    const state = runtime.getSaveData().state;
    expect(state.fore!.layers.find((layer) => layer.id === "青子01")).toMatchObject({ storage: "青子01", center: 300 });
    // Même personnage (préfixe non ASCII), nouvelle image : copie sur back à la même position.
    expect(state.back!.layers.find((layer) => layer.id === "青子01")).toMatchObject({
      storage: "青子02",
      center: 300,
      vcenter: 200,
    });
  });

  it("applique center/vcenter explicites au calque existant", () => {
    const runtime = run(`
*page0|
@bg page=fore time=0 storage=bg
@fg page=fore storage=青子01 center=512 vcenter=288 index=1000
@chgfg page=fore storage=青子02 center=300 vcenter=200
@pg
`);
    runtime.step();
    const fore = runtime.getSaveData().state.fore!;
    expect(fore.layers.find((layer) => layer.id === "青子01")).toMatchObject({
      storage: "青子02",
      center: 300,
      vcenter: 200,
    });
  });

  it("conserve la position quand center/vcenter sont absents", () => {
    const runtime = run(`
*page0|
@bg page=fore time=0 storage=bg
@fg page=fore storage=青子01 center=420 vcenter=250 index=1000
@chgfg page=fore storage=青子02
@pg
`);
    runtime.step();
    const fore = runtime.getSaveData().state.fore!;
    expect(fore.layers.find((layer) => layer.id === "青子01")).toMatchObject({ storage: "青子02", center: 420, vcenter: 250 });
  });

  it("crée un orphelin à center/vcenter fournis (et non à 512/288 par défaut)", () => {
    const runtime = run(`
*page0|
@bg page=fore time=0 storage=bg
@chgfg page=fore id=orphan storage=perso center=200 vcenter=150
@pg
`);
    runtime.step();
    const fore = runtime.getSaveData().state.fore!;
    expect(fore.layers.find((layer) => layer.id === "orphan")).toMatchObject({
      storage: "perso",
      center: 200,
      vcenter: 150,
    });
  });
});
