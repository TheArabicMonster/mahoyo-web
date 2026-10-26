import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import { WebAudioPlayer } from "@/renderer/audio-manager.js";
import type { ParsedScript } from "@/kag/types.js";
import type { PlayerCommands, ScriptSummary } from "./types.js";

const SCRIPTS: ScriptSummary[] = [
  { id: "1-0", label: "Prologue", file: "1-0.ks", x: 512, y: 80, arc: "Prologue" },
  { id: "1-1", label: "Chapitre 1 — Partie 1", file: "1-1.ks", x: 512, y: 180, arc: "Chapitre 1" },
  { id: "1-2", label: "Chapitre 1 — Partie 2", file: "1-2.ks", x: 512, y: 260, arc: "Chapitre 1" },
];

/**
 * Orchestrateur minimal du player.
 *
 * Cette classe est un stub temporaire qui sera remplacée par une implémentation
 * complète connectant Runtime, StageRenderer, AudioPlayer et UIManager.
 */
export class Player implements PlayerCommands {
  private runtime: Runtime | null = null;
  private audio = new WebAudioPlayer();

  constructor() {
    this.setupMenu();
  }

  private setupMenu() {
    const list = document.getElementById("script-list");
    if (!list) return;
    list.innerHTML = "";
    for (const script of SCRIPTS) {
      const btn = document.createElement("button");
      btn.className = "ui-btn";
      btn.textContent = script.label;
      btn.onclick = () => this.startScript(script.file);
      list.appendChild(btn);
    }
  }

  async startScript(file: string, _label?: string) {
    try {
      const res = await fetch(`/assets/scenario/${file}`);
      const source = await res.text();
      const script = parse(lex(source));
      this.runtime = new Runtime(script, file);
      this.runtime.scriptLoader = async (storage: string) => {
        try {
          const r = await fetch(`/assets/scenario/${storage}`);
          if (!r.ok) return null;
          return parse(lex(await r.text())) as ParsedScript;
        } catch {
          return null;
        }
      };
      this.runLoop();
    } catch (err) {
      console.error("Failed to start script:", err);
    }
  }

  private async runLoop() {
    if (!this.runtime) return;
    // Boucle de lecture synchrone basique pour démonstration.
    while (true) {
      const step = this.runtime.step();
      for (const ev of step.events) {
        if (ev.kind === "audio") {
          this.audio.apply(ev.event, { instant: false });
        }
      }
      if (step.stop.kind === "end") break;
      if (step.stop.kind === "loadScript") {
        const ok = await this.runtime.loadScript(step.stop.file);
        if (!ok) break;
      }
      // Pour les autres arrêts, on avance immédiatement (pas d'interaction utilisateur dans ce stub).
    }
  }

  advance(): void {}
  setMode(): void {}
  toggleUserHide(): void {}
  rollback(): void {}
  choose(): void {}
  openScreen(): void {}
  closeScreen(): void {}
  returnToTitle(): void {}
  async save(): Promise<void> {}
  async load(): Promise<void> {}
  async deleteSave(): Promise<void> {}
  updateSettings(): void {}
  toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }
}
