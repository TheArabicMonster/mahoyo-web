/**
 * SPÉCIFICATION D'AVANCE — #287 « tracer / timelines » : `@settracerreturn`, `@startchart`,
 * `@loadtimeline` (no-ops justifiés).
 *
 * Statut : tests de non-régression #287 (spécifiés avant implémentation, verts depuis le lot).
 *
 * ## Sémantique / contexte (vérifié dans les scripts, assets locaux non commités)
 *
 * - `@settracerreturn storage=… target=…` (2 occurrences utiles : `sp2.ks`) : règle la destination
 *   de retour du **traceur de parcours** (mode debug/flowchart d'origine). `sp2.ks` est un script
 *   système non chargé par le player (écrans spéciaux/archive) : la commande n'a **aucun effet
 *   visible, audible ou de déroulement** dans le port.
 * - `@startchart storage=main.gc block=… clearflag=…` (`sp2.ks`, `first.ks`) : lance une **carte
 *   de fin de chapitre** (graphique de flowchart, `.gc`) propre au moteur TYPE-MOON. Aucun écran
 *   de ce type n'est modélisé par le player, et les scripts qui l'utilisent ne sont pas chargés
 *   par le parcours jouable → aucun effet dans le port.
 * - `@loadtimeline storage=…tla` (1 occurrence utile, `menutest.ks`) : charge un fichier de
 *   **timeline** `.tla`. Le pipeline d'assets ne convertit pas les `.tla` (aucun asset timeline
 *   dans le manifeste) et `menutest.ks` est un script de test non chargé par le player → no-op
 *   documenté (l'approximation « timelines absentes » est déjà actée §9 bis : `@playtimeline
 *   scene=` est rejoué depuis les données `*tladata` embarquées, sans `.tla`).
 *
 * ## Contrat attendu (port)
 *
 * Les trois commandes sont déclarées **no-op justifiés** dans `tools/ignored-commands.ts` avec
 * `effet: "aucun"`, une raison explicite citant le contexte ci-dessus et `issue: "#287"`.
 * Conséquences : l'audit les classe « ignorée(s) volontairement » (elles sortent de la baseline
 * des inconnues : 4 → 0 commande / 5 → 0 occurrence après #282 et #287) ; le runtime ne doit
 * émettre **aucun avertissement de commande inconnue** ni aucun événement visible/déroulement ;
 * parses et exécution restent tolérants (aucun crash, aucun arrêt).
 *
 * Le registre doit rester valide au sens de `validateIgnoredCommands()` et ne contenir **que**
 * les 5 no-ops admis après #287 : `autocache`, `deffont`, `settracerreturn`, `startchart`,
 * `loadtimeline` (les 2 no-ops historiques + les 3 du lot).
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RenderEvent } from "@/kag/events.js";
import {
  IGNORED_COMMANDS,
  IGNORED_COMMANDS_BY_NAME,
  validateIgnoredCommands,
} from "../../../tools/ignored-commands.js";

function findEvent<T extends RenderEvent["kind"]>(
  events: readonly RenderEvent[],
  kind: T,
): Extract<RenderEvent, { kind: T }> | undefined {
  return events.find((event): event is Extract<RenderEvent, { kind: T }> => event.kind === kind);
}

function runPage(source: string): { events: RenderEvent[]; warnings: string[] } {
  const runtime = new Runtime(parse(lex(source)));
  const warnings: string[] = [];
  runtime.onWarning = (message) => warnings.push(message);
  const events: RenderEvent[] = [];
  for (let i = 0; i < 30; i++) {
    const step = runtime.step();
    events.push(...step.events);
    if (step.stop.kind === "end") break;
  }
  return { events, warnings };
}

const unknownWarnings = (warnings: string[]): string[] =>
  warnings.filter((message) => message.includes("commande non gérée"));

describe("registre des no-ops #287 (tests #287)", () => {
  it("déclare settracerreturn, startchart et loadtimeline en no-op effet aucun, issue #287", () => {
    for (const name of ["settracerreturn", "startchart", "loadtimeline"]) {
      const entry = IGNORED_COMMANDS_BY_NAME.get(name);
      expect(entry, `entrée manquante : ${name}`).toBeDefined();
      expect(entry?.effet).toBe("aucun");
      expect(entry?.issue).toBe("#287");
      expect(entry?.accord).toBeUndefined(); // effet "aucun" : pas d'accord requis (DoD)
      expect((entry?.raison ?? "").length).toBeGreaterThanOrEqual(20);
    }
  });

  it("les raisons citent le contexte qui justifie le no-op", () => {
    const settracer = IGNORED_COMMANDS_BY_NAME.get("settracerreturn")?.raison ?? "";
    const startchart = IGNORED_COMMANDS_BY_NAME.get("startchart")?.raison ?? "";
    const loadtimeline = IGNORED_COMMANDS_BY_NAME.get("loadtimeline")?.raison ?? "";
    // sp2.ks / first.ks pour les deux premiers (scripts système non chargés par le player).
    expect(`${settracer} ${startchart}`).toMatch(/sp2\.ks|système|non chargés?/i);
    // .tla absent du pipeline pour le troisième.
    expect(loadtimeline).toMatch(/\.tla|timeline|menutest/i);
  });

  it("le registre reste valide et ne contient que les 5 no-ops admis après #287", () => {
    expect(validateIgnoredCommands()).toEqual([]);
    expect([...IGNORED_COMMANDS_BY_NAME.keys()].sort()).toEqual([
      "autocache",
      "deffont",
      "loadtimeline",
      "settracerreturn",
      "startchart",
    ]);
    expect(IGNORED_COMMANDS.filter((entry) => entry.effet === "aucun").length).toBe(
      IGNORED_COMMANDS.length,
    );
  });
});

describe("@settracerreturn — tolérance runtime (tests #287)", () => {
  it("parses et exécute sans avertissement d'inconnue ni effet visible", () => {
    const { events, warnings } = runPage(`
*page0|
@settracerreturn storage=sp2.ks target=*endofex02
Texte normal.[l]
@pg
    `);
    expect(unknownWarnings(warnings)).toEqual([]);
    // Aucun effet visuel/événementiel propre à la commande ; le texte continue de s'afficher.
    expect(findEvent(events, "text")).toBeDefined();
    expect(events.some((event) => event.kind === "quake" || event.kind === "audio")).toBe(false);
  });
});

describe("@startchart — tolérance runtime (tests #287)", () => {
  it("parses et exécute sans avertissement d'inconnue ni effet visible", () => {
    const { events, warnings } = runPage(`
*page0|
@startchart storage=main.gc block=246 clearflag=false
Texte normal.[l]
@pg
    `);
    expect(unknownWarnings(warnings)).toEqual([]);
    expect(findEvent(events, "text")).toBeDefined();
  });
});

describe("@loadtimeline — tolérance runtime (tests #287)", () => {
  it("parses et exécute sans avertissement d'inconnue ni effet visible (aucun .tla dans le pipeline)", () => {
    const { events, warnings } = runPage(`
*page0|
@loadtimeline storage=menutest.tla
Texte normal.[l]
@pg
    `);
    expect(unknownWarnings(warnings)).toEqual([]);
    expect(findEvent(events, "text")).toBeDefined();
  });
});
