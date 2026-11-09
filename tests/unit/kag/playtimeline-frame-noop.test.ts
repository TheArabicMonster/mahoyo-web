/**
 * SPÉCIFICATION D'AVANCE — #287 : variante de test `@playtimeline frame=N` (sans `scene=`).
 *
 * Statut : tests de non-régression #287 (spécifiés avant implémentation, verts depuis le lot).
 *
 * ## Contexte / trace vérifiée
 *
 * Le modèle du port rejoue `@playtimeline scene=N` depuis les données `*tladata` embarquées dans
 * le script (`tools/convert-…`), avec un fallback documenté §9 bis : « variante malformée à
 * tolérer (`@playtimeline` de test) ». Le corpus contient une forme **sans `scene=`** :
 *
 * - `menutest.ks:2` : `@playtimeline frame=0` (script de test, 1 occurrence comptée dans la
 *   baseline des inconnues) ;
 * - `gamemenu.ks:25/33` : `@playtimeline frame=0/21 textoff=false` (script système, hors audit).
 *
 * Le parser actuel renvoie `{ kind: "raw", command: "playtimeline" }` quand `scene` manque → le
 * runtime émet « commande non gérée: @playtimeline » et l'audit la compte comme inconnue.
 *
 * ## Contrat attendu (port)
 *
 * - `@playtimeline` **sans `scene=`** (variante de test `frame=…`) : tolérée comme **no-op
 *   documenté** — instruction `{ kind: "noop", command: "playtimeline", reason: … }` (ou
 *   équivalent), **aucun avertissement de commande inconnue**, aucun événement, aucun arrêt.
 *   `frame=`/`textoff=` sont ignorés (pas de timeline `.tla` dans le pipeline).
 * - `@playtimeline scene=N` : comportement inchangé (rejeu de la séquence depuis les timelines
 *   connues ; sans données de timeline, avertissement « timeline introuvable », pas « commande
 *   non gérée », et aucun événement) — non-régression figée ici.
 * - Après #287, la baseline ne doit plus contenir `playtimeline` (4 → 0 commande / 5 → 0
 *   occurrence, avec #282) : la variante est classée « implémentée » (no-op explicite), pas
 *   « ignorée volontairement » (le registre #275 reste réservé aux 5 no-ops admis).
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RenderEvent } from "@/kag/events.js";

type LooseInstruction = { kind: string; command?: string; reason?: string };

function instructions(source: string): LooseInstruction[] {
  return parse(lex(source)).pages.flatMap(
    (page) => page.instructions as unknown as LooseInstruction[],
  );
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

/** Avertissements « commande non gérée » (ceux que l'audit transforme en inconnues). */
const unknownWarnings = (warnings: string[]): string[] =>
  warnings.filter((message) => message.includes("commande non gérée"));

describe("@playtimeline frame= — variante de test tolérée (#287, tests #287)", () => {
  it("se parse en no-op explicite (plus de raw) pour menutest.ks", () => {
    const [instruction] = instructions("*page0|\n@playtimeline frame=0\n@pg\n");
    expect(instruction?.kind).toBe("noop");
    expect(instruction?.command).toBe("playtimeline");
    expect((instruction?.reason ?? "").length).toBeGreaterThan(0);
  });

  it("ne produit pas d'avertissement de commande inconnue et aucun effet", () => {
    const { events, warnings } = runPage(`
*page0|
@playtimeline frame=0
Texte après la variante de test.[l]
@pg
    `);
    expect(unknownWarnings(warnings)).toEqual([]);
    expect(warnings.filter((message) => message.includes("playtimeline"))).toEqual([]);
    // Aucun arrêt/événement supplémentaire : le texte continue normalement.
    expect(events.some((event) => event.kind === "text")).toBe(true);
    expect(events.some((event) => event.kind === "bgMove" || event.kind === "audio")).toBe(false);
  });

  it("tolère aussi frame= avec textoff=false (gamemenu.ks, hors audit)", () => {
    const { warnings } = runPage("*page0|\n@playtimeline frame=21 textoff=false\n@pg\n");
    expect(warnings.filter((message) => message.includes("commande non gérée"))).toEqual([]);
  });

  it("les arguments frame/textoff de la variante sont ignorés sans casser le parse", () => {
    expect(() => parse(lex("*page0|\n@playtimeline frame=0 textoff=false unknownopt=1\n@pg\n"))).not.toThrow();
  });
});

describe("@playtimeline scene= — non-régression du rejeu de timeline (#287, tests #287)", () => {
  it("conserve l'instruction playtimeline scene=N (forme nominale)", () => {
    const [instruction] = instructions("*page0|\n@playtimeline scene=6\n@pg\n");
    expect(instruction?.kind).toBe("playtimeline");
    const scene = (instruction as unknown as { scene?: number }).scene;
    expect(scene).toBe(6);
  });

  it("sans données de timeline : avertissement « timeline introuvable », pas « commande non gérée »", () => {
    const { events, warnings } = runPage("*page0|\n@playtimeline scene=6\n@pg\n");
    expect(unknownWarnings(warnings)).toEqual([]);
    expect(warnings.some((message) => message.includes("timeline introuvable"))).toBe(true);
    // Seul le clearText implicite de début de page : aucun événement de la timeline.
    expect(events.filter((event) => event.kind !== "clearText")).toEqual([]);
  });

  it("la trace actuelle (raw → warning d'inconnue) n'est plus acceptable", () => {
    // Garde-fou : une régression qui rouvrirait la variante en raw serait détectée.
    const kinds = instructions("*page0|\n@playtimeline frame=0\n@pg\n").map((i) => i.kind);
    expect(kinds).not.toContain("raw");
  });
});
