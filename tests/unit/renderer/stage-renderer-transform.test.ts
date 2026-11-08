import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDomStageRenderer } from "@/renderer/stage-renderer.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { SceneState, SpriteState, TransitionSpec } from "@/kag/events.js";

/** Zoom et rotation d'un fond et d'un sprite posés par `@bg` / `@fg`. */
describe("DomStageRenderer — zoom et rotation des fonds et des sprites", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer>;
  const sig = () => new AbortController().signal;
  const bgEl = () => root.querySelector("#stage-bg") as HTMLElement;
  const bgImg = () => root.querySelector("#stage-bg > .mh-stage-bg-img") as HTMLImageElement | null;

  const show = (scene: Partial<SceneState> & { bg: string | null }, instant = true, transition: TransitionSpec = { method: "none" }) =>
    renderer.apply([{ kind: "scene", scene: { sprites: [], effect: null, ...scene }, transition }], { instant, signal: sig() });

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    renderer = createDomStageRenderer({ resolver: createAssetResolver() });
    renderer.mount(root);
  });

  afterEach(() => {
    renderer.dispose();
    root.remove();
    vi.restoreAllMocks();
  });

  describe("fond", () => {
    it("zoomé : <img> à la taille d'origine, posé en (left, top), pivot au centre", async () => {
      await show({ bg: "fond", bgLeft: 853, bgTop: 198, bgZoomX: 200, bgZoomY: 200, bgRotate: 6 });
      const img = bgImg();
      expect(img).not.toBeNull();
      expect(img!.src).toContain("fond");
      expect(img!.style.left).toBe("853px");
      expect(img!.style.top).toBe("198px");
      expect(img!.style.transform).toBe("rotate(6deg) scale(2, 2)");
      expect(img!.style.transformOrigin).toBe("50% 50%");
      // Plus de background-image : il serait rogné aux 1024×576 de la boîte du fond.
      expect(bgEl().style.backgroundImage).toBe("none");
      expect(bgEl().style.backgroundColor).not.toBe("rgb(0, 0, 0)");
    });

    it("zoomé sans position : centré sur l'écran", async () => {
      await show({ bg: "fond", bgZoomX: 120, bgZoomY: 120 });
      const img = bgImg()!;
      expect(img.style.left).toBe("50%");
      expect(img.style.top).toBe("50%");
      expect(img.style.transform).toBe("translate(-50%, -50%) rotate(0deg) scale(1.2, 1.2)");
    });

    it("miroir : un zoom négatif devient une échelle négative", async () => {
      await show({ bg: "fond", bgLeft: 0, bgTop: 0, bgZoomX: -100 });
      expect(bgImg()!.style.transform).toBe("rotate(0deg) scale(-1, 1)");
    });

    it("sans zoom ni rotation : background-image classique, aucun <img>", async () => {
      await show({ bg: "fond", bgLeft: -48, bgTop: -48 });
      expect(bgImg()).toBeNull();
      expect(bgEl().style.backgroundImage).toContain("fond");
      expect(bgEl().style.backgroundPosition).toBe("-48px -48px");
    });

    it("un fond ordinaire après un fond zoomé retire l'<img>", async () => {
      await show({ bg: "un", bgLeft: 0, bgTop: 0, bgZoomX: 200, bgZoomY: 200 });
      expect(bgImg()).not.toBeNull();
      await show({ bg: "deux", bgLeft: -48, bgTop: -48 });
      expect(bgImg()).toBeNull();
      expect(bgEl().style.backgroundImage).toContain("deux");
      expect(bgEl().children.length).toBe(0);
    });

    it("fond effacé (null) : plus d'<img>, fond noir", async () => {
      await show({ bg: "un", bgZoomX: 200, bgZoomY: 200 });
      await show({ bg: null });
      expect(bgImg()).toBeNull();
      expect(bgEl().style.backgroundImage).toBe("none");
    });

    it("fondu enchaîné depuis un fond zoomé : l'ancienne image passe dans l'overlay", async () => {
      await show({ bg: "un", bgLeft: 10, bgTop: 20, bgZoomX: 200, bgZoomY: 200 });
      const old = bgImg()!;
      await show({ bg: "deux", bgLeft: -48, bgTop: -48 }, false, { method: "crossfade", time: 1000 });
      const overlay = root.querySelector(".mh-stage-bg-overlay") as HTMLElement;
      expect(overlay).not.toBeNull();
      // L'<img> de l'ancien fond est celui de l'overlay, avec son zoom ; le nouveau fond n'en a pas.
      expect(overlay.contains(old)).toBe(true);
      expect(old.style.transform).toBe("rotate(0deg) scale(2, 2)");
      expect(overlay.style.backgroundImage).toBe("none");
      expect(bgImg()).toBeNull();
      expect(bgEl().style.backgroundImage).toContain("deux");
      renderer.hurry();
      expect(root.querySelector(".mh-stage-bg-overlay")).toBeNull();
    });

    it("fondu enchaîné vers un fond zoomé : l'overlay garde l'ancien fond ordinaire", async () => {
      await show({ bg: "un", bgLeft: -48, bgTop: -48 });
      await show({ bg: "deux", bgLeft: 5, bgTop: 6, bgZoomX: 150, bgZoomY: 150 }, false, { method: "crossfade", time: 1000 });
      const overlay = root.querySelector(".mh-stage-bg-overlay") as HTMLElement;
      expect(overlay.style.backgroundImage).toContain("un");
      expect(overlay.querySelector("img")).toBeNull();
      expect(bgImg()!.style.transform).toBe("rotate(0deg) scale(1.5, 1.5)");
    });
  });

  describe("partbg zoomé (#169)", () => {
    const partbg = (crop: { srcLeft: number; srcTop: number; srcZoomX: number; srcZoomY: number }): SpriteState => ({
      id: "pb",
      storage: "fond-haut",
      x: 626,
      y: 288,
      z: 1000,
      opacity: 1,
      crop: { width: 775, height: 576, ...crop },
    });
    const inner = () => root.querySelector(".mh-stage-partbg-img") as HTMLImageElement;

    it("l'image est zoomée autour de son propre centre, pas de son coin haut gauche", async () => {
      await show({ bg: "noir", sprites: [partbg({ srcLeft: -150, srcTop: -174, srcZoomX: 140, srcZoomY: 140 })] });
      expect(inner().style.transform).toBe("translate(150px, 174px) scale(1.4, 1.4)");
      expect(inner().style.transformOrigin).toBe("50% 50%");
    });

    it("avec ce pivot, une image 775×1050 zoomée à 140 % couvre la fenêtre 775×576 (plus de bande noire)", () => {
      // Image posée à sa taille d'origine en (-srcleft, -srctop), puis zoomée autour de son centre.
      const [W, H, z, srcLeft, srcTop, w, h] = [775, 1050, 1.4, -150, -174, 775, 576];
      const left = -srcLeft + (W * (1 - z)) / 2;
      const top = -srcTop + (H * (1 - z)) / 2;
      expect(left).toBeLessThanOrEqual(0);
      expect(top).toBeLessThanOrEqual(0);
      expect(left + W * z).toBeGreaterThanOrEqual(w);
      expect(top + H * z).toBeGreaterThanOrEqual(h);
    });

    it("sans zoom, le pivot ne change rien : l'image reste décalée de (-srcleft, -srctop)", async () => {
      await show({ bg: "noir", sprites: [partbg({ srcLeft: 42, srcTop: 127, srcZoomX: 100, srcZoomY: 100 })] });
      expect(inner().style.transform).toBe("translate(-42px, -127px) scale(1, 1)");
      expect(inner().style.transformOrigin).toBe("50% 50%");
    });
  });

  describe("sprites", () => {
    const sprite =(extra: Partial<SpriteState> = {}): SpriteState => ({ id: "s", storage: "sprite", x: 429, y: 86, z: 1000, opacity: 1, ...extra });
    const spriteEl = () => root.querySelector(".mh-stage-sprite") as HTMLImageElement;

    it("zoom et rotation : transform centré (translate, rotate, scale)", async () => {
      await show({ bg: "fond", sprites: [sprite({ zoomx: 200, zoomy: 200, rotate: 3 })] });
      expect(spriteEl().style.transform).toBe("translate(-50%, -50%) rotate(3deg) scale(2, 2)");
      expect(spriteEl().style.left).toBe("429px");
      expect(spriteEl().style.top).toBe("86px");
    });

    it("zoom d'un seul axe : l'autre reste à 100 %", async () => {
      await show({ bg: "fond", sprites: [sprite({ zoomx: -150 })] });
      expect(spriteEl().style.transform).toBe("translate(-50%, -50%) rotate(0deg) scale(-1.5, 1)");
    });

    it("ancrage (#171) : le zoom pivote autour du centre posé par left/top, jamais autour du bas ni du coin", async () => {
      // Valeurs inventées : un sprite zoomé à 140 % et un non zoomé au même centre.
      await show({ bg: "fond", sprites: [sprite({ id: "z", x: 601, y: 205, zoomx: 140, zoomy: 140 }), sprite({ id: "n", x: 601, y: 205 })] });
      const zoomed = root.querySelector<HTMLElement>('[data-sprite-id="z"]')!;
      const plain = root.querySelector<HTMLElement>('[data-sprite-id="n"]')!;
      for (const el of [zoomed, plain]) {
        expect(el.style.left).toBe("601px");
        expect(el.style.top).toBe("205px");
        expect(el.style.transformOrigin).toBe("");
      }
      // translate(-50%, -50%) est la première fonction : le centre de l'image reste en (left, top).
      expect(zoomed.style.transform.startsWith("translate(-50%, -50%) ")).toBe(true);
      expect(plain.style.transform).toBe("");
    });

    it("sprite neutre : aucun transform en ligne (le CSS de la classe centre déjà)", async () => {
      await show({ bg: "fond", sprites: [sprite()] });
      expect(spriteEl().style.transform).toBe("");
    });

    it("le zoom disparaît quand le sprite redevient neutre", async () => {
      await show({ bg: "fond", sprites: [sprite({ zoomx: 200, zoomy: 200 })] });
      expect(spriteEl().style.transform).not.toBe("");
      await show({ bg: "fond", sprites: [sprite()] });
      expect(spriteEl().style.transform).toBe("");
    });
  });
});
