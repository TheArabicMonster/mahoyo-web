import { describe, it, expect } from "vitest";
import { partbgInnerTransform, partbgWrapperTransform, spriteTransform } from "@/renderer/transform-helpers.js";
import { compileAction } from "@/renderer/action-compiler.js";

describe("transform helpers", () => {
  it("spriteTransform produit translate(-50%, -50%) rotate(...) scale(...)", () => {
    expect(spriteTransform({ zoomx: 2, zoomy: 2, rotate: 45 })).toBe(
      "translate(-50%, -50%) rotate(45deg) scale(2, 2)",
    );
  });

  it("spriteTransform supporte l'absence de rotation", () => {
    expect(spriteTransform({ zoomx: 1, zoomy: 1 })).toBe("translate(-50%, -50%) rotate(0deg) scale(1, 1)");
  });

  it("partbgWrapperTransform centre le wrapper", () => {
    expect(partbgWrapperTransform()).toBe("translate(-50%, -50%)");
  });

  it("partbgInnerTransform utilise le signe négatif", () => {
    expect(partbgInnerTransform({ srcleft: 542, srctop: 0, srczoomx: 100, srczoomy: 100 })).toBe(
      "translate(-542px, 0px) scale(1, 1)",
    );
  });

  it("les 3 sites partbg produisent le même transform inner pour un même état", () => {
    const srcleft = 542;
    const srctop = 120;
    const srczoomx = 150;
    const srczoomy = 150;

    const expected = partbgInnerTransform({ srcleft, srctop, srczoomx, srczoomy });

    // Site 1 : renderScene via partbgInnerTransform (testé via stage-renderer.test.ts).
    // Site 2 : applyKeyframeToElement via partbgInnerTransform (testé via stage-renderer.test.ts).
    // Site 3 : compileAction via partbgInnerTransform.
    const compiled = compileAction({
      storage: "im02",
      isPartbg: true,
      keyframes: [
        { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft, srctop, srczoomx, srczoomy },
        { time: 100, duration: 100, interp: "l", easing: "linear", accel: 0, srcleft, srctop, srczoomx, srczoomy },
      ],
    });
    expect(compiled).not.toBeNull();
    const last = compiled!.keyframes.inner.find((k) => k.offset === 1);
    expect(last).toBeDefined();
    expect(last!.transform).toBe(expected);
  });
});
