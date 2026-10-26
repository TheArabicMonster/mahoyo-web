import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";

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

describe("Runtime", () => {
  it("advances through pages", () => {
    const script = parse(lex(SAMPLE));
    const runtime = new Runtime(script);

    const page0 = runtime.next();
    expect(page0).not.toBeNull();
    expect(page0?.text).toContain("こんにちは");
    expect(page0?.display.background).toBe("black");
    expect(page0?.display.layers[0].storage).toBe("青子");

    const page1 = runtime.next();
    expect(page1).not.toBeNull();
    expect(page1?.text).toContain("さようなら");
    expect(page1?.display.background).toBe("white");
    expect(page1?.display.layers.length).toBe(0);

    expect(runtime.next()).toBeNull();
  });

  it("jumps to a label", () => {
    const script = parse(lex(SAMPLE));
    const runtime = new Runtime(script);
    expect(runtime.jump("page1")).toBe(true);
    const page = runtime.next();
    expect(page?.text).toContain("さようなら");
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

    const page0 = runtime.next();
    expect(page0).not.toBeNull();
    expect(page0?.display.background).toBe("sunset");
    expect(page0?.display.layers[0].storage).toBe("青子");
    expect(page0?.transition).toBe(true);
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

    // Configurer le scriptLoader
    runtime.scriptLoader = async (storage: string) => {
      if (storage === "sub.ks") return subScript;
      return null;
    };

    // Page 0: @call storage=sub.ks détecté → pendingScriptLoad
    const p1 = runtime.next();
    expect(p1?.pendingScriptLoad).toBe("sub.ks");
    expect(p1?.text).toContain("メインスクリプト");

    // Charger le script
    const loaded = await runtime.loadScript("sub.ks");
    expect(loaded).toBe(true);

    // Sub script page 0: texte du sub
    const p2 = runtime.next();
    expect(p2?.text).toContain("サブスクリプト");

    // @return → retour au main, page1
    const p3 = runtime.next();
    expect(p3?.text).toContain("メインに戻った");
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
    const page = runtime.next();
    expect(page?.display.layers.length).toBe(1);
    expect(page?.display.layers[0].storage).toBe("有珠");
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
    const page = runtime.next();
    expect(page?.state.back.background).toBe("sunset");
    expect(page?.state.back.layers[0].storage).toBe("青子");
    // Après @trans, fore est mis à jour depuis back
    expect(page?.display.background).toBe("sunset");
  });

  it("emits audio actions for @playstop and @fadebgm", () => {
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

    const p0 = runtime.next();
    expect(p0?.state.bgm).toBeNull();
    expect(p0?.pendingAudioAction).toEqual({ action: "stopBgm" });

    const p1 = runtime.next();
    expect(p1?.state.bgm).toBeNull();
    expect(p1?.pendingAudioAction).toEqual({ action: "fadeBgm", time: 2000 });
  });

  it("emits audio action for @sestop", () => {
    const SE_SAMPLE = `
*page0|
@se storage=se01
@sestop storage=se01 time=500
@pg
`;
    const script = parse(lex(SE_SAMPLE));
    const runtime = new Runtime(script);
    const page = runtime.next();
    expect(page?.state.se).toBeNull();
    expect(page?.pendingAudioAction).toEqual({ action: "stopSe", storage: "se01", time: 500 });
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

    const p0 = runtime.next();
    expect(p0?.pendingTextbox).toEqual({ visible: false, time: 300 });

    const p1 = runtime.next();
    expect(p1?.pendingTextbox).toEqual({ visible: true, time: 300 });
  });

  it("emits quake effect for @quake", () => {
    const QUAKE_SAMPLE = `
*page0|
@quake vmax=10 hmax=2 time=500 interval=40
@pg
`;
    const script = parse(lex(QUAKE_SAMPLE));
    const runtime = new Runtime(script);
    const page = runtime.next();
    expect(page?.pendingQuake).toEqual({ vmax: 10, hmax: 2, time: 500, interval: 40 });
  });
});
