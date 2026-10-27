/**
 * Test d'intégration : joue le vrai prologue Mahoyo (1-0.ks) avec le manifest.
 *
 * Ce test ne rend rien à l'écran, mais il exécute le runtime sur le script
 * réel et vérifie que toutes les références d'assets existent dans le
 * manifest généré par le pipeline.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { AssetManifest } from "@/core/asset-manifest.js";
import type { RenderEvent } from "@/kag/events.js";

const ASSETS_DIR = join(import.meta.dirname, "../../public/assets");
const MANIFEST_PATH = join(ASSETS_DIR, "asset-manifest.json");
const SCENARIO_PATH = join(ASSETS_DIR, "scenario/1-0.ks");

describe("Prologue 1-0.ks", () => {
  it("se charge et ses assets sont résolubles", () => {
    const manifest: AssetManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    const resolver = createAssetResolver({ baseUrl: "/assets", manifest });

    const text = readFileSync(SCENARIO_PATH, "utf-8");
    const script = parse(lex(text));
    expect(script.pages.length).toBeGreaterThan(0);

    const runtime = new Runtime(script, "1-0.ks");
    runtime.scriptLoader = async (storage) => {
      // Les scripts appelés par le prologue sont dans le manifest.
      const url = resolver.scenario(storage);
      if (!url) return null;
      const res = await fetch(url);
      if (!res.ok) return null;
      return parse(lex(await res.text()));
    };

    const warnings: string[] = [];
    runtime.onWarning = (msg: string) => warnings.push(msg);

    const missingAssets = new Set<string>();
    const errors: string[] = [];
    let steps = 0;

    while (steps < 5000) {
      try {
        const step = runtime.step();
        steps++;
        collectAssets(step.events, manifest, missingAssets);
        if (step.stop.kind === "end") break;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        break;
      }
    }

    // Pas d'erreur fatale.
    expect(errors).toEqual([]);

    // Pas d'asset manquant dans le manifest.
    expect(Array.from(missingAssets)).toEqual([]);

    // Le prologue fait au moins quelques pas.
    expect(steps).toBeGreaterThan(10);

    // Seul warning attendu : timeline_object non défini (TLA animé non essentiel)
    const unexpectedWarnings = warnings.filter((w) => !w.includes("timeline_object"));
    expect(unexpectedWarnings).toEqual([]);
  });
});

function collectAssets(
  events: readonly RenderEvent[],
  manifest: AssetManifest,
  missing: Set<string>,
): void {
  for (const ev of events) {
    if (ev.kind === "scene") {
      if (ev.scene.bg) checkImage(ev.scene.bg, manifest, missing);
      for (const sprite of ev.scene.sprites) {
        checkImage(sprite.storage, manifest, missing);
      }
    } else if (ev.kind === "audio") {
      const e = ev.event;
      if (e.kind === "play" && e.storage) {
        checkAudio(e.storage, manifest, missing);
      }
    }
  }
}

function checkImage(storage: string, manifest: AssetManifest, missing: Set<string>): void {
  if (!manifest.images[storage]) {
    missing.add(`image:${storage}`);
  }
}

function checkAudio(storage: string, manifest: AssetManifest, missing: Set<string>): void {
  if (!manifest.audio[storage]) {
    missing.add(`audio:${storage}`);
  }
}
