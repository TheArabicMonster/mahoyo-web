/**
 * HUD-03 (#189) : résolveur d'images d'interface avec repli.
 * Manifeste factice : les clés et les noms de fichiers ci-dessous sont inventés.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetManifest } from "@/core/asset-manifest.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import {
  createUiAssets,
  UI_ASSET_KEYS,
  UI_ASSET_VAR_PREFIX,
  uiAssetVarName,
} from "@/ui/ui-assets.js";

const entry = (url: string) => ({ url, source: url, kind: "image" as const });

const manifest: AssetManifest = {
  version: 1,
  generatedAt: "2026-01-01T00:00:00Z",
  images: {
    c_background: entry("image/fond-test.webp"),
    "c_titleバー": entry("image/barre-test.webp"),
    "cadre test (a)": entry('image/dossier "x"/cadre.webp'),
  },
  audio: {},
  scenarios: {},
};

const makeAssets = (m: AssetManifest | null = manifest) =>
  createUiAssets(createAssetResolver({ baseUrl: "/assets", manifest: m ?? undefined }));

afterEach(() => vi.unstubAllGlobals());

describe("uiAsset", () => {
  it("clé présente : URL complète issue du manifeste", () => {
    expect(makeAssets().uiAsset("c_background")).toBe("/assets/image/fond-test.webp");
  });

  it("clé absente : null", () => {
    expect(makeAssets().uiAsset("inconnue")).toBeNull();
  });

  it("recherche tolérante : casse, pleine chasse, extension", () => {
    const assets = makeAssets();
    expect(assets.uiAsset("C_Background")).toBe("/assets/image/fond-test.webp");
    expect(assets.uiAsset("ｃ_background.png")).toBe("/assets/image/fond-test.webp");
    expect(assets.uiAsset("c_titleバー")).toBe("/assets/image/barre-test.webp");
  });

  it("clé vide, sans manifeste ou sans source : null", () => {
    expect(makeAssets().uiAsset("  ")).toBeNull();
    expect(makeAssets(null).uiAsset("c_background")).toBeNull();
    expect(createUiAssets(undefined).uiAsset("c_background")).toBeNull();
  });

  it("n'avertit pas pour une clé absente (l'absence est normale)", () => {
    const onMissing = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const assets = createUiAssets(createAssetResolver({ manifest, onMissing }));
    assets.uiAsset("inconnue");
    assets.apply(document.createElement("div"), ["inconnue"]);
    expect(onMissing).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("apply : variables --mh-asset-*", () => {
  it("pose la variable des clés présentes, et seulement celles-là", () => {
    const root = document.createElement("div");
    const set = makeAssets().apply(root, ["c_background", "inconnue", "c_titleバー"]);
    expect(set).toEqual(["--mh-asset-c_background", "--mh-asset-c_titleバー"]);
    expect(root.style.getPropertyValue("--mh-asset-c_background")).toBe('url("/assets/image/fond-test.webp")');
    expect(root.style.getPropertyValue("--mh-asset-c_titleバー")).toBe('url("/assets/image/barre-test.webp")');
    expect(root.style.getPropertyValue("--mh-asset-inconnue")).toBe("");
    expect(root.getAttribute("style")).not.toContain("inconnue");
  });

  it("manifeste vide ou absent : aucune variable posée", () => {
    for (const m of [null, { ...manifest, images: {} }]) {
      const root = document.createElement("div");
      expect(makeAssets(m).apply(root)).toEqual([]);
      expect(root.getAttribute("style") ?? "").toBe("");
    }
  });

  it("par défaut, parcourt UI_ASSET_KEYS", () => {
    const root = document.createElement("div");
    expect(makeAssets().apply(root)).toEqual(["--mh-asset-c_background", "--mh-asset-c_titleバー"]);
  });

  it("encode l'URL (espaces, guillemets, parenthèses) et la met entre guillemets", () => {
    const root = document.createElement("div");
    makeAssets().apply(root, ["cadre test (a)"]);
    expect(root.style.getPropertyValue("--mh-asset-cadre-test-a")).toBe('url("/assets/image/dossier%20%22x%22/cadre.webp")');
  });

  it("un second appel retire les variables devenues absentes, sans toucher au reste", () => {
    const root = document.createElement("div");
    root.style.setProperty("--mh-ink", "#123456");
    const assets = makeAssets();
    assets.apply(root, ["c_background", "c_titleバー"]);
    assets.apply(root, ["c_background"]);
    expect(root.style.getPropertyValue("--mh-asset-c_titleバー")).toBe("");
    expect(root.style.getPropertyValue("--mh-asset-c_background")).not.toBe("");
    assets.clear(root);
    expect(root.style.getPropertyValue("--mh-asset-c_background")).toBe("");
    expect(root.style.getPropertyValue("--mh-ink")).toBe("#123456");
  });

  it("aucune requête réseau quand une clé manque, ni à la résolution ni à la pose", () => {
    const fetchSpy = vi.fn();
    const imageSpy = vi.fn();
    const xhrSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("Image", imageSpy);
    vi.stubGlobal("XMLHttpRequest", xhrSpy);
    const root = document.createElement("div");
    const assets = makeAssets({ ...manifest, images: {} });
    assets.uiAsset("c_background");
    assets.apply(root);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(imageSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(root.querySelector("img")).toBeNull();
  });
});

describe("uiAssetVarName", () => {
  it("replie la clé en identifiant CSS, lettres japonaises conservées", () => {
    expect(uiAssetVarName("C_Background")).toBe(`${UI_ASSET_VAR_PREFIX}c_background`);
    expect(uiAssetVarName("c_titleバー")).toBe("--mh-asset-c_titleバー");
    expect(uiAssetVarName("cadre test (a)")).toBe("--mh-asset-cadre-test-a");
    expect(uiAssetVarName("ＡＢ")).toBe("--mh-asset-ab");
  });

  it("clé vide ou sans caractère exploitable : null", () => {
    expect(uiAssetVarName("")).toBeNull();
    expect(uiAssetVarName(" ()")).toBeNull();
  });
});

describe("UI_ASSET_KEYS", () => {
  const design = readFileSync(resolve(__dirname, "../../../docs/DESIGN.md"), "utf8");

  it("ne contient que des clés documentées dans DESIGN.md §5, sans doublon", () => {
    expect(new Set(UI_ASSET_KEYS).size).toBe(UI_ASSET_KEYS.length);
    for (const key of UI_ASSET_KEYS) expect(design, key).toContain(key);
  });

  it("ne contient aucune extension ni aucun chemin (clés seules)", () => {
    for (const key of UI_ASSET_KEYS) expect(key).not.toMatch(/[./\\]|^https?:/);
  });
});
