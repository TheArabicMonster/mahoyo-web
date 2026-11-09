/**
 * SPÉCIFICATION D'AVANCE — #284 : `@cockrobin` / `@endcockrobin` (réplique conditionnelle « robin »).
 *
 * Statut : tests de non-régression #284 (spécifiés avant implémentation, verts depuis le lot).
 *
 * ## Sémantique moteur (vérifiée dans les TJS, non commités)
 *
 * `data/scenario/robinserifplugin.tjs` définit deux **macros de texte** :
 *
 * ```tjs
 * cf.dispRobinSerif          = false if cf.dispRobinSerif === void;           // défaut: false
 * cf.visibileRobinSerifButton= false if cf.visibileRobinSerifButton === void; // défaut: false
 *
 * .cockrobin    = "[if exp='cf.visibileRobinSerifButton&&cf.dispRobinSerif'][robinmode *]
 *                  [trans textoff=0 time=%time|300][macropop]";
 * .endcockrobin = "[backlay][position page=back layer=message1 visible=false]
 *                  [clfg preback=0 page=back id=robin time=%time|300 textoff=0][endrobinmode][macropop]";
 * ```
 *
 * `[cockrobin]` ouvre donc un **bloc conditionnel** : la réplique « robin » (une seconde couche de
 * message + le sprite de visage en `id=robin`) n'est affichée que si **les deux** drapeaux de
 * configuration sont vrais. Les deux valent `false` par défaut : **au comportement par défaut du
 * jeu, le bloc est masqué** (contrairement à l'hypothèse de l'issue #284 qui proposait de
 * l'afficher ; c'est le TJS qui fait foi). Le corpus ne l'utilise que dans `testcodes.ks` (script
 * de test), avec `[cockrobin frame=balloon02 quake=1]…[l][endcockrobin][endif][r]`.
 *
 * ## Contrat attendu (port, approximation documentée à l'implémentation)
 *
 * - Parser : `[cockrobin …]` ouvre un bloc dont le contenu est **ignoré par défaut** (flags de
 *   config non modélisés, valeur moteur `false`), jusqu'au `[endcockrobin]` correspondant inclus.
 *   Les commandes de texte situées dans le bloc ne produisent ni texte ni warning d'inconnue.
 * - Le `[endif]` orphelin qui suit `[endcockrobin]` (il ferme le `[if]` ajouté par la macro
 *   moteur) doit rester toléré sans warning (`CONDITIONAL_CLOSERS` déjà en place).
 * - Aucune commande inconnue `cockrobin`/`endcockrobin` ne doit subsister dans l'audit.
 * - Si une configuration `cf.*` est ajoutée plus tard au port, le bloc deviendra affichable
 *   (comportement conditionnel conservé) ; ce n'est pas requis par ce lot.
 * - Écart documenté : le port n'affiche pas la seconde couche de message ni le sprite `id=robin`
 *   (non modélisés) ; la réplique robin (contenu du bloc) est conservée/masquée comme un texte
 *   normal, sans le cadre « balloon01 ».
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RenderEvent } from "@/kag/events.js";

type Seg = { text?: string; pause?: true; graph?: unknown };

function runPage(source: string): { events: RenderEvent[]; warnings: string[] } {
  const runtime = new Runtime(parse(lex(source)));
  const warnings: string[] = [];
  runtime.onWarning = (message) => warnings.push(message);
  const events: RenderEvent[] = [];
  for (let i = 0; i < 60; i++) {
    const step = runtime.step();
    events.push(...step.events);
    if (step.stop.kind === "end") break;
  }
  return { events, warnings };
}

function textOf(events: RenderEvent[]): string {
  return events
    .flatMap((event) =>
      event.kind === "text" ? ((event as unknown as { segments: Seg[] }).segments ?? []) : [],
    )
    .map((seg) => seg.text ?? "")
    .join("");
}

const TESTCODES_LIKE = `
*page0|
Texte avant le bloc robin.[l]
[cockrobin frame=balloon02 quake=1][r]
Réplique robin conditionnelle.[l][endcockrobin][endif][r]
Texte après le bloc robin.[l]
@pg
`;

describe("@cockrobin / @endcockrobin (#284, tests #284)", () => {
  it("parse sans commande inconnue (les tags ne doivent plus être des raw)", () => {
    const pages = parse(lex(TESTCODES_LIKE)).pages;
    const kinds = pages.flatMap((page) => page.instructions.map((instruction) => String(instruction.kind)));
    expect(kinds.some((kind) => kind === "raw")).toBe(false);
  });

  it("comportement par défaut : le bloc robin est masqué (flags cf.* = false dans le TJS)", () => {
    const { events, warnings } = runPage(TESTCODES_LIKE);
    expect(warnings.filter((w) => /cockrobin/i.test(w))).toEqual([]);
    const text = textOf(events);
    // Le texte hors bloc reste lu, la réplique conditionnelle par défaut est ignorée.
    expect(text).toContain("Texte avant le bloc robin");
    expect(text).toContain("Texte après le bloc robin");
    expect(text).not.toContain("Réplique robin conditionnelle");
  });

  it("le [endif] orphelin de fin de bloc est toléré sans warning", () => {
    const { warnings } = runPage(TESTCODES_LIKE);
    expect(warnings).toEqual([]);
  });

  it("les apparitions des scripts narratifs réels ne produisent pas d'avertissement", () => {
    // testcodes.ks est le seul script du corpus à utiliser le bloc ; on reproduit sa forme exacte.
    const { warnings } = runPage(`
*page0|
[cockrobin frame=balloon02 quake=1][r]
やばいっす、青子さんなんか強いっす！[l][endcockrobin][endif][r]
@pg
    `);
    expect(warnings.filter((w) => /cockrobin/i.test(w))).toEqual([]);
  });
});
