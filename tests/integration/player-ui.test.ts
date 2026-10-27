/**
 * Test d'intégration UI : le player démarre le prologue réel dans jsdom.
 *
 * On importe src/main.ts après avoir mocké fetch pour qu'il trouve le manifest
 * et le scénario 1-0.ks. On vérifie ensuite que le viewport et le texte
 * s'affichent dans le DOM.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { hasAssets } from "./skip-if-no-assets.js";

const ASSETS_DIR = join(import.meta.dirname, "../../public/assets");
const MANIFEST = JSON.parse(readFileSync(join(ASSETS_DIR, "asset-manifest.json"), "utf-8"));
const SCENARIO_1_0 = readFileSync(join(ASSETS_DIR, "scenario/1-0.ks"), "utf-8");

describe.skipIf(!hasAssets)("Player UI — prologue", () => {
  beforeEach(() => {
    // Nettoie le DOM entre les tests.
    document.body.innerHTML = '<div id="app"></div>';

    // Mock fetch pour les assets locaux.
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const path = typeof url === "string" ? url : url.toString();
      if (path.endsWith("/asset-manifest.json")) {
        return new Response(JSON.stringify(MANIFEST), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (path.endsWith("/scenario/1-0.ks")) {
        return new Response(SCENARIO_1_0, { status: 200, headers: { "Content-Type": "text/plain" } });
      }
      // Images/audio : retourne 404 (jsdom ne les chargera pas de toute façon).
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
  });

  it("démarre le prologue et affiche du texte", async () => {
    // Importe main.ts qui démarre automatiquement le player.
    await import("@/main.js");

    // Attendre que le runtime produise du texte (plusieurs steps async).
    await new Promise((resolve) => setTimeout(resolve, 500));

    const viewport = document.getElementById("viewport");
    expect(viewport).toBeTruthy();

    // Le texte du prologue doit être présent dans la textbox.
    const textEl = document.getElementById("text");
    expect(textEl).toBeTruthy();
    // Le texte japonais du prologue commence par cette phrase.
    expect(textEl!.textContent).toContain("その子の影になったのは８年");
  });
});
