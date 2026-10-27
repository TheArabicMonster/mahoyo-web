import "./main.css";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import { createDomStageRenderer } from "./renderer/stage-renderer.js";
import { DomUIManager } from "./ui/ui-manager.js";
import { Player } from "./ui/player.js";
import { DEMO_SCRIPT } from "./demo-script.js";

const resolver = createAssetResolver();

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
  loadScript: async (file) => {
    if (file === "demo.ks") return parse(lex(DEMO_SCRIPT));
    // Démo : aucun autre script n'est disponible
    return null;
  },
  scripts: [
    { id: "demo", label: "Démo technique", file: "demo.ks", x: 640, y: 360, arc: "Démo" },
  ],
});

// Quand le titre est affiché, lancer automatiquement la démo
player.ready.then(() => {
  player.startScript("demo.ks");
});
