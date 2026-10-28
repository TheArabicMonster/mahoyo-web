import { describe, it, expect } from "vitest";
import { compileAction, extractDiscrete } from "@/renderer/action-compiler.js";
import type { AnimationDef } from "@/kag/types.js";
import { parseActionKeys, SAMPLE_FGACT } from "@/kag/action.js";

function defFrom(keysStr: string, propsStr: string, opts: Partial<AnimationDef> = {}): AnimationDef {
  return {
    storage: "test",
    keyframes: parseActionKeys(keysStr, propsStr),
    ...opts,
  };
}

describe("compileAction", () => {
  it("compile l'oracle SAMPLE_FGACT en keyframes WAAPI", () => {
    const def = defFrom(SAMPLE_FGACT.keysStr, SAMPLE_FGACT.propsStr, { storage: "im空絵b", loop: true });
    const compiled = compileAction(def);
    expect(compiled).not.toBeNull();
    if (!compiled) return;

    // Durée totale = temps absolu de la dernière keyframe = 1800.
    expect(compiled.duration).toBe(1800);
    // loop → Infinity.
    expect(compiled.iterations).toBe(Infinity);

    // Les keyframes WAAPI ont des offset entre 0 et 1.
    const wrapper = compiled.keyframes.wrapper;
    const offsets = wrapper.map((k) => k.offset);
    expect(offsets[0]).toBe(0);
    expect(offsets[offsets.length - 1]).toBe(1);

    // opacity est continue : on doit la retrouver sur les keyframes wrapper.
    const hasOpacity = wrapper.some((k) => k.opacity !== undefined);
    expect(hasOpacity).toBe(true);

    // center/vcenter sont continues (left/top).
    const hasLeft = wrapper.some((k) => k.left !== undefined);
    expect(hasLeft).toBe(true);
  });

  it("interp n → steps(1, end), l → linear", () => {
    const def = defFrom("(0,0,l,0)(100,0,n,255)", "opacity");
    const compiled = compileAction(def);
    if (!compiled) return;
    // 1ʳᵉ keyframe (offset 0) interp l → linear.
    expect(compiled.keyframes.wrapper[0].easing).toBe("linear");
    // 2e keyframe interp n → steps(1, end).
    expect(compiled.keyframes.wrapper[1].easing).toBe("steps(1, end)");
  });

  it("retourne null si duration <= 0", () => {
    const def = defFrom("(0,0,l,)", "opacity");
    expect(compileAction(def)).toBeNull();
  });

  it("retourne null si aucune keyframe", () => {
    const def: AnimationDef = { storage: "x", keyframes: [] };
    expect(compileAction(def)).toBeNull();
  });

  it("compile rotate + zoom en transform centré", () => {
    const def = defFrom(
      "(0,0,l,0,0,0)(1000,0,l,45,100,100)",
      "rotate,zoomx,zoomy",
    );
    const compiled = compileAction(def);
    if (!compiled) return;
    // La 2e keyframe doit avoir transform contenant translate(-50%,-50%) + scale + rotate.
    const last = compiled.keyframes.wrapper.find((k) => k.offset === 1);
    expect(last).toBeDefined();
    expect(last!.transform).toContain("translate(-50%, -50%)");
    expect(last!.transform).toContain("scale(1, 1)");
    expect(last!.transform).toContain("rotate(45deg)");
  });

  it("extrait les changements discrets (storage/effect/contrast/absolute)", () => {
    const def = defFrom(
      "(0,0,l,im空絵b,512,288,0,13,,,,nega,62,1)(2500,0,,,,,255,,,5,5,,,)",
      "-storage,center,vcenter,opacity,-type,rotate,zoomx,zoomy,-effect,-contrast,-visible",
    );
    const discrete = extractDiscrete(def);
    // storage=im空絵b à t=0 ; -type=13 à t=0 ; effect=nega à t=0 ; contrast=62 à t=0.
    const storageChange = discrete.find((d) => d.field === "storage");
    expect(storageChange?.value).toBe("im空絵b");
    expect(storageChange?.time).toBe(0);

    const effectChange = discrete.find((d) => d.field === "effect");
    expect(effectChange?.value).toBe("nega");

    const contrastChange = discrete.find((d) => d.field === "contrast");
    expect(contrastChange?.value).toBe(62);

    // absolute absent de cet échantillon.
    expect(discrete.find((d) => d.field === "absolute")).toBeUndefined();
  });

  it("gère absolute (z-index) comme discret", () => {
    const def = defFrom(
      "(0,0,n,im森絵c,512,288,1100,0,1)(1050,,l,,,,,,)",
      "-storage,center,vcenter,absolute,opacity,-visible",
    );
    const discrete = extractDiscrete(def);
    const abs = discrete.find((d) => d.field === "absolute");
    expect(abs?.value).toBe(1100);
    expect(abs?.time).toBe(0);
  });

  it("boucle : iterations=Infinity quand loop=true, 1 sinon", () => {
    const loopDef = defFrom("(0,0,l,)(100,0,l,)", "opacity", { loop: true });
    const noLoopDef = defFrom("(0,0,l,)(100,0,l,)", "opacity", { loop: false });
    expect(compileAction(loopDef)?.iterations).toBe(Infinity);
    expect(compileAction(noLoopDef)?.iterations).toBe(1);
  });

  it("ajoute offset 0 et 1 si manquants", () => {
    // keyframes à t=200 et t=800 (pas de t=0 ni de t=1000 final) avec opacity.
    const def = defFrom("(200,0,l,0)(800,0,l,255)", "opacity");
    const compiled = compileAction(def);
    if (!compiled) return;
    expect(compiled.duration).toBe(800);
    // WAAPI exige offset 0 et 1.
    expect(compiled.keyframes.wrapper[0].offset).toBe(0);
    expect(compiled.keyframes.wrapper[compiled.keyframes.wrapper.length - 1].offset).toBe(1);
  });

  it("compile l'échantillon nested-paren (storage avec sous-parenthèses)", () => {
    const def = defFrom(
      "(0,0,l,im12宇宙の果て01(中心無し),512,288,0,13,,,,nega,62,1)(2500,0,,,,,255,,,5,5,,,)",
      "-storage,center,vcenter,opacity,-type,rotate,zoomx,zoomy,-effect,-contrast,-visible",
      { storage: "im12宇宙の果て01(中心無し)" },
    );
    const compiled = compileAction(def);
    expect(compiled).not.toBeNull();
    const discrete = compiled?.discrete ?? [];
    const storage = discrete.find((d) => d.field === "storage");
    expect(storage?.value).toBe("im12宇宙の果て01(中心無し)");
  });

  it("compile une anim partbg : inner keyframes séparées des wrapper", () => {
    // @partbgact : srcleft/srctop/srczoomx/srczoomy animés (panoramique).
    const def = defFrom(
      "(0,0,l,0,0,100,100)(30000,0,l,542,0,100,100)",
      "srcleft,srctop,srczoomx,srczoomy",
      { storage: "im02", isPartbg: true },
    );
    const compiled = compileAction(def);
    expect(compiled).not.toBeNull();
    if (!compiled) return;
    expect(compiled.duration).toBe(30000);
    // Wrapper keyframes : aucune (pas de center/vcenter/opacity/zoom).
    expect(compiled.keyframes.wrapper.length).toBe(0);
    // Inner keyframes : 2 + padding offset 0/1 = 4.
    expect(compiled.keyframes.inner.length).toBeGreaterThanOrEqual(2);
    const last = compiled.keyframes.inner.find((k) => k.offset === 1);
    expect(last).toBeDefined();
    expect(last!.transform).toContain("translate(-542px");
    expect(last!.transform).toContain("scale(1, 1)");
  });

  it("complète les props transform manquantes depuis la keyframe précédente", () => {
    // kf0 a zoom=200% (parse → 2) mais pas rotate ; kf1 a rotate mais pas zoom.
    // Le carry-forward doit conserver zoom=2 sur la dernière keyframe.
    const def = defFrom(
      "(0,0,l,512,288,0,0,200,200)(1000,0,l,512,288,0,45,,)",
      "center,vcenter,opacity,rotate,zoomx,zoomy",
    );
    const compiled = compileAction(def);
    expect(compiled).not.toBeNull();
    const kfs = compiled!.keyframes.wrapper;
    expect(kfs.length).toBeGreaterThanOrEqual(2);
    const first = kfs[0];
    const last = kfs[kfs.length - 1];
    expect(first.transform).toContain("scale(2, 2)");
    expect(first.transform).toContain("rotate(0deg)");
    expect(last.transform).toContain("scale(2, 2)");
    expect(last.transform).toContain("rotate(45deg)");
  });

  it("compile une anim partbg mixte : wrapper + inner", () => {
    // center + srcleft animés simultanément.
    const def = defFrom(
      "(0,0,l,748,0,100,100)(30000,0,l,300,-542,100,100)",
      "center,srcleft,srctop,srczoomx,srczoomy",
      { storage: "im02", isPartbg: true },
    );
    const compiled = compileAction(def);
    if (!compiled) return;
    // Wrapper : center animé.
    expect(compiled.keyframes.wrapper.some((k) => k.left !== undefined)).toBe(true);
    // Inner : srcleft animé.
    expect(compiled.keyframes.inner.some((k) => k.transform !== undefined)).toBe(true);
  });
});
