// Tests d'avance #282 — rendu des actions/effets de scène (TDD, implémentation à venir).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDomStageRenderer } from "@/renderer/stage-renderer.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { RenderEvent, SceneState } from "@/kag/events.js";

type FakeAnimation = {
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  finish: ReturnType<typeof vi.fn>;
  commitStyles: ReturnType<typeof vi.fn>;
  currentTime: number;
  playState: string;
  onfinish: (() => void) | null;
  addEventListener: () => void;
};

const sig = () => new AbortController().signal;

function installAnimationStub(): FakeAnimation[] {
  const animations: FakeAnimation[] = [];
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: function () {
      const animation: FakeAnimation = {
        pause: vi.fn(),
        play: vi.fn(),
        cancel: vi.fn(),
        finish: vi.fn(),
        commitStyles: vi.fn(),
        currentTime: 0,
        playState: "running",
        onfinish: null,
        addEventListener: () => {},
      };
      animations.push(animation);
      return animation as unknown as Animation;
    },
  });
  return animations;
}

const scene = (sprites: SceneState["sprites"]): RenderEvent =>
  ({ kind: "scene", scene: { bg: null, sprites, effect: null }, transition: { method: "none" } }) as RenderEvent;

const animDef = {
  storage: "sprite",
  page: "fore" as const,
  id: "l1",
  keyframes: [
    { time: 0, duration: 0, interp: "l" as const, easing: "linear", accel: 0, center: 100, vcenter: 100 },
    { time: 500, duration: 500, interp: "l" as const, easing: "linear", accel: 0, center: 300, vcenter: 300 },
  ],
};

describe("DomStageRenderer — pause/resume d'animations (#282)", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer>;
  let animations: FakeAnimation[];
  const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
    renderer = createDomStageRenderer({ resolver: createAssetResolver() });
    renderer.mount(root);
    animations = installAnimationStub();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    renderer.dispose();
    root.remove();
  });

  const apply = (events: RenderEvent[]) => renderer.apply(events, { instant: true, signal: sig() });

  it("@action démarre une animation WAAPI ; @pauseaction la met en pause ; @resumeaction la relance", async () => {
    await apply([scene([{ id: "l1", storage: "sprite", x: 100, y: 100, z: 100, opacity: 1 }])]);
    await apply([{ kind: "animate", target: "l1", def: animDef } as RenderEvent]);
    await wait();
    expect(animations.length).toBeGreaterThan(0);
    const controllerAnimation = animations.at(-1)!;
    await apply([{ kind: "pauseAnimation", target: "l1" } as unknown as RenderEvent]);
    expect(controllerAnimation.pause).toHaveBeenCalled();
    await apply([{ kind: "resumeAnimation", target: "l1" } as unknown as RenderEvent]);
    expect(controllerAnimation.play).toHaveBeenCalled();
  });

  it("@pauseaction/all cible toutes les animations", async () => {
    await apply([scene([{ id: "l1", storage: "sprite", x: 10, y: 10, z: 100, opacity: 1 }])]);
    await apply([{ kind: "animate", target: "l1", def: animDef } as RenderEvent]);
    await wait();
    await apply([{ kind: "pauseAnimation" } as unknown as RenderEvent]);
    expect(animations.at(-1)!.pause).toHaveBeenCalled();
  });
});

describe("DomStageRenderer — particules @beginfallnote (approximation #282)", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer>;

  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
    renderer = createDomStageRenderer({ resolver: createAssetResolver() });
    renderer.mount(root);
  });

  afterEach(() => {
    renderer.dispose();
    root.remove();
  });

  const apply = (events: RenderEvent[]) => renderer.apply(events, { instant: true, signal: new AbortController().signal });

  it("crée un overlay de notes, applique rate= puis retire l'overlay à @endfallnote", async () => {
    await apply([{ kind: "fallnote", active: true } as unknown as RenderEvent]);
    const overlay = root.querySelector(".mh-stage-fallnote") as HTMLElement | null;
    expect(overlay).not.toBeNull();
    expect(overlay!.querySelectorAll(".mh-stage-fallnote-note").length).toBeGreaterThan(0);
    await apply([{ kind: "fallnote", active: true, rate: 0.1 } as unknown as RenderEvent]);
    expect(overlay!.dataset.rate).toBe("0.1");
    await apply([{ kind: "fallnote", active: false } as unknown as RenderEvent]);
    expect(root.querySelector(".mh-stage-fallnote")).toBeNull();
  });
});
