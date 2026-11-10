/**
 * #300 — ruby + emoji `[graph]` : la lecture doit s'attacher à l'image, pas au texte suivant.
 *
 * Sémantique moteur (vérifiée dans `data/override/messagelayer.tjs`, non commité) :
 * - un `[ruby text=… char=1]` numérique pose `currentRuby`/`rubyTargetCharLength` (`setRuby`) ;
 * - `putGraph` est appelé pour l'image inline (`[graph]`, et les macros emoji `[ansz]`…) et
 *   **incrémente `rubyCharCount`** puis dessine le ruby via `drawRuby` quand la cible est atteinte :
 *   l'image est donc comptée comme un **caractère de base** et le ruby est dessiné **au-dessus de
 *   l'image**. Pour `char=N > 1`, le ruby couvre l'image et les N-1 cellules suivantes.
 *
 * Le motif du corpus `[ruby text=アンサズ char=1][ansz]` doit donc produire un segment
 * `{ graph: { storage: "アンサズ26", ruby: "アンサズ", … } }`, et **pas** un ruby sur le « 、 »
 * qui suit. Cas réels : `c-1.ks` (554, 624, 797) et `c-11.ks` (501 → 3 couples) = **6 occurrences**
 * (l'issue #300 en annonçait 5).
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RenderEvent } from "@/kag/events.js";
import { reduceStage } from "@/kag/stage-state.js";

type Seg = {
  text?: string;
  ruby?: string;
  rubyGroup?: number;
  graph?: { storage: string; alt?: string; ruby?: string; rubyGroup?: number };
  emoji?: { base: string; alt: string; ruby?: string; rubyGroup?: number };
  pause?: true;
};

function segmentsOf(source: string): Seg[] {
  const out: Seg[] = [];
  for (const page of parse(lex(source)).pages) {
    for (const instruction of page.instructions) {
      if (String(instruction.kind) === "text") {
        out.push(...((instruction as unknown as { segments: Seg[] }).segments ?? []));
      }
    }
  }
  return out;
}

function runPage(source: string): { events: RenderEvent[]; warnings: string[] } {
  const runtime = new Runtime(parse(lex(source)));
  const warnings: string[] = [];
  runtime.onWarning = (message) => warnings.push(message);
  const events: RenderEvent[] = [];
  for (let i = 0; i < 40; i++) {
    const step = runtime.step();
    events.push(...step.events);
    if (step.stop.kind === "end") break;
  }
  return { events, warnings };
}

const allSegments = (events: RenderEvent[]): Seg[] =>
  events.flatMap((event) =>
    event.kind === "text" ? ((event as unknown as { segments: Seg[] }).segments ?? []) : [],
  );

describe("parse — ruby posé sur le graph/emoji (#300)", () => {
  it("motif du corpus : [ruby text=アンサズ char=1][ansz] → ruby sur le marqueur emoji, pas sur « 、 »", () => {
    const segments = segmentsOf("*page0|\n「[ruby text=アンサズ char=1][ansz]、」\n@pg\n");
    // Au parse, [ansz] est le marqueur interne emoji (converti en graph par le runtime #284).
    const emoji = segments.find((segment) => segment.emoji !== undefined);
    expect(emoji).toBeDefined();
    expect(emoji?.emoji?.base).toBe("アンサズ");
    expect(emoji?.emoji?.ruby).toBe("アンサズ");
    // La ponctuation suivante ne porte plus le ruby (bug initial).
    const punctuation = segments.find((segment) => segment.text?.includes("、"));
    expect(punctuation?.ruby).toBeUndefined();
  });

  it("char=2 : le ruby couvre l'image puis le premier caractère suivant (même groupe)", () => {
    const segments = segmentsOf("*page0|\n[ruby text=タービン char=2][ansz]回路\n@pg\n");
    const emoji = segments.find((segment) => segment.emoji !== undefined);
    expect(emoji?.emoji?.ruby).toBe("タービン");
    const group = emoji?.emoji?.rubyGroup;
    expect(group).toBeDefined();
    const firstChar = segments.find((segment) => segment.text?.startsWith("回"));
    expect(firstChar?.ruby).toBe("タービン");
    expect(firstChar?.rubyGroup).toBe(group);
    const lastChar = segments.find((segment) => segment.text === "路");
    expect(lastChar?.ruby).toBeUndefined();
  });

  it("ruby texte standard : comportement inchangé (pas de régression)", () => {
    const segments = segmentsOf("*page0|\n[ruby text=またた]瞬き\n@pg\n");
    expect(segments[0]).toMatchObject({ text: "瞬", ruby: "またた" });
    expect(segments[1]).toMatchObject({ text: "き" });
    expect(segments[1]?.ruby).toBeUndefined();
  });

  it("[graph] sans ruby : image simple, aucun ruby attaché", () => {
    const segments = segmentsOf('*page0|\n[graph storage=heart24 alt="(ハート)"]\n@pg\n');
    const graph = segments.find((segment) => segment.graph !== undefined);
    expect(graph?.graph).toMatchObject({ storage: "heart24", alt: "(ハート)" });
    expect(graph?.graph?.ruby).toBeUndefined();
  });
});

describe("runtime — expansion emoji et ordre du flux (#300)", () => {
  const CORPUS_PATTERNS = [
    "[ruby text=ソウ char=1][swel]―――", // c-1.ks:554
    "[ruby text=ソウェル char=1][swel]―――！", // c-1.ks:624
    "[ruby text=エイワズ char=1][eywz]！", // c-1.ks:797
    "[ruby text=アンサズ char=1][ansz]、", // c-11.ks:501 (1/3)
    "[ruby text=ソウェル char=1][swel]、", // c-11.ks:501 (2/3)
    "[ruby text=イングズ char=1][ingz]ッ！", // c-11.ks:501 (3/3)
  ];

  it("les 6 occurrences du corpus attachent le ruby à l'emoji et pas au texte", () => {
    const source = `*page0|\n${CORPUS_PATTERNS.join("\n@pg\n")}\n@pg\n`;
    const { events, warnings } = runPage(source);
    expect(warnings.filter((message) => message.includes("commande non gérée"))).toEqual([]);
    const segments = allSegments(events);
    const rubyGraphs = segments.filter((segment) => segment.graph?.ruby !== undefined);
    expect(rubyGraphs.map((segment) => segment.graph?.ruby)).toEqual([
      "ソウ",
      "ソウェル",
      "エイワズ",
      "アンサズ",
      "ソウェル",
      "イングズ",
    ]);
    // Aucun segment texte ne porte ces rubys (bug initial : le ruby allait sur « 、 »/« ッ »).
    expect(segments.some((segment) => segment.text !== undefined && segment.ruby !== undefined)).toBe(false);
    // La taille de message par défaut (26) est utilisée pour le storage de l'image.
    expect(rubyGraphs[3]?.graph?.storage).toBe("アンサズ26");
  });

  it("reduceStage conserve l'annotation ruby du graph (sauvegardes)", () => {
    const snapshot = reduceStage([
      {
        kind: "text",
        segments: [
          { graph: { storage: "swel26", alt: "SWEL", ruby: "ソウェル", rubyGroup: 1 } },
          { text: "―――" },
        ],
      },
    ]);
    const graph = snapshot.text.find((segment) => "graph" in segment);
    expect(graph !== undefined && "graph" in graph ? graph.graph : undefined).toMatchObject({
      storage: "swel26",
      ruby: "ソウェル",
      rubyGroup: 1,
    });
  });
});
