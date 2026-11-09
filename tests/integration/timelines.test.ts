/**
 * Test d'intégration : les timelines extraites des vrais scripts sont cohérentes avec
 * les assets convertis (chaque image et chaque piste citées existe dans le manifest).
 *
 * Nécessite les assets locaux et `timelines.json` (généré par `npm run timelines`) ;
 * sinon le test est ignoré. Aucun contenu du jeu n'est affiché.
 *
 * @vitest-environment node
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { parseTimelineData, lookupTimeline } from "@/core/timeline.js";
import type { AssetManifest } from "@/core/asset-manifest.js";
import { hasAssets, assetsDir, manifestPath } from "./skip-if-no-assets.js";

const path = hasAssets && assetsDir ? join(assetsDir, "timelines.json") : "";
const hasTimelines = path !== "" && existsSync(path);

describe.skipIf(!hasTimelines)("Timelines (vrais assets)", () => {
  const data = hasTimelines ? parseTimelineData(JSON.parse(readFileSync(path, "utf-8"))) : null;
  const manifest: AssetManifest | null = hasTimelines ? JSON.parse(readFileSync(manifestPath, "utf-8")) : null;

  it("les données sont valides et contiennent l'ouverture", () => {
    expect(data).not.toBeNull();
    const opening = lookupTimeline(data, "opening.ks", 4);
    expect(opening).not.toBeNull();
    expect(opening!.duration).toBeGreaterThan(190_000);
    expect(opening!.bg.length).toBeGreaterThan(5);
    expect(opening!.audio.some((a) => a.channel === "bgm" && a.action === "play")).toBe(true);
  });

  it("l'ouverture : plans dans l'ordre du film, sans image répétée, avec panoramiques (#135)", () => {
    const opening = lookupTimeline(data, "opening.ks", 4)!;
    const times = opening.bg.map((b) => b.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(opening.bg.map((b) => b.storage)).size).toBe(opening.bg.length);
    expect(opening.bg.every((b) => b.left !== undefined && b.top !== undefined && b.fade !== undefined)).toBe(true);
    expect((opening.moves ?? []).filter((m) => m.time > 0).length).toBeGreaterThan(5);
  });

  it("l'ouverture : calques avec fondus, triés, dont un avec pluie (#125)", () => {
    const layers = lookupTimeline(data, "opening.ks", 4)!.layers ?? [];
    expect(new Set(layers.map((l) => l.id)).size).toBeGreaterThan(10);
    expect(layers.filter((l) => l.time > 0).length).toBeGreaterThan(50);
    expect(layers.map((l) => l.at)).toEqual([...layers.map((l) => l.at)].sort((a, b) => a - b));
    expect(layers.every((l) => l.opacity >= 0 && l.opacity <= 1)).toBe(true);
    expect(layers.some((l) => l.rain)).toBe(true);
  });

  it("l'ouverture ne cite que des images et des pistes présentes dans le manifest", () => {
    const images = new Set(Object.keys(manifest!.images).map((k) => k.toLowerCase()));
    const sounds = new Set(Object.keys(manifest!.audio).map((k) => k.toLowerCase()));
    const missing = (script: string): string[] => {
      const out: string[] = [];
      for (const [id, scene] of Object.entries(data!.scripts[script] ?? {})) {
        for (const b of scene.bg) if (!images.has(b.storage.toLowerCase())) out.push(`${id} image ${b.storage}`);
        for (const l of scene.layers ?? []) if (!images.has(l.storage.toLowerCase())) out.push(`${id} calque ${l.storage}`);
        for (const a of scene.audio) if (a.storage && !sounds.has(a.storage.toLowerCase())) out.push(`${id} audio ${a.storage}`);
      }
      return out;
    };
    expect(missing("opening.ks")).toEqual([]);

    // Information : les scripts système (logo, menus) peuvent citer des pistes absentes.
    const others = Object.keys(data!.scripts).filter((s) => s !== "opening.ks").flatMap(missing);
    console.log(`Références absentes hors ouverture : ${others.length}`);
  });
});
