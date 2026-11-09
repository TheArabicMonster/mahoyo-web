/**
 * SPÉCIFICATION D'AVANCE — #284 « texte et options message » : `[graph]` et macros emoji.
 *
 * Statut : tests de non-régression #284 (spécifiés avant implémentation, verts depuis le lot).
 *
 * ## Sémantique moteur (vérifiée dans les TJS, non commités)
 *
 * `data/scenario/macro.tjs` enregistre des **macros de texte** (`exCharTags`) qui s'expansent en
 * une balise inline `[graph]` — ce ne sont pas des commandes `@` :
 *
 * ```tjs
 * [ "heart",   "heart",     "(ハート)" ]   // storage = "heart"   + kag.current.fontSize
 * [ "ageage",  "アゲアゲ",   "↑" ]
 * [ "ansz",    "アンサズ",   "ANSZ" ]
 * [ "ingz",    "イングズ",   "INGZ" ]
 * [ "eywz",    "エイワズ",   "EYWZ" ]
 * [ "swel",    "ソウェル",   "SWEL" ]
 * macros[name] = macros[name.toLowerCase()] = "[graph storage=&('" + nom + "'+kag.current.fontSize) alt=\"...\"]";
 * ```
 *
 * Donc `[heart]` = `[graph storage=heart<tailleCourante> alt="(ハート)"]`. Les assets réels
 * confirment le suffixe de taille (`heart24`, `heart26`, `アゲアゲ26`, `アンサズ26`, `イングズ26`,
 * `エイワズ26`, `ソウェル26` dans `asset-manifest.json`) : c'est le **fontSize du message courant**
 * (corpus : 24 et 26) qui choisit l'image.
 *
 * `[graph]` (KAG3 standard) : image insérée **dans le flux de texte**, à la place du tag, comme un
 * caractère unique pour la frappe et l'historique — pas un sprite de scène. Attributs attendus :
 * `storage` (clé d'asset), `alt` (texte de repli, lu par l'accessibilité et si l'image manque).
 *
 * ## Contrat attendu (port)
 *
 * - Parser : un segment de texte `{ graph: { storage: string; alt?: string } }` (nom exact du
 *   champ à figer à l'implémentation ; ce test le suppose pour être lisible).
 * - Macros emoji : `[heart]`, `[ageage]`, `[ansz]`, `[ingz]`, `[eywz]`, `[swel]` (et variantes
 *   de casse des tags KAG) → segment graph avec `storage = <base><fontSizeCourant>` et `alt` du
 *   tableau ci-dessus ; aucune commande inconnue ne doit être signalée.
 * - Runtime : le segment graph reste dans l'ordre du texte dans l'événement `text` et dans
 *   l'état persisté (`reduceStage`), pour la sauvegarde et l'historique.
 * - Rendu : `<img class="mh-stage-graph">` inline dans `.mh-stage-text`, `alt` = `alt` du tag,
 *   src résolu par l'`AssetResolver` (clé `storage`) ; repli sur `alt` si l'image n'existe pas.
 *
 * ## Delta d'audit attendu
 *
 * Les 6 tags emoji représentent 10 occurrences (`heart` 3, `swel` 3, `ageage`/`ansz`/`ingz`/`eywz`
 * 1 chacun) dans la baseline #276 ; ils sortiront des inconnues avec `[graph]`. La cible globale
 * #284 annoncée par le Lead (23→19 commandes / 31→16 occurrences) sera revérifiée à
 * l'implémentation : selon que les tags inline sont comptés comme commandes ou non, le delta
 * commandes peut être plus grand que 4 — mesurer avec `npm run audit` avant de figer la baseline.
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RenderEvent } from "@/kag/events.js";

type Seg = { text?: string; pause?: true; graph?: { storage: string; alt?: string } };

function textSegments(source: string): Seg[][] {
  const pages = parse(lex(source)).pages;
  const out: Seg[][] = [];
  for (const page of pages) {
    for (const instruction of page.instructions) {
      if (String(instruction.kind) === "text") {
        out.push((instruction as unknown as { segments: Seg[] }).segments);
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

const textOf = (segments: Seg[]): string => segments.map((seg) => seg.text ?? "").join("");

describe("[graph] — parse et runtime (#284, tests #284)", () => {
  it("parse [graph] comme un segment de texte inline (storage + alt)", () => {
    const pages = textSegments("*page0|\nBonjour [graph storage=heart24 alt=\"(ハート)\"] !\n@pg\n");
    expect(pages.length).toBe(1);
    expect(pages[0]).toContainEqual({ graph: { storage: "heart24", alt: "(ハート)" } });
    // Le tag est bien inséré dans le flux, entre les deux morceaux de texte.
    expect(textOf(pages[0] ?? [])).toContain("Bonjour");
  });

  it("runtime : le graph reste un segment de l'événement text, dans l'ordre", () => {
    const { events, warnings } = runPage(`
*page0|
Avant [graph storage=heart24 alt="(ハート)"] après.[l]
@pg
    `);
    expect(warnings.some((w) => /graph/i.test(w))).toBe(false);
    const segments = allSegments(events);
    const graphIndex = segments.findIndex((seg) => seg.graph !== undefined);
    expect(graphIndex).toBeGreaterThanOrEqual(0);
    expect(segments[graphIndex]).toMatchObject({ graph: { storage: "heart24", alt: "(ハート)" } });
    expect(segments.slice(0, graphIndex).some((seg) => seg.text?.includes("Avant"))).toBe(true);
    expect(segments.slice(graphIndex + 1).some((seg) => seg.text?.includes("après"))).toBe(true);
  });
});

describe("macros emoji — expansion en [graph <base><fontSize>] (#284, tests #284)", () => {
  /**
   * Tailles explicites 24/26 : les deux existent dans les assets réels, et le `fontSize` courant
   * du message choisit l'image. On fige la relation par `@font size=…` pour ne pas dépendre du
   * défaut moteur (à confirmer à l'implémentation).
   */
  const EMOJI: { tag: string; base: string; alt: string }[] = [
    { tag: "heart", base: "heart", alt: "(ハート)" },
    { tag: "ageage", base: "アゲアゲ", alt: "↑" },
    { tag: "ansz", base: "アンサズ", alt: "ANSZ" },
    { tag: "ingz", base: "イングズ", alt: "INGZ" },
    { tag: "eywz", base: "エイワズ", alt: "EYWZ" },
    { tag: "swel", base: "ソウェル", alt: "SWEL" },
  ];

  for (const emoji of EMOJI) {
    it(`[${emoji.tag}] → storage ${emoji.base}<taille> + alt, sans warning`, () => {
      const { events, warnings } = runPage(`
*page0|
@font size=26
Texte [${emoji.tag}] suite.[l]
@pg
      `);
      expect(warnings.some((w) => w.includes(emoji.tag))).toBe(false);
      const graph = allSegments(events).find((seg) => seg.graph !== undefined)?.graph;
      expect(graph).toBeDefined();
      expect(graph?.storage).toBe(`${emoji.base}26`);
      expect(graph?.alt).toBe(emoji.alt);
    });
  }

  it("la taille suit le style courant (24 vs 26)", () => {
    const seg24 = allSegments(runPage("*page0|\n@font size=24\nUn [heart] deux.[l]\n@pg\n").events).find(
      (seg) => seg.graph !== undefined,
    )?.graph;
    expect(seg24?.storage).toBe("heart24");
    const seg26 = allSegments(runPage("*page0|\n@font size=26\nUn [heart] deux.[l]\n@pg\n").events).find(
      (seg) => seg.graph !== undefined,
    )?.graph;
    expect(seg26?.storage).toBe("heart26");
  });

  it("le tag emoji ne produit pas de commande inconnue (audit)", () => {
    const { warnings } = runPage("*page0|\nUn [swel] texte.[l]\n@pg\n");
    expect(warnings).toEqual([]);
  });
});
