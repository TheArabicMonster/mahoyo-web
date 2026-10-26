import html2canvas from "html2canvas";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import { AudioManager } from "@/renderer/audio-manager.js";
import { resolveBackground, resolveImage, resolveBgm, resolveSe } from "@/core/asset-resolver.js";
import type { RuntimeSnapshot, RuntimeSaveData, RuntimeState } from "@/kag/runtime.js";
import type { AnimationDef, TextSegment, Layer, ParsedScript } from "@/kag/types.js";

const ASSET_BASE = "/assets";

/** Liste des scripts disponibles (chapitres principaux) */
const SCRIPTS = [
  { id: "1-0", label: "Prologue", file: "1-0.ks", x: 512, y: 80, arc: "Prologue" },
  { id: "1-1", label: "Chapitre 1 — Partie 1", file: "1-1.ks", x: 512, y: 180, arc: "Chapitre 1" },
  { id: "1-2", label: "Chapitre 1 — Partie 2", file: "1-2.ks", x: 512, y: 260, arc: "Chapitre 1" },
  { id: "1-3", label: "Chapitre 1 — Partie 3", file: "1-3.ks", x: 512, y: 340, arc: "Chapitre 1" },
  { id: "1-4", label: "Chapitre 1 — Partie 4", file: "1-4.ks", x: 512, y: 420, arc: "Chapitre 1" },
  { id: "1-5", label: "Chapitre 1 — Partie 5", file: "1-5.ks", x: 512, y: 500, arc: "Chapitre 1" },
  { id: "1.5-1", label: "Interlude 1.5 — Partie 1", file: "1.5-1.ks", x: 700, y: 260, arc: "Interlude" },
  { id: "2-1", label: "Chapitre 2 — Partie 1", file: "2-1.ks", x: 512, y: 580, arc: "Chapitre 2" },
];

/**
 * Convertir les segments de texte en nœuds DOM avec support typewriter.
 * Les segments "pause" ([l]) sont insérés comme des <span data-pause>.
 */
function segmentsToDom(segments: TextSegment[]): Node[] {
  const nodes: Node[] = [];
  for (const seg of segments) {
    if ("pause" in seg && seg.pause) {
      const marker = document.createElement("span");
      marker.setAttribute("data-pause", "true");
      marker.style.display = "none";
      nodes.push(marker);
    } else if ("text" in seg) {
      if (seg.text === "\n") {
        nodes.push(document.createElement("br"));
      } else if (seg.ruby) {
        for (const char of seg.text) {
          const ruby = document.createElement("ruby");
          ruby.textContent = char;
          const rt = document.createElement("rt");
          rt.textContent = seg.ruby;
          ruby.appendChild(rt);
          nodes.push(ruby);
        }
      } else {
        for (const char of seg.text) {
          const span = document.createElement("span");
          span.textContent = char;
          span.style.opacity = "0";
          span.style.transition = "opacity 0.05s";
          nodes.push(span);
        }
      }
    }
  }
  return nodes;
}

export class Player {
  private runtime: Runtime | null = null;
  private menuEl = document.getElementById("menu") as HTMLDivElement;
  private gameEl = document.getElementById("game") as HTMLDivElement;
  private flowchartEl = document.getElementById("flowchart") as HTMLDivElement;
  private flowchartNodesEl = document.getElementById("flowchart-nodes") as HTMLDivElement;
  private flowchartLinesEl = document.getElementById("flowchart-lines") as unknown as SVGSVGElement;
  private pauseMenuEl = document.getElementById("pause-menu") as HTMLDivElement;
  private staffrollEl = document.getElementById("staffroll") as HTMLDivElement;
  private staffrollContentEl = document.getElementById("staffroll-content") as HTMLDivElement;
  private effectsOverlayEl = document.getElementById("effects-overlay") as HTMLDivElement;
  private viewportEl = document.getElementById("viewport") as HTMLDivElement;
  private bgEl = document.getElementById("background") as HTMLDivElement;
  private bgNextEl = document.getElementById("background-next") as HTMLDivElement;
  private textEl = document.getElementById("text") as HTMLDivElement;
  private hintEl = document.getElementById("hint") as HTMLDivElement;
  private textboxEl = document.getElementById("textbox") as HTMLDivElement;
  private layersEl = document.getElementById("layers") as HTMLDivElement;

  // Audio
  private audio = new AudioManager();

  // Typewriter state
  private typewriterTimer: ReturnType<typeof setInterval> | null = null;
  private typewriterIndex = 0;
  private typewriterNodes: Node[] = [];
  private isTyping = false;
  private isPaused = false;  // paused at [l] marker
  private skipMode = false;

  // Auto mode
  private autoMode = false;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private autoDelay = 3000; // ms avant d'avancer automatiquement

  // Wait timer (@wait)
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private isWaiting = false;

  // Pause menu
  private isPauseMenuOpen = false;
  private pauseTab: "save" | "load" | "settings" = "save";

  // Background transition state
  private currentBackground = "";

  // History
  private history: RuntimeSnapshot[] = [];
  private historyIndex = -1;
  private isShowingHistory = false;

  // Settings
  private textSpeed = 30; // ms par caractère
  private bgmVolume = 0.6;
  private seVolume = 0.5;

  // Save state
  private currentScriptFile = "1-0.ks";

  constructor() {
    this.gameEl.addEventListener("click", (e) => {
      // Ne pas avancer si on clique sur un bouton du UI
      if ((e.target as HTMLElement).closest(".ui-btn")) return;
      this.handleClick();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this.isShowingHistory) {
          this.hideHistory();
        } else if (this.isPauseMenuOpen) {
          this.hidePauseMenu();
        } else if (this.gameEl.style.display !== "none") {
          this.showPauseMenu();
        } else {
          this.returnToMenu();
        }
      } else if (e.key === "p" || e.key === "P") {
        if (this.gameEl.style.display !== "none") this.togglePauseMenu();
      } else if (e.key === "a" || e.key === "A") {
        if (!this.isShowingHistory) this.toggleAutoMode();
      } else if (e.key === "t" || e.key === "T" || e.key === "Control") {
        this.toggleSkipMode();
      } else if (e.key === "s" || e.key === "S") {
        this.quicksave();
      } else if (e.key === "l" || e.key === "L") {
        void this.quickload();
      } else if (e.key === "f" || e.key === "F") {
        this.toggleFullscreen();
      } else if (e.key === "ArrowUp" || e.key === "h" || e.key === "H") {
        if (!this.isShowingHistory) this.showHistory(-1);
      } else if (e.key === "ArrowDown") {
        if (this.isShowingHistory) this.showHistory(1);
      }
    });
    this.renderMenu();
    this.loadSettings();
    this.bindSettings();

    // UI buttons
    document.getElementById("btn-auto")?.addEventListener("click", () => {
      this.toggleAutoMode();
    });
    document.getElementById("btn-skip")?.addEventListener("click", () => {
      this.toggleSkipMode();
    });
    document.getElementById("btn-pause")?.addEventListener("click", () => {
      this.togglePauseMenu();
    });
    document.getElementById("btn-fullscreen")?.addEventListener("click", () => {
      this.toggleFullscreen();
    });
    document.getElementById("btn-pause-menu")?.addEventListener("click", () => {
      this.hidePauseMenu();
      this.returnToMenu();
    });
    document.getElementById("btn-pause-resume")?.addEventListener("click", () => {
      this.hidePauseMenu();
    });
    document.getElementById("btn-flowchart")?.addEventListener("click", () => {
      this.showFlowchart();
    });
    document.getElementById("btn-flowchart-back")?.addEventListener("click", () => {
      this.hideFlowchart();
    });

    // Responsive viewport scaling
    this.updateViewportScale();
    window.addEventListener("resize", () => this.updateViewportScale());
  }

  private updateViewportScale() {
    const GAME_W = 1024;
    const GAME_H = 576;
    const scaleX = window.innerWidth / GAME_W;
    const scaleY = window.innerHeight / GAME_H;
    const scale = Math.min(scaleX, scaleY);
    this.viewportEl.style.setProperty("--viewport-scale", String(scale));
    this.viewportEl.style.transform = `scale(${scale})`;
  }

  // ── Menu ──

  private renderMenu() {
    const listEl = document.getElementById("script-list") as HTMLDivElement;
    listEl.innerHTML = "";

    for (const script of SCRIPTS) {
      const btn = document.createElement("button");
      btn.className = "script-btn";
      btn.innerHTML = `<span class="script-name">${script.label}</span><br><span class="script-info">${script.file}</span>`;
      btn.addEventListener("click", () => this.startGame(script.file));
      listEl.appendChild(btn);
    }
  }

  private renderFlowchart() {
    this.flowchartNodesEl.innerHTML = "";
    this.flowchartLinesEl.innerHTML = "";

    const unlocked = this.getUnlockedScripts();
    const completed = this.getCompletedScripts();

    // Dessiner les lignes de connexion entre les nœuds consécutifs du même arc
    const canvasRect = this.flowchartEl.getBoundingClientRect();
    for (let i = 0; i < SCRIPTS.length - 1; i++) {
      const a = SCRIPTS[i];
      const b = SCRIPTS[i + 1];
      if (a.arc !== b.arc) continue;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(a.x));
      line.setAttribute("y1", String(a.y));
      line.setAttribute("x2", String(b.x));
      line.setAttribute("y2", String(b.y));
      line.setAttribute("class", "flowchart-line");
      this.flowchartLinesEl.appendChild(line);
    }

    for (const script of SCRIPTS) {
      const node = document.createElement("button");
      node.className = "flowchart-node";
      if (completed.includes(script.id)) node.classList.add("completed");
      else if (unlocked.includes(script.id)) node.classList.add("unlocked");
      else node.classList.add("locked");
      node.style.left = `${script.x}px`;
      node.style.top = `${script.y}px`;
      node.textContent = script.label;
      node.disabled = !unlocked.includes(script.id);
      node.addEventListener("click", () => {
        this.hideFlowchart();
        this.startGame(script.file);
      });
      this.flowchartNodesEl.appendChild(node);
    }
  }

  private showFlowchart() {
    this.menuEl.style.display = "none";
    this.flowchartEl.style.display = "flex";
    this.renderFlowchart();
  }

  private hideFlowchart() {
    this.flowchartEl.style.display = "none";
    this.menuEl.style.display = "flex";
  }

  // ── Pause menu ──

  private togglePauseMenu() {
    if (this.isPauseMenuOpen) {
      this.hidePauseMenu();
    } else {
      this.showPauseMenu();
    }
  }

  private showPauseMenu() {
    if (!this.runtime) return;
    this.isPauseMenuOpen = true;
    this.pauseMenuEl.style.display = "flex";
    this.pauseTab = "save";
    this.renderPauseTabs();
    this.renderSaveSlots();
    this.bindPauseSettings();
  }

  private hidePauseMenu() {
    this.isPauseMenuOpen = false;
    this.pauseMenuEl.style.display = "none";
  }

  private renderPauseTabs() {
    const tabs = this.pauseMenuEl.querySelectorAll(".pause-tab");
    tabs.forEach((tab) => {
      tab.classList.toggle("active", tab.getAttribute("data-tab") === this.pauseTab);
      tab.addEventListener("click", () => {
        this.pauseTab = tab.getAttribute("data-tab") as "save" | "load" | "settings";
        this.renderPauseTabs();
        this.updatePausePanels();
      });
    });
  }

  private updatePausePanels() {
    const saveSlots = document.getElementById("save-slots") as HTMLDivElement;
    const loadSlots = document.getElementById("load-slots") as HTMLDivElement;
    const settings = document.getElementById("pause-settings") as HTMLDivElement;
    saveSlots.style.display = this.pauseTab === "save" ? "grid" : "none";
    loadSlots.style.display = this.pauseTab === "load" ? "grid" : "none";
    settings.style.display = this.pauseTab === "settings" ? "block" : "none";
    if (this.pauseTab === "save") this.renderSaveSlots();
    if (this.pauseTab === "load") this.renderLoadSlots();
  }

  private renderSlotContent(slot: ReturnType<typeof this.loadSlotData>, index: number): string {
    if (!slot) {
      return `<span class="slot-num">${index}</span><span class="slot-info">Vide</span>`;
    }
    const thumb = slot.thumbnail
      ? `<img class="slot-thumb" src="${slot.thumbnail}" alt="" loading="lazy">`
      : "";
    return `${thumb}<span class="slot-num">${index}</span><span class="slot-info">${slot.scriptFile}<br>${new Date(slot.timestamp).toLocaleString()}</span><span class="slot-text">${this.escapeHtml(slot.previewText)}</span>`;
  }

  private renderSaveSlots() {
    const container = document.getElementById("save-slots") as HTMLDivElement;
    container.innerHTML = "";
    for (let i = 1; i <= 6; i++) {
      const slot = this.loadSlotData(i);
      const el = document.createElement("button");
      el.className = "save-slot";
      el.innerHTML = this.renderSlotContent(slot, i);
      el.addEventListener("click", () => {
        void this.saveSlot(i).then(() => this.renderSaveSlots());
      });
      container.appendChild(el);
    }
  }

  private renderLoadSlots() {
    const container = document.getElementById("load-slots") as HTMLDivElement;
    container.innerHTML = "";
    for (let i = 1; i <= 6; i++) {
      const slot = this.loadSlotData(i);
      const el = document.createElement("button");
      el.className = "save-slot";
      el.disabled = !slot;
      el.innerHTML = this.renderSlotContent(slot, i);
      el.addEventListener("click", () => {
        if (slot) {
          void this.loadSlot(i);
          this.hidePauseMenu();
        }
      });
      container.appendChild(el);
    }
  }

  private async saveSlot(slotIndex: number) {
    if (!this.runtime) return;
    const saveData = this.runtime.getSaveData();
    const snapshot = this.history[this.historyIndex] ?? null;
    const previewText = snapshot?.text.slice(0, 80) ?? "";
    let thumbnail = "";
    try {
      const canvas = await html2canvas(this.viewportEl, {
        scale: 0.25,
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
      });
      thumbnail = canvas.toDataURL("image/webp", 0.7);
    } catch (err) {
      console.warn("Thumbnail capture failed:", err);
    }
    const slotData = {
      ...saveData,
      scriptFile: this.currentScriptFile,
      timestamp: Date.now(),
      previewText,
      thumbnail,
    };
    localStorage.setItem(`mahoyo.save.${slotIndex}`, JSON.stringify(slotData));
    this.showToast(`Sauvegarde ${slotIndex} enregistrée`);
  }

  private loadSlotData(slotIndex: number): (RuntimeSaveData & { scriptFile: string; timestamp: number; previewText: string; thumbnail?: string }) | null {
    try {
      const data = localStorage.getItem(`mahoyo.save.${slotIndex}`);
      if (!data) return null;
      return JSON.parse(data) as RuntimeSaveData & { scriptFile: string; timestamp: number; previewText: string };
    } catch {
      return null;
    }
  }

  private async loadSlot(slotIndex: number) {
    const data = this.loadSlotData(slotIndex);
    if (!data) return;
    const scriptFile = data.scriptFile || "1-0.ks";
    const script = await this.loadScriptFile(scriptFile);
    if (!script || !this.runtime) return;
    await this.runtime.loadSaveData(
      {
        scriptName: data.scriptName,
        pc: data.pc,
        state: data.state,
        callStack: data.callStack,
      },
      new Map([[data.scriptName, script]])
    );
    this.stopTypewriter();
    this.cancelAutoAdvance();
    this.cancelWait();
    this.showToast(`Partie ${slotIndex} chargée`);
    this.advance();
  }

  private escapeHtml(text: string): string {
    return text.replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c] ?? c));
  }

  private bindPauseSettings() {
    const textSpeedInput = document.getElementById("pause-setting-text-speed") as HTMLInputElement;
    const autoDelayInput = document.getElementById("pause-setting-auto-delay") as HTMLInputElement;
    const bgmVolumeInput = document.getElementById("pause-setting-bgm-volume") as HTMLInputElement;
    const seVolumeInput = document.getElementById("pause-setting-se-volume") as HTMLInputElement;

    textSpeedInput.value = String(100 - this.textSpeed);
    autoDelayInput.value = String(this.autoDelay);
    bgmVolumeInput.value = String(Math.round(this.audio.getBgmVolume() * 100));
    seVolumeInput.value = String(Math.round(this.audio.getSeVolume() * 100));

    this.updatePauseSettingLabels();

    textSpeedInput.oninput = () => {
      this.textSpeed = 100 - parseInt(textSpeedInput.value, 10);
      this.updatePauseSettingLabels();
      this.saveSettings();
    };
    autoDelayInput.oninput = () => {
      this.autoDelay = parseInt(autoDelayInput.value, 10);
      this.updatePauseSettingLabels();
      this.saveSettings();
    };
    bgmVolumeInput.oninput = () => {
      this.audio.setBgmVolume(parseInt(bgmVolumeInput.value, 10) / 100);
      // le volume est déjà mis à jour par AudioManager
      this.updatePauseSettingLabels();
      this.saveSettings();
    };
    seVolumeInput.oninput = () => {
      this.audio.setSeVolume(parseInt(seVolumeInput.value, 10) / 100);
      this.updatePauseSettingLabels();
      this.saveSettings();
    };
  }

  private updatePauseSettingLabels() {
    const textSpeedValue = document.getElementById("pause-setting-text-speed-value");
    const autoDelayValue = document.getElementById("pause-setting-auto-delay-value");
    const bgmVolumeValue = document.getElementById("pause-setting-bgm-volume-value");
    const seVolumeValue = document.getElementById("pause-setting-se-volume-value");
    if (textSpeedValue) textSpeedValue.textContent = `${this.textSpeed} ms`;
    if (autoDelayValue) autoDelayValue.textContent = `${(this.autoDelay / 1000).toFixed(1)} s`;
    if (bgmVolumeValue) bgmVolumeValue.textContent = `${Math.round(this.audio.getBgmVolume() * 100)}%`;
    if (seVolumeValue) seVolumeValue.textContent = `${Math.round(this.audio.getSeVolume() * 100)}%`;
  }

  private getUnlockedScripts(): string[] {
    // Pour le PoC, tout est débloqué. Plus tard, on pourra lire la progression.
    return SCRIPTS.map(s => s.id);
  }

  private getCompletedScripts(): string[] {
    try {
      const data = localStorage.getItem("mahoyo.progress");
      if (!data) return [];
      const progress = JSON.parse(data) as { completed: string[] };
      return progress.completed ?? [];
    } catch {
      return [];
    }
  }

  private markScriptCompleted(scriptId: string) {
    try {
      const data = localStorage.getItem("mahoyo.progress");
      const progress = data ? (JSON.parse(data) as { completed: string[] }) : { completed: [] };
      if (!progress.completed.includes(scriptId)) {
        progress.completed.push(scriptId);
        localStorage.setItem("mahoyo.progress", JSON.stringify(progress));
      }
    } catch {
      // ignore
    }
  }

  private async startGame(scriptFile: string) {
    this.menuEl.style.display = "none";
    this.gameEl.style.display = "block";

    try {
      await this.loadScriptFile(scriptFile);
    } catch (err) {
      console.error(err);
      this.textEl.textContent = `Erreur de chargement: ${scriptFile}`;
    }
  }

  private returnToMenu() {
    this.stopTypewriter();
    this.cancelAutoAdvance();
    this.cancelWait();
    this.stopQuake();
    this.stopStaffroll();
    this.effectsOverlayEl.style.display = "none";
    this.effectsOverlayEl.className = "";
    this.autoMode = false;
    this.skipMode = false;
    this.isTyping = false;
    this.isPaused = false;
    this.isShowingHistory = false;
    this.audio.stopBgm();
    this.runtime = null;
    this.gameEl.style.display = "none";
    this.flowchartEl.style.display = "none";
    this.menuEl.style.display = "flex";
    // Reset display state
    this.bgEl.style.backgroundImage = "";
    this.bgNextEl.style.backgroundImage = "";
    this.bgNextEl.style.opacity = "0";
    this.textEl.innerHTML = "";
    this.layersEl.innerHTML = "";
    this.hintEl.style.display = "";
    this.textboxEl.classList.remove("hidden");
    this.textboxEl.classList.remove("frame-hidden");
  }

  // ── Settings ──

  private loadSettings() {
    try {
      const saved = localStorage.getItem("mahoyo.settings");
      if (saved) {
        const settings = JSON.parse(saved);
        this.textSpeed = settings.textSpeed ?? 30;
        this.autoDelay = settings.autoDelay ?? 3000;
        this.audio.setBgmVolume(settings.bgmVolume ?? 0.6);
        this.audio.setSeVolume(settings.seVolume ?? 0.5);
      }
    } catch {
      // ignore
    }
    this.updateSettingsUI();
  }

  private saveSettings() {
    try {
      localStorage.setItem(
        "mahoyo.settings",
        JSON.stringify({
          textSpeed: this.textSpeed,
          autoDelay: this.autoDelay,
          bgmVolume: this.audio.getBgmVolume(),
          seVolume: this.audio.getSeVolume(),
        })
      );
    } catch {
      // ignore
    }
  }

  private updateSettingsUI() {
    const textSpeedInput = document.getElementById("setting-text-speed") as HTMLInputElement;
    const autoDelayInput = document.getElementById("setting-auto-delay") as HTMLInputElement;
    const bgmVolumeInput = document.getElementById("setting-bgm-volume") as HTMLInputElement;
    const seVolumeInput = document.getElementById("setting-se-volume") as HTMLInputElement;

    // Convertir textSpeed (0-100) vers ms inversement proportionnel
    // 0 → 100ms, 100 → 0ms (instant)
    const speedPercent = Math.max(0, Math.min(100, Math.round((1 - this.textSpeed / 100) * 100)));

    if (textSpeedInput) textSpeedInput.value = String(speedPercent);
    if (autoDelayInput) autoDelayInput.value = String(this.autoDelay);
    if (bgmVolumeInput) bgmVolumeInput.value = String(Math.round(this.audio.getBgmVolume() * 100));
    if (seVolumeInput) seVolumeInput.value = String(Math.round(this.audio.getSeVolume() * 100));

    const textSpeedValue = document.getElementById("setting-text-speed-value");
    const autoDelayValue = document.getElementById("setting-auto-delay-value");
    const bgmVolumeValue = document.getElementById("setting-bgm-volume-value");
    const seVolumeValue = document.getElementById("setting-se-volume-value");

    if (textSpeedValue) textSpeedValue.textContent = `${this.textSpeed} ms`;
    if (autoDelayValue) autoDelayValue.textContent = `${(this.autoDelay / 1000).toFixed(1)} s`;
    if (bgmVolumeValue) bgmVolumeValue.textContent = `${Math.round(this.audio.getBgmVolume() * 100)}%`;
    if (seVolumeValue) seVolumeValue.textContent = `${Math.round(this.audio.getSeVolume() * 100)}%`;
  }

  private bindSettings() {
    const textSpeedInput = document.getElementById("setting-text-speed") as HTMLInputElement;
    const autoDelayInput = document.getElementById("setting-auto-delay") as HTMLInputElement;
    const bgmVolumeInput = document.getElementById("setting-bgm-volume") as HTMLInputElement;
    const seVolumeInput = document.getElementById("setting-se-volume") as HTMLInputElement;

    textSpeedInput?.addEventListener("input", () => {
      const percent = parseInt(textSpeedInput.value, 10) / 100;
      // 0% → 100ms, 100% → 0ms
      this.textSpeed = Math.round(100 * (1 - percent));
      this.updateSettingsUI();
      this.saveSettings();
    });

    autoDelayInput?.addEventListener("input", () => {
      this.autoDelay = parseInt(autoDelayInput.value, 10);
      this.updateSettingsUI();
      this.saveSettings();
    });

    bgmVolumeInput?.addEventListener("input", () => {
      this.audio.setBgmVolume(parseInt(bgmVolumeInput.value, 10) / 100);
      // le volume est déjà mis à jour par AudioManager
      this.updateSettingsUI();
      this.saveSettings();
    });

    seVolumeInput?.addEventListener("input", () => {
      this.audio.setSeVolume(parseInt(seVolumeInput.value, 10) / 100);
      // le volume est déjà mis à jour par AudioManager
      this.updateSettingsUI();
      this.saveSettings();
    });
  }

  private toggleSkipMode() {
    this.skipMode = !this.skipMode;
    if (this.skipMode) {
      this.showToast("Skip mode ON");
      this.finishTextwriterAndAdvance();
    } else {
      this.showToast("Skip mode OFF");
    }
  }

  private finishTextwriterAndAdvance() {
    this.stopTypewriter();
    this.skipToNextPauseOrEnd();
    if (!this.isPaused && !this.isTyping) {
      this.advance();
    }
  }

  // ── Fullscreen ──

  private toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen();
    }
  }

  // ── Save/Load ──

  private quicksave() {
    if (!this.runtime) return;
    try {
      const saveData = this.runtime.getSaveData();
      localStorage.setItem(
        "mahoyo.quicksave",
        JSON.stringify({
          ...saveData,
          scriptFile: this.currentScriptFile,
          timestamp: Date.now(),
        })
      );
      this.showToast("Partie sauvegardée");
    } catch {
      this.showToast("Erreur de sauvegarde");
    }
  }

  private async quickload() {
    try {
      const saved = localStorage.getItem("mahoyo.quicksave");
      if (!saved) {
        this.showToast("Aucune sauvegarde");
        return;
      }
      const data = JSON.parse(saved);
      const scriptFile = data.scriptFile || "1-0.ks";
      const script = await this.loadScriptFile(scriptFile);
      if (!script) {
        this.showToast("Script introuvable");
        return;
      }
      this.currentScriptFile = scriptFile;
      this.runtime = new Runtime(script, scriptFile);
      // Restaurer l'état
      await this.runtime.loadSaveData(
        {
          scriptName: data.scriptName,
          pc: data.pc,
          state: data.state,
          callStack: data.callStack,
        },
        new Map([[data.scriptName, script]])
      );
      this.stopTypewriter();
      this.cancelAutoAdvance();
      this.showToast("Partie chargée");
      this.advance();
    } catch (err) {
      console.error(err);
      this.showToast("Erreur de chargement");
    }
  }

  private showToast(message: string) {
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.7);
      color: #fff;
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 0.85rem;
      z-index: 1000;
      pointer-events: none;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  // ── Game logic ──

  private async loadScriptFile(scriptFile: string): Promise<ParsedScript | null> {
    this.currentScriptFile = scriptFile;
    const scriptPath = `${ASSET_BASE}/scenario/${scriptFile}`;
    const response = await fetch(scriptPath);
    if (!response.ok) {
      throw new Error(`Failed to load ${scriptPath}`);
    }
    const source = await response.text();
    const script = parse(lex(source));
    this.runtime = new Runtime(script, scriptFile);

    this.runtime.scriptLoader = async (storage: string) => {
      try {
        const url = `${ASSET_BASE}/scenario/${storage}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const src = await res.text();
        return parse(lex(src));
      } catch {
        return null;
      }
    };

    this.advance();
    return script;
  }

  async load(scriptPath: string) {
    const scriptName = scriptPath.split("/").pop() ?? "main";
    const script = await this.loadScriptFile(scriptName);
    return script;
  }

  private handleClick() {
    if (this.isShowingHistory) {
      this.hideHistory();
      return;
    }
    // En skip mode, le clic désactive le skip et permet de reprendre le contrôle
    if (this.skipMode) {
      this.skipMode = false;
      this.showToast("Skip mode OFF");
      return;
    }
    // Si on est dans un @wait, le clic l'annule et avance
    if (this.isWaiting) {
      this.cancelWait();
      this.advance();
      return;
    }
    if (this.isPaused) {
      // Reprendre après un [l]
      this.isPaused = false;
      this.resumeTypewriter();
    } else if (this.isTyping) {
      // Clic pendant le typewriter → afficher tout le texte jusqu'au prochain [l] ou fin
      this.skipToNextPauseOrEnd();
    } else {
      this.advance();
    }
  }

  advance() {
    if (!this.runtime) return;
    const snapshot = this.runtime.next();
    if (!snapshot) {
      this.textEl.textContent = "— Fin —";
      this.hintEl.style.display = "none";
      // Marquer le script comme terminé dans la progression
      const script = SCRIPTS.find(s => s.file === this.currentScriptFile);
      if (script) this.markScriptCompleted(script.id);
      return;
    }

    // Si un chargement de script est nécessaire
    if (snapshot.pendingScriptLoad) {
      this.handleScriptLoad(snapshot.pendingScriptLoad);
      return;
    }

    this.render(snapshot);

    // Si @wait a demandé un temps d'attente
    if (snapshot.waitTime && snapshot.waitTime > 0) {
      this.startWait(snapshot.waitTime);
    }
  }

  private async handleScriptLoad(storage: string) {
    if (!this.runtime) return;

    const success = await this.runtime.loadScript(storage);
    if (success) {
      this.advance();
    } else {
      // Chargement échoué — on skip et continue
      console.warn(`Script non trouvé: ${storage}`);
      this.advance();
    }
  }

  private quakeTimer: ReturnType<typeof setTimeout> | null = null;
  private staffrollStartTime: number | null = null;
  private staffrollDuration = 0;
  private staffrollHeight = 0;
  private staffrollFrame: number | null = null;

  private startQuake(quake: { vmax: number; hmax: number; time: number; interval: number }) {
    this.stopQuake();
    this.viewportEl.classList.add("shaking");
    this.viewportEl.style.setProperty("--shake-v", `${quake.vmax}px`);
    this.viewportEl.style.setProperty("--shake-h", `${quake.hmax}px`);
    this.viewportEl.style.setProperty("--shake-interval", `${quake.interval}ms`);
    this.quakeTimer = setTimeout(() => {
      this.stopQuake();
    }, quake.time);
  }

  private stopQuake() {
    if (this.quakeTimer) {
      clearTimeout(this.quakeTimer);
      this.quakeTimer = null;
    }
    this.viewportEl.classList.remove("shaking");
  }

  private renderEffect(effect?: RuntimeSnapshot["pendingEffect"]) {
    if (!effect) return;
    if (effect.kind === "stophaze") {
      this.effectsOverlayEl.style.display = "none";
      this.effectsOverlayEl.className = "";
      return;
    }
    this.effectsOverlayEl.style.display = "block";
    this.effectsOverlayEl.className = "";
    if (effect.kind === "noise") {
      this.effectsOverlayEl.classList.add("noise-effect");
      this.effectsOverlayEl.style.opacity = String(effect.opacity / 255);
      if (effect.monocro) {
        this.effectsOverlayEl.classList.add("noise-monocro");
      }
    } else if (effect.kind === "haze") {
      this.effectsOverlayEl.classList.add("haze-effect");
      this.effectsOverlayEl.style.opacity = String(Math.min(effect.power / 10, 0.8));
      this.effectsOverlayEl.style.setProperty("--haze-duration", `${Math.max(2000 - effect.omega * 100, 500)}ms`);
    }
  }

  private renderStaffroll(staffroll?: RuntimeState["staffroll"]) {
    if (!staffroll || staffroll.lines.length === 0) {
      this.stopStaffroll();
      return;
    }

    if (staffroll.running) {
      this.staffrollEl.style.display = "block";
      this.staffrollContentEl.innerHTML = "";
      for (const line of staffroll.lines) {
        const el = document.createElement("div");
        el.className = "staffroll-line";
        el.textContent = line.text;
        el.style.fontSize = `${line.size}px`;
        el.style.top = `${line.y}px`;
        if (line.face) el.style.fontFamily = line.face;
        if (line.cmx !== undefined) el.style.left = `calc(50% + ${line.cmx}px)`;
        this.staffrollContentEl.appendChild(el);
      }

      if (this.staffrollFrame === null) {
        this.staffrollStartTime = performance.now() - staffroll.elapsed;
        this.staffrollDuration = staffroll.time;
        this.staffrollHeight = staffroll.height;
        this.animateStaffroll();
      }
    } else if (!staffroll.running && this.staffrollFrame !== null) {
      this.stopStaffroll();
    }
  }

  private animateStaffroll() {
    if (this.staffrollStartTime === null) return;
    const elapsed = performance.now() - this.staffrollStartTime;
    const progress = Math.min(elapsed / this.staffrollDuration, 1);
    const translateY = -progress * this.staffrollHeight;
    this.staffrollContentEl.style.transform = `translateY(${translateY}px)`;

    if (progress < 1) {
      this.staffrollFrame = requestAnimationFrame(() => this.animateStaffroll());
    } else {
      this.staffrollFrame = null;
    }
  }

  private stopStaffroll() {
    if (this.staffrollFrame) {
      cancelAnimationFrame(this.staffrollFrame);
      this.staffrollFrame = null;
    }
    this.staffrollStartTime = null;
    this.staffrollEl.style.display = "none";
    this.staffrollContentEl.innerHTML = "";
  }

  private setTextboxVisible(visible: boolean, timeMs: number) {
    this.textboxEl.style.transitionDuration = `${timeMs}ms`;
    if (visible) {
      this.textboxEl.classList.remove("hidden");
    } else {
      this.textboxEl.classList.add("hidden");
    }
  }

  private setTextboxFrameVisible(visible: boolean) {
    if (visible) {
      this.textboxEl.classList.remove("frame-hidden");
    } else {
      this.textboxEl.classList.add("frame-hidden");
    }
  }

  private renderBackground(storage: string, transition = false, transitionTime = 1200) {
    if (!storage) return;
    const bgUrl = resolveBackground(storage);

    const applyBackground = (url: string) => {
      if (transition && this.currentBackground && this.currentBackground !== storage) {
        // Crossfade via #background-next
        this.bgNextEl.style.backgroundImage = `url(${url})`;
        this.bgNextEl.classList.add("active");
        this.viewportEl.style.setProperty("--bg-transition-duration", `${transitionTime}ms`);

        setTimeout(() => {
          this.bgEl.style.backgroundImage = `url(${url})`;
          this.bgNextEl.classList.remove("active");
          this.currentBackground = storage;
        }, transitionTime);
      } else {
        // Changement immédiat
        this.bgEl.style.backgroundImage = `url(${url})`;
        this.bgNextEl.classList.remove("active");
        this.currentBackground = storage;
      }
    };

    const img = new Image();
    img.onload = () => applyBackground(bgUrl);
    img.onerror = () => {
      // Fallback: essayer .png si .webp n'existe pas
      const fallbackUrl = `${ASSET_BASE}/bg/${storage}.png`;
      const fallbackImg = new Image();
      fallbackImg.onload = () => applyBackground(fallbackUrl);
      fallbackImg.onerror = () => {
        // Dernier fallback: image/
        const imageUrl = `${ASSET_BASE}/image/${storage}.webp`;
        const imageImg = new Image();
        imageImg.onload = () => applyBackground(imageUrl);
        imageImg.onerror = () => {
          console.warn(`Background introuvable: ${storage}`);
          this.bgEl.style.backgroundColor = "#000";
          this.bgEl.style.backgroundImage = "none";
          this.currentBackground = storage;
        };
        imageImg.src = imageUrl;
      };
      fallbackImg.src = fallbackUrl;
    };
    img.src = bgUrl;
  }

  private renderLayers(layers: Layer[], animation?: AnimationDef | null) {
    this.layersEl.innerHTML = "";
    for (const layer of layers) {
      const el = document.createElement("div");
      el.className = "sprite";

      const colorNames: Record<string, string> = {
        red: "#cc0000",
        white: "#ffffff",
        black: "#000000",
      };

      // Vérifier si ce layer est ciblé par l'animation
      const isAnimated = animation && animation.storage === layer.storage;

      if (colorNames[layer.storage]) {
        el.style.backgroundColor = colorNames[layer.storage];
        el.style.left = "0";
        el.style.top = "0";
        el.style.width = "100%";
        el.style.height = "100%";
      } else {
        el.style.backgroundImage = `url(${resolveImage(layer.storage)})`;
        el.style.left = `${layer.center - 256}px`;
        el.style.top = `${layer.vcenter - 288}px`;
        // Fallback: si l'image est introuvable, afficher un placeholder
        el.onerror = () => {
          el.classList.add("sprite-missing");
          el.style.backgroundImage = "none";
          el.title = `Image introuvable: ${layer.storage}`;
          console.warn(`Image introuvable: ${layer.storage}`);
        };
      }

      el.style.zIndex = String(layer.index);
      el.style.opacity = String(layer.opacity);

      // Appliquer l'animation CSS si ce layer est ciblé
      if (isAnimated && animation.keyframes.length >= 2) {
        this.applyAnimation(el, animation);
      }

      this.layersEl.appendChild(el);
    }
  }

  private applyAnimation(el: HTMLDivElement, anim: AnimationDef) {
    const keyframes = anim.keyframes;
    const totalDuration = keyframes[keyframes.length - 1].time || 1000;

    // Construire les CSS keyframes
    const cssKeyframes: Record<string, string> = {};
    for (const kf of keyframes) {
      const percent = totalDuration > 0 ? ((kf.time / totalDuration) * 100).toFixed(1) : "0";
      const props: string[] = [];
      if (kf.center !== undefined) props.push(`left: ${kf.center - 256}px`);
      if (kf.vcenter !== undefined) props.push(`top: ${kf.vcenter - 288}px`);
      if (kf.opacity !== undefined) props.push(`opacity: ${kf.opacity}`);
      if (kf.zoomx !== undefined || kf.zoomy !== undefined) {
        const sx = kf.zoomx ?? 1;
        const sy = kf.zoomy ?? 1;
        props.push(`transform: scale(${sx}, ${sy})`);
      }
      if (kf.rotate !== undefined) props.push(`transform: rotate(${kf.rotate}deg)`);
      if (props.length > 0) {
        cssKeyframes[percent + "%"] = props.join("; ");
      }
    }

    // Injecter les keyframes CSS
    const animName = `anim_${anim.storage.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
    let cssText = `@keyframes ${animName} {\n`;
    for (const [offset, props] of Object.entries(cssKeyframes)) {
      cssText += `  ${offset} { ${props} }\n`;
    }
    cssText += `}`;

    const styleEl = document.createElement("style");
    styleEl.textContent = cssText;
    document.head.appendChild(styleEl);

    // Nettoyer le style après l'animation
    setTimeout(() => styleEl.remove(), totalDuration + 100);

    // Appliquer l'animation
    el.style.animation = `${animName} ${totalDuration}ms ${anim.loop ? "infinite" : "forwards"} linear`;
  }

  private startTypewriter(nodes: Node[]) {
    this.stopTypewriter();
    this.typewriterNodes = nodes;
    this.typewriterIndex = 0;
    this.isTyping = true;
    this.isPaused = false;

    this.textEl.innerHTML = "";
    for (const node of nodes) {
      this.textEl.appendChild(node);
    }

    this.resumeTypewriter();
  }

  private resumeTypewriter() {
    this.typewriterTimer = setInterval(() => {
      if (this.typewriterIndex >= this.typewriterNodes.length) {
        this.finishTypewriter();
        return;
      }

      const node = this.typewriterNodes[this.typewriterIndex];

      // Vérifier si c'est un marqueur de pause [l]
      if (node instanceof HTMLSpanElement && node.hasAttribute("data-pause")) {
        this.typewriterIndex++; // passer le marqueur
        this.isPaused = true;
        this.stopTypewriter();
        // En auto mode, planifier la reprise après un délai
        if (this.autoMode) {
          this.scheduleAutoAdvance();
        }
        return;
      }

      if (node instanceof HTMLSpanElement && !node.hasAttribute("data-pause")) {
        node.style.opacity = "1";
      }
      this.typewriterIndex++;
    }, this.textSpeed);
  }

  private skipToNextPauseOrEnd() {
    // Afficher immédiatement tout le texte jusqu'au prochain [l] ou la fin
    while (this.typewriterIndex < this.typewriterNodes.length) {
      const node = this.typewriterNodes[this.typewriterIndex];
      if (node instanceof HTMLSpanElement && node.hasAttribute("data-pause")) {
        this.typewriterIndex++; // passer le marqueur
        this.isPaused = true;
        this.stopTypewriter();
        return;
      }
      if (node instanceof HTMLSpanElement && !node.hasAttribute("data-pause")) {
        node.style.opacity = "1";
      }
      this.typewriterIndex++;
    }
    this.finishTypewriter();
  }

  private finishTypewriter() {
    this.stopTypewriter();
    for (const node of this.typewriterNodes) {
      if (node instanceof HTMLSpanElement && !node.hasAttribute("data-pause")) {
        node.style.opacity = "1";
      }
    }
    this.isTyping = false;
    this.isPaused = false;
    // Si auto mode, planifier l'avance
    if (this.autoMode) {
      this.scheduleAutoAdvance();
    } else if (this.skipMode) {
      this.advance();
    }
  }

  // ── Auto mode ──

  private toggleAutoMode() {
    this.autoMode = !this.autoMode;
    this.updateAutoButton();
    if (this.autoMode && !this.isTyping && !this.isPaused) {
      this.scheduleAutoAdvance();
    }
    if (!this.autoMode) {
      this.cancelAutoAdvance();
    }
  }

  private scheduleAutoAdvance() {
    this.cancelAutoAdvance();
    // Calculer le délai basé sur la longueur du texte
    const textLength = this.textEl.textContent?.length ?? 0;
    const delay = Math.max(1500, Math.min(this.autoDelay, textLength * 80));
    this.autoTimer = setTimeout(() => {
      if (this.autoMode) {
        if (this.isPaused) {
          this.isPaused = false;
          this.resumeTypewriter();
        } else {
          this.advance();
        }
      }
    }, delay);
  }

  private cancelAutoAdvance() {
    if (this.autoTimer) {
      clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
  }

  // ── Wait timer (@wait) ──

  private startWait(timeMs: number) {
    this.cancelWait();
    this.isWaiting = true;
    this.waitTimer = setTimeout(() => {
      this.isWaiting = false;
      this.waitTimer = null;
      if (this.autoMode) {
        this.scheduleAutoAdvance();
      } else if (this.skipMode) {
        this.advance();
      }
    }, timeMs);
  }

  private cancelWait() {
    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
    this.isWaiting = false;
  }

  private updateAutoButton() {
    const btn = document.getElementById("btn-auto");
    if (btn) {
      btn.textContent = this.autoMode ? "⏸ Auto" : "▶ Auto";
      btn.style.color = this.autoMode ? "rgba(255, 200, 100, 0.9)" : "";
    }
  }

  private stopTypewriter() {
    if (this.typewriterTimer) {
      clearInterval(this.typewriterTimer);
      this.typewriterTimer = null;
    }
  }

  render(snapshot: RuntimeSnapshot) {
    // Sauvegarder dans l'historique
    this.addToHistory(snapshot);

    const display = snapshot.display;

    // Background
    const bg = display.background;
    if (bg) {
      this.renderBackground(bg, snapshot.transition, 1200);
    }

    // Sprites / foregrounds + animation
    this.renderLayers(display.layers, snapshot.pendingAnimation);

    // Staff roll
    this.renderStaffroll(snapshot.state.staffroll);

    // Visual effects (noise / haze)
    this.renderEffect(snapshot.pendingEffect);

    // BGM
    if (snapshot.state.bgm) {
      this.audio.playBgm(snapshot.state.bgm, resolveBgm);
    } else if (snapshot.pendingAudioAction?.action === "stopBgm") {
      this.audio.stopBgm();
    } else if (snapshot.pendingAudioAction?.action === "fadeBgm") {
      this.audio.stopBgm(snapshot.pendingAudioAction.time);
    }

    // SE
    if (snapshot.state.se) {
      this.audio.playSe(snapshot.state.se, resolveSe);
    } else if (snapshot.pendingAudioAction?.action === "stopSe") {
      this.audio.stopSe(snapshot.pendingAudioAction.time ?? 0);
    } else if (snapshot.pendingAudioAction?.action === "fadeSe") {
      const action = snapshot.pendingAudioAction;
      if (!action.storage || action.storage === this.audio.getCurrentSe()) {
        this.audio.fadeSe(action.time, action.volume / 100);
      }
    }

    // Quake effect
    if (snapshot.pendingQuake) {
      this.startQuake(snapshot.pendingQuake);
    }

    // Textbox visibility
    if (snapshot.pendingTextbox) {
      this.setTextboxVisible(snapshot.pendingTextbox.visible, snapshot.pendingTextbox.time);
    }

    // Textbox frame visibility
    if (snapshot.pendingFrame) {
      this.setTextboxFrameVisible(snapshot.pendingFrame.visible);
    }

    // Text with typewriter effect
    const nodes = segmentsToDom(snapshot.segments);
    if (nodes.length > 0) {
      this.startTypewriter(nodes);
    } else {
      this.textEl.innerHTML = "";
      this.isTyping = false;
    }
  }

  // ── History ──

  private addToHistory(snapshot: RuntimeSnapshot) {
    // Garder seulement le texte (pas l'état complet pour économiser la mémoire)
    if (snapshot.text.trim().length === 0) return;
    this.history.push(snapshot);
    this.historyIndex = this.history.length - 1;
  }

  private showHistory(direction: 1 | -1) {
    if (this.history.length === 0) return;

    const newIndex = this.historyIndex + direction;
    if (newIndex < 0 || newIndex >= this.history.length) return;

    this.historyIndex = newIndex;
    this.isShowingHistory = true;
    this.cancelAutoAdvance();

    // Afficher la page d'historique
    const snapshot = this.history[this.historyIndex];
    this.textEl.innerHTML = "";

    // Afficher le texte directement (pas de typewriter)
    for (const seg of snapshot.segments) {
      if ("pause" in seg && seg.pause) continue;
      if (!("text" in seg)) continue;
      if (seg.text === "\n") {
        this.textEl.appendChild(document.createElement("br"));
      } else if (seg.ruby) {
        const ruby = document.createElement("ruby");
        ruby.textContent = seg.text;
        const rt = document.createElement("rt");
        rt.textContent = seg.ruby;
        ruby.appendChild(rt);
        this.textEl.appendChild(ruby);
      } else {
        this.textEl.appendChild(document.createTextNode(seg.text));
      }
    }

    // Indicateur d'historique
    const indicator = document.createElement("div");
    indicator.id = "history-indicator";
    indicator.textContent = `◀ Historique ${this.historyIndex + 1}/${this.history.length} ▶`;
    this.textEl.appendChild(indicator);
  }

  private hideHistory() {
    this.isShowingHistory = false;
    // Re-afficher la page courante
    if (this.history.length > 0) {
      const current = this.history[this.history.length - 1];
      const nodes = segmentsToDom(current.segments);
      this.textEl.innerHTML = "";
      for (const node of nodes) {
        if (node instanceof HTMLSpanElement && node.hasAttribute("data-pause")) continue;
        if (node instanceof HTMLSpanElement) {
          node.style.opacity = "1";
          node.style.transition = "";
        }
        this.textEl.appendChild(node);
      }
    }
  }
}

const player = new Player();
