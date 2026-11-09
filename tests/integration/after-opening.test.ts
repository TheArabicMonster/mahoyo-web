/**
 * Test d'intégration : l'écran juste après la fin de l'ouverture (`opening.ks`), au début de
 * `1-2.ks`, avec les vrais scripts et les timelines générées.
 *
 * Ce que le joueur ne doit pas voir : des calques de la timeline restés à l'écran, un fond
 * noir à la place du fond attendu, des sprites ou un fond posés au mauvais endroit parce que
 * leur zoom (`zoom=`, `rotate=`) est ignoré.
 *
 * Nécessite les assets locaux (MAHOYO_ASSETS_DIR ou public/assets) et `timelines.json` ;
 * sinon le test est ignoré. Aucun texte du jeu n'est affiché : seulement des compteurs.
 *
 * @vitest-environment node
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import { applyStageSnapshot, reduceStage } from "@/kag/stage-state.js";
import type { RenderEvent, StageSnapshot } from "@/kag/events.js";
import { parseTimelineData } from "@/core/timeline.js";
import { listCorpus } from "../../tools/audit-lib.js";
import { hasAssets, assetsDir, scenarioDir } from "./skip-if-no-assets.js";

const timelinesPath = hasAssets && assetsDir ? join(assetsDir, "timelines.json") : "";
const hasTimelines = timelinesPath !== "" && existsSync(timelinesPath);

/** Nombre de pages de `1-2.ks` inspectées après l'ouverture. */
const PAGES = 6;

describe.skipIf(!hasTimelines)("Après l'ouverture (vrais assets)", () => {
  const timelines = hasTimelines ? parseTimelineData(JSON.parse(readFileSync(timelinesPath, "utf-8"))) : null;
  const { scriptTexts } = hasAssets ? listCorpus(scenarioDir) : { scriptTexts: new Map<string, string>() };
  const textOf = (file: string): string | undefined => {
    const exact = scriptTexts.get(file);
    if (exact !== undefined) return exact;
    const lower = file.toLowerCase();
    for (const [k, v] of scriptTexts) if (k.toLowerCase() === lower) return v;
    return undefined;
  };

  const makeRuntime = (file: string): Runtime => {
    const runtime = new Runtime(parse(lex(textOf(file)!)), file);
    runtime.timelines = timelines;
    runtime.scriptLoader = async (storage: string) => {
      const t = textOf(storage);
      return t === undefined ? null : parse(lex(t));
    };
    return runtime;
  };

  /** Calques de timeline à l'écran : posés par `timelineLayer`, retirés par `timelineLayerClear`. */
  const trackLayers = (live: Set<string>, events: readonly RenderEvent[]): void => {
    for (const e of events) {
      if (e.kind === "timelineLayer") live.add(e.layer.id);
      else if (e.kind === "timelineLayerClear") live.clear();
    }
  };

  /**
   * Joue l'ouverture comme le player (fin naturelle ou saut d'un clic donnent le même état final :
   * toutes les entrées du calendrier sont appliquées, dans l'ordre), puis les premières pages de
   * `1-2.ks`. Retourne l'état à la fin de l'ouverture et à chaque page de `1-2.ks`.
   */
  const playOpeningThenNext = async (): Promise<{
    afterOpening: { snapshot: StageSnapshot; layers: number; scheduled: number };
    pages: { snapshot: StageSnapshot; layers: number }[];
  }> => {
    const runtime = makeRuntime("opening.ks");
    const live = new Set<string>();
    let snapshot = reduceStage([]);
    let scheduled = 0;

    // Ouverture : jusqu'à la fin du script, en appliquant le calendrier de la timeline.
    for (let steps = 0; steps < 200; steps++) {
      const step = runtime.step();
      snapshot = applyStageSnapshot(snapshot, step.events);
      trackLayers(live, step.events);
      if (step.stop.kind === "timeline") {
        for (const entry of step.stop.schedule) {
          snapshot = applyStageSnapshot(snapshot, entry.events);
          trackLayers(live, entry.events);
          scheduled++;
        }
      }
      if (step.stop.kind === "end") break;
    }
    const afterOpening = { snapshot, layers: live.size, scheduled };

    // Début de 1-2.ks, comme le chaînage du player (`loadScript` sans empiler d'appel).
    expect(await runtime.loadScript("1-2.ks", undefined, false)).toBe(true);
    const pages: { snapshot: StageSnapshot; layers: number }[] = [];
    for (let steps = 0; steps < 500 && pages.length < PAGES; steps++) {
      const step = runtime.step();
      snapshot = applyStageSnapshot(snapshot, step.events);
      trackLayers(live, step.events);
      if (step.stop.kind === "click") pages.push({ snapshot, layers: live.size });
      if (step.stop.kind === "end") break;
    }
    return { afterOpening, pages };
  };

  it("à la fin de l'ouverture : plus aucun calque de timeline, un fond affiché", async () => {
    expect(textOf("opening.ks")).toBeDefined();
    const { afterOpening } = await playOpeningThenNext();
    expect(afterOpening.scheduled).toBeGreaterThan(50);
    expect(afterOpening.layers).toBe(0);
    expect(afterOpening.snapshot.scene.bg).toBeTruthy();
    expect(afterOpening.snapshot.scene.bg).not.toBe("black");
  });

  it("au début de 1-2.ks : toujours un fond (ni noir ni absent), sans calque de timeline", async () => {
    expect(textOf("1-2.ks")).toBeDefined();
    const { pages } = await playOpeningThenNext();
    expect(pages.length).toBe(PAGES);
    for (const [i, page] of pages.entries()) {
      expect(page.layers, `page ${i} : calques de timeline`).toBe(0);
      expect(page.snapshot.scene.bg, `page ${i} : fond`).toBeTruthy();
      expect(page.snapshot.scene.bg, `page ${i} : fond noir`).not.toBe("black");
    }
  });

  it("au début de 1-2.ks : les fonds et sprites zoomés ou tournés du script portent leur zoom", async () => {
    const { pages } = await playOpeningThenNext();
    const zoomedBg = pages.filter((p) => p.snapshot.scene.bgZoomX !== undefined || p.snapshot.scene.bgRotate !== undefined);
    const zoomedSprites = pages.flatMap((p) => p.snapshot.scene.sprites).filter((s) => s.zoomx !== undefined || s.rotate !== undefined);
    // Le script pose un fond zoomé et tourné et un sprite zoomé dès la page 2 : sans zoom, ils
    // s'affichaient à leur taille d'origine, à une position qui ne correspond qu'à l'image zoomée.
    expect(zoomedBg.length).toBeGreaterThan(0);
    expect(zoomedSprites.length).toBeGreaterThan(0);
    console.log(`\nAprès l'ouverture : ${pages.length} pages, ${zoomedBg.length} avec un fond zoomé/tourné, ${zoomedSprites.length} sprites zoomés/tournés`);
  });
});
