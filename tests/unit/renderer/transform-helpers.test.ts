import { describe, it, expect } from "vitest";
import { partbgInnerTransform, partbgWrapperTransform, spriteTransform } from "@/renderer/transform-helpers.js";

describe("transform helpers", () => {
  it("spriteTransform produit translate(-50%, -50%) rotate(...) scale(...)", () => {
    expect(spriteTransform({ zoomx: 2, zoomy: 2, rotate: 45 })).toBe(
      "translate(-50%, -50%) rotate(45deg) scale(2, 2)",
    );
  });

  it("spriteTransform supporte l'absence de rotation", () => {
    expect(spriteTransform({ zoomx: 1, zoomy: 1 })).toBe("translate(-50%, -50%) scale(1, 1)");
  });

  it("partbgWrapperTransform centre le wrapper", () => {
    expect(partbgWrapperTransform()).toBe("translate(-50%, -50%)");
  });

  it("partbgInnerTransform utilise le signe négatif", () => {
    expect(partbgInnerTransform({ srcleft: 542, srctop: 0, srczoomx: 100, srczoomy: 100 })).toBe(
      "translate(-542px, 0px) scale(1, 1)",
    );
  });
});
