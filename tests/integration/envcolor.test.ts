/**
 * Intégration : la table des effets d'ambiance du jeu (`data/others/envcolor.ksc`) se parse.
 * Ignoré si les données du moteur ne sont pas installées (comme les autres tests d'intégration).
 * Aucune donnée du jeu n'est reproduite : seuls des compteurs et des noms d'effets sont vérifiés.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnvColor } from "@/kag/envcolor.js";
import { assetsDir, hasAssets } from "./skip-if-no-assets.js";

const envColorPath = hasAssets && assetsDir ? join(assetsDir, "data", "others", "envcolor.ksc") : "";
const hasEnvColor = envColorPath !== "" && existsSync(envColorPath);

describe.skipIf(!hasEnvColor)("envcolor.ksc (données du moteur installées)", () => {
  it("parse les effets d'ambiance, gammas et calques de couleur", () => {
    const table = parseEnvColor(new Uint8Array(readFileSync(envColorPath)));
    expect(table.size).toBeGreaterThan(70);

    const monocro = table.get("monocro");
    expect(monocro?.grayscale).toBe(true);

    const nuit = table.get("屋外深夜");
    expect(nuit).toBeDefined();
    expect(nuit!.rGamma).toBeGreaterThan(0);
    expect(nuit!.rGamma).not.toBe(1);
    expect(nuit!.blends.length).toBeGreaterThanOrEqual(1);
    for (const blend of nuit!.blends) {
      expect(blend.alpha).toBeGreaterThan(0);
      expect(blend.layerType).toBeGreaterThanOrEqual(1);
    }

    // Toutes les entrées exposent des paramètres finis et dans les bornes du moteur (floor > ceil
    // est légitime : les effets d'inversion comme `nega` encodent floor=255, ceil=0).
    for (const effect of table.values()) {
      for (const value of [effect.rGamma, effect.gGamma, effect.bGamma]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
      for (const bound of [effect.rFloor, effect.gFloor, effect.bFloor, effect.rCeil, effect.gCeil, effect.bCeil]) {
        expect(bound).toBeGreaterThanOrEqual(0);
        expect(bound).toBeLessThanOrEqual(255);
      }
    }
  });

  it("le fichier est un UTF-16LE avec BOM (format du jeu)", () => {
    const bytes = readFileSync(envColorPath);
    expect(bytes.length).toBeGreaterThan(1000);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xfe);
  });
});
