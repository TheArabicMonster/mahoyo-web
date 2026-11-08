import "./main.css";
import "./ui/tokens.css";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { AssetResolver } from "@/core/asset-resolver.js";
import { applyViewportScale, computeViewportScale } from "@/core/display.js";
import { createDomStageRenderer } from "./renderer/stage-renderer.js";
import { DomUIManager } from "./ui/ui-manager.js";
import { Player } from "./ui/player.js";
import type { AssetManifest } from "@/core/asset-manifest.js";
import { parseStoryChain, type StoryChain } from "@/core/story-chain.js";
import { chaptersToScripts } from "./ui/chapter-list.js";
import { createSaveStore, type ResilientSaveStore } from "./player/save-store-idb.js";
import { createLocalSettingsStore } from "./player/settings-store.js";
import type { ProgressAccess } from "./player/save-transfer.js";
import { downloadSaveExport, importSaveFile, pickSaveFile } from "./ui/save-transfer.js";

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

  // Échelle initiale ; le player la recalcule selon les réglages (#177).
  applyViewportScale(
    viewport,
    computeViewportScale(window.innerWidth, window.innerHeight, {
      fullscreen: false,
      mode: "fit",
      windowSize: "fit",
    }),
  );

  const chain = await loadChain(resolver);

  // Instancie le player avec les vraies factories. L'écran titre propose Start, Load,
  // « Continuer » (autosave), Flowchart, Config et Extra (liste des chapitres).
  // Sauvegardes : IndexedDB (migration auto des anciennes clés localStorage), repli localStorage puis mémoire.
  const saveStore = createSaveStore();
  const settingsStore = createLocalSettingsStore();
  exposeSaveTransfer(saveStore, settingsStore);

  new Player({
    root: viewport,
    resolver,
    createStageRenderer: createDomStageRenderer,
    createUIManager: () => new DomUIManager({ resolver }),
    scripts: chaptersToScripts(chain),
    loadChain: async () => chain,
    saveStore,
    settingsStore,
  });
}

/**
 * API d'export/import en attendant les boutons de l'écran de sauvegarde (HUD-10, #196) :
 * `await mahoyoSaves.export()` télécharge un JSON ; `await mahoyoSaves.import()` ouvre le sélecteur de fichier.
 * Recharger la page après un import pour que la progression fusionnée soit prise en compte par le player.
 */
function exposeSaveTransfer(saveStore: ResilientSaveStore, progress: ProgressAccess): void {
  const api = {
    backend: () => saveStore.backend(),
    export: () => downloadSaveExport(saveStore, progress),
    import: async () => {
      const file = await pickSaveFile();
      return file ? (await importSaveFile(file, saveStore, progress)).message : null;
    },
  };
  (window as unknown as { mahoyoSaves?: typeof api }).mahoyoSaves = api;
}

main().catch((err) => {
  console.error("[main] Erreur fatale:", err);
});
