import type { AssetResolver } from "@/core/asset-resolver.js";
import type {
  AssetRef,
  Awaitable,
  EffectState,
  Ms,
  RenderEvent,
  SceneState,
  SpriteState,
  StaffrollState,
  StageSnapshot,
  TextboxState,
} from "@/kag/events.js";
import type { AnimationDef, TextSegment } from "@/kag/types.js";
import type { DisplaySettings, RunOptions, StageRenderer, StageRendererDeps } from "./types.js";

/**
 * Implémentation DOM de StageRenderer.
 *
 * Hypothèses simplificatrices (documentées dans docs/agents/A-QUESTIONS.md) :
 * - `universal` = crossfade (rule/vague ignorés).
 * - Les animations se résolvent immédiatement en mode instant ; sinon elles
 *   tournent en CSS et peuvent être attendues via `waitFor("animation")`.
 * - Les effets `noise`/`haze` sont rendus par des calques CSS approximatifs.
 */
export class DomStageRenderer implements StageRenderer {
  private resolver: AssetResolver;
  private root: HTMLElement | null = null;

  private container: HTMLElement | null = null;
  private bgEl: HTMLElement | null = null;
  private spritesEl: HTMLElement | null = null;
  private effectsEl: HTMLElement | null = null;
  private textboxEl: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private indicatorEl: HTMLElement | null = null;

  private settings: DisplaySettings = {
    textSpeed: 30,
    autoDelay: 2000,
    fontScale: 1,
    textboxOpacity: 0.8,
  };

  private userHidden = false;
  private currentScene: SceneState = { bg: null, sprites: [], effect: null };
  private text: TextSegment[] = [];
  private textbox: TextboxState = { visible: true, frame: true };
  private staffroll: StaffrollState | null = null;

  private typewriterTimer: ReturnType<typeof setTimeout> | null = null;
  private typewriterResolve: (() => void) | null = null;
  private typewriterHurry = false;

  private transitionPromise: Promise<void> | null = null;
  private transitionResolve: (() => void) | null = null;

  private animations = new Map<string, AnimationController>();
  private quakeTimer: ReturnType<typeof setTimeout> | null = null;
  private quakeResolve: (() => void) | null = null;

  private staffrollTimer: ReturnType<typeof setTimeout> | null = null;
  private staffrollResolve: (() => void) | null = null;

  constructor(deps: StageRendererDeps) {
    this.resolver = deps.resolver;
  }

  mount(root: HTMLElement): void {
    if (this.root) throw new Error("DomStageRenderer déjà monté");
    this.root = root;
    this.injectStyles();

    this.container = document.createElement("div");
    this.container.className = "mh-stage";

    const stage = document.createElement("div");
    stage.className = "mh-stage-scene";
    stage.id = "stage";

    this.bgEl = document.createElement("div");
    this.bgEl.className = "mh-stage-bg";
    this.bgEl.id = "stage-bg";

    this.spritesEl = document.createElement("div");
    this.spritesEl.className = "mh-stage-sprites";
    this.spritesEl.id = "stage-sprites";

    this.effectsEl = document.createElement("div");
    this.effectsEl.className = "mh-stage-effects";
    this.effectsEl.id = "stage-effects";

    stage.append(this.bgEl, this.spritesEl, this.effectsEl);

    this.textboxEl = document.createElement("div");
    this.textboxEl.className = "mh-stage-textbox";
    this.textboxEl.id = "textbox";

    const frame = document.createElement("div");
    frame.className = "mh-stage-textbox-frame";
    frame.id = "textbox-frame";

    this.textEl = document.createElement("div");
    this.textEl.className = "mh-stage-text";
    this.textEl.id = "text";

    this.indicatorEl = document.createElement("div");
    this.indicatorEl.className = "mh-stage-indicator";
    this.indicatorEl.id = "textbox-indicator";

    this.textboxEl.append(frame, this.textEl, this.indicatorEl);

    this.container.append(stage, this.textboxEl);
    root.appendChild(this.container);

    this.applyTextbox();
  }

  async apply(events: readonly RenderEvent[], opts: RunOptions): Promise<void> {
    if (!this.container) throw new Error("DomStageRenderer non monté");

    const hasText = events.some((e) => e.kind === "text" || e.kind === "lineBreak");
    const hadText = this.text.length > 0;

    for (const event of events) {
      if (event.kind === "audio") continue;
      await this.applyEvent(event, opts);
    }

    if (hasText || (hadText && events.some((e) => e.kind === "clearText"))) {
      return this.runTypewriter(opts);
    }
    return Promise.resolve();
  }

  async waitFor(what: Exclude<Awaitable, "audio">, target: string | undefined, signal: AbortSignal): Promise<void> {
    let promise: Promise<void> | null = null;
    switch (what) {
      case "transition":
        promise = this.transitionPromise;
        break;
      case "animation":
        promise = target ? this.animations.get(target)?.promise ?? null : null;
        break;
      case "quake":
        promise = this.quakeResolve && this.quakePromise ? this.quakePromise() : null;
        break;
    }
    if (!promise) return;
    if (signal.aborted) return;
    await Promise.race([promise, new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))]).catch(() => {});
  }

  hurry(): void {
    this.typewriterHurry = true;
    if (this.typewriterResolve) {
      this.typewriterResolve();
      this.typewriterResolve = null;
    }
    if (this.transitionResolve) {
      this.transitionResolve();
      this.transitionResolve = null;
    }
    for (const ctrl of this.animations.values()) ctrl.hurry();
    if (this.quakeResolve) {
      this.quakeResolve();
      this.quakeResolve = null;
    }
  }

  setClickIndicator(style: "line" | "page" | null): void {
    if (!this.indicatorEl) return;
    this.indicatorEl.textContent = style === "page" ? "▼" : style === "line" ? "▽" : "";
    this.indicatorEl.style.visibility = style ? "visible" : "hidden";
  }

  setUserHidden(hidden: boolean): void {
    this.userHidden = hidden;
    this.applyTextbox();
  }

  async restore(snapshot: StageSnapshot, signal: AbortSignal): Promise<void> {
    this.currentScene = snapshot.scene;
    this.text = [...snapshot.text];
    this.textbox = snapshot.textbox;
    this.staffroll = snapshot.staffroll;
    this.renderScene(true);
    this.renderText(true);
    this.applyTextbox();
    if (signal.aborted) return;
  }

  async preload(assets: readonly AssetRef[], signal?: AbortSignal): Promise<void> {
    const urls = assets.map((a) => this.resolveAsset(a));
    await Promise.all(
      urls.map(
        (url) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => {
              console.warn("preload failed", url);
              resolve();
            };
            if (signal?.aborted) return resolve();
            img.src = url;
            signal?.addEventListener("abort", () => resolve(), { once: true });
          }),
      ),
    );
  }

  async captureThumbnail(maxWidth: number): Promise<Blob | null> {
    if (!this.container) return null;
    const canvas = document.createElement("canvas");
    const rect = this.container.getBoundingClientRect();
    const scale = maxWidth / rect.width;
    canvas.width = maxWidth;
    canvas.height = rect.height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/webp", 0.85);
    });
  }

  setSettings(settings: Readonly<DisplaySettings>): void {
    this.settings = { ...settings };
    this.applyTextbox();
    if (this.textEl) {
      this.textEl.style.fontSize = `${1.5 * settings.fontScale}rem`;
    }
  }

  clear(): void {
    this.currentScene = { bg: null, sprites: [], effect: null };
    this.text = [];
    this.textbox = { visible: true, frame: true };
    this.staffroll = null;
    this.renderScene(true);
    this.renderText(true);
    this.applyTextbox();
  }

  dispose(): void {
    this.clearTimers();
    if (this.container && this.root) {
      this.root.removeChild(this.container);
    }
    this.root = null;
    this.container = null;
  }

  // ── Interne ──

  private injectStyles(): void {
    if (document.getElementById("mh-stage-styles")) return;
    const style = document.createElement("style");
    style.id = "mh-stage-styles";
    style.textContent = `
      .mh-stage {
        position: absolute;
        inset: 0;
        overflow: hidden;
        font-family: sans-serif;
      }
      .mh-stage-scene {
        position: absolute;
        inset: 0;
        z-index: 0;
      }
      .mh-stage-bg {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center;
        z-index: 0;
      }
      .mh-stage-sprites {
        position: absolute;
        inset: 0;
        z-index: 10;
      }
      .mh-stage-sprite {
        position: absolute;
        transform: translate(-50%, -50%);
        transition: opacity 0.3s ease;
      }
      .mh-stage-effects {
        position: absolute;
        inset: 0;
        z-index: 20;
        pointer-events: none;
      }
      .mh-stage-noise {
        position: absolute;
        inset: 0;
        opacity: 0;
        pointer-events: none;
        background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      }
      .mh-stage-haze {
        position: absolute;
        inset: 0;
        opacity: 0;
        pointer-events: none;
        background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.4), transparent 60%);
        animation: mh-haze-pulse 2s ease-in-out infinite;
      }
      @keyframes mh-haze-pulse {
        0%, 100% { opacity: 0.2; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.05); }
      }
      .mh-stage-textbox {
        position: absolute;
        left: 10%;
        right: 10%;
        bottom: 5%;
        min-height: 140px;
        z-index: 30;
        transition: opacity 0.3s ease;
        pointer-events: auto;
      }
      .mh-stage-textbox-frame {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,0.7);
        border: 2px solid rgba(255,255,255,0.3);
        border-radius: 8px;
      }
      .mh-stage-text {
        position: relative;
        padding: 20px 24px;
        color: #fff;
        font-size: 1.5rem;
        line-height: 1.6;
        white-space: pre-wrap;
        min-height: 100px;
      }
      .mh-stage-indicator {
        position: absolute;
        right: 24px;
        bottom: 16px;
        color: #fff;
        font-size: 1.2rem;
        animation: mh-indicator-blink 1s infinite;
      }
      @keyframes mh-indicator-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
    `;
    document.head.appendChild(style);
  }

  private async applyEvent(event: RenderEvent, opts: RunOptions): Promise<void> {
    switch (event.kind) {
      case "scene": {
        const oldScene = this.currentScene;
        this.currentScene = event.scene;
        const transitionTime = event.transition.method === "none" ? 0 : event.transition.time;
        await this.transitionScene(oldScene, event.scene, transitionTime, opts);
        break;
      }
      case "text": {
        this.text.push(...event.segments);
        break;
      }
      case "lineBreak": {
        this.text.push({ text: "\n" });
        break;
      }
      case "clearText": {
        this.text = [];
        break;
      }
      case "textbox": {
        this.textbox = event.state;
        this.applyTextbox();
        break;
      }
      case "effect": {
        this.currentScene = { ...this.currentScene, effect: event.effect };
        this.renderEffect();
        break;
      }
      case "animate": {
        this.startAnimation(event.target, event.def, opts);
        break;
      }
      case "stopAnimation": {
        if (event.target) this.stopAnimation(event.target);
        else {
          for (const [id] of this.animations) this.stopAnimation(id);
        }
        break;
      }
      case "quake": {
        if (event.quake) this.startQuake(event.quake, opts);
        else this.stopQuake();
        break;
      }
      case "staffroll": {
        this.staffroll = event.state;
        this.renderStaffroll(opts);
        break;
      }
      case "audio":
        break;
    }
  }

  private renderScene(instant: boolean): void {
    if (!this.bgEl || !this.spritesEl) return;
    const bg = this.currentScene.bg;
    this.bgEl.style.backgroundImage = bg ? `url(${this.resolver.background(bg)})` : "none";
    this.bgEl.style.backgroundColor = bg ? "" : "#000";

    const sprites = [...this.currentScene.sprites].sort((a, b) => a.z - b.z);
    this.spritesEl.innerHTML = "";
    for (const s of sprites) {
      const img = document.createElement("img");
      img.className = "mh-stage-sprite";
      img.src = this.resolver.image(s.storage);
      img.style.left = `${s.x}px`;
      img.style.top = `${s.y}px`;
      img.style.opacity = String(s.opacity);
      img.alt = "";
      this.spritesEl.appendChild(img);
    }

    if (!instant) {
      this.bgEl.style.opacity = "0";
      void this.bgEl.offsetHeight;
      this.bgEl.style.transition = "opacity 0.3s ease";
      this.bgEl.style.opacity = "1";
    }

    this.renderEffect();
  }

  private async transitionScene(from: SceneState, to: SceneState, time: Ms, opts: RunOptions): Promise<void> {
    this.currentScene = to;
    if (opts.instant || time <= 0) {
      this.renderScene(true);
      return;
    }

    this.renderScene(true);
    if (!this.bgEl) return;

    const overlay = document.createElement("div");
    overlay.className = "mh-stage-bg";
    overlay.style.cssText = this.bgEl.style.cssText;
    overlay.style.zIndex = "5";
    overlay.style.opacity = "1";
    this.bgEl.parentElement?.appendChild(overlay);

    this.transitionPromise = new Promise((resolve) => {
      this.transitionResolve = resolve;
      setTimeout(resolve, time);
    });

    requestAnimationFrame(() => {
      overlay.style.transition = `opacity ${time}ms ease`;
      overlay.style.opacity = "0";
    });

    await this.transitionPromise;
    overlay.remove();
    this.transitionPromise = null;
    this.transitionResolve = null;
  }

  private renderEffect(): void {
    if (!this.effectsEl) return;
    this.effectsEl.innerHTML = "";
    const effect = this.currentScene.effect;
    if (!effect) return;
    if (effect.kind === "noise") {
      const el = document.createElement("div");
      el.className = "mh-stage-noise";
      el.style.opacity = String(effect.opacity > 1 ? effect.opacity / 255 : effect.opacity);
      if (effect.monocro) el.style.filter = "grayscale(100%)";
      this.effectsEl.appendChild(el);
    } else if (effect.kind === "haze") {
      const el = document.createElement("div");
      el.className = "mh-stage-haze";
      el.style.opacity = String(Math.min(1, effect.power / 20));
      this.effectsEl.appendChild(el);
    }
  }

  private startAnimation(target: string, def: AnimationDef, opts: RunOptions): void {
    this.stopAnimation(target);
    if (opts.instant) return;
    const ctrl = new AnimationController(def, () => this.stopAnimation(target));
    this.animations.set(target, ctrl);
  }

  private stopAnimation(target: string): void {
    const ctrl = this.animations.get(target);
    if (ctrl) {
      ctrl.cancel();
      this.animations.delete(target);
    }
  }

  private startQuake(spec: { hmax: number; vmax: number; time?: Ms | null }, opts: RunOptions): void {
    this.stopQuake();
    if (opts.instant) return;
    if (!this.container) return;

    const start = performance.now();
    const duration = spec.time ?? null;
    this.quakePromise = () =>
      new Promise<void>((resolve) => {
        this.quakeResolve = resolve;
        const tick = () => {
          if (!this.container) return;
          const dx = (Math.random() - 0.5) * 2 * spec.hmax;
          const dy = (Math.random() - 0.5) * 2 * spec.vmax;
          this.container.style.transform = `translate(${dx}px, ${dy}px)`;
          const elapsed = performance.now() - start;
          if (duration !== null && elapsed >= duration) {
            this.stopQuake();
            resolve();
            return;
          }
          this.quakeTimer = setTimeout(tick, 40);
        };
        tick();
      });
    this.quakePromise();
  }

  private quakePromise: (() => Promise<void>) | null = null;

  private stopQuake(): void {
    if (this.quakeTimer) clearTimeout(this.quakeTimer);
    this.quakeTimer = null;
    if (this.container) this.container.style.transform = "";
    if (this.quakeResolve) {
      this.quakeResolve();
      this.quakeResolve = null;
    }
  }

  private renderStaffroll(opts: RunOptions): void {
    if (!this.container || !this.staffroll) return;
    if (opts.instant) return;

    const el = document.createElement("div");
    el.className = "mh-stage-staffroll";
    el.style.cssText = "position:absolute;left:0;right:0;top:720px;z-index:25;text-align:center;color:#fff;";
    for (const line of this.staffroll.lines) {
      const p = document.createElement("p");
      p.textContent = line.text;
      p.style.fontSize = `${line.size}px`;
      el.appendChild(p);
    }
    this.container.appendChild(el);

    const time = this.staffroll.time;
    this.staffrollPromise = new Promise((resolve) => {
      this.staffrollResolve = resolve;
      el.style.transition = `transform ${time}ms linear`;
      requestAnimationFrame(() => {
        el.style.transform = `translateY(-${this.staffroll!.height + 720}px)`;
      });
      setTimeout(() => {
        el.remove();
        resolve();
      }, time);
    });
  }

  private staffrollPromise: Promise<void> | null = null;

  private applyTextbox(): void {
    if (!this.textboxEl || !this.textbox) return;
    const hidden = this.userHidden || !this.textbox.visible;
    this.textboxEl.style.opacity = hidden ? "0" : "1";
    const frame = this.textboxEl.querySelector(".mh-stage-textbox-frame") as HTMLElement | null;
    if (frame) {
      frame.style.opacity = String(this.settings.textboxOpacity);
      frame.style.display = this.textbox.frame ? "block" : "none";
    }
  }

  private renderText(instant: boolean): void {
    if (!this.textEl) return;
    if (instant) {
      this.textEl.textContent = this.text.map((s) => ("text" in s ? s.text : "")).join("");
      return;
    }
  }

  private runTypewriter(opts: RunOptions): Promise<void> {
    return new Promise((resolve) => {
      this.typewriterResolve = resolve;
      if (opts.instant || this.settings.textSpeed <= 0 || this.typewriterHurry) {
        this.renderText(true);
        this.typewriterResolve = null;
        this.typewriterHurry = false;
        resolve();
        return;
      }
      this.typewriterHurry = false;
      const full = this.text.map((s) => ("text" in s ? s.text : "")).join("");
      this.textEl!.textContent = "";
      let i = 0;
      const step = () => {
        if (!this.textEl) return;
        if (this.typewriterHurry) {
          this.textEl.textContent = full;
          this.typewriterResolve = null;
          resolve();
          return;
        }
        i++;
        this.textEl.textContent = full.slice(0, i);
        if (i >= full.length) {
          this.typewriterResolve = null;
          resolve();
          return;
        }
        this.typewriterTimer = setTimeout(step, this.settings.textSpeed);
      };
      step();
    });
  }

  private clearTimers(): void {
    if (this.typewriterTimer) clearTimeout(this.typewriterTimer);
    if (this.quakeTimer) clearTimeout(this.quakeTimer);
    if (this.staffrollTimer) clearTimeout(this.staffrollTimer);
    for (const ctrl of this.animations.values()) ctrl.cancel();
    this.animations.clear();
  }

  private resolveAsset(ref: AssetRef): string {
    return this.resolver.image(ref);
  }
}

class AnimationController {
  promise: Promise<void>;
  private resolve: () => void = () => {};
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(_def: AnimationDef, private onDone: () => void) {
    this.promise = new Promise((resolve) => {
      this.resolve = resolve;
      const duration = _def.keyframes[_def.keyframes.length - 1]?.time ?? 0;
      this.timer = setTimeout(() => {
        this.resolve();
        this.onDone();
      }, duration);
    });
  }

  hurry(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.resolve();
    this.onDone();
  }

  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.resolve();
  }
}

export function createDomStageRenderer(deps: StageRendererDeps): StageRenderer {
  return new DomStageRenderer(deps);
}
