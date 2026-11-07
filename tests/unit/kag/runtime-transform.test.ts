import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RenderEvent, SceneState } from "@/kag/events.js";

/** Joue la première page du script et retourne la dernière scène émise. */
function lastScene(source: string): SceneState {
  const runtime = new Runtime(parse(lex(source)));
  const step = runtime.step();
  const scenes = step.events.filter((e): e is Extract<RenderEvent, { kind: "scene" }> => e.kind === "scene");
  const scene = scenes[scenes.length - 1];
  if (!scene) throw new Error("aucune scène émise");
  return scene.scene;
}

/** Zoom et rotation des fonds et des calques : l'état de scène les porte jusqu'au renderer. */
describe("Runtime — zoom et rotation de @bg / @fg / @chgfg", () => {
  it("@bg zoom/rotate sur back puis @trans : la scène porte zoom, rotation et position", () => {
    const scene = lastScene(`
@bg storage=fond left=853 top=198 zoom=200 rotate=6
@trans time=0 nowait=1
texte inventé
`);
    expect(scene.bg).toBe("fond");
    expect(scene).toMatchObject({ bgLeft: 853, bgTop: 198, bgZoomX: 200, bgZoomY: 200, bgRotate: 6 });
  });

  it("@bg avec transition implicite (time + rule) garde le zoom", () => {
    const scene = lastScene(`
@bg time=600 rule=crossfade storage=fond left=-48 top=-48 zoom=120
texte inventé
`);
    expect(scene).toMatchObject({ bg: "fond", bgZoomX: 120, bgZoomY: 120 });
    expect(scene.bgRotate).toBeUndefined();
  });

  it("un @bg sans zoom remet le fond à la taille d'origine (le zoom ne persiste pas)", () => {
    const scene = lastScene(`
@bg storage=un zoom=150 rotate=3
@trans time=0 nowait=1
@bg storage=deux
@trans time=0 nowait=1
texte inventé
`);
    expect(scene.bg).toBe("deux");
    expect(scene.bgZoomX).toBeUndefined();
    expect(scene.bgZoomY).toBeUndefined();
    expect(scene.bgRotate).toBeUndefined();
  });

  it("zoom=100 rotate=0 (neutres) n'écrivent rien dans la scène", () => {
    const scene = lastScene(`
@bg storage=fond zoom=100 rotate=0
@trans time=0 nowait=1
texte inventé
`);
    expect("bgZoomX" in scene || "bgZoomY" in scene || "bgRotate" in scene).toBe(false);
  });

  it("@fg zoom/zoomx/zoomy/rotate : le sprite porte ses valeurs, un sprite neutre n'en porte pas", () => {
    const scene = lastScene(`
@bg storage=fond
@fg storage=grand center=429 vcenter=86 zoom=200 index=1000
@fg storage=miroir center=100 vcenter=100 zoomx=-100 zoomy=80 rotate=-2.5 index=1100
@fg storage=simple center=10 vcenter=20 index=1200
@trans time=0 nowait=1
texte inventé
`);
    const byId = Object.fromEntries(scene.sprites.map((s) => [s.id, s]));
    expect(byId.grand).toMatchObject({ x: 429, y: 86, zoomx: 200, zoomy: 200 });
    expect(byId.grand?.rotate).toBeUndefined();
    expect(byId.miroir).toMatchObject({ zoomx: -100, zoomy: 80, rotate: -2.5 });
    const simple = byId.simple as Record<string, unknown>;
    expect("zoomx" in simple || "zoomy" in simple || "rotate" in simple).toBe(false);
  });

  it("@chgfg change l'image en gardant le zoom, sauf si la commande en précise un", () => {
    const scene = lastScene(`
@bg storage=fond
@fg storage=a id=x center=1 vcenter=2 zoom=160 rotate=5
@chgfg storage=b id=x
@fg storage=c id=y center=1 vcenter=2 zoom=160 rotate=5
@chgfg storage=d id=y zoom=100 rotate=0
@trans time=0 nowait=1
texte inventé
`);
    const byId = Object.fromEntries(scene.sprites.map((s) => [s.id, s]));
    expect(byId.x).toMatchObject({ storage: "b", zoomx: 160, zoomy: 160, rotate: 5 });
    expect(byId.y?.storage).toBe("d");
    const reset = byId.y as Record<string, unknown>;
    expect("zoomx" in reset || "zoomy" in reset || "rotate" in reset).toBe(false);
  });

  it("@backlay recopie le zoom du fond de fore vers back", () => {
    const scene = lastScene(`
@bg storage=fond left=10 top=20 zoom=130 rotate=4
@trans time=0 nowait=1
@backlay
@fg storage=a center=1 vcenter=2
@trans time=0 nowait=1
texte inventé
`);
    expect(scene).toMatchObject({ bg: "fond", bgLeft: 10, bgTop: 20, bgZoomX: 130, bgRotate: 4 });
  });
});

/** `@bgact` ne doit plus réinitialiser le fond ni ses calques (il était lu comme un `@bg` sans position). */
describe("Runtime — @bgact", () => {
  const BGACT = "@bgact page=back props=-storage,left,top,zoomx,zoomy keys=(0,0,l,fond,111,-566,120,120)(40000,,,,-63,,,) storage=fond";

  it("garde le fond, ses calques, sa position et son zoom", () => {
    const scene = lastScene(`
@bg storage=fond left=111 top=-566 zoom=120
@fg storage=sprite center=429 vcenter=86 zoom=200
${BGACT}
@trans time=0 nowait=1
texte inventé
`);
    expect(scene).toMatchObject({ bg: "fond", bgLeft: 111, bgTop: -566, bgZoomX: 120, bgZoomY: 120 });
    expect(scene.sprites.map((s) => s.id)).toEqual(["sprite"]);
    expect(scene.sprites[0]).toMatchObject({ zoomx: 200, zoomy: 200 });
  });

  it("pose l'état de départ (première keyframe) quand le @bg ne précisait rien", () => {
    const scene = lastScene(`
@bg storage=fond
${BGACT}
@trans time=0 nowait=1
texte inventé
`);
    expect(scene).toMatchObject({ bg: "fond", bgLeft: 111, bgTop: -566, bgZoomX: 120, bgZoomY: 120 });
  });

  it("sur fore : émet une scène sans transition ; sur back : aucun événement", () => {
    const runtime = new Runtime(parse(lex(`
@bg storage=fond time=0 page=fore
@bgact page=fore props=-storage,left,top keys=(0,0,l,fond,5,6)(1000,,,,9,9) storage=fond
texte inventé
`)));
    const scenes = runtime.step().events.filter((e): e is Extract<RenderEvent, { kind: "scene" }> => e.kind === "scene");
    const last = scenes[scenes.length - 1]!;
    expect(last.scene).toMatchObject({ bg: "fond", bgLeft: 5, bgTop: 6 });
    expect(last.transition).toEqual({ method: "none" });
  });
});

/** Animation de sprite (@fgact) : l'état final porte le zoom de la dernière keyframe. */
describe("Runtime — @fgact et zoom", () => {
  it("garde le zoom du calque quand les keyframes n'en précisent pas", () => {
    const scene = lastScene(`
@bg storage=fond
@fg storage=sprite center=100 vcenter=100 zoom=140
@fgact page=back props=center,vcenter keys=(0,0,l,100,100)(1000,,,300,100) storage=sprite
@trans time=0 nowait=1
texte inventé
`);
    expect(scene.sprites[0]).toMatchObject({ x: 300, zoomx: 140, zoomy: 140 });
  });

  it("prend le zoom de la dernière keyframe", () => {
    const scene = lastScene(`
@bg storage=fond
@fg storage=sprite center=100 vcenter=100 zoom=140
@fgact page=back props=center,vcenter,zoomx,zoomy keys=(0,0,l,100,100,140,140)(1000,,,100,100,200,200) storage=sprite
@trans time=0 nowait=1
texte inventé
`);
    expect(scene.sprites[0]).toMatchObject({ zoomx: 200, zoomy: 200 });
  });
});
