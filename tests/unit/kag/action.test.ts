import { describe, it, expect } from "vitest";
import {
  parseActionKeys,
  parsePropHeaders,
  splitKeyframes,
  SAMPLE_FGACT,
  SAMPLE_FGACT_NESTED_PAREN,
} from "@/kag/action.js";

describe("parseActionKeys", () => {
  it("tokenise les keyframes avec parenthèses imbriquées", () => {
    const frames = splitKeyframes(SAMPLE_FGACT_NESTED_PAREN.keysStr);
    expect(frames.length).toBe(4);
    // La 1ʳᵉ frame doit contenir le storage avec parenthèses intact.
    expect(frames[0][3]).toBe("im12宇宙の果て01(中心無し)");
  });

  it("parse les en-têtes de props (préfixe - = discret)", () => {
    const headers = parsePropHeaders("-storage,center,vcenter,opacity,-visible");
    expect(headers).toEqual([
      { name: "storage", discrete: true },
      { name: "center", discrete: false },
      { name: "vcenter", discrete: false },
      { name: "opacity", discrete: false },
      { name: "visible", discrete: true },
    ]);
  });

  it("parse l'oracle SAMPLE_FGACT : temps absolus, carry, opacity 0..1", () => {
    const kfs = parseActionKeys(SAMPLE_FGACT.keysStr, SAMPLE_FGACT.propsStr);
    expect(kfs.length).toBe(SAMPLE_FGACT.expected.length);

    for (let i = 0; i < SAMPLE_FGACT.expected.length; i++) {
      const kf = kfs[i];
      const exp = SAMPLE_FGACT.expected[i];
      expect(kf.time).toBe(exp.time);
      expect(kf.duration).toBe(exp.duration);
      expect(kf.interp).toBe(exp.interp);
      expect(kf.storage).toBe(exp.storage);
      expect(kf.center).toBe(exp.center);
      expect(kf.vcenter).toBe(exp.vcenter);
      expect(kf.opacity).toBeCloseTo(exp.opacity, 2);
      expect(kf.visible).toBe(exp.visible);
    }
  });

  it("interprète l'interp : l=linear, n=steps, ~=warn", () => {
    const kfs = parseActionKeys(
      "(0,0,l,)(100,0,n,)(200,0,~,)",
      "opacity",
    );
    expect(kfs[0].interp).toBe("l");
    expect(kfs[0].easing).toBe("linear");
    expect(kfs[1].interp).toBe("n");
    expect(kfs[1].easing).toBe("steps");
    expect(kfs[2].interp).toBe("~");
    expect(kfs[2].easing).toBe("warn");
  });

  it("carry interp sur cellule vide", () => {
    const kfs = parseActionKeys("(0,0,n,)(100,,,)", "opacity");
    // 2e frame interp vide → carry "n"
    expect(kfs[1].interp).toBe("n");
  });

  it("gère absolute = z-index", () => {
    const kfs = parseActionKeys(
      "(0,0,n,im森絵c,512,288,1100,0,1)(1050,,l,,,,,,)",
      "-storage,center,vcenter,absolute,opacity,-visible",
    );
    expect(kfs[0].absolute).toBe(1100);
    // carry absolute sur 2e frame
    expect(kfs[1].absolute).toBe(1100);
  });

  it("gère rotate / zoomx / zoomy / effect / contrast", () => {
    const kfs = parseActionKeys(
      "(0,0,l,im12宇宙の果て01(中心無し),512,288,0,13,,,,nega,62,1)(2500,0,,,,,255,,,5,5,,,)",
      "-storage,center,vcenter,opacity,-type,rotate,zoomx,zoomy,-effect,-contrast,-visible",
    );
    expect(kfs[0].storage).toBe("im12宇宙の果て01(中心無し)");
    expect(kfs[0].type).toBe("13");
    expect(kfs[0].effect).toBe("nega");
    expect(kfs[0].contrast).toBe(62);
    // frame1 : zoomx=zoomy="5" → 0.05 ; rotate vide (carry, frame0 vide aussi).
    expect(kfs[1].rotate).toBeUndefined();
    expect(kfs[1].zoomx).toBeCloseTo(0.05, 2);
    expect(kfs[1].zoomy).toBeCloseTo(0.05, 2);
    expect(kfs[1].opacity).toBeCloseTo(1, 2);
  });

  it("parse rotate (float, degrés)", () => {
    const kfs = parseActionKeys("(0,0,l,0)(1000,0,l,45)", "rotate");
    expect(kfs[1].rotate).toBe(45);
  });

  it("preserve le storage intact sur l'échantillon nested-paren", () => {
    const kfs = parseActionKeys(SAMPLE_FGACT_NESTED_PAREN.keysStr, SAMPLE_FGACT_NESTED_PAREN.propsStr);
    expect(kfs.length).toBe(SAMPLE_FGACT_NESTED_PAREN.expectedFrameCount);
    expect(kfs[0].storage).toBe(SAMPLE_FGACT_NESTED_PAREN.expectedStorage);
    // temps absolus
    expect(kfs.map((k) => k.time)).toEqual([0, 2500, 4600, 5000]);
    // La 3e frame a des "~" dans les cellules de props (center/vcenter/etc),
    // pas dans la colonne interp : interp carry → "l".
    expect(kfs[2].interp).toBe("l");
    // Les "~" en valeur de prop déclenchent le carry : center reste 512.
    expect(kfs[2].center).toBe(512);
  });

  it("retourne [] si keys absent", () => {
    expect(parseActionKeys(undefined, "opacity")).toEqual([]);
    expect(parseActionKeys("", "opacity")).toEqual([]);
  });

  it("ignore les props inconnues sans planter", () => {
    const kfs = parseActionKeys("(0,0,l,a,b)(100,0,l,c,d)", "-unknown,center");
    expect(kfs.length).toBe(2);
    // -unknown ignoré (discret inconnu), center="b"/"d" → parseInt NaN → undefined.
    expect(kfs[0].center).toBeUndefined();
    expect(kfs[1].center).toBeUndefined();
  });
});
