/**
 * Intégration : trace visuelle du vrai prologue (`tools/trace-visual.ts`).
 *
 * Vérifie que l'outil de diagnostic #249 rejoue `1-0.ks` avec les assets locaux,
 * retrouve les lignes source, résout les storages et ne signale aucun asset
 * manquant. Ignoré quand les vrais assets ne sont pas installés (comme les autres
 * tests d'intégration). Aucun texte du jeu n'est lu ni affiché.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { runTrace } from "../../tools/trace-visual.js";
import { assetsDir, hasAssets, scenarioDir } from "./skip-if-no-assets.js";

describe.skipIf(!hasAssets)("Trace visuelle (assets réels)", () => {
  it("rejoue 1-0.ks : lignes, pages fore/back, assets résolus, aucune image manquante", async () => {
    const { report, steps } = await runTrace(join(scenarioDir, "1-0.ks"), assetsDir!, 20_000);

    // Le prologue a des points d'arrêt (texte) et des commandes visuelles.
    expect(report.steps).toBeGreaterThan(50);
    expect(steps.at(-1)?.stop).toBe("end");
    expect(report.samples.length).toBeGreaterThan(100);

    // La ligne source est retrouvée pour l'écrasante majorité des commandes tracées.
    const withLine = report.samples.filter((sample) => sample.line !== null).length;
    expect(withLine / report.samples.length).toBeGreaterThan(0.9);
    expect(report.samples.some((sample) => sample.line === 5)).toBe(true);

    // Tous les assets cités sont résolus et présents (le prologue n'a pas d'image absente).
    expect(report.missingImages).toEqual([]);

    // Les deux pages sont tracées, comme la première commande `@partbg` du prologue (l.5).
    const partbg = report.samples.find((sample) => sample.line === 5)!;
    expect(partbg.command).toBe("@partbg");
    expect(partbg.page).toBe("back");
    expect(partbg.storage.url).toContain("im02");
    expect(report.samples.some((sample) => sample.page === "fore")).toBe(true);

    // Le crop du partbg est décrit (rect déclaré + dimensions de l'image).
    expect(partbg.crops.length).toBeGreaterThan(0);
    expect(partbg.crops.join(" ")).toContain("rect déclaré");
  });
});
