/**
 * Parser de la table des effets d'ambiance `envcolor.ksc` (#260).
 *
 * Le format est celui des données du jeu (TJS, flottants hexadécimaux, `void`) ; le test
 * n'embarque aucune donnée du jeu, seulement un échantillon synthétique équivalent.
 */
import { describe, it, expect } from "vitest";
import { decodeKscText, parseEnvColor, parseTjsNumber } from "@/kag/envcolor.js";

/** Encode une chaîne en UTF-16LE avec BOM, comme `envcolor.ksc`. */
function utf16File(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[2 + i * 2] = code & 0xff;
    out[3 + i * 2] = code >> 8;
  }
  return out;
}

const SAMPLE = `(const) %[
 "monocro" => (const) [
  void, void, void, void, void, void, void, void, void, 1
 ],
 "nuit" => (const) [
  0x1.7AE147AE147AEp-1 /* 0.74 */, void, void,
  0x1.999999999999Ap-1 /* 0.8 */, void, void,
  0x1.0000000000000p0 /* 1 */, void, void, 0,
  22, 75, 90, 31, 2, 42, 33, 68, 31, 5
 ]
]`;

describe("parseTjsNumber", () => {
  it("gère void, entiers, décimaux et flottants hexadécimaux TJS", () => {
    expect(parseTjsNumber("void")).toBeUndefined();
    expect(parseTjsNumber("226")).toBe(226);
    expect(parseTjsNumber("+0.0")).toBe(0);
    expect(parseTjsNumber("0x1.7AE147AE147AEp-1")).toBeCloseTo(0.74, 6);
    expect(parseTjsNumber("0x1.0000000000000p0")).toBeCloseTo(1, 6);
    expect(parseTjsNumber("0x1.DC28F5C28F5C3p-1")).toBeCloseTo(0.93, 6);
    expect(parseTjsNumber("0x1.0F5C28F5C28F6p0")).toBeCloseTo(1.06, 6);
    expect(parseTjsNumber("/* commentaire */ 48")).toBe(48);
    expect(parseTjsNumber("pas-un-nombre")).toBeUndefined();
  });
});

describe("decodeKscText", () => {
  it("décode UTF-16LE avec BOM et UTF-8 sans BOM", () => {
    expect(decodeKscText(utf16File("屋外深夜"))).toBe("屋外深夜");
    expect(decodeKscText(new TextEncoder().encode("abc"))).toBe("abc");
    expect(decodeKscText("\uFEFFabc")).toBe("abc");
  });
});

describe("parseEnvColor", () => {
  const table = parseEnvColor(utf16File(SAMPLE));

  it("lit chaque entrée et applique les défauts du moteur (gamma 1, floor 0, ceil 255)", () => {
    expect([...table.keys()]).toEqual(["monocro", "nuit"]);
    expect(table.get("monocro")).toMatchObject({ grayscale: true, blends: [] });
    const monocro = table.get("monocro")!;
    expect([monocro.rGamma, monocro.rFloor, monocro.rCeil]).toEqual([1, 0, 255]);
    expect([monocro.gGamma, monocro.bGamma]).toEqual([1, 1]);
  });

  it("lit le gamma par canal et les calques de couleur translucides (groupes de 5)", () => {
    const nuit = table.get("nuit")!;
    expect(nuit.rGamma).toBeCloseTo(0.74, 6);
    expect(nuit.gGamma).toBeCloseTo(0.8, 6);
    expect(nuit.bGamma).toBeCloseTo(1, 6);
    expect(nuit.grayscale).toBe(false);
    expect(nuit.blends).toEqual([
      { r: 22, g: 75, b: 90, alpha: 31, layerType: 2 },
      { r: 42, g: 33, b: 68, alpha: 31, layerType: 5 },
    ]);
  });

  it("ignore les calques d'opacité nulle et les entrées malformées", () => {
    const partial = parseEnvColor(utf16File(`(const) %[\n "x" => (const) [ void, void, void, void, void, void, void, void, void, 0, 10, 20, 30, 0, 2 ]\n]`));
    expect(partial.get("x")?.blends).toEqual([]);
    expect(parseEnvColor("n'importe quoi")).toEqual(new Map());
  });
});
