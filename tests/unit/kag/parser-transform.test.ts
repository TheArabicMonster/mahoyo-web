import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import type { Instruction } from "@/kag/types.js";

function first(source: string): Instruction {
  const instruction = parse(lex(source)).pages[0]?.instructions[0];
  if (!instruction) throw new Error("aucune instruction");
  return instruction;
}

/** Zoom et rotation (#164) : `zoom=`, `zoomx=`, `zoomy=`, `rotate=` sur @bg, @fg et @chgfg. */
describe("parser — zoom et rotation de @bg / @fg / @chgfg", () => {
  it("@bg zoom=… rotate=… : zoom des deux axes et rotation", () => {
    const i = first("@bg storage=fond left=853 top=198 zoom=200 rotate=6");
    expect(i).toMatchObject({ kind: "bg", storage: "fond", left: 853, top: 198, zoomx: 200, zoomy: 200, rotate: 6 });
  });

  it("zoomx / zoomy l'emportent sur zoom, un axe absent reste absent", () => {
    const both = first("@fg storage=a center=1 vcenter=2 zoom=150 zoomx=-200");
    expect(both).toMatchObject({ kind: "fg", zoomx: -200, zoomy: 150 });
    const onlyX = first("@fg storage=a center=1 vcenter=2 zoomx=80");
    expect(onlyX).toMatchObject({ kind: "fg", zoomx: 80 });
    expect((onlyX as { zoomy?: number }).zoomy).toBeUndefined();
  });

  it("rotation décimale et négative", () => {
    expect(first("@fg storage=a center=1 vcenter=2 rotate=-2.694")).toMatchObject({ kind: "fg", rotate: -2.694 });
  });

  it("sans attribut : aucun champ de zoom ni de rotation", () => {
    const i = first("@bg storage=fond") as Record<string, unknown>;
    expect("zoomx" in i || "zoomy" in i || "rotate" in i).toBe(false);
    const f = first("@fg storage=a center=1 vcenter=2") as Record<string, unknown>;
    expect("zoomx" in f || "zoomy" in f || "rotate" in f).toBe(false);
  });

  it("une valeur illisible (expression) est ignorée sans invalider le reste", () => {
    const i = first("@fg storage=a center=7 vcenter=8 zoom=&f.zoom rotate=3");
    expect(i).toMatchObject({ kind: "fg", center: 7, vcenter: 8, rotate: 3 });
    expect((i as { zoomx?: number }).zoomx).toBeUndefined();
  });

  it("@chgfg garde zoom et rotation précisés (même neutres : ils remettent à zéro)", () => {
    expect(first("@chgfg storage=b id=x zoom=100 rotate=0")).toMatchObject({ kind: "chgfg", zoomx: 100, zoomy: 100, rotate: 0 });
  });
});

describe("parser — @bgact", () => {
  it("devient une instruction bgact avec ses keyframes (left, top, zoom)", () => {
    const i = first("@bgact page=back props=-storage,left,top,zoomx,zoomy keys=(0,0,l,fond,111,-566,120,120)(40000,,,,-63,,,) storage=fond");
    expect(i.kind).toBe("bgact");
    if (i.kind !== "bgact") return;
    expect(i.page).toBe("back");
    expect(i.keyframes).toHaveLength(2);
    expect(i.keyframes[0]).toMatchObject({ time: 0, left: 111, top: -566, zoomx: 1.2, zoomy: 1.2 });
    // Cellules vides : reprise de la valeur précédente.
    expect(i.keyframes[1]).toMatchObject({ time: 40000, left: -63, top: -566, zoomx: 1.2 });
  });
});
