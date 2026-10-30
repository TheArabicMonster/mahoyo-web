import "./main.css";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { AssetResolver } from "@/core/asset-resolver.js";
import { createDomStageRenderer } from "./renderer/stage-renderer.js";
import { DomUIManager } from "./ui/ui-manager.js";
import { Player } from "./ui/player.js";
import type { AssetManifest } from "@/core/asset-manifest.js";
import { parseStoryChain, type StoryChain } from "@/core/story-chain.js";
import { chaptersToScripts } from "./ui/chapter-list.js";

const ASSET_BASE = "/assets";
const MANIFEST_URL = `${ASSET_BASE}/asset-manifest.json`;

/** Charge le manifest d'assets généré par le pipeline. */
async function loadManifest(): Promise<AssetManifest | undefined> {
  try {
    const res = await fetch(MANIFEST_URL);
    if (!res.ok) {
      console.warn(`[main] Manifest non trouvé (${res.status}), fallback sur les conventions.`);
      return undefined;
    }
    return (await res.json()) as AssetManifest;
  } catch (err) {
    console.warn("[main] Impossible de charger le manifest:", err);
    return undefined;
  }
}

/** Charge la table d'enchaînement générée par `npm run chain` (absente : le jeu se limite au prologue). */
async function loadChain(resolver: AssetResolver): Promise<StoryChain | null> {
  try {
    const res = await fetch(resolver.chain());
    if (!res.ok) return null;
    return parseStoryChain(await res.json());
  } catch {
    return null;
  }
}

async function main() {
  const manifest = await loadManifest();
  const resolver: AssetResolver = createAssetResolver({ baseUrl: ASSET_BASE, manifest });

  // Crée le viewport logique 1280×720
  const app = document.getElementById("app") ?? document.body;
  const viewport = document.createElement("div");
  viewport.id = "viewport";
  app.appendChild(viewport);

  // Scaling : ajuste le viewport pour tenir dans la fenêtre
  function updateScale() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min(vw / 1280, vh / 720);
    viewport.style.transform = `scale(${scale})`;
  }
  updateScale();
  window.addEventListener("resize", updateScale);

  const chain = await loadChain(resolver);

  // Instancie le player avec les vraies factories. L'écran titre propose « Nouvelle
  // partie », « Continuer » (autosave) et la liste des chapitres.
  new Player({
    root: viewport,
    resolver,
    createStageRenderer: createDomStageRenderer,
    createUIManager: () => new DomUIManager(),
    scripts: chaptersToScripts(chain),
    loadChain: async () => chain,
  });
}

main().catch((err) => {
  console.error("[main] Erreur fatale:", err);
});
