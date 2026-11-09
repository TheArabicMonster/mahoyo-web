// Tests #282 — runtime des actions/effets de scène.
// Registre des approximations (#295) — tests figés :
// approx:action-modules-subset — translation linéaire pour tous les modules, accel non interpolée.
// approx:pauseploy-font — police du thème au lieu de MS PGothic/user.
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RenderEvent } from "@/kag/events.js";

type AnyEvent = { kind: string } & Record<string, unknown>;

/** Exécute tout le script et collecte les événements (les attentes sont acquittées). */
function runAll(source: string): { events: AnyEvent[]; state: ReturnType<Runtime["getSaveData"]>["state"] } {
  const runtime = new Runtime(parse(lex(source)), "t.ks");
  const events: AnyEvent[] = [];
  for (let i = 0; i < 80; i++) {
    const step = runtime.step();
    events.push(...(step.events as readonly RenderEvent[] as unknown as AnyEvent[]));
    if (step.stop.kind === "end" || step.stop.kind === "click") break;
  }
  return { events, state: runtime.getSaveData().state };
}

const ACTION_SCRIPT = `
*page0|
@partbg page=fore storage=pane.center center=500 vcenter=300 index=1000 width=200 height=100 id=pb1
@action page=fore id=pb1 module=LayerNormalMoveModule startx=335 x=94 starty=81 y=81 time=700
@pauseaction id=pb1
@resumeaction id=pb1
@removeaction id=pb1
@pg
`;

describe("runtime — @action (#282)", () => {
  it("anime un partbg en translation (left/top moteur → center/vcenter du port) via `animate`", () => {
    const { events } = runAll(ACTION_SCRIPT);
    const animate = events.find((e) => e.kind === "animate");
    expect(animate).toBeDefined();
    expect(animate).toMatchObject({ kind: "animate", target: "pb1" });
    const def = animate!.def as {
      storage: string;
      page?: string;
      keyframes: { time: number; center?: number; vcenter?: number }[];
    };
    expect(def.page).toBe("fore");
    // left/top moteur → centre du wrapper : + width/2, + height/2 (crop 200×100).
    expect(def.keyframes[0]).toMatchObject({ center: 435, vcenter: 131 });
    expect(def.keyframes[def.keyframes.length - 1]).toMatchObject({ center: 194, vcenter: 131 });
    expect(def.keyframes[def.keyframes.length - 1]!.time).toBe(700);
  });
});

describe("runtime — @pauseaction / @resumeaction / @removeaction (#282)", () => {
  it("émet pauseAnimation/resumeAnimation ciblés, puis stopAnimation (remove = état courant)", () => {
    const { events } = runAll(ACTION_SCRIPT);
    expect(events.find((e) => e.kind === "pauseAnimation")).toMatchObject({ kind: "pauseAnimation", target: "pb1" });
    expect(events.find((e) => e.kind === "resumeAnimation")).toMatchObject({ kind: "resumeAnimation", target: "pb1" });
    // @removeaction réutilise stopAnimation ciblé (le renderer annule en conservant l'état courant).
    expect(events.find((e) => e.kind === "stopAnimation")).toMatchObject({ kind: "stopAnimation", target: "pb1" });
  });

  it("@pauseaction all=1 cible toutes les animations (target absent)", () => {
    const { events } = runAll("*page0|\n@pauseaction all=1\n@resumeaction\n@pg\n");
    expect(events.find((e) => e.kind === "pauseAnimation")).toMatchObject({ kind: "pauseAnimation" });
    expect((events.find((e) => e.kind === "pauseAnimation")!.target as string | undefined)).toBeUndefined();
  });
});

describe("runtime — @pauseploy / @resumeploy (#282)", () => {
  it("masque la bulle ploy puis la restaure (nz6.ks)", () => {
    const { events } = runAll(`
*page0|
@ploysay mode=lu13 ox=1 oy=2
@pauseploy
@resumeploy
@pg
    `);
    const ployEvents = events.filter((e) => e.kind === "ploy") as unknown as { ploy: { mode: string } | null }[];
    expect(ployEvents.map((e) => e.ploy?.mode ?? null)).toEqual(["lu13", null, "lu13"]);
  });
});

describe("runtime — @beginfallnote / @fallnoteopt / @endfallnote (#282, approximation)", () => {
  it("émet l'activation, le taux puis l'arrêt des particules (rate réel 0.10)", () => {
    const { events } = runAll(`
*page0|
@beginfallnote
@fallnoteopt rate=0.10
@endfallnote
@pg
    `);
    const fallnote = events.filter((e) => e.kind === "fallnote") as unknown as { active: boolean; rate?: number }[];
    expect(fallnote.length).toBeGreaterThanOrEqual(3);
    expect(fallnote[0]).toMatchObject({ active: true });
    expect(fallnote[1]).toMatchObject({ active: true, rate: 0.1 });
    expect(fallnote[2]).toMatchObject({ active: false });
  });
});
