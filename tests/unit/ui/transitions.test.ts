import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createScreenTransitions,
  DomScreenTransitions,
  FALLBACK_TIMINGS,
  parseCssDuration,
  TRANSITION_CLASS,
  TRANSITION_RUNNING_CLASS,
} from "@/ui/transitions.js";

/**
 * HUD-14 (#205) : transitions plein écran. jsdom ne joue ni les transitions ni les animations CSS :
 * on contrôle le **séquencement** (phases `out` → `black` → `in` → `idle`) avec une horloge simulée,
 * et les durées attendues viennent des tokens (`FALLBACK_TIMINGS`, vérifiés contre `tokens.css` /
 * `transitions.css` dans `transitions-css.test.ts`).
 */
type PhaseRecord = { phase: string; at: number };

function overlayOf(host: HTMLElement): HTMLElement {
  return (host.querySelector<HTMLElement>("#ui-overlay") ?? host) as HTMLElement;
}

/** Enregistre les changements de `data-phase` du rideau (timestamps de l'horloge simulée). */
function watchPhases(element: HTMLElement): PhaseRecord[] {
  const records: PhaseRecord[] = [{ phase: element.dataset.phase ?? "idle", at: Date.now() }];
  const observer = new MutationObserver(() => {
    records.push({ phase: element.dataset.phase ?? "idle", at: Date.now() });
  });
  observer.observe(element, { attributes: true, attributeFilter: ["data-phase"] });
  return records;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Transitions plein écran (HUD-14)", () => {
  let host: HTMLElement;
  let transitions: DomScreenTransitions;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    document.body.innerHTML =
      '<div id="app"><div id="viewport"><div id="ui-overlay"></div></div></div>';
    host = document.getElementById("viewport")!;
    transitions = createScreenTransitions({ host, prefersReducedMotion: () => false });
  });

  afterEach(() => {
    transitions.dispose();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("pose le rideau dans #ui-overlay (sous #ui-loading) et démarre en phase idle", () => {
    const curtain = document.getElementById("ui-transition")!;
    expect(curtain).not.toBeNull();
    expect(curtain.parentElement).toBe(document.getElementById("ui-overlay"));
    expect(curtain.classList.contains(TRANSITION_CLASS)).toBe(true);
    expect(curtain.dataset.phase).toBe("idle");
    expect(curtain.getAttribute("aria-hidden")).toBe("true");
    expect(transitions.active).toBe(false);
  });

  it("sans overlay, le rideau se pose sur la racine fournie", () => {
    transitions.dispose();
    host.innerHTML = "";
    const bare = createScreenTransitions({ host, prefersReducedMotion: () => false });
    expect(document.getElementById("ui-transition")!.parentElement).toBe(host);
    bare.dispose();
  });

  it("lit les durées dans les tokens (repli identique aux variables CSS)", () => {
    expect(transitions.timings("title-to-game")).toEqual({ out: 1200, hold: 200, in: 850 });
    expect(transitions.timings("game-to-title")).toEqual({ out: 400, hold: 100, in: 800 });
    expect(transitions.timings("loading-to-scene")).toEqual({ out: 400, hold: 0, in: 850 });
    // Le repli ne doit jamais diverger des constantes du module.
    expect(transitions.timings("title-to-game")).toEqual(FALLBACK_TIMINGS["title-to-game"]);
  });

  it("titre → jeu : fondu 1,2 s, noir 0,2 s, apparition 0,85 s (horloge simulée)", async () => {
    const overlay = overlayOf(host);
    const transition = transitions.start("title-to-game");
    const curtain = document.getElementById("ui-transition")!;
    expect(transitions.phase).toBe("out");
    expect(overlay.classList.contains(TRANSITION_RUNNING_CLASS)).toBe(true);
    expect(overlay.dataset.transitionKind).toBe("title-to-game");

    await vi.advanceTimersByTimeAsync(1199);
    expect(transitions.phase).toBe("out"); // toujours dans le fondu au noir
    await vi.advanceTimersByTimeAsync(1);
    expect(transitions.phase).toBe("black"); // écran entièrement noir

    await expect(transition.black).resolves.toBeUndefined();
    expect(transitions.phase).toBe("black"); // `black` résout quand le rideau est entièrement noir
    const revealed = transition.reveal();
    await flush();
    await vi.advanceTimersByTimeAsync(199);
    expect(transitions.phase).toBe("black"); // maintien du noir
    await vi.advanceTimersByTimeAsync(1);
    expect(transitions.phase).toBe("in"); // apparition de la scène

    await vi.advanceTimersByTimeAsync(849);
    expect(transitions.phase).toBe("in");
    await vi.advanceTimersByTimeAsync(1);
    expect(transitions.phase).toBe("idle");
    await revealed;
    expect(transitions.active).toBe(false);
    expect(curtain.dataset.phase).toBe("idle");
    expect(overlay.classList.contains(TRANSITION_RUNNING_CLASS)).toBe(false);
    expect(overlay.dataset.transitionKind).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("jeu → titre : fondu 0,4 s, noir 0,1 s, apparition 0,8 s", async () => {
    const transition = transitions.start("game-to-title");
    await vi.advanceTimersByTimeAsync(399);
    expect(transitions.phase).toBe("out");
    await vi.advanceTimersByTimeAsync(1);
    expect(transitions.phase).toBe("black");
    const revealed = transition.reveal();
    await flush();
    await vi.advanceTimersByTimeAsync(99);
    expect(transitions.phase).toBe("black");
    await vi.advanceTimersByTimeAsync(1);
    expect(transitions.phase).toBe("in");
    await vi.advanceTimersByTimeAsync(800);
    await revealed;
    expect(transitions.phase).toBe("idle");
  });

  it("chargement → scène : fondu court puis apparition de 0,85 s", async () => {
    const transition = transitions.start("loading-to-scene");
    await vi.advanceTimersByTimeAsync(400);
    expect(transitions.phase).toBe("black");
    const revealed = transition.reveal();
    await flush();
    await vi.advanceTimersByTimeAsync(1);
    expect(transitions.phase).toBe("in");
    await vi.advanceTimersByTimeAsync(850);
    await revealed;
    expect(transitions.phase).toBe("idle");
  });

  it("assets prêts pendant le fondu : aucun noir prolongé (> 1 s) pour titre → jeu", async () => {
    const transition = transitions.start("title-to-game");
    const records = watchPhases(document.getElementById("ui-transition")!);
    // Préchargement rapide : la scène est prête pendant le fondu au noir.
    await vi.advanceTimersByTimeAsync(300);
    const revealed = transition.reveal();
    await vi.advanceTimersByTimeAsync(900); // t = 1200 ms : noir complet
    expect(transitions.phase).toBe("black");
    await flush();
    await vi.advanceTimersByTimeAsync(200); // maintien de 0,2 s
    expect(transitions.phase).toBe("in");
    await vi.advanceTimersByTimeAsync(850);
    await revealed;

    const blackAt = records.findIndex((r) => r.phase === "black");
    const inAt = records.findIndex((r) => r.phase === "in");
    expect(blackAt).toBeGreaterThanOrEqual(0);
    expect(inAt).toBeGreaterThan(blackAt);
    const blackDuration = records[inAt]!.at - records[blackAt]!.at;
    expect(blackDuration).toBeGreaterThan(0);
    expect(blackDuration).toBeLessThanOrEqual(1000);
  });

  it("assets lents : le noir attend le préchargement puis révèle (écran de chargement visible)", async () => {
    const transition = transitions.start("title-to-game");
    await vi.advanceTimersByTimeAsync(1200);
    expect(transitions.phase).toBe("black");
    // Le chargement dure 3 s de plus : le rideau reste noir, `#ui-loading` porte l'indicateur stylé.
    await vi.advanceTimersByTimeAsync(3000);
    expect(transitions.phase).toBe("black");
    await expect(transition.black).resolves.toBeUndefined();
    expect(transitions.phase).toBe("black"); // `black` résout quand le rideau est entièrement noir
    const revealed = transition.reveal();
    await flush();
    await vi.advanceTimersByTimeAsync(199);
    expect(transitions.phase).toBe("black");
    await vi.advanceTimersByTimeAsync(1);
    expect(transitions.phase).toBe("in");
    await vi.advanceTimersByTimeAsync(850);
    await revealed;
    expect(transitions.phase).toBe("idle");
  });

  it("prefers-reduced-motion : aucune transition ni minuteur", async () => {
    transitions.dispose();
    transitions = createScreenTransitions({ host, prefersReducedMotion: () => true });
    const overlay = overlayOf(host);
    const transition = transitions.start("title-to-game");
    expect(transitions.active).toBe(false);
    expect(transitions.phase).toBe("idle");
    expect(overlay.classList.contains(TRANSITION_RUNNING_CLASS)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await expect(transition.reveal()).resolves.toBeUndefined();
    await expect(transition.black).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(transitions.phase).toBe("idle");
  });

  it("cancel() : le rideau disparaît, black et reveal() résolvent sans animer", async () => {
    const transition = transitions.start("title-to-game");
    await vi.advanceTimersByTimeAsync(200);
    transition.cancel();
    expect(transitions.phase).toBe("idle");
    expect(transitions.active).toBe(false);
    expect(overlayOf(host).classList.contains(TRANSITION_RUNNING_CLASS)).toBe(false);
    await expect(transition.reveal()).resolves.toBeUndefined();
    await expect(transition.black).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("une nouvelle transition interrompt la précédente (une seule active)", async () => {
    const first = transitions.start("title-to-game");
    await vi.advanceTimersByTimeAsync(500);
    const second = transitions.start("game-to-title");
    expect(transitions.active).toBe(true);
    expect(document.getElementById("ui-transition")!.dataset.kind).toBe("game-to-title");
    await expect(first.reveal()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(400);
    expect(transitions.phase).toBe("black");
    second.cancel();
    expect(transitions.active).toBe(false);
  });

  it("dispose() retire le rideau et rend start() inerte", async () => {
    transitions.dispose();
    expect(document.getElementById("ui-transition")).toBeNull();
    const transition = transitions.start("title-to-game");
    expect(transitions.active).toBe(false);
    await expect(transition.reveal()).resolves.toBeUndefined();
  });

  it("parseCssDuration lit ms et s, refuse le reste", () => {
    expect(parseCssDuration("1200ms")).toBe(1200);
    expect(parseCssDuration("1.2s")).toBe(1200);
    expect(parseCssDuration("0s")).toBe(0);
    expect(parseCssDuration("850ms ")).toBe(850);
    expect(parseCssDuration("")).toBeNull();
    expect(parseCssDuration("fast")).toBeNull();
  });
});
