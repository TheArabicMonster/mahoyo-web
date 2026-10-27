import "./main.css";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { AssetResolver } from "@/core/asset-resolver.js";
import { createDomStageRenderer } from "./renderer/stage-renderer.js";
import { DomUIManager } from "./ui/ui-manager.js";
import { Player } from "./ui/player.js";
import type { AssetManifest } from "@/core/asset-manifest.js";

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

  // Instancie le player avec les vraies factories
  const player = new Player({
    root: viewport,
    resolver,
    createStageRenderer: createDomStageRenderer,
    createUIManager: () => new DomUIManager(),
    scripts: [
      { id: "1-0", label: "Prologue", file: "1-0.ks", x: 512, y: 80, arc: "Prologue" },
    ],
  });

  // Lancer le prologue dès que le titre est prêt
  player.ready.then(() => {
    player.startScript("1-0.ks");
  });
}

main().catch((err) => {
  console.error("[main] Erreur fatale:", err);
});
