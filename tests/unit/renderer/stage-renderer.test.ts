import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDomStageRenderer, STAGE_SCALE } from "@/renderer/stage-renderer.js";
import { FRAME_TEXT_LINE_HEIGHT, FRAME_TEXT_REM } from "@/renderer/text-fit.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import { compileAction } from "@/renderer/action-compiler.js";
import { partbgInnerTransform } from "@/renderer/transform-helpers.js";
import type { RenderEvent, SceneState, StageSnapshot, TimelineLayerState } from "@/kag/events.js";
import { DEFAULT_DISPLAY_SETTINGS, type DisplaySettings } from "@/renderer/types.js";

const display = (o: Partial<DisplaySettings> = {}): DisplaySettings => ({ ...DEFAULT_DISPLAY_SETTINGS, ...o });

type MockAnim = {
  element: HTMLElement;
  onfinish: (() => void) | null;
  finish: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  commitStyles: ReturnType<typeof vi.fn>;
};

async function withMockAnimate<T>(
  fn: (mocks: { getAnims: () => MockAnim[] }) => Promise<T>,
): Promise<T> {
  const anims: MockAnim[] = [];
  const original = (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (
    this: HTMLElement,
    _keyframes: Keyframe[],
    _options: KeyframeAnimationOptions,
  ) {
    const anim: MockAnim = {
      element: this,
      onfinish: null,
      finish: vi.fn(() => {
        if (anim.onfinish) anim.onfinish();
      }),
      cancel: vi.fn(),
      commitStyles: vi.fn(),
    };
    anims.push(anim);
    return anim as unknown as Animation;
  };
  try {
    return await fn({ getAnims: () => anims });
  } finally {
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = original;
  }
}

describe("DomStageRenderer", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer>;
  /** Calque <img> de fond actif (double tampon #373). */
  const bgLayer = (): HTMLImageElement | null =>
    [...root.querySelectorAll<HTMLImageElement>("#stage-bg .mh-stage-bg-layer")].find((l) => l.style.display !== "none") ?? null;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    renderer = createDomStageRenderer({ resolver: createAssetResolver() });
    renderer.mount(root);
  });

  afterEach(() => {
    renderer.dispose();
    root.remove();
  });

  it("monte le DOM de scène et de textbox", () => {
    expect(root.querySelector(".mh-stage")).not.toBeNull();
    expect(root.querySelector("#stage-bg")).not.toBeNull();
    expect(root.querySelector("#textbox")).not.toBeNull();
  });

  it("applique un background", async () => {
    const events: RenderEvent[] = [
      { kind: "scene", scene: { bg: "black", sprites: [], effect: null }, transition: { method: "none" } },
    ];
    await renderer.apply(events, { instant: true, signal: new AbortController().signal });
    const layer = bgLayer();
    expect(layer?.src).toContain("black.webp");
  });

  it("@bg sans left/top : position par défaut du moteur, X centré et bas + 48 px (#249)", async () => {
    const events: RenderEvent[] = [
      { kind: "scene", scene: { bg: "black", sprites: [], effect: null }, transition: { method: "none" } },
    ];
    await renderer.apply(events, { instant: true, signal: new AbortController().signal });
    // `@bg` (tagex.tjs) pose top = 576 - hauteurImage + 48 ; en CSS sans connaître la taille :
    // «100% + 48px» place le bas de l'image 48 px sous le bas de l'écran (object-position, #373).
    expect(bgLayer()!.style.objectPosition).toBe("50% calc(100% + 48px)");
  });

  it("@bg avec left seul : X explicite, Y par défaut du moteur (#249)", async () => {
    const events: RenderEvent[] = [
      { kind: "scene", scene: { bg: "black", bgLeft: 10, sprites: [], effect: null }, transition: { method: "none" } },
    ];
    await renderer.apply(events, { instant: true, signal: new AbortController().signal });
    expect(bgLayer()!.style.objectPosition).toBe("10px calc(100% + 48px)");
  });

  it("@bg avec top seul : Y explicite, X centré (#249)", async () => {
    const events: RenderEvent[] = [
      { kind: "scene", scene: { bg: "black", bgTop: 20, sprites: [], effect: null }, transition: { method: "none" } },
    ];
    await renderer.apply(events, { instant: true, signal: new AbortController().signal });
    expect(bgLayer()!.style.objectPosition).toBe("50% 20px");
  });

  it("affiche du texte en mode instant", async () => {
    const events: RenderEvent[] = [
      { kind: "clearText" },
      { kind: "text", segments: [{ text: "Hello" }] },
    ];
    await renderer.apply(events, { instant: true, signal: new AbortController().signal });
    const text = root.querySelector(".mh-stage-text") as HTMLElement;
    expect(text.textContent).toBe("Hello");
  });

  it("gère clearText", async () => {
    const events: RenderEvent[] = [
      { kind: "text", segments: [{ text: "Hello" }] },
      { kind: "clearText" },
    ];
    await renderer.apply(events, { instant: true, signal: new AbortController().signal });
    const text = root.querySelector(".mh-stage-text") as HTMLElement;
    expect(text.textContent).toBe("");
  });

  it("affiche l'indicateur de clic", async () => {
    renderer.setClickIndicator("line");
    const indicator = root.querySelector(".mh-stage-indicator") as HTMLElement;
    expect(indicator.textContent).toBe("▽");
    renderer.setClickIndicator("page");
    expect(indicator.textContent).toBe("▼");
    renderer.setClickIndicator(null);
    expect(indicator.style.visibility).toBe("hidden");
  });

  it("un seul élément DOM par id de sprite après réconciliation (#408)", async () => {
    const scene = (x: number): RenderEvent => ({
      kind: "scene",
      scene: { bg: null, sprites: [{ id: "rideau", storage: "rideau", x, y: 288, z: 1, opacity: 1 }], effect: null },
      transition: { method: "none" },
    });
    await renderer.apply([scene(100)], { instant: true, signal: new AbortController().signal });
    await renderer.apply([scene(300)], { instant: true, signal: new AbortController().signal });
    expect(root.querySelectorAll('[data-sprite-id="rideau"]')).toHaveLength(1);
    expect(root.querySelectorAll("img.mh-stage-sprite")).toHaveLength(1);
  });

  it("n'affiche rien pour un calque sans image puis l'affiche si une image arrive (#110)", async () => {
    const applySprite = (storage: string) =>
      renderer.apply(
        [
          {
            kind: "scene",
            scene: {
              bg: null,
              sprites: [{ id: "pb1", storage, x: 512, y: 288, z: 1, opacity: 1 }],
              effect: null,
            },
            transition: { method: "none" },
          } as RenderEvent,
        ],
        { instant: true, signal: new AbortController().signal },
      );

    // Calque placeholder sans image : aucun <img> (et aucune URL vide) dans le DOM.
    await applySprite("");
    expect(root.querySelector(".mh-stage-sprite")).toBeNull();
    expect([...root.querySelectorAll("img")].some((img) => img.getAttribute("src") === "")).toBe(false);

    // La même couche reçoit une image (@chgfg) : elle s'affiche.
    await applySprite("perso01(全)");
    const img = root.querySelector(".mh-stage-sprite") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toContain("perso01");
  });

  it("affiche et retire l'indicateur d'attente non interruptible, hors de la boîte de texte (#134)", () => {
    const wait = root.querySelector(".mh-stage-wait") as HTMLElement;
    expect(wait).not.toBeNull();
    // Hors de la textbox : visible même quand le script la masque (@textoff).
    expect(wait.closest(".mh-stage-textbox")).toBeNull();
    expect(wait.classList.contains("mh-stage-wait-on")).toBe(false);

    renderer.setWaitIndicator(true);
    expect(wait.classList.contains("mh-stage-wait-on")).toBe(true);
    renderer.setWaitIndicator(false);
    expect(wait.classList.contains("mh-stage-wait-on")).toBe(false);
  });

  it("nudgeWaitIndicator ne fait réagir que l'indicateur actif", () => {
    const wait = root.querySelector(".mh-stage-wait") as HTMLElement;
    renderer.nudgeWaitIndicator();
    expect(wait.classList.contains("mh-stage-wait-nudge")).toBe(false);

    renderer.setWaitIndicator(true);
    renderer.nudgeWaitIndicator();
    expect(wait.classList.contains("mh-stage-wait-nudge")).toBe(true);
    renderer.setWaitIndicator(false);
    expect(wait.classList.contains("mh-stage-wait-nudge")).toBe(false);
  });

  it("masque la textbox utilisateur", async () => {
    renderer.setUserHidden(true);
    const textbox = root.querySelector(".mh-stage-textbox") as HTMLElement;
    expect(textbox.style.opacity).toBe("0");
    renderer.setUserHidden(false);
    expect(textbox.style.opacity).toBe("1");
  });

  it("restaure un snapshot", async () => {
    const snapshot: StageSnapshot = {
      scene: { bg: "room", sprites: [], effect: null },
      textbox: { visible: false, frame: false },
      text: [{ text: "Restored" }],
      staffroll: null,
    };
    await renderer.restore(snapshot, new AbortController().signal);
    const text = root.querySelector(".mh-stage-text") as HTMLElement;
    expect(text.textContent).toBe("Restored");
    const textbox = root.querySelector(".mh-stage-textbox") as HTMLElement;
    expect(textbox.style.opacity).toBe("0");
  });

  it("ignore les événements audio", async () => {
    const events: RenderEvent[] = [
      { kind: "audio", event: { kind: "play", channel: "bgm", storage: "m01", loop: true, volume: 1 } },
    ];
    await expect(renderer.apply(events, { instant: true, signal: new AbortController().signal })).resolves.toBeUndefined();
  });

  it("applique un effet noise", async () => {
    const events: RenderEvent[] = [
      { kind: "effect", effect: { kind: "noise", opacity: 0.5 } },
    ];
    await renderer.apply(events, { instant: true, signal: new AbortController().signal });
    const effects = root.querySelector(".mh-stage-effects") as HTMLElement;
    expect(effects.children.length).toBe(1);
  });

  it("hurry termine le typewriter", async () => {
    const events: RenderEvent[] = [
      { kind: "text", segments: [{ text: "Long text here" }] },
    ];
    renderer.setSettings(display({ textSpeedUnread: 1000, textSpeedRead: 1000, fontScale: 1, textboxOpacity: 1 }));
    const promise = renderer.apply(events, { instant: false, signal: new AbortController().signal });
    // Laisse le typewriter démarrer (microtask) avant de hurry — reflète l'usage
    // réel où le player appelle hurry pendant apply (typewriterResolve set).
    await Promise.resolve();
    renderer.hurry();
    await promise;
    const text = root.querySelector(".mh-stage-text") as HTMLElement;
    expect(text.textContent).toBe("Long text here");
  });

  it("l'abort interrompt la frappe et résout apply() sans attendre la fin de la page (#231)", async () => {
    // Cause du blocage de « retour au titre » avec les placeholders : `Player.endSession()` attend
    // la promesse d'`apply()` ; le typewriter ne l'écoutait pas et une page très longue (index.html
    // servi à la place du scénario absent) retardait le retour au titre de toute sa durée de frappe.
    const controller = new AbortController();
    renderer.setSettings(display({ textSpeedUnread: 1000, textSpeedRead: 1000 }));
    const events: RenderEvent[] = [
      { kind: "text", segments: [{ text: "Une page beaucoup trop longue pour être tapée avant un retour au titre." }] },
    ];
    const promise = renderer.apply(events, { instant: false, signal: controller.signal });
    const text = root.querySelector(".mh-stage-text") as HTMLElement;
    // Attend que la frappe ait réellement démarré (premier caractère révélé, minuteur d'1 s armé).
    for (let i = 0; i < 50 && (text.textContent ?? "") === ""; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const revealed = text.textContent;
    expect(revealed?.length ?? 0).toBeGreaterThan(0);

    controller.abort();
    // Sans l'écoute de l'abort, la promesse ne se résoudrait qu'après ~65 s de frappe.
    await expect(promise).resolves.toBeUndefined();
    // La frappe est bien arrêtée : plus aucune unité n'est révélée après l'annulation.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(text.textContent).toBe(revealed);
  });

  describe("boîte de texte fixe et police réduite (#163)", () => {
    // L'ancienne boîte n'est plus que le repli quand l'image de cadre manque (#173) : on simule un
    // échec de chargement pour l'obtenir.
    beforeEach(async () => {
      vi.stubGlobal(
        "Image",
        class {
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;
          set src(_url: string) {
            this.onerror?.();
          }
        },
      );
      await renderer.apply([{ kind: "textbox", state: { visible: true, frame: true, frameImage: "absent" }, time: 0 }], {
        instant: true,
        signal: new AbortController().signal,
      });
      expect((root.querySelector("#textbox") as HTMLElement).dataset.frameStyle).toBe("box");
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    // jsdom n'a pas de mise en page : on simule la hauteur de la zone de texte (24 px = 1,5 rem,
    // lignes de 1,6 fois la taille, marges de 20 px) en fonction de la police et du nombre de lignes.
    function mockTextHeight(linesOf: (el: HTMLElement) => number): () => void {
      const spy = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
        if (!this.classList.contains("mh-stage-text")) return 0;
        const px = parseFloat(this.style.fontSize) * 16;
        return 40 + linesOf(this) * px * 1.6;
      });
      return () => spy.mockRestore();
    }

    async function show(text: string, fontScale = 1): Promise<{ box: HTMLElement; text: HTMLElement }> {
      renderer.setSettings(display({ textSpeedUnread: 0, textSpeedRead: 0, fontScale, textboxOpacity: 1 }));
      await renderer.apply([{ kind: "text", segments: [{ text }] }], { instant: true, signal: new AbortController().signal });
      return { box: root.querySelector("#textbox") as HTMLElement, text: root.querySelector("#text") as HTMLElement };
    }

    it("garde la police nominale sur un texte court (#314)", async () => {
      const restore = mockTextHeight(() => 3);
      try {
        const { box, text } = await show("court");
        expect(box.dataset.textFit).toBe("nominal");
        expect(text.style.fontSize).toBe("1.5rem");
        expect(text.style.overflowY).toBe("hidden");
      } finally {
        restore();
      }
    });

    it("ne réduit plus la police d'une page longue : police constante (#314)", async () => {
      const restore = mockTextHeight(() => 7);
      try {
        const { box, text } = await show("long");
        expect(box.dataset.textFit).toBe("nominal");
        expect(text.style.fontSize).toBe("1.5rem");
        // La boîte ne bouge pas non plus.
        expect(box.style.bottom).toBe("");
        expect(box.style.top).toBe("");
        expect(box.style.height).toBe("");
      } finally {
        restore();
      }
    });

    it("la boîte garde la même géométrie et la même police d'une page à l'autre", async () => {
      let lines = 2;
      const restore = mockTextHeight(() => lines);
      try {
        const { box, text } = await show("page");
        const snapshot = () => [box.style.top, box.style.bottom, box.style.height, box.style.maxHeight, text.style.fontSize].join("|");
        const first = snapshot();
        for (const n of [9, 12, 4, 30, 1]) {
          lines = n;
          await renderer.apply([{ kind: "clearText" }, { kind: "text", segments: [{ text: `page ${n}` }] }], {
            instant: true,
            signal: new AbortController().signal,
          });
          expect(snapshot()).toBe(first);
        }
      } finally {
        restore();
      }
    });

    it("respecte fontScale sans rétrécissement automatique (#314)", async () => {
      const restore = mockTextHeight(() => 7);
      try {
        const { box, text } = await show("très long", 1.2);
        expect(box.dataset.textFit).toBe("nominal");
        expect(parseFloat(text.style.fontSize)).toBeCloseTo(1.5 * 1.2, 6);
      } finally {
        restore();
      }
    });

    // Registre des approximations (#295) — test figé :
    // approx:text-overflow-clip — le débordement est découpé (pas de pagination auto, pas de shrink).
    it("découpe une page qui déborde au lieu de défiler ou de réduire (#314)", async () => {
      const restore = mockTextHeight(() => 60);
      try {
        const { box, text } = await show("énorme");
        expect(box.dataset.textFit).toBe("nominal");
        // Police constante : plus de réduction ni de barre de défilement.
        expect(parseFloat(text.style.fontSize)).toBeCloseTo(1.5, 6);
        expect(text.style.overflowY).toBe("hidden");
      } finally {
        restore();
      }
    });

    it("garde l'indicateur dans le coin de la boîte", async () => {
      await show("texte");
      renderer.setClickIndicator("page");
      const indicator = root.querySelector("#textbox-indicator") as HTMLElement;
      expect(indicator.parentElement?.id).toBe("textbox");
    });
  });

  describe("cadre image du jeu d'origine (#173)", () => {
    const sig = () => new AbortController().signal;
    const box = () => root.querySelector("#textbox") as HTMLElement;
    const frame = () => root.querySelector("#textbox-frame") as HTMLElement;
    const text = () => root.querySelector("#text") as HTMLElement;
    const textbox = (state: { visible: boolean; frame: boolean; frameImage?: string }): RenderEvent => ({
      kind: "textbox",
      state,
      time: 0,
    });

    it("applique par défaut le cadre txtwindow02 plein écran, sans boîte", () => {
      expect(box().dataset.frameStyle).toBe("image");
      expect(frame().style.backgroundImage).toContain("txtwindow02");
      expect(frame().style.display).toBe("block");
    });

    it("suit @position frame= et le masquage du cadre", async () => {
      await renderer.apply([textbox({ visible: true, frame: true, frameImage: "txtwindow01" })], { instant: true, signal: sig() });
      expect(frame().style.backgroundImage).toContain("txtwindow01");
      await renderer.apply([textbox({ visible: true, frame: false, frameImage: "txtwindow01" })], { instant: true, signal: sig() });
      expect(box().dataset.frameStyle).toBe("image");
      expect(frame().style.display).toBe("none");
      await renderer.apply([textbox({ visible: true, frame: true, frameImage: "" })], { instant: true, signal: sig() });
      expect(frame().style.display).toBe("none");
    });

    it("garde l'image d'origine au réglage d'opacité par défaut", () => {
      renderer.setSettings(display({ textSpeedUnread: 0, textSpeedRead: 0, fontScale: 1, textboxOpacity: 0.8 }));
      expect(frame().style.opacity).toBe("1");
      renderer.setSettings(display({ textSpeedUnread: 0, textSpeedRead: 0, fontScale: 1, textboxOpacity: 0.4 }));
      expect(frame().style.opacity).toBe("0.5");
    });

    it("pose l'indicateur à la suite du texte", async () => {
      await renderer.apply([{ kind: "text", segments: [{ text: "Texte inventé." }] }], { instant: true, signal: sig() });
      renderer.setClickIndicator("page");
      const indicator = root.querySelector("#textbox-indicator") as HTMLElement;
      expect(indicator.parentElement).toBe(text());
      expect(text().lastChild).toBe(indicator);
      expect(indicator.dataset.style).toBe("page");
      expect(getComputedStyle(indicator).position).toBe("absolute");
      renderer.setClickIndicator(null);
      expect(indicator.dataset.style).toBeUndefined();
    });

    it("positionne l'indicateur hors du flux sur le dernier caractère (#175)", async () => {
      const rect = (left: number, top: number, width: number, height: number) =>
        ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() { return this; } }) as DOMRect;
      const widthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
        return this.id === "text" ? 100 : 0;
      });
      const boxSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return this.id === "text" ? rect(10, 20, 100, 40) : rect(0, 0, 0, 0);
      });
      // jsdom n'implémente pas la mise en page : on fournit la boîte du dernier caractère.
      const rangeProto = Range.prototype as unknown as { getClientRects?: () => DOMRectList };
      const originalGetClientRects = rangeProto.getClientRects;
      rangeProto.getClientRects = () => [rect(90, 30, 10, 20)] as unknown as DOMRectList;
      try {
        await renderer.apply([{ kind: "text", segments: [{ text: "Texte inventé." }] }], { instant: true, signal: sig() });
        renderer.setClickIndicator("page");
        const indicator = root.querySelector("#textbox-indicator") as HTMLElement;
        // Dernier caractère : right = 100, text.left = 10, scale = 1 → 92 px.
        // Boîte du caractère : top 30, hauteur 20 ; icône 24 px → 30 - 20 + (20 - 24) / 2 = 8 px.
        expect(indicator.style.left).toBe("92px");
        expect(indicator.style.top).toBe("8px");
      } finally {
        if (originalGetClientRects) rangeProto.getClientRects = originalGetClientRects;
        else delete rangeProto.getClientRects;
        boxSpy.mockRestore();
        widthSpy.mockRestore();
      }
    });

    it("atténue le texte déjà lu de la page après le clic, jusqu'au changement de page", async () => {
      await renderer.apply([{ kind: "text", segments: [{ text: "Premier." }] }], { instant: true, signal: sig() });
      expect(text().querySelectorAll('[data-read="1"]')).toHaveLength(0);
      renderer.setClickIndicator("line");
      renderer.setClickIndicator(null);
      expect(text().querySelectorAll('[data-read="1"]').length).toBe(8); // « Premier. » = 8 unités
      await renderer.apply([{ kind: "lineBreak" }, { kind: "text", segments: [{ text: "Second." }] }], { instant: true, signal: sig() });
      expect(text().querySelectorAll('[data-read="1"]').length).toBe(8);
      expect(text().textContent).toBe("Premier.\nSecond.");
      await renderer.apply([{ kind: "clearText" }, { kind: "text", segments: [{ text: "Page suivante." }] }], { instant: true, signal: sig() });
      expect(text().querySelectorAll('[data-read="1"]')).toHaveLength(0);
    });

    it("affiche une page restaurée sans atténuation", async () => {
      await renderer.apply([{ kind: "text", segments: [{ text: "Lu." }] }], { instant: true, signal: sig() });
      renderer.setClickIndicator("line");
      renderer.setClickIndicator(null);
      await renderer.restore(
        { scene: { bg: null, sprites: [], effect: null }, textbox: { visible: true, frame: true, frameImage: "txtwindow00" }, text: [{ text: "Restauré." }], staffroll: null },
        sig(),
      );
      expect(text().querySelectorAll('[data-read="1"]')).toHaveLength(0);
      expect(frame().style.backgroundImage).toContain("txtwindow00");
    });

    it("garde la police du cadre image constante, même sur une page très longue (#314)", async () => {
      // jsdom : pas de mise en page, hauteur simulée (lignes de FRAME_TEXT_LINE_HEIGHT fois la taille).
      let lines = 11;
      const spy = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
        if (!this.classList.contains("mh-stage-text")) return 0;
        return lines * parseFloat(this.style.fontSize) * 16 * FRAME_TEXT_LINE_HEIGHT;
      });
      try {
        renderer.setSettings(display({ textSpeedUnread: 0, textSpeedRead: 0, fontScale: 1, textboxOpacity: 0.8 }));
        await renderer.apply([{ kind: "text", segments: [{ text: "onze lignes" }] }], { instant: true, signal: sig() });
        expect(box().dataset.textFit).toBe("nominal");
        expect(parseFloat(text().style.fontSize)).toBeCloseTo(FRAME_TEXT_REM, 6);
        lines = 13;
        await renderer.apply([{ kind: "clearText" }, { kind: "text", segments: [{ text: "treize lignes" }] }], { instant: true, signal: sig() });
        expect(box().dataset.textFit).toBe("nominal");
        expect(parseFloat(text().style.fontSize)).toBeCloseTo(FRAME_TEXT_REM, 6);
      } finally {
        spy.mockRestore();
      }
    });

    it("pose dans le CSS un corps constant dérivé du moteur (26 px du repère → 32,5 px à 1280×720, #314)", () => {
      const css = document.getElementById("mh-stage-styles")?.textContent ?? "";
      const rule = css.slice(css.indexOf('.mh-stage-textbox[data-frame-style="image"] .mh-stage-text {'));
      const rem = parseFloat(/font-size:\s*([\d.]+)rem/.exec(rule)![1]!);
      const leading = parseFloat(/line-height:\s*([\d.]+);/.exec(rule)![1]!);
      expect(rem).toBe(FRAME_TEXT_REM);
      expect(leading).toBe(FRAME_TEXT_LINE_HEIGHT);
      // Le stage (1024×576) est agrandi de STAGE_SCALE vers 1280×720 : on compare le rendu à l'écran.
      const bodyPx = rem * 16 * STAGE_SCALE;
      expect(bodyPx).toBeCloseTo(26 * STAGE_SCALE, 6);
      expect(bodyPx * leading).toBeCloseTo(40.8 * STAGE_SCALE, 6);
    });

    it("respecte fontScale", async () => {
      renderer.setSettings(display({ textSpeedUnread: 0, textSpeedRead: 0, fontScale: 1.25, textboxOpacity: 0.8 }));
      await renderer.apply([{ kind: "text", segments: [{ text: "court" }] }], { instant: true, signal: sig() });
      expect(parseFloat(text().style.fontSize)).toBeCloseTo(FRAME_TEXT_REM * 1.25, 6);
    });

    it("masquage par l'utilisateur et @textoff cachent aussi le cadre", async () => {
      renderer.setUserHidden(true);
      expect(box().style.opacity).toBe("0");
      renderer.setUserHidden(false);
      await renderer.apply([textbox({ visible: false, frame: true })], { instant: true, signal: sig() });
      expect(box().style.opacity).toBe("0");
    });
  });

  it("réconcilie les sprites par id (pas de recréation DOM)", async () => {
    const scene = (sprites: { id: string; storage: string; x: number; y: number; z: number; opacity: number }[]) => ({
      bg: null,
      sprites: sprites.map((s) => ({ ...s })),
      effect: null,
    });
    const sig = () => new AbortController().signal;

    // 1ʳᵉ scène : deux sprites A et B.
    await renderer.apply(
      [{ kind: "scene", scene: scene([
        { id: "A", storage: "im01", x: 100, y: 100, z: 1, opacity: 1 },
        { id: "B", storage: "im02", x: 200, y: 200, z: 2, opacity: 1 },
      ]), transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    const spritesEl = root.querySelector("#stage-sprites") as HTMLElement;
    expect(spritesEl.children.length).toBe(2);
    const elA1 = spritesEl.querySelector('[data-sprite-id="A"]') as HTMLImageElement;
    const elB1 = spritesEl.querySelector('[data-sprite-id="B"]') as HTMLImageElement;
    expect(elA1).not.toBeNull();
    expect(elB1).not.toBeNull();
    const identityA = elA1;

    // 2ᵉ scène : A déplacé (même id), B retiré, C ajouté.
    await renderer.apply(
      [{ kind: "scene", scene: scene([
        { id: "A", storage: "im01", x: 300, y: 300, z: 1, opacity: 0.5 },
        { id: "C", storage: "im03", x: 400, y: 400, z: 3, opacity: 1 },
      ]), transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    expect(spritesEl.children.length).toBe(2);
    const elA2 = spritesEl.querySelector('[data-sprite-id="A"]') as HTMLImageElement;
    const elC2 = spritesEl.querySelector('[data-sprite-id="C"]') as HTMLImageElement;
    // A est le même élément DOM (pas recréé) : position/opacité mises à jour.
    expect(elA2).toBe(identityA);
    expect(elA2.style.left).toBe("300px");
    expect(elA2.style.opacity).toBe("0.5");
    // B a été retiré.
    expect(spritesEl.querySelector('[data-sprite-id="B"]')).toBeNull();
    // C est nouveau.
    expect(elC2).not.toBeNull();
    expect(elC2.style.left).toBe("400px");
  });

  it("la transition est non-bloquante et waitFor la résout", async () => {
    // jsdom n'implémente pas le chargement d'images : on simule un décodage immédiat (#362).
    class InstantImage {
      src = "";
      decoding?: string;
      fetchPriority?: string;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decode(): Promise<void> {
        this.onload?.();
        return Promise.resolve();
      }
    }
    vi.stubGlobal("Image", InstantImage);
    try {
    const sig = () => new AbortController().signal;
    await renderer.apply(
      [{ kind: "scene", scene: { bg: "old", sprites: [], effect: null }, transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    // Transition crossfade 100ms : apply() doit rendre la main immédiatement.
    const start = performance.now();
    await renderer.apply(
      [{ kind: "scene", scene: { bg: "newbg", sprites: [], effect: null }, transition: { method: "crossfade", time: 100 } }],
      { instant: false, signal: sig() },
    );
    const applyElapsed = performance.now() - start;
    // Non-bloquant : apply() ne doit pas attendre les 100ms de transition.
    expect(applyElapsed).toBeLessThan(60);

    // waitFor("transition") doit attendre la fin de la transition.
    const ctrl = new AbortController();
    await renderer.waitFor("transition", undefined, ctrl.signal);
    // Pas d'overlay résiduel après la transition.
    expect(root.querySelectorAll(".mh-stage-bg-overlay").length).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe("panoramique du fond (bgMove, #135)", () => {
    const sig = () => new AbortController().signal;
    const showPano = () =>
      renderer.apply(
        [{ kind: "scene", scene: { bg: "pano", bgLeft: -99, bgTop: -48, sprites: [], effect: null }, transition: { method: "none" } }],
        { instant: true, signal: sig() },
      );

    afterEach(() => vi.restoreAllMocks());

    it("fait glisser le fond en ligne droite jusqu'à la position cible", async () => {
      await showPano();
      expect(bgLayer()!.style.objectPosition).toBe("-99px -48px");
      await renderer.apply([{ kind: "track", track: { target: "bg", prop: "transform", duration: 5000, keyframes: [{ time: 0 }, { time: 5000, left: -167, top: -48 }] } }], { instant: false, signal: sig() });
      expect(bgLayer()!.style.transition).toBe("object-position 5000ms linear");
      expect(bgLayer()!.style.objectPosition).toBe("-167px -48px");
    });

    it("en mode instantané (saut de la séquence), pose directement la position finale", async () => {
      await showPano();
      await renderer.apply([{ kind: "track", track: { target: "bg", prop: "transform", duration: 5000, keyframes: [{ time: 0 }, { time: 5000, left: -167, top: -48 }] } }], { instant: true, signal: sig() });
      expect(bgLayer()!.style.transition).toBe("none");
      expect(bgLayer()!.style.objectPosition).toBe("-167px -48px");
    });

    it("panoramique accéléré : la transition porte l'accélération", async () => {
      await showPano();
      await renderer.apply([{ kind: "track", track: { target: "bg", prop: "transform", duration: 14500, accel: 20, keyframes: [{ time: 0 }, { time: 14500, left: -48, top: -149 }] } }], { instant: false, signal: sig() });
      expect(bgLayer()!.style.transition).toMatch(/^object-position 14500ms (linear\(0|ease-in)/);
    });

    it("un fondu en plein panoramique accéléré part de la position eased, pas de la linéaire", async () => {
      const now = vi.spyOn(performance, "now").mockReturnValue(0);
      await showPano();
      await renderer.apply([{ kind: "track", track: { target: "bg", prop: "transform", duration: 1000, accel: 3, keyframes: [{ time: 0 }, { time: 1000, left: 1, top: -48 }] } }], { instant: false, signal: sig() });
      now.mockReturnValue(500);
      await renderer.apply(
        [{ kind: "scene", scene: { bg: "next", bgLeft: 0, bgTop: 0, sprites: [], effect: null }, transition: { method: "crossfade", time: 800 } }],
        { instant: false, signal: sig() },
      );
      const overlay = root.querySelector(".mh-stage-bg-overlay") as HTMLElement;
      // À mi-parcours, une accélération positive est en retard sur la droite : -99 + 100 * 0.5^k avec k = 1 + ln 4.
      const k = 1 + Math.log(4);
      const expected = -99 + 100 * Math.pow(0.5, k);
      expect(parseFloat(overlay.style.backgroundPosition)).toBeCloseTo(expected, 1);
      expect(parseFloat(overlay.style.backgroundPosition)).toBeLessThan(-49);
      renderer.hurry();
    });

    it("zoom et rotation du fond : transform autour du centre ; un nouveau fond les remet à zéro", async () => {
      await showPano();
      await renderer.apply([{ kind: "track", track: { target: "bg", prop: "transform", duration: 0, keyframes: [{ time: 0 }, { time: 0, left: -381, top: -613, zoomx: 60, zoomy: 60, rotate: 315 }] } }], { instant: false, signal: sig() });
      expect(bgLayer()!.style.transform).toBe("rotate(315deg) scale(0.6, 0.6)");
      expect(bgLayer()!.style.transformOrigin).toBe("512px 288px");
      await renderer.apply([{ kind: "track", track: { target: "bg", prop: "transform", duration: 2000, accel: 3, keyframes: [{ time: 0 }, { time: 2000, left: -48, top: -48, zoomx: 100, zoomy: 100, rotate: 0 }] } }], { instant: false, signal: sig() });
      expect(bgLayer()!.style.transition).toMatch(/transform 2000ms (linear\(0|ease-in)/);
      expect(bgLayer()!.style.transform).toBe("rotate(0deg) scale(1, 1)");
      await showPano();
      expect(bgLayer()!.style.transform).toBe("");
    });

    it("régression #397 : un track bg déplace la position effective du fond (calque ou conteneur)", async () => {
      await showPano();
      const effective = (): { position: string; transition: string } => {
        const layers = [...root.querySelectorAll<HTMLImageElement>("#stage-bg > .mh-stage-bg-layer")];
        const layer = layers.find((el) => el.style.display !== "none");
        const container = root.querySelector("#stage-bg") as HTMLElement;
        // #373 : fond en calques <img> (object-position) ; repli sur le conteneur (background-position).
        return layer
          ? { position: layer.style.objectPosition, transition: layer.style.transition }
          : { position: container.style.backgroundPosition, transition: container.style.transition };
      };
      const before = effective();
      expect(before.position).toContain("-99px");
      await renderer.apply(
        [{ kind: "track", track: { target: "bg", prop: "transform", duration: 1000, keyframes: [{ time: 0 }, { time: 1000, left: -167, top: -149 }] } }],
        { instant: false, signal: sig() },
      );
      const after = effective();
      // Sans animation de fond, la position resterait figée et ce test échouerait (#397).
      expect(after.position).not.toBe(before.position);
      expect(after.position).toContain("-167px");
      expect(after.transition).toMatch(/^(object-position|background-position) 1000ms/);
    });

    it("un fondu commencé en plein panoramique part de la position courante de l'ancien fond", async () => {
      const now = vi.spyOn(performance, "now").mockReturnValue(1000);
      await showPano();
      await renderer.apply([{ kind: "track", track: { target: "bg", prop: "transform", duration: 5000, keyframes: [{ time: 0 }, { time: 5000, left: -167, top: -48 }] } }], { instant: false, signal: sig() });
      now.mockReturnValue(3500); // à mi-chemin
      await renderer.apply(
        [{ kind: "scene", scene: { bg: "next", bgLeft: -48, bgTop: -300, sprites: [], effect: null }, transition: { method: "crossfade", time: 2000 } }],
        { instant: false, signal: sig() },
      );
      const overlay = root.querySelector(".mh-stage-bg-overlay") as HTMLElement;
      expect(overlay.style.backgroundImage).toContain("pano");
      expect(overlay.style.backgroundPosition).toBe("-133px -48px");
      // Le nouveau fond est posé à sa propre position, sans mouvement hérité.
      expect(bgLayer()!.style.objectPosition).toBe("-48px -300px");
      expect(bgLayer()!.style.transition).toBe("");
      renderer.hurry();
    });
  });

  describe("transitions : apparence et calques de l'ancienne scène (#409)", () => {
    const sig = () => new AbortController().signal;
    const scene = (over: Partial<SceneState> & { bg: string | null }, transition: { method: "none" | "crossfade"; time?: number } = { method: "none" }): RenderEvent =>
      ({ kind: "scene", scene: { sprites: [], effect: null, ...over } as SceneState, transition: { method: transition.method, time: transition.time ?? 0 } } as RenderEvent);

    it("l'overlay reprend l'apparence de l'ancienne scène, pas le filtre du nouveau fond", async () => {
      await renderer.apply([scene({ bg: "un", bgLeft: 0, bgTop: 0 })], { instant: true, signal: sig() });
      await renderer.apply(
        [scene({ bg: "deux", bgEffect: "monocro" }, { method: "crossfade", time: 500 })],
        { instant: false, signal: sig() },
      );
      const overlay = root.querySelector<HTMLElement>(".mh-stage-bg-overlay")!;
      const bg = root.querySelector<HTMLElement>("#stage-bg")!;
      // L'ancien fond garde son apparence (aucun filtre) ; le nouveau est monochrome.
      expect(overlay.style.filter === "" || overlay.style.filter === "none").toBe(true);
      expect(bg.style.filter).toContain("grayscale");
      renderer.hurry();
    });

    it("les calques de l'ancienne scène passent dans l'overlay puis disparaissent avec lui", async () => {
      const sprite = { id: "s1", storage: "ancien-calque", x: 100, y: 120, z: 100, opacity: 1 };
      await renderer.apply([scene({ bg: "un", sprites: [sprite] as never })], { instant: true, signal: sig() });
      await renderer.apply([scene({ bg: "deux" }, { method: "crossfade", time: 500 })], { instant: false, signal: sig() });
      const layersOverlay = root.querySelector<HTMLElement>(".mh-stage-bg-overlay-layers")!;
      const snapshot = layersOverlay.querySelector<HTMLImageElement>(".mh-stage-sprite");
      expect(snapshot).not.toBeNull();
      expect(snapshot!.getAttribute("src")).toContain("ancien-calque");
      renderer.hurry();
      expect(root.querySelector(".mh-stage-bg-overlay")).toBeNull();
    });

    it("#410 : le filtre du fond n'est pas appliqué une seconde fois aux calques de l'ancienne scène", async () => {
      const sprite = { id: "s2", storage: "calque-flou", x: 200, y: 150, z: 100, opacity: 1, blurx: 1, blury: 1 };
      await renderer.apply([scene({ bg: "un", bgEffect: "monocro", sprites: [sprite] as never })], { instant: true, signal: sig() });
      const source = root.querySelector<HTMLImageElement>('#stage-sprites img[data-sprite-id="s2"]')!;
      const sourceFilter = source.style.filter;
      await renderer.apply([scene({ bg: "deux" }, { method: "crossfade", time: 500 })], { instant: false, signal: sig() });
      const bgOverlay = root.querySelector<HTMLElement>(".mh-stage-bg-overlay")!;
      const layersOverlay = root.querySelector<HTMLElement>(".mh-stage-bg-overlay-layers")!;
      // Le fond ancien porte bien son filtre…
      expect(bgOverlay.style.filter).toContain("grayscale");
      // …mais le calque ancien n'est pas dans cet élément filtré : son filtre reste le sien (une fois).
      expect(layersOverlay.contains(layersOverlay.querySelector('[data-sprite-id="s2"]'))).toBe(true);
      expect(layersOverlay.style.filter).toBe("");
      expect(layersOverlay.querySelector<HTMLImageElement>('[data-sprite-id="s2"]')!.style.filter).toBe(sourceFilter);
      renderer.hurry();
    });
  });

  describe("calques de timeline (#125)", () => {
    const sig = () => new AbortController().signal;
    const layer = (over: Partial<TimelineLayerState> = {}): TimelineLayerState => ({ id: "L1", storage: "carton", x: 224, y: 217, opacity: 0, z: 3400, ...over });
    const layerEl = (id = "L1") => root.querySelector(`#stage-timeline [data-layer-id="${id}"]`) as HTMLElement | null;
    const trackLayer = (l: TimelineLayerState, time: number, accel?: number): RenderEvent => ({ kind: "track", track: { target: l.id, prop: "transform", layer: l, duration: time, ...(accel === undefined ? {} : { accel }), keyframes: [{ time: 0 }, { time }] } });

    it("pose un calque centré sur (x, y), avec son ordre et son opacité, entre le fond et les sprites", async () => {
      await renderer.apply([trackLayer(layer(), 0)], { instant: false, signal: sig() });
      const el = layerEl()!;
      expect(el.style.left).toBe("224px");
      expect(el.style.top).toBe("217px");
      expect(el.style.opacity).toBe("0");
      expect(el.style.zIndex).toBe("3400");
      expect(el.querySelector("img")!.getAttribute("src")).toContain("carton");
      const order = [...root.querySelector("#stage")!.children].map((c) => c.id);
      expect(order.indexOf("stage-timeline")).toBeGreaterThan(order.indexOf("stage-bg"));
      expect(order.indexOf("stage-timeline")).toBeLessThan(order.indexOf("stage-sprites"));
    });

    it("fondu : transition linéaire de l'opacité et de la position ; instantanée en cas de saut", async () => {
      await renderer.apply([trackLayer(layer(), 0)], { instant: false, signal: sig() });
      await renderer.apply([trackLayer(layer({ opacity: 1, x: 300 }), 1500)], { instant: false, signal: sig() });
      expect(layerEl()!.style.transition).toBe("left 1500ms linear, top 1500ms linear, opacity 1500ms linear, transform 1500ms linear");
      expect(layerEl()!.style.opacity).toBe("1");
      expect(layerEl()!.style.left).toBe("300px");
      await renderer.apply([trackLayer(layer({ opacity: 0 }), 1000)], { instant: true, signal: sig() });
      expect(layerEl()!.style.transition).toBe("none");
      expect(layerEl()!.style.opacity).toBe("0");
    });

    it("accélération : le même rythme pour la position, l'opacité et le zoom", async () => {
      await renderer.apply([trackLayer(layer(), 0)], { instant: false, signal: sig() });
      await renderer.apply([trackLayer(layer({ opacity: 1, y: 600 }), 14500, 20)], { instant: false, signal: sig() });
      const t = layerEl()!.style.transition;
      // `linear(…)` échantillonné (ou ease-in sans support) : jamais le `linear` simple.
      for (const prop of ["left", "top", "opacity", "transform"]) expect(t).toMatch(new RegExp(`${prop} 14500ms (linear\\(0|ease-in)`));
      await renderer.apply([trackLayer(layer(), 2000, -3)], { instant: false, signal: sig() });
      expect(layerEl()!.style.transition).toMatch(/top 2000ms (linear\(0|ease-out)/);
    });

    it("zoom, rotation et point d'ancrage : transform CSS autour de l'ancrage, centre par défaut", async () => {
      await renderer.apply([trackLayer(layer(), 0)], { instant: false, signal: sig() });
      expect(layerEl()!.style.transform).toBe("translate(-50%, -50%) rotate(0deg) scale(1, 1)");
      expect(layerEl()!.style.transformOrigin).toBe("50% 50%");
      await renderer.apply([trackLayer(layer({ zoomx: 60, zoomy: -80, rotate: 315, afx: 121.5, afy: 204 }), 0)], { instant: false, signal: sig() });
      expect(layerEl()!.style.transform).toBe("translate(-50%, -50%) rotate(315deg) scale(0.6, -0.8)");
      expect(layerEl()!.style.transformOrigin).toBe("121.5px 204px");
      // Une clé sans ces champs remet les valeurs par défaut.
      await renderer.apply([trackLayer(layer(), 0)], { instant: false, signal: sig() });
      expect(layerEl()!.style.transform).toBe("translate(-50%, -50%) rotate(0deg) scale(1, 1)");
      expect(layerEl()!.style.transformOrigin).toBe("50% 50%");
    });

    it("pluie : classe dédiée tant que le calque la demande", async () => {
      await renderer.apply([trackLayer(layer({ rain: true }), 0)], { instant: false, signal: sig() });
      expect(layerEl()!.classList.contains("mh-stage-tl-rain")).toBe(true);
      await renderer.apply([trackLayer(layer(), 0)], { instant: false, signal: sig() });
      expect(layerEl()!.classList.contains("mh-stage-tl-rain")).toBe(false);
    });

    it("la fin de la séquence, clear() et restore() retirent les calques", async () => {
      const add = () => renderer.apply([trackLayer(layer(), 0), trackLayer(layer({ id: "L2" }), 0)], { instant: false, signal: sig() });
      await add();
      await renderer.apply([{ kind: "timelineLayerClear" }], { instant: false, signal: sig() });
      expect(root.querySelectorAll("#stage-timeline > *").length).toBe(0);
      await add();
      renderer.clear();
      expect(root.querySelectorAll("#stage-timeline > *").length).toBe(0);
      await add();
      await renderer.restore({ scene: { bg: null, sprites: [], effect: null }, textbox: { visible: true, frame: true }, text: [], staffroll: null }, sig());
      expect(root.querySelectorAll("#stage-timeline > *").length).toBe(0);
    });
  });

  describe("tremblement d'écran (#148)", () => {
    const sig = () => new AbortController().signal;
    const container = () => root.querySelector(".mh-stage") as HTMLElement;

    it("garde l'agrandissement 1.25 du stage pendant le tremblement (sinon l'écran tombe à 1024×576)", async () => {
      expect(document.getElementById("mh-stage-styles")!.textContent).toContain("transform: scale(1.25)");
      await renderer.apply([{ kind: "quake", quake: { hmax: 6, vmax: 4, time: null } }], { instant: false, signal: sig() });
      const t = container().style.transform;
      expect(t).toMatch(/^translate\(-?[\d.e-]+px, -?[\d.e-]+px\) scale\(1\.25\)$/);
      await renderer.apply([{ kind: "quake", quake: null }], { instant: false, signal: sig() });
    });

    it("l'arrêt du tremblement rend la transformation au CSS (agrandissement seul)", async () => {
      await renderer.apply([{ kind: "quake", quake: { hmax: 6, vmax: 4, time: null } }], { instant: false, signal: sig() });
      await renderer.apply([{ kind: "quake", quake: null }], { instant: false, signal: sig() });
      expect(container().style.transform).toBe("");
    });
  });

  it("hurry termine la transition immédiatement", async () => {
    const sig = () => new AbortController().signal;
    await renderer.apply(
      [{ kind: "scene", scene: { bg: "old", sprites: [], effect: null }, transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    await renderer.apply(
      [{ kind: "scene", scene: { bg: "newbg", sprites: [], effect: null }, transition: { method: "crossfade", time: 5000 } }],
      { instant: false, signal: sig() },
    );
    // Overlays présents pendant la transition.
    expect(root.querySelectorAll(".mh-stage-bg-overlay").length).toBeGreaterThan(0);
    renderer.hurry();
    // Après hurry : overlays nettoyés.
    expect(root.querySelectorAll(".mh-stage-bg-overlay").length).toBe(0);
  });

  it("rend un sprite partbg (crop wrapper overflow:hidden + img translatée)", async () => {
    const sig = () => new AbortController().signal;
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: "black",
          sprites: [{
            id: "pb1",
            storage: "im02空",
            x: 748,
            y: 0,
            z: 1000,
            opacity: 1,
            crop: {
              width: 522,
              height: 576,
              srcLeft: 542,
              srcTop: 0,
              srcZoomX: 100,
              srcZoomY: 100,
              bgStorage: "black",
            },
          }],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );

    const wrapper = root.querySelector(".mh-stage-partbg") as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.dataset.spriteId).toBe("pb1");
    expect(wrapper.style.width).toBe("522px");
    expect(wrapper.style.height).toBe("576px");
    expect(wrapper.style.overflow).toBe("hidden");
    expect(wrapper.style.left).toBe("748px");
    expect(wrapper.style.opacity).toBe("1");
    // Le wrapper est centré sur son point d'ancrage (centre du partbg).
    expect(wrapper.style.transform).toContain("translate(-50%, -50%)");
    // bgstorage derrière le crop.
    expect(wrapper.style.backgroundImage).toContain("black.webp");

    const innerImg = wrapper.querySelector(".mh-stage-partbg-img") as HTMLImageElement;
    expect(innerImg).not.toBeNull();
    // Image translatée de -srcLeft et scalée (zoom 100% = scale(1,1)).
    expect(innerImg.style.transform).toContain("translate(-542px");
    expect(innerImg.style.transform).toContain("scale(1, 1)");
    expect(innerImg.src).toContain("im02");
  });

  it("réconcilie un partbg (pas de recréation du wrapper)", async () => {
    const sig = () => new AbortController().signal;
    const cropSprite = (x: number, srcLeft: number) => ({
      id: "pb1",
      storage: "im02空",
      x,
      y: 0,
      z: 1000,
      opacity: 1,
      crop: { width: 522, height: 576, srcLeft, srcTop: 0, srcZoomX: 100, srcZoomY: 100 },
    });
    await renderer.apply(
      [{ kind: "scene", scene: { bg: null, sprites: [cropSprite(748, 542)], effect: null }, transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    const w1 = root.querySelector(".mh-stage-partbg") as HTMLElement;
    const inner1 = w1.querySelector(".mh-stage-partbg-img") as HTMLImageElement;
    expect(w1.style.left).toBe("748px");
    expect(inner1.style.transform).toContain("translate(-542px");

    await renderer.apply(
      [{ kind: "scene", scene: { bg: null, sprites: [cropSprite(300, 100)], effect: null }, transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    const w2 = root.querySelector(".mh-stage-partbg") as HTMLElement;
    const inner2 = w2.querySelector(".mh-stage-partbg-img") as HTMLImageElement;
    expect(w2).toBe(w1);
    expect(w2.style.left).toBe("300px");
    expect(inner2.style.transform).toContain("translate(-100px");
  });

  it("conserve le centrage d'un sprite zoomé/rotaté (transform composé)", async () => {
    const sig = () => new AbortController().signal;
    await renderer.apply(
      [{ kind: "scene", scene: { bg: null, sprites: [{ id: "sp", storage: "sp", x: 512, y: 288, z: 1000, opacity: 1 }], effect: null }, transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    await renderer.apply(
      [{
        kind: "animate",
        target: "sp",
        def: {
          storage: "sp",
          keyframes: [
            { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, center: 512, vcenter: 288, opacity: 1, zoomx: 1, zoomy: 1, rotate: 0 },
            { time: 100, duration: 0, interp: "l", easing: "linear", accel: 0, center: 512, vcenter: 288, opacity: 1, zoomx: 2, zoomy: 2, rotate: 90 },
          ],
        },
      }],
      { instant: true, signal: sig() },
    );
    const el = root.querySelector('[data-sprite-id="sp"]') as HTMLElement;
    expect(el.style.transform).toContain("translate(-50%, -50%)");
    expect(el.style.transform).toContain("scale(2, 2)");
    expect(el.style.transform).toContain("rotate(90deg)");
  });

  it("le mode instant produit le même transform final que la dernière keyframe WAAPI", async () => {
    const sig = () => new AbortController().signal;
    await renderer.apply(
      [{ kind: "scene", scene: { bg: null, sprites: [{ id: "sp", storage: "sp", x: 512, y: 288, z: 1000, opacity: 1 }], effect: null }, transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );

    const def = {
      storage: "sp",
      keyframes: [
        { time: 0, duration: 0, interp: "l" as const, easing: "linear" as const, accel: 0, center: 512, vcenter: 288, opacity: 1, zoomx: 1, zoomy: 1, rotate: 0 },
        { time: 100, duration: 0, interp: "l" as const, easing: "linear" as const, accel: 0, center: 600, vcenter: 300, opacity: 1, zoomx: 2, rotate: 45 },
      ],
    };

    const compiled = compileAction({ storage: "sp", keyframes: def.keyframes });
    expect(compiled).not.toBeNull();
    const waapiLast = compiled!.keyframes.wrapper.find((k) => k.offset === 1);
    expect(waapiLast).toBeDefined();

    await renderer.apply(
      [{ kind: "animate", target: "sp", def }],
      { instant: true, signal: sig() },
    );

    const el = root.querySelector('[data-sprite-id="sp"]') as HTMLElement;
    expect(el.style.transform).toBe(waapiLast!.transform);
    // Le carry-forward + helper garantissent rotate(45deg) et zoomx=2/zoomy=1.
    expect(el.style.transform).toContain("rotate(45deg)");
    expect(el.style.transform).toContain("scale(2, 1)");
  });

  it("les 3 sites partbg produisent le même transform inner avec srczoom ≠ 100", async () => {
    const sig = () => new AbortController().signal;
    const srcLeft = 542;
    const srcTop = 120;
    const srcZoomX = 150;
    const srcZoomY = 150;
    const expected = partbgInnerTransform({
      srcleft: srcLeft,
      srctop: srcTop,
      srczoomx: srcZoomX,
      srczoomy: srcZoomY,
    });

    // Site 1 : renderScene.
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: null,
          sprites: [{
            id: "pb-crop",
            storage: "im02",
            x: 748,
            y: 0,
            z: 1000,
            opacity: 1,
            crop: { width: 522, height: 576, srcLeft, srcTop, srcZoomX, srcZoomY },
          }],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );
    const inner1 = root.querySelector(".mh-stage-partbg-img") as HTMLElement;
    expect(inner1.style.transform).toBe(expected);

    // Site 2 : applyAnimationFinal (mode instant).
    await renderer.apply(
      [{
        kind: "animate",
        target: "pb-crop",
        def: {
          storage: "im02",
          isPartbg: true,
          keyframes: [
            { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft: srcLeft, srctop: srcTop, srczoomx: srcZoomX, srczoomy: srcZoomY },
            { time: 100, duration: 100, interp: "l", easing: "linear", accel: 0, srcleft: srcLeft, srctop: srcTop, srczoomx: srcZoomX, srczoomy: srcZoomY },
          ],
        },
      }],
      { instant: true, signal: sig() },
    );
    const inner2 = root.querySelector(".mh-stage-partbg-img") as HTMLElement;
    expect(inner2.style.transform).toBe(expected);

    // Site 3 : compileAction (dernière keyframe WAAPI).
    const compiled = compileAction({
      storage: "im02",
      isPartbg: true,
      keyframes: [
        { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft: srcLeft, srctop: srcTop, srczoomx: srcZoomX, srczoomy: srcZoomY },
        { time: 100, duration: 100, interp: "l", easing: "linear", accel: 0, srcleft: srcLeft, srctop: srcTop, srczoomx: srcZoomX, srczoomy: srcZoomY },
      ],
    });
    expect(compiled).not.toBeNull();
    const last = compiled!.keyframes.inner.find((k) => k.offset === 1);
    expect(last).toBeDefined();
    expect(last!.transform).toBe(expected);
  });

  it("@partbgact instant applique aussi les props wrapper (center/vcenter/opacity)", async () => {
    const sig = () => new AbortController().signal;
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: null,
          sprites: [{
            id: "pb-wrapper",
            storage: "im02",
            x: 748,
            y: 0,
            z: 1000,
            opacity: 1,
            crop: { width: 522, height: 576, srcLeft: 0, srcTop: 0, srcZoomX: 100, srcZoomY: 100 },
          }],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );

    await renderer.apply(
      [{
        kind: "animate",
        target: "pb-wrapper",
        def: {
          storage: "im02",
          id: "pb-wrapper",
          isPartbg: true,
          keyframes: [
            { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, center: 748, vcenter: 0, opacity: 1, srcleft: 0, srctop: 0, srczoomx: 100, srczoomy: 100 },
            { time: 100, duration: 100, interp: "l", easing: "linear", accel: 0, center: 600, vcenter: 100, opacity: 0.5, srcleft: 0, srctop: 0, srczoomx: 100, srczoomy: 100 },
          ],
        },
      }],
      { instant: true, signal: sig() },
    );

    const wrapper = root.querySelector(".mh-stage-partbg") as HTMLElement;
    expect(wrapper.style.left).toBe("600px");
    expect(wrapper.style.top).toBe("100px");
    expect(wrapper.style.opacity).toBe("0.5");
    // Le centrage du wrapper est préservé.
    expect(wrapper.style.transform).toContain("translate(-50%, -50%)");
  });

  it("rend le ruby via <ruby><rt>", async () => {
    const events: RenderEvent[] = [
      { kind: "clearText" },
      { kind: "text", segments: [
        { text: "あいう" },
        { text: "お", ruby: "え" },
        { text: "。" },
      ] },
    ];
    await renderer.apply(events, { instant: true, signal: new AbortController().signal });
    const textEl = root.querySelector(".mh-stage-text") as HTMLElement;
    const ruby = textEl.querySelector("ruby");
    expect(ruby).not.toBeNull();
    // Le texte visible du <ruby> contient la base "お" et l'annotation "え".
    expect(textEl.textContent).toBe("あいうおえ。");
    const baseNode = ruby?.childNodes[0];
    expect(baseNode?.textContent).toBe("お");
    const rt = ruby?.querySelector("rt");
    expect(rt?.textContent).toBe("え");
  });

  it("affiche un fond dont le nom contient des parenthèses ou des espaces", async () => {
    for (const bg of ["bg01玄関-(雨)", "image avec espace", "山城01(近)"]) {
      await renderer.apply(
        [{ kind: "scene", scene: { bg, sprites: [], effect: null }, transition: { method: "none" } }],
        { instant: true, signal: new AbortController().signal },
      );
      // #373 : le fond est un calque <img>, son src doit être résolu et encodé correctement.
      const layer = bgLayer();
      expect(layer?.src, bg).toBeTruthy();
      expect(decodeURIComponent(layer!.src), bg).toContain(bg.split("/").pop()!.replace(/\.(webp|png)$/, ""));
    }
  });

  it("pose le ruby une seule fois sur une base de plusieurs caractères", async () => {
    await renderer.apply([
      { kind: "clearText" },
      { kind: "text", segments: [{ text: "中腹", ruby: "ちゅうふく" }, { text: "に" }] },
    ], { instant: true, signal: new AbortController().signal });
    const textEl = root.querySelector(".mh-stage-text") as HTMLElement;
    const rubies = textEl.querySelectorAll("ruby");
    expect(rubies).toHaveLength(1);
    expect(rubies[0]?.childNodes[0]?.textContent).toBe("中腹");
    expect(rubies[0]?.querySelector("rt")?.textContent).toBe("ちゅうふく");
    expect(textEl.textContent).toBe("中腹ちゅうふくに");
  });

  it("garde séparés deux ruby consécutifs de segments différents", async () => {
    await renderer.apply([
      { kind: "clearText" },
      { kind: "text", segments: [{ text: "山", ruby: "やま" }, { text: "川", ruby: "かわ" }] },
    ], { instant: true, signal: new AbortController().signal });
    const rubies = root.querySelectorAll(".mh-stage-text ruby");
    expect(rubies).toHaveLength(2);
    expect(rubies[0]?.querySelector("rt")?.textContent).toBe("やま");
    expect(rubies[1]?.querySelector("rt")?.textContent).toBe("かわ");
  });

  it("applique le style du segment à tout le groupe ruby", async () => {
    await renderer.apply([
      { kind: "clearText" },
      { kind: "text", segments: [{ text: "中腹", ruby: "ちゅうふく", style: { bold: true } }] },
    ], { instant: true, signal: new AbortController().signal });
    const ruby = root.querySelector(".mh-stage-text ruby") as HTMLElement;
    expect(ruby.style.fontWeight).toBe("bold");
    expect(root.querySelectorAll(".mh-stage-text ruby")).toHaveLength(1);
  });

  it("ne re-type pas le texte déjà révélé après un nouveau segment", async () => {
    // 1ʳᵐᵉ apply : texte court, instant.
    await renderer.apply(
      [{ kind: "text", segments: [{ text: "abc" }] }],
      { instant: true, signal: new AbortController().signal },
    );
    expect(renderer.typedUnitsExposed()).toBe(3);

    // 2ᵉ apply : nouveau segment. Le typewriter doit continuer depuis 3,
    // pas re-type depuis 0. On vérifie via un instant apply que typedUnits
    // reste cumulatif (5) et le texte est "abcde".
    await renderer.apply(
      [{ kind: "text", segments: [{ text: "de" }] }],
      { instant: true, signal: new AbortController().signal },
    );
    const textEl = root.querySelector(".mh-stage-text") as HTMLElement;
    expect(textEl.textContent).toBe("abcde");
    expect(renderer.typedUnitsExposed()).toBe(5);
  });

  it("clearText reset typedUnits", async () => {
    await renderer.apply(
      [{ kind: "text", segments: [{ text: "hello" }] }],
      { instant: true, signal: new AbortController().signal },
    );
    expect(renderer.typedUnitsExposed()).toBe(5);
    await renderer.apply(
      [{ kind: "clearText" }, { kind: "text", segments: [{ text: "x" }] }],
      { instant: true, signal: new AbortController().signal },
    );
    expect(renderer.typedUnitsExposed()).toBe(1);
    const textEl = root.querySelector(".mh-stage-text") as HTMLElement;
    expect(textEl.textContent).toBe("x");
  });

  it("@partbgact instant : applique l'état final sur l'image interne", async () => {
    const sig = () => new AbortController().signal;
    // 1. Pose un partbg initial (srcleft=542).
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: null,
          sprites: [{
            id: "im02",
            storage: "im02",
            x: 748, y: 0, z: 1000, opacity: 1,
            crop: { width: 522, height: 576, srcLeft: 542, srcTop: 0, srcZoomX: 100, srcZoomY: 100 },
          }],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );
    const inner1 = root.querySelector(".mh-stage-partbg-img") as HTMLElement;
    expect(inner1.style.transform).toContain("translate(-542px");

    // 2. @partbgact instant : applique l'état final (srcleft=100 → translate(-100px)).
    await renderer.apply(
      [{
        kind: "animate",
        target: "im02",
        def: {
          storage: "im02",
          isPartbg: true,
          keyframes: [
            { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft: 542, srctop: 0, srczoomx: 100, srczoomy: 100 },
            { time: 30000, duration: 30000, interp: "l", easing: "linear", accel: 0, srcleft: 100, srctop: 0, srczoomx: 100, srczoomy: 100 },
          ],
        },
      }],
      { instant: true, signal: sig() },
    );
    const inner2 = root.querySelector(".mh-stage-partbg-img") as HTMLElement;
    expect(inner2.style.transform).toContain("translate(-100px");
  });

  it("@partbgact non-instant : démarre l'animation et résout la promise", async () => {
    const sig = () => new AbortController().signal;
    // Pose un partbg.
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: null,
          sprites: [{
            id: "im02",
            storage: "im02",
            x: 748, y: 0, z: 1000, opacity: 1,
            crop: { width: 522, height: 576, srcLeft: 542, srcTop: 0, srcZoomX: 100, srcZoomY: 100 },
          }],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );
    // Lance l'animation (durée courte pour le test).
    await renderer.apply(
      [{
        kind: "animate",
        target: "im02",
        def: {
          storage: "im02",
          isPartbg: true,
          keyframes: [
            { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft: 542, srctop: 0, srczoomx: 100, srczoomy: 100 },
            { time: 100, duration: 100, interp: "l", easing: "linear", accel: 0, srcleft: 0, srctop: 0, srczoomx: 100, srczoomy: 100 },
          ],
        },
      }],
      { instant: false, signal: sig() },
    );
    // L'animation doit être terminée (promise résolue). Pas de crash.
    expect(root.querySelector(".mh-stage-partbg-img")).not.toBeNull();
  });

  it("waitFor('animation') sans cible attend toutes les animations non-loop", async () => {
    vi.useFakeTimers();
    const sig = () => new AbortController().signal;
    // Crée les sprites avant d'animer.
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: null,
          sprites: [
            { id: "a", storage: "a", x: 0, y: 0, z: 1000, opacity: 1 },
            { id: "b", storage: "b", x: 0, y: 0, z: 1001, opacity: 1 },
          ],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );

    // Lance deux animations non-loop (durée 100 ms).
    await renderer.apply(
      [
        {
          kind: "animate",
          target: "a",
          def: {
            storage: "a",
            keyframes: [
              { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, opacity: 1, center: 0 },
              { time: 100, duration: 0, interp: "l", easing: "linear", accel: 0, opacity: 1, center: 100 },
            ],
          },
        },
        {
          kind: "animate",
          target: "b",
          def: {
            storage: "b",
            keyframes: [
              { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, opacity: 1, center: 0 },
              { time: 100, duration: 0, interp: "l", easing: "linear", accel: 0, opacity: 1, center: 100 },
            ],
          },
        },
      ],
      { instant: false, signal: sig() },
    );

    const waitPromise = renderer.waitFor("animation", undefined, sig());
    let resolved = false;
    waitPromise.then(() => { resolved = true; });

    // Immédiatement, la promise ne devrait pas être résolue.
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Avance le temps jusqu'à la fin des animations.
    vi.advanceTimersByTime(100);
    await waitPromise;
    expect(resolved).toBe(true);

    vi.useRealTimers();
  });

  it("waitFor('animation') sans cible ignore les loops", async () => {
    vi.useFakeTimers();
    const sig = () => new AbortController().signal;
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: null,
          sprites: [{ id: "loopA", storage: "loopA", x: 0, y: 0, z: 1000, opacity: 1 }],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );

    await renderer.apply(
      [{
        kind: "animate",
        target: "loopA",
        def: {
          storage: "loopA",
          loop: true,
          keyframes: [
            { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, opacity: 1 },
            { time: 50, duration: 0, interp: "l", easing: "linear", accel: 0, opacity: 0 },
          ],
        },
      }],
      { instant: false, signal: sig() },
    );

    const waitPromise = renderer.waitFor("animation", undefined, sig());
    // Les loops ne bloquent pas : la promise est déjà résolue (ou rejetée
    // immédiatement si aucune animation non-loop).
    await waitPromise;
    // Avance le temps : la loop tourne sans fin sans bloquer waitFor.
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
  });

  it("clear() retire tous les sprites du DOM (pas de ghost)", async () => {
    const sig = () => new AbortController().signal;
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: null,
          sprites: [
            { id: "a", storage: "a", x: 0, y: 0, z: 1000, opacity: 1 },
            { id: "b", storage: "b", x: 0, y: 0, z: 1001, opacity: 1 },
          ],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );
    expect(root.querySelectorAll(".mh-stage-sprite").length).toBe(2);

    renderer.clear();
    expect(root.querySelectorAll(".mh-stage-sprite").length).toBe(0);
  });

  it("restore() retire les anciens sprites du DOM avant de rendre le snapshot", async () => {
    const sig = () => new AbortController().signal;
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: null,
          sprites: [{ id: "old", storage: "old", x: 0, y: 0, z: 1000, opacity: 1 }],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );
    expect(root.querySelectorAll(".mh-stage-sprite").length).toBe(1);

    const snapshot: StageSnapshot = {
      scene: { bg: null, sprites: [], effect: null },
      text: [],
      textbox: { visible: true, frame: true },
      staffroll: null,
    };
    await renderer.restore(snapshot, sig());
    expect(root.querySelectorAll(".mh-stage-sprite").length).toBe(0);
  });

  it("WAAPI path: animation with only discrete props falls back to a timer and resolves", async () => {
    await withMockAnimate(async ({ getAnims }) => {
      vi.useFakeTimers();
      const sig = () => new AbortController().signal;
      await renderer.apply(
        [{
          kind: "scene",
          scene: { bg: null, sprites: [{ id: "a", storage: "a", x: 0, y: 0, z: 1000, opacity: 1 }], effect: null },
          transition: { method: "none" },
        }],
        { instant: true, signal: sig() },
      );

      const animatePromise = renderer.apply(
        [{
          kind: "animate",
          target: "a",
          def: {
            storage: "a",
            keyframes: [
              { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0 },
              { time: 100, duration: 0, interp: "l", easing: "linear", accel: 0, visible: false },
            ],
          },
        }],
        { instant: false, signal: sig() },
      );

      // No continuous keyframes => no WAAPI animation should be created.
      expect(getAnims().length).toBe(0);

      const waitPromise = renderer.waitFor("animation", "a", sig());
      vi.advanceTimersByTime(100);
      await waitPromise;
      await animatePromise;
      vi.useRealTimers();
    });
  });

  it("WAAPI path: stopAnimation cancels both wrapper and inner partbg animations", async () => {
    await withMockAnimate(async ({ getAnims }) => {
      const sig = () => new AbortController().signal;
      await renderer.apply(
        [{
          kind: "scene",
          scene: {
            bg: null,
            sprites: [{
              id: "im02",
              storage: "im02",
              x: 748, y: 0, z: 1000, opacity: 1,
              crop: { width: 522, height: 576, srcLeft: 542, srcTop: 0, srcZoomX: 100, srcZoomY: 100 },
            }],
            effect: null,
          },
          transition: { method: "none" },
        }],
        { instant: true, signal: sig() },
      );

      await renderer.apply(
        [{
          kind: "animate",
          target: "im02",
          def: {
            storage: "im02",
            isPartbg: true,
            keyframes: [
              { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft: 542, srctop: 0, srczoomx: 100, srczoomy: 100, opacity: 1 },
              { time: 100, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft: 0, srctop: 0, srczoomx: 100, srczoomy: 100, opacity: 0.5 },
            ],
          },
        }],
        { instant: false, signal: sig() },
      );

      expect(getAnims().length).toBe(2);
      const [wrapper, inner] = getAnims();

      await renderer.apply(
        [{ kind: "stopAnimation", target: "im02" }],
        { instant: true, signal: sig() },
      );

      expect(wrapper.commitStyles).toHaveBeenCalledTimes(1);
      expect(wrapper.cancel).toHaveBeenCalledTimes(1);
      expect(inner.commitStyles).toHaveBeenCalledTimes(1);
      expect(inner.cancel).toHaveBeenCalledTimes(1);
    });
  });

  it("WAAPI path: hurry finishes both wrapper and inner partbg animations", async () => {
    await withMockAnimate(async ({ getAnims }) => {
      const sig = () => new AbortController().signal;
      await renderer.apply(
        [{
          kind: "scene",
          scene: {
            bg: null,
            sprites: [{
              id: "im02",
              storage: "im02",
              x: 748, y: 0, z: 1000, opacity: 1,
              crop: { width: 522, height: 576, srcLeft: 542, srcTop: 0, srcZoomX: 100, srcZoomY: 100 },
            }],
            effect: null,
          },
          transition: { method: "none" },
        }],
        { instant: true, signal: sig() },
      );

      await renderer.apply(
        [{
          kind: "animate",
          target: "im02",
          def: {
            storage: "im02",
            isPartbg: true,
            keyframes: [
              { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft: 542, srctop: 0, srczoomx: 100, srczoomy: 100, opacity: 1 },
              { time: 100, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft: 0, srctop: 0, srczoomx: 100, srczoomy: 100, opacity: 0.5 },
            ],
          },
        }],
        { instant: false, signal: sig() },
      );

      expect(getAnims().length).toBe(2);
      const [wrapper, inner] = getAnims();

      renderer.hurry();

      expect(wrapper.finish).toHaveBeenCalledTimes(1);
      expect(inner.finish).toHaveBeenCalledTimes(1);
    });
  });

  it("injected CSS does not apply a transition to .mh-stage-sprite", () => {
    const style = document.head.querySelector("style")?.textContent ?? "";
    const match = style.match(/\.mh-stage-sprite\s*\{([^}]*)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toContain("transition");
  });

  describe("réglages d'affichage (#177)", () => {
    const textEl = () => root.querySelector("#text") as HTMLElement;
    const sig = () => new AbortController().signal;

    it("applique la police et les variables du fondu du texte lu", () => {
      renderer.setSettings(display({ fontFamily: "monospace", readFade: true, readFadeOpacity: 0.5, readFadeDuration: 800 }));
      expect(textEl().style.fontFamily).toBe("monospace");
      expect(textEl().style.getPropertyValue("--mh-read-opacity")).toBe("0.5");
      expect(textEl().style.getPropertyValue("--mh-read-duration")).toBe("800ms");
    });

    it("désactive l'atténuation du texte lu quand le fondu est sans", () => {
      renderer.setSettings(display({ readFade: false }));
      expect(textEl().style.getPropertyValue("--mh-read-opacity")).toBe("1");
      expect(textEl().style.getPropertyValue("--mh-read-duration")).toBe("0ms");
    });

    it("masque les effets spéciaux quand le réglage est désactivé", async () => {
      renderer.setSettings(display({ specialEffects: false }));
      await renderer.apply([{ kind: "effect", effect: { kind: "noise", opacity: 0.5 } }], { instant: true, signal: sig() });
      expect((root.querySelector(".mh-stage-effects") as HTMLElement).children.length).toBe(0);
      renderer.setSettings(display({ specialEffects: true }));
      expect((root.querySelector(".mh-stage-effects") as HTMLElement).children.length).toBe(1);
    });

    it("conserve le texte au changement de page quand l'effacement est désactivé", async () => {
      renderer.setSettings(display({ clearTextOnPageChange: false }));
      await renderer.apply([{ kind: "text", segments: [{ text: "Premier." }] }], { instant: true, signal: sig() });
      await renderer.apply(
        [{ kind: "clearText" }, { kind: "text", segments: [{ text: "Second." }] }],
        { instant: true, signal: sig() },
      );
      expect(textEl().textContent).toBe("Premier.Second.");
      renderer.setSettings(display({ clearTextOnPageChange: true }));
      await renderer.apply([{ kind: "clearText" }], { instant: true, signal: sig() });
      expect(textEl().textContent).toBe("");
    });
  });
});

describe("Texte — accessibilité et typographie (#314)", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    renderer = createDomStageRenderer({ resolver: createAssetResolver() });
    renderer.mount(root);
    renderer.setSettings(DEFAULT_DISPLAY_SETTINGS);
  });
  afterEach(() => {
    renderer.dispose();
    root.remove();
  });

  const apply = (text: string) =>
    renderer.apply([{ kind: "clearText" }, { kind: "text", segments: [{ text }] }], {
      instant: true,
      signal: new AbortController().signal,
    });

  it("expose le texte complet une seule fois au lecteur d'écran (couche visuelle aria-hidden)", async () => {
    await apply("Bonjour à tous.");
    const visual = root.querySelector("#text") as HTMLElement;
    const sr = root.querySelector(".mh-stage-text-sr") as HTMLElement;
    expect(visual.getAttribute("aria-hidden")).toBe("true");
    expect(sr).not.toBeNull();
    expect(sr.getAttribute("aria-live")).toBe("polite");
    expect(sr.textContent).toBe("Bonjour à tous.");
    // Le texte complet est présent dès le premier rendu : l'annonce ne dépend pas de la frappe.
    expect(visual.textContent).toBe("Bonjour à tous.");
  });

  it("applique les espaces fines insécables françaises à la couche visuelle seulement", async () => {
    await apply("Oui ! « bonjour »");
    const units = [...root.querySelectorAll<HTMLElement>(".mh-text-unit")].map((unit) => unit.textContent ?? "");
    const visual = units.join("");
    expect(visual).toContain("\u202F!");
    expect(visual).toContain("«\u202F");
    expect(visual).toContain("\u202F»");
    // Le nœud lecteur d'écran garde le texte source (copie/collage fidèle).
    expect(root.querySelector(".mh-stage-text-sr")?.textContent).toBe("Oui ! « bonjour »");
  });

  it("construit la structure DOM de la page entière dès le début de la frappe (#314)", async () => {
    const units = "Une phrase assez longue pour vérifier la stabilité.";
    const pending = renderer.apply([{ kind: "clearText" }, { kind: "text", segments: [{ text: units }] }], {
      instant: false,
      signal: new AbortController().signal,
    });
    // Laisse démarrer la frappe (le premier caractère est révélé) sans l'attendre.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const wrappers = [...root.querySelectorAll<HTMLElement>(".mh-text-unit")];
    // Autant de wrappers que de caractères : la mise en page est complète.
    expect(wrappers.length).toBe(units.length);
    // Certaines unités ne sont pas encore révélées, mais existent déjà (pas de reconstruction).
    expect(root.querySelectorAll(".mh-text-unit-hidden").length).toBeGreaterThan(0);
    renderer.hurry();
    await pending;
    expect(root.querySelectorAll(".mh-text-unit")).toHaveLength(wrappers.length);
    expect(root.querySelectorAll(".mh-text-unit-hidden")).toHaveLength(0);
  });
});

describe("Sprites — dimensions réservées et clip partbgid (#315)", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    renderer = createDomStageRenderer({
      resolver: createAssetResolver(),
      // Manifeste des dimensions (généré au build) : placement avant décodage.
      imageDimensions: {
        perso: { width: 200, height: 100 },
        grand: { width: 800, height: 600 },
        bgwin: { width: 400, height: 300 },
      },
    });
    renderer.mount(root);
    renderer.setSettings(DEFAULT_DISPLAY_SETTINGS);
  });
  afterEach(() => {
    renderer.dispose();
    root.remove();
  });

  const applyScene = (sprites: SceneState["sprites"]) =>
    renderer.apply([{ kind: "scene", scene: { bg: null, sprites, effect: null }, transition: { method: "none" } }], {
      instant: true,
      signal: new AbortController().signal,
    });

  it("réserve la taille native avant décodage et ancre au centre (plus de boîte 0×0)", async () => {
    await applyScene([{ id: "p1", storage: "perso", x: 512, y: 288, z: 1, opacity: 1 }]);
    const img = root.querySelector<HTMLImageElement>('[data-sprite-id="p1"]')!;
    expect(img.style.width).toBe("200px");
    expect(img.style.height).toBe("100px");
    expect(img.style.left).toBe("512px");
    expect(img.style.top).toBe("288px");
    // Le CSS de base centre la boîte réservée : rect attendu = resolvePlacement({center:512,vcenter:288}).
    expect(img.className).toContain("mh-stage-sprite");
  });

  // Registre des approximations (#295) — test figé :
  // approx:sprite-clip-bbox — clip par insets sur la boîte non transformée.
  it("applique le clip absolu d'un sprite partbgid (aucun débordement du partbg)", async () => {
    await applyScene([
      {
        id: "win",
        storage: "bgwin",
        x: 512,
        y: 288,
        z: 1,
        opacity: 1,
        crop: { width: 300, height: 200, srcLeft: 0, srcTop: 0, srcZoomX: 100, srcZoomY: 100 },
      },
      { id: "char", storage: "grand", x: 512, y: 288, z: 2, opacity: 1, partbgId: "win" },
    ]);
    const img = root.querySelector<HTMLImageElement>('[data-sprite-id="char"]')!;
    // Image 800×600 centrée : boîte x=112,y=-12 ; clip partbg (362,188,300,200) → inset 200/250/200/250.
    expect(img.style.clipPath).toBe("inset(200px 250px 200px 250px)");
    expect(img.style.width).toBe("800px");
    expect(img.style.height).toBe("600px");
  });

  it("sans partbgid, aucun clip n'est appliqué", async () => {
    await applyScene([{ id: "p2", storage: "perso", x: 512, y: 288, z: 1, opacity: 1 }]);
    const img = root.querySelector<HTMLImageElement>('[data-sprite-id="p2"]')!;
    expect(img.style.clipPath).toBe("");
  });
});
