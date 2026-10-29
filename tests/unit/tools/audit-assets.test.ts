/**
 * Tests de la résolution des assets référencés par l'audit.
 *
 * L'audit doit résoudre une référence comme le fait le resolver du player
 * (storageKey puis recherche dans le manifest), sinon il signale à tort des
 * assets manquants.
 */
import { describe, it, expect } from "vitest";
import { collectAssets, createAssetCollection } from "../../../tools/audit-lib.js";
import type { AssetManifest } from "../../../src/core/asset-manifest.js";
import type { RenderEvent } from "../../../src/kag/events.js";

function entry(url: string) {
  return { url, source: url, kind: "image" as const };
}

const MANIFEST = {
  version: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  images: {
    "perso01(全)": entry("image/perso01(全).webp"),
    "bg01": entry("bg/bg01.webp"),
  },
  audio: {
    m01: { url: "bgm/m01.ogg", source: "bgm/m01.ogg", kind: "bgm" as const },
  },
  scenarios: {},
} as AssetManifest;

function scene(bg: string | undefined, sprites: string[]): RenderEvent {
  return {
    kind: "scene",
    scene: { bg, sprites: sprites.map((storage) => ({ storage })) },
  } as unknown as RenderEvent;
}

function play(storage: string): RenderEvent {
  return { kind: "audio", event: { kind: "play", storage } } as unknown as RenderEvent;
}

function run(events: RenderEvent[]) {
  const assets = createAssetCollection();
  collectAssets(events, MANIFEST, assets);
  return assets;
}

describe("collectAssets", () => {
  it("résout une référence à variante via son asset de base", () => {
    const assets = run([scene(undefined, ["perso01(全)|e"])]);
    expect([...assets.missing]).toEqual([]);
    expect(assets.variantRefs).toBe(1);
  });

  it("ne compte pas comme variante une référence sans suffixe", () => {
    const assets = run([scene("bg01", ["perso01(全)"])]);
    expect([...assets.missing]).toEqual([]);
    expect(assets.variantRefs).toBe(0);
  });

  it("signale l'asset de base absent, toutes variantes regroupées", () => {
    const assets = run([scene(undefined, ["absent(全)|b", "absent(全)|e", "absent(全)"])]);
    expect([...assets.missing]).toEqual(["image:absent(全)"]);
    expect(assets.variantRefs).toBe(0);
  });

  it("ignore la casse, le dossier et l'extension comme le resolver", () => {
    const assets = run([scene("BG/Bg01.TLG", [])]);
    expect([...assets.missing]).toEqual([]);
  });

  it("compte à part les références de nom vide", () => {
    const assets = run([scene(undefined, ["", "  "])]);
    expect(assets.emptyRefs).toBe(2);
    expect([...assets.missing]).toEqual([]);
  });

  it("ne signale pas les couleurs solides, qui n'ont pas de fichier", () => {
    const assets = run([scene("black", ["white"])]);
    expect([...assets.missing]).toEqual([]);
  });

  it("résout l'audio et signale l'audio absent", () => {
    const assets = run([play("m01"), play("M01.ogg"), play("absent")]);
    expect([...assets.missing]).toEqual(["audio:absent"]);
  });
});
