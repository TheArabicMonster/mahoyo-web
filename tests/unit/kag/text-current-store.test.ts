/**
 * SPÉCIFICATION D'AVANCE — #284 : `@current`, `@store`, `@deffont` (options de message / UI).
 *
 * Statut : tests de non-régression #284 (spécifiés avant implémentation, verts depuis le lot).
 *
 * ## `@current` (KAG3 standard, `mainwindow.tjs`)
 *
 * Sélectionne la **couche de message courante** : `layer=message0` ou `layer=message1`
 * (deux couches existent pour la réplique « robin », cf. `robinserifplugin.tjs`), et
 * `withback=true` propage la sélection à la page `back` (utilisé par `receiver.ks`).
 * Corpus : `macro.ks` (`layer=message1` / `layer=message0`), `receiver.ks` (`withback=true`).
 *
 * Contrat port (approximation documentée) : le port n'affiche qu'une textbox (une couche de
 * message) ; `@current` mémorise la couche active dans l'état (`messageLayer: 0 | 1`,
 * `withBack`), sans effet visuel propre. Cela rend le parse et l'état prévisibles pour une future
 * seconde couche, et évite une commande inconnue. Aucun warning attendu.
 *
 * ## `@store` (KAG3 standard, `mainwindow.tjs`)
 *
 * Active/désactive la **sauvegarde et le chargement** (menu Store) : `enabled=false` pendant les
 * phases où sauvegarder serait incohérent (`first.ks`, `receiver.ks` du corpus). Défaut moteur :
 * activé (absent = true). Contrat port : instruction `{ kind: "store"; enabled: boolean }`, état
 * `saveLoadEnabled` (défaut `true`) exposé dans les sauvegardes, et **les boutons/entrées
 * Sauvegarder/Charger du HUD doivent être désactivés quand `false`** (câblage UI à faire à
 * l'implémentation ; test rendu/UI à ajouter alors). Ici on fige le contrat runtime/état.
 *
 * ## `@deffont` (KAG3 standard) — no-op justifié (#275)
 *
 * Seul usage du corpus : `face=user` (nz1..nz6) ; le port n'a pas de réglage de police
 * utilisateur et `@resetfont` retombe sur la police du thème → **aucun effet visible**. Déjà
 * déclaré no-op du registre #275 (`effet: "aucun"`, issue #284) : on vérifie que ce statut perdure
 * et que le parse reste tolérant (aucun crash ; la commande reste `raw`/classée ignorée).
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RenderEvent } from "@/kag/events.js";
import { IGNORED_COMMANDS_BY_NAME } from "../../../tools/ignored-commands.js";

type LooseInstruction = { kind: string; [key: string]: unknown };

function instructions(source: string): LooseInstruction[] {
  return parse(lex(source)).pages.flatMap(
    (page) => page.instructions as unknown as LooseInstruction[],
  );
}

function runPage(source: string): { events: RenderEvent[]; warnings: string[]; runtime: Runtime } {
  const runtime = new Runtime(parse(lex(source)));
  const warnings: string[] = [];
  runtime.onWarning = (message) => warnings.push(message);
  const events: RenderEvent[] = [];
  for (let i = 0; i < 40; i++) {
    const step = runtime.step();
    events.push(...step.events);
    if (step.stop.kind === "end") break;
  }
  return { events, warnings, runtime };
}

/** État runtime non typé tant que #284 n'est pas implémenté (contrat à figer). */
const looseState = (runtime: Runtime): Record<string, unknown> =>
  runtime.getSaveData().state as unknown as Record<string, unknown>;

describe("@current — parse et état (#284, tests #284)", () => {
  it("parse layer=message1 / message0 et withback", () => {
    const [current1, current0, currentBack] = instructions(`
*page0|
@current layer=message1
@current layer=message0
@current withback=true
@pg
    `);
    expect(current1).toMatchObject({ kind: "current", layer: "message1" });
    expect(current0).toMatchObject({ kind: "current", layer: "message0" });
    expect(currentBack).toMatchObject({ kind: "current", withBack: true });
  });

  it("la couche courante est mémorisée dans l'état (défaut 0, puis 1)", () => {
    const before = looseState(runPage("*page0|\nTexte.\n@pg\n").runtime);
    expect(before.messageLayer ?? 0).toBe(0);

    const { runtime } = runPage("*page0|\n@current layer=message1\nTexte.\n@pg\n");
    expect(looseState(runtime).messageLayer).toBe(1);
  });

  it("pas d'avertissement de commande inconnue", () => {
    const { warnings } = runPage("*page0|\n@current layer=message1\nTexte.\n@pg\n");
    expect(warnings.filter((w) => w.includes("current"))).toEqual([]);
  });
});

describe("@store — parse et état (#284, tests #284)", () => {
  it("parse enabled=false / enabled=true / absent (défaut activé)", () => {
    const [off, on, bare] = instructions(`
*page0|
@store enabled=false
@store enabled=true
@store
@pg
    `);
    expect(off).toMatchObject({ kind: "store", enabled: false });
    expect(on).toMatchObject({ kind: "store", enabled: true });
    expect(bare).toMatchObject({ kind: "store", enabled: true });
  });

  it("l'état saveLoadEnabled suit la commande (défaut true)", () => {
    expect(looseState(runPage("*page0|\nTexte.\n@pg\n").runtime).saveLoadEnabled ?? true).toBe(true);
    const { runtime } = runPage("*page0|\n@store enabled=false\nTexte.\n@pg\n");
    expect(looseState(runtime).saveLoadEnabled).toBe(false);
    const { runtime: runtimeOn } = runPage("*page0|\n@store enabled=false\n@store enabled=true\nTexte.\n@pg\n");
    expect(looseState(runtimeOn).saveLoadEnabled).toBe(true);
  });

  it("pas d'avertissement de commande inconnue", () => {
    const { warnings } = runPage("*page0|\n@store enabled=false\nTexte.\n@pg\n");
    expect(warnings.filter((w) => w.includes("store"))).toEqual([]);
  });
});

describe("@deffont — no-op justifié (déjà en place, doit perdurer)", () => {
  it("est déclaré no-op sans effet dans le registre #275", () => {
    const entry = IGNORED_COMMANDS_BY_NAME.get("deffont");
    expect(entry).toBeDefined();
    expect(entry?.effet).toBe("aucun");
    expect(entry?.issue).toContain("#284");
  });

  it("le parse reste tolérant (aucun crash) et l'audit l'ignore", () => {
    expect(() => parse(lex("*page0|\n@deffont face=user\nTexte.\n@pg\n"))).not.toThrow();
    const { warnings } = runPage("*page0|\n@deffont face=user\nTexte.\n@pg\n");
    // L'audit le classe « ignoré volontairement » : le warning de commande non gérée peut exister,
    // il ne compte pas comme inconnue (registre #275). On vérifie juste que le runtime ne casse pas.
    expect(warnings.filter((w) => !w.includes("deffont")).length).toBe(0);
  });
});
