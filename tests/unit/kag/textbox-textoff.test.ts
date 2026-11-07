/**
 * #159 : la boîte de texte masquée par `@textoff` doit se réafficher quand un
 * texte lisible arrive. Tous les scripts de ce fichier sont inventés.
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RenderEvent } from "@/kag/events.js";

type TextboxEvent = Extract<RenderEvent, { kind: "textbox" }>;

function runtimeOf(src: string): Runtime {
  return new Runtime(parse(lex(src)), "test.ks");
}

function textboxEvents(events: readonly RenderEvent[]): TextboxEvent[] {
  return events.filter((e): e is TextboxEvent => e.kind === "textbox");
}

/** Index du premier événement `kind` dans la liste (-1 si absent). */
function indexOfKind(events: readonly RenderEvent[], kind: RenderEvent["kind"]): number {
  return events.findIndex((e) => e.kind === kind);
}

describe("@textoff puis texte (#159)", () => {
  it("réaffiche la boîte avant le texte qui suit @textoff", () => {
    const runtime = runtimeOf(`
*p0|
@textoff
Texte inventé.
@pg
`);
    const step = runtime.step();
    const boxes = textboxEvents(step.events);
    // Masquage puis réaffichage, dans cet ordre.
    expect(boxes.map((b) => b.state.visible)).toEqual([false, true]);
    expect(boxes[1].time).toBe(300);
    // Le réaffichage précède le texte.
    const lastBox = step.events.lastIndexOf(boxes[1]);
    expect(lastBox).toBeLessThan(indexOfKind(step.events, "text"));
    expect(runtime.getSaveData().state.textbox?.visible).toBe(true);
  });

  it("réaffiche la boîte même après des commandes intermédiaires (@clall, @wait)", () => {
    const runtime = runtimeOf(`
*p0|
@textoff time=800
@clall
@wait time=100
Texte inventé.
@pg
`);
    // @wait arrête le runtime : on enchaîne les pas jusqu'au clic de fin de page.
    const events: RenderEvent[] = [];
    for (let i = 0; i < 10; i++) {
      const step = runtime.step();
      events.push(...step.events);
      if (step.stop.kind === "click") break;
    }
    expect(textboxEvents(events).map((b) => b.state.visible)).toEqual([false, true]);
    expect(textboxEvents(events)[1]).toBe(textboxEvents(events).at(-1));
    expect(events.indexOf(textboxEvents(events)[1])).toBeLessThan(indexOfKind(events, "text"));
  });

  it("conserve l'état du cadre (@invisibleframe) lors du réaffichage", () => {
    const runtime = runtimeOf(`
*p0|
@invisibleframe
@textoff
Texte inventé.
@pg
`);
    const step = runtime.step();
    const boxes = textboxEvents(step.events);
    const last = boxes[boxes.length - 1];
    expect(last.state).toEqual({ visible: true, frame: false });
  });

  it("réaffiche la boîte masquée par @position visible=false", () => {
    const runtime = runtimeOf(`
*p0|
@position visible=false
Texte inventé.
@pg
`);
    const step = runtime.step();
    expect(textboxEvents(step.events).map((b) => b.state.visible)).toEqual([false, true]);
  });

  it("ne réémet rien pour les textes suivants une fois la boîte visible", () => {
    const runtime = runtimeOf(`
*p0|
@textoff
Premier texte.[l]
Second texte.
@pg
`);
    const step1 = runtime.step();
    expect(textboxEvents(step1.events).map((b) => b.state.visible)).toEqual([false, true]);
    expect(step1.stop.kind).toBe("click");
    const step2 = runtime.step();
    expect(textboxEvents(step2.events)).toHaveLength(0);
  });
});

describe("@textoff sans texte (#159)", () => {
  it("laisse la boîte masquée quand aucun texte ne suit", () => {
    const runtime = runtimeOf(`
*p0|
@textoff time=1000
@wait time=500
@pg
`);
    const step = runtime.step();
    expect(textboxEvents(step.events).map((b) => b.state.visible)).toEqual([false]);
    expect(runtime.getSaveData().state.textbox?.visible).toBe(false);
  });

  it("n'est pas réaffichée par un texte blanc (espaces, sauts de ligne)", () => {
    const runtime = runtimeOf(`
*p0|
@textoff
@r
@pg
`);
    const step = runtime.step();
    expect(textboxEvents(step.events).map((b) => b.state.visible)).toEqual([false]);
  });

  it("reste masquée à travers une page sans texte", () => {
    const runtime = runtimeOf(`
*p0|
@textoff
@pg
*p1|
@wait time=100
@pg
`);
    const step0 = runtime.step();
    const step1 = runtime.step();
    const all = [...step0.events, ...step1.events];
    expect(textboxEvents(all).map((b) => b.state.visible)).toEqual([false]);
  });
});

describe("@texton explicite (#159)", () => {
  it("@texton réaffiche la boîte une seule fois, sans doublon au texte", () => {
    const runtime = runtimeOf(`
*p0|
@textoff
@texton
Texte inventé.
@pg
`);
    const step = runtime.step();
    expect(textboxEvents(step.events).map((b) => b.state.visible)).toEqual([false, true]);
  });

  it("un texte entre @textoff et @texton réaffiche d'abord, @texton reste inoffensif", () => {
    const runtime = runtimeOf(`
*p0|
@textoff
Texte inventé.[l]
@texton
Suite.
@pg
`);
    const step1 = runtime.step();
    expect(textboxEvents(step1.events).map((b) => b.state.visible)).toEqual([false, true]);
    const step2 = runtime.step();
    expect(textboxEvents(step2.events).map((b) => b.state.visible)).toEqual([true]);
  });
});

describe("@textoff en fin de script (#159)", () => {
  const SUB = `
*s0|
@textoff
@return
`;
  const NEXT = `
*n0|
Texte du script suivant.
@pg
`;

  it("la boîte masquée en fin de script est réaffichée par le texte du script suivant", async () => {
    const runtime = runtimeOf(`
*p0|
@jump storage="sub.ks"
`);
    runtime.scriptLoader = async (storage: string) => {
      if (storage === "sub.ks") return parse(lex(SUB));
      if (storage === "next.ks") return parse(lex(NEXT));
      return null;
    };

    const first = runtime.step();
    expect(first.stop.kind).toBe("loadScript");
    expect(await runtime.loadScript("sub.ks", undefined, false)).toBe(true);

    const second = runtime.step();
    expect(textboxEvents(second.events).map((b) => b.state.visible)).toEqual([false]);
    expect(runtime.getSaveData().state.textbox?.visible).toBe(false);

    // Le player enchaîne ensuite sur le script suivant avec le même runtime.
    expect(await runtime.loadScript("next.ks", undefined, false)).toBe(true);
    const third = runtime.step();
    const boxes = textboxEvents(third.events);
    expect(boxes.map((b) => b.state.visible)).toEqual([true]);
    expect(third.events.indexOf(boxes[0])).toBeLessThan(indexOfKind(third.events, "text"));
  });

  it("le script suivant sans texte laisse la boîte masquée", async () => {
    const runtime = runtimeOf(SUB);
    runtime.scriptLoader = async (storage: string) =>
      storage === "quiet.ks" ? parse(lex("*q0|\n@wait time=100\n@pg\n")) : null;
    runtime.step();
    expect(await runtime.loadScript("quiet.ks", undefined, false)).toBe(true);
    const step = runtime.step();
    expect(textboxEvents(step.events)).toHaveLength(0);
    expect(runtime.getSaveData().state.textbox?.visible).toBe(false);
  });
});

describe("sauvegardes (#159)", () => {
  it("une sauvegarde faite boîte masquée se recharge masquée, puis le texte la réaffiche", async () => {
    const SRC = `
*p0|
@textoff
@pg
*p1|
Texte inventé.
@pg
`;
    const script = parse(lex(SRC));
    const runtime = new Runtime(script, "test.ks");
    runtime.step();
    const data = runtime.getSaveData();
    expect(data.state.textbox?.visible).toBe(false);

    const restored = new Runtime(script, "test.ks");
    expect(await restored.loadSaveData(data, new Map([["test.ks", script]]))).toBe(true);
    const step = restored.step();
    expect(textboxEvents(step.events).map((b) => b.state.visible)).toEqual([true]);
    expect(restored.getSaveData().state.textbox?.visible).toBe(true);
  });
});
