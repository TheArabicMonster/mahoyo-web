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
import { compileAction, type DiscreteChange } from "./action-compiler.js";

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
  /** Calque(s) overlay pour le crossfade de fond (transition non-bloquante). */
  private bgOverlays: HTMLElement[] = [];
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
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;

  private animations = new Map<string, AnimationController>();
  /**
   * Sprites courants par id (réconciliation, pas de innerHTML="").
   * Clé = SpriteState.id. Permet aux éléments DOM de survivre entre scènes
   * (et donc aux animations CSS/WAAPI qui y tournent).
   */
  private spriteEls = new Map<string, HTMLImageElement>();
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
    // Termine la transition courante immédiatement (clear timer + overlays + resolve).
    this.finishTransition();
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
    this.finishTransition();
    this.clearBgOverlays();
    this.spriteEls.clear();
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
    this.finishTransition();
    this.clearBgOverlays();
    this.spriteEls.clear();
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
    this.finishTransition();
    this.clearBgOverlays();
    this.spriteEls.clear();
    if (this.container && this.root) {
      this.root.removeChild(this.container);
    }
    this.root = null;
    this.container = null;
  }

  /** Termine immédiatement la transition courante (si any) sans attendre. */
  private finishTransition(): void {
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
    const resolve = this.transitionResolve;
    this.transitionResolve = null;
    this.transitionPromise = null;
    this.clearBgOverlays();
    if (resolve) resolve();
  }

  // ── Interne ──

  private injectStyles(): void {
    if (document.getElementById("mh-stage-styles")) return;
    const style = document.createElement("style");
    style.id = "mh-stage-styles";
    style.textContent = `
      .mh-stage {
        position: absolute;
        left: 0;
        top: 0;
        width: 1024px;
        height: 576px;
        transform: scale(1.25);
        transform-origin: 0 0;
        overflow: hidden;
        font-family: inherit;
      }
      .mh-stage-scene {
        position: absolute;
        inset: 0;
        z-index: 0;
      }
      .mh-stage-bg {
        position: absolute;
        inset: 0;
        background-size: auto;
        background-position: 50% 50%;
        background-repeat: no-repeat;
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
        // Non-bloquant : on démarre la transition et on rend la main.
        // waitFor("transition") permettra au player d'attendre sa fin.
        this.startTransition(oldScene, event.scene, transitionTime, opts);
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

  /**
   * Réconcilie les sprites de la scène courante avec le DOM.
   *
   * On garde un `Map<id, HTMLImageElement>` : les sprites dont l'id persiste
   * sont mis à jour (position/opacity/src) sans être recréés — c'est
   * indispensable pour que les animations CSS/WAAPI qui ciblent un calque
   * survivent entre deux scènes. Les sprites absents de la nouvelle scène
   * sont retirés ; les nouveaux sont créés et insérés dans l'ordre z.
   */
  private renderScene(instant: boolean): void {
    if (!this.bgEl || !this.spritesEl) return;
    const bg = this.currentScene.bg;
    this.bgEl.style.backgroundImage = bg ? `url(${this.resolver.background(bg)})` : "none";
    this.bgEl.style.backgroundColor = bg ? "" : "#000";
    // Positionnement natif (repère 1024×576) : left/top explicites sinon centrage.
    if (bg) {
      const left = this.currentScene.bgLeft;
      const top = this.currentScene.bgTop;
      this.bgEl.style.backgroundPosition =
        left !== undefined && top !== undefined ? `${left}px ${top}px` : "50% 50%";
    }

    const sprites = [...this.currentScene.sprites].sort((a, b) => a.z - b.z);
    const seen = new Set<string>();

    for (const s of sprites) {
      seen.add(s.id);
      let img = this.spriteEls.get(s.id);
      if (!img) {
        img = document.createElement("img");
        img.className = "mh-stage-sprite";
        img.alt = "";
        img.dataset.spriteId = s.id;
        this.spriteEls.set(s.id, img);
      }
      // Mise à jour src (peut changer via @chgfg).
      const src = this.resolver.image(s.storage);
      if (img.src !== src && !img.src.endsWith(src)) img.src = src;
      img.style.left = `${s.x}px`;
      img.style.top = `${s.y}px`;
      img.style.opacity = String(s.opacity);
      img.style.zIndex = String(s.z);
      // Réordonne selon z : appendChild déplace l'élément à la fin (au-dessus).
      this.spritesEl.appendChild(img);
    }

    // Retire les sprites disparus.
    for (const [id, el] of this.spriteEls) {
      if (!seen.has(id)) {
        el.remove();
        this.spriteEls.delete(id);
      }
    }

    if (!instant) {
      this.bgEl.style.opacity = "0";
      void this.bgEl.offsetHeight;
      this.bgEl.style.transition = "opacity 0.3s ease";
      this.bgEl.style.opacity = "1";
    }

    this.renderEffect();
  }

  /**
   * Démarre une transition non-bloquante entre `from` et `to`.
   *
   * - Réconcilie les sprites vers `to` immédiatement (les calques persistent).
   * - Pour le crossfade de fond : on pose un overlay avec l'ancien fond par-dessus
   *   le nouveau, puis on fade out l'overlay. Le nouveau fond apparaît dessous.
   * - `transitionPromise` est résolu après `time` ms (ou immédiatement via hurry()).
   * - Si une transition était déjà en cours, on la termine d'abord (clear overlays).
   *
   * Non-await : `apply()` rend la main avant la fin de la transition.
   */
  private startTransition(from: SceneState, to: SceneState, time: Ms, opts: RunOptions): void {
    // Termine une transition précédente éventuelle (clear timer + overlays).
    this.finishTransition();

    this.currentScene = to;

    if (opts.instant || time <= 0) {
      this.renderScene(true);
      return;
    }

    // Rend la nouvelle scène (sprites réconciliés + nouveau fond).
    this.renderScene(true);
    if (!this.bgEl) return;

    // Overlay avec l'ancien fond, par-dessus, qui fade out.
    const oldBg = from.bg;
    if (oldBg) {
      const overlay = document.createElement("div");
      overlay.className = "mh-stage-bg mh-stage-bg-overlay";
      overlay.style.cssText = this.bgEl.style.cssText;
      overlay.style.backgroundImage = `url(${this.resolver.background(oldBg)})`;
      if (from.bgLeft !== undefined && from.bgTop !== undefined) {
        overlay.style.backgroundPosition = `${from.bgLeft}px ${from.bgTop}px`;
      }
      overlay.style.zIndex = "5";
      overlay.style.opacity = "1";
      this.bgEl.parentElement?.appendChild(overlay);
      this.bgOverlays.push(overlay);

      requestAnimationFrame(() => {
        overlay.style.transition = `opacity ${time}ms ease`;
        overlay.style.opacity = "0";
      });
    }

    // Promise résolu à la fin de la transition (ou via hurry/finishTransition).
    this.transitionPromise = new Promise<void>((resolve) => {
      this.transitionResolve = resolve;
      this.transitionTimer = setTimeout(() => {
        this.onTransitionEnd();
        resolve();
      }, time);
    });
  }

  private onTransitionEnd(): void {
    this.transitionTimer = null;
    this.transitionResolve = null;
    this.transitionPromise = null;
    this.clearBgOverlays();
  }

  private clearBgOverlays(): void {
    for (const el of this.bgOverlays) el.remove();
    this.bgOverlays = [];
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
    if (opts.instant) {
      // Mode instant : applique l'état final de l'animation sans la jouer.
      this.applyAnimationFinal(def);
      return;
    }
    // Récupère l'élément sprite persistant (réconciliation PR 5).
    const el = this.spriteEls.get(target) ?? this.findPartbgEl(def);
    const ctrl = new AnimationController(def, target, el, this.resolver, () => this.stopAnimation(target));
    this.animations.set(target, ctrl);
  }

  /** Applique l'état final d'une animation sur le sprite cible (mode instant). */
  private applyAnimationFinal(def: AnimationDef): void {
    const last = def.keyframes[def.keyframes.length - 1];
    if (!last) return;
    const el = this.spriteEls.get(def.id ?? def.storage);
    if (!el) return;
    if (last.center !== undefined) el.style.left = `${last.center}px`;
    if (last.vcenter !== undefined) el.style.top = `${last.vcenter}px`;
    if (last.opacity !== undefined) el.style.opacity = String(last.opacity);
    if (last.zoomx !== undefined || last.zoomy !== undefined) {
      el.style.transform = `scale(${last.zoomx ?? 1}, ${last.zoomy ?? 1})`;
    }
    if (last.rotate !== undefined) {
      el.style.transform = `${el.style.transform || ""} rotate(${last.rotate}deg)`.trim();
    }
  }

  /** Pour @fgact sur un partbg (PR 7) : recherche l'élément partbg par id. */
  private findPartbgEl(def: AnimationDef): HTMLElement | null {
    if (!def.partbgid || !this.container) return null;
    return this.container.querySelector(`[data-partbg-id="${def.partbgid}"]`) as HTMLElement | null;
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

/**
 * Contrôleur d'animation basé sur Web Animations API.
 *
 * - Compile le `AnimationDef` via `compileAction` (keyframes WAAPI + discrete).
 * - Lance `el.animate(...)` sur le sprite persistant (réconciliation PR 5).
 * - Props discrètes (storage/effect/contrast/visible/type/absolute) appliquées
 *   au bon instant via setTimeout.
 * - `loop` → iterations: Infinity. `hurry()` épargne les loops (elles
 *   continuent en arrière-plan) mais résout le promise (pour @wact skip).
 * - `cancel()` (via @stopaction) annule tout.
 *
 * Fallback : si `el.animate` n'existe pas (jsdom), on simule via setTimeout
 * (pas d'animation visuelle, juste la timing + discrete).
 */
class AnimationController {
  promise: Promise<void>;
  private resolveFn: () => void = () => {};
  private animation: Animation | null = null;
  private discreteTimers: ReturnType<typeof setTimeout>[] = [];
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly loop: boolean;

  constructor(
    def: AnimationDef,
    private target: string,
    private el: HTMLElement | null,
    private resolver: AssetResolver,
    private onDone: () => void,
  ) {
    this.loop = !!def.loop;
    this.promise = new Promise((resolve) => {
      this.resolveFn = resolve;
    });
    this.run(def);
  }

  private run(def: AnimationDef): void {
    const compiled = compileAction(def);
    if (!compiled) {
      // Duration <= 0 : applique l'état final puis termine.
      this.applyDiscrete(def, 0);
      this.finish();
      return;
    }

    // Changements discrets programmés.
    this.scheduleDiscrete(compiled.discrete, def);

    if (this.el && typeof this.el.animate === "function") {
      // WAAPI : lance l'animation sur l'élément persistant.
      const anim = this.el.animate(compiled.keyframes, {
        duration: compiled.duration,
        iterations: compiled.iterations,
        fill: "forwards",
      });
      this.animation = anim;
      if (!this.loop) {
        anim.onfinish = () => this.finish();
      } else {
        // Loop : le promise n'est jamais résolu naturellement (animation infinie).
        // On résout seulement via hurry()/cancel().
      }
    } else {
      // Fallback jsdom : setTimeout pour la durée.
      this.fallbackTimer = setTimeout(() => this.finish(), compiled.duration);
    }
  }

  /** Applique les changements discrets selon leur timing absolu. */
  private scheduleDiscrete(discrete: DiscreteChange[], def: AnimationDef): void {
    for (const change of discrete) {
      if (change.time <= 0) {
        // Immédiat.
        this.applyDiscreteChange(change, def);
      } else {
        const t = setTimeout(() => this.applyDiscreteChange(change, def), change.time);
        this.discreteTimers.push(t);
      }
    }
  }

  /** Applique tous les changements discrets d'un def jusqu'à un temps donné (fallback). */
  private applyDiscrete(def: AnimationDef, _upToTime: number): void {
    const compiled = compileAction(def);
    if (!compiled) return;
    for (const change of compiled.discrete) {
      this.applyDiscreteChange(change, def);
    }
  }

  private applyDiscreteChange(change: DiscreteChange, def: AnimationDef): void {
    if (!this.el) return;
    switch (change.field) {
      case "storage": {
        const src = this.resolver.image(change.value as string);
        if ((this.el as HTMLImageElement).src !== src) (this.el as HTMLImageElement).src = src;
        break;
      }
      case "absolute":
        this.el.style.zIndex = String(change.value);
        break;
      case "visible":
        this.el.style.visibility = change.value ? "visible" : "hidden";
        break;
      case "effect":
      case "contrast":
      case "type":
        // Effets de filtre non gérés ici (PR futur). No-op silencieux.
        break;
    }
  }

  /** Termine l'animation (résout le promise + onDone). */
  private finish(): void {
    this.clearTimers();
    this.resolveFn();
    this.onDone();
  }

  /**
   * Hurry : résout le promise (pour @wact skip) mais ÉPARGNE les loops
   * (l'animation WAAPI continue en arrière-plan). Pour les animations non-loop,
   * on termine réellement (finish de l'animation WAAPI).
   */
  hurry(): void {
    this.clearTimers();
    if (this.loop) {
      // Loop : on résout le promise sans arrêter l'animation.
      this.resolveFn();
    } else {
      // Non-loop : termine immédiatement (jump à la fin).
      if (this.animation) {
        try {
          this.animation.finish();
        } catch {
          this.animation.cancel();
        }
      }
      this.finish();
    }
  }

  /** Cancel (@stopaction) : annule tout (loops y compris). */
  cancel(): void {
    this.clearTimers();
    if (this.animation) {
      this.animation.cancel();
      this.animation = null;
    }
    this.resolveFn();
  }

  private clearTimers(): void {
    for (const t of this.discreteTimers) clearTimeout(t);
    this.discreteTimers = [];
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }
}

export function createDomStageRenderer(deps: StageRendererDeps): StageRenderer {
  return new DomStageRenderer(deps);
}
