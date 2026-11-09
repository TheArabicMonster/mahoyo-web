/**
 * Tests du registre unique des commandes KAG volontairement ignorées (#275).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  IGNORED_COMMAND_EFFECTS,
  IGNORED_COMMANDS,
  IGNORED_COMMANDS_BY_NAME,
  MIN_REASON_LENGTH,
  validateIgnoredCommands,
  type IgnoredCommand,
} from "../../../tools/ignored-commands.js";

function entry(overrides: Partial<IgnoredCommand> = {}): IgnoredCommand {
  return {
    name: "tickclock",
    raison: "Horloge du HUD absente du port : aucun effet sans interface dédiée.",
    effet: "aucun",
    issue: "#276",
    ...overrides,
  };
}

describe("IGNORED_COMMANDS (registre livré)", () => {
  it("est valide et indexé par nom", () => {
    expect(validateIgnoredCommands()).toEqual([]);
    expect(IGNORED_COMMANDS_BY_NAME.size).toBe(IGNORED_COMMANDS.length);
    for (const command of IGNORED_COMMANDS) {
      expect(IGNORED_COMMANDS_BY_NAME.get(command.name)).toBe(command);
    }
  });

  it("ne contient que des no-ops sans effet justifiés par le triage #276", () => {
    // Garde-fou (DoD v1.0) : aucun no-op à effet visible/audible/de déroulement.
    // Les seules entrées admises sont celles dont le triage #276 prouve l'absence d'effet.
    expect(IGNORED_COMMANDS.length).toBeGreaterThan(0);
    for (const command of IGNORED_COMMANDS) {
      expect(command.effet).toBe("aucun");
      expect(command.raison.length).toBeGreaterThanOrEqual(MIN_REASON_LENGTH);
      expect(command.issue).toMatch(/^#\d+$/);
    }
    const names = IGNORED_COMMANDS.map((command) => command.name);
    expect(names).toContain("autocache");
    expect(names).toContain("deffont");
  });

  it("liste les catégories d'effet autorisées", () => {
    expect(IGNORED_COMMAND_EFFECTS).toContain("aucun");
    expect(IGNORED_COMMAND_EFFECTS).toContain("déroulement");
    expect(IGNORED_COMMAND_EFFECTS).toContain("audio");
    expect(IGNORED_COMMAND_EFFECTS).toHaveLength(7);
  });
});

describe("validateIgnoredCommands", () => {
  it("accepte un no-op sans effet (avec raison et issue)", () => {
    expect(validateIgnoredCommands([entry()])).toEqual([]);
  });

  it("accepte un effet visible uniquement avec un accord explicite", () => {
    expect(
      validateIgnoredCommands([entry({ effet: "image", accord: "accord du 2026-11-09 (#276)" })]),
    ).toEqual([]);
  });

  it("refuse un effet visible sans accord explicite (DoD v1.0)", () => {
    const problems = validateIgnoredCommands([entry({ effet: "audio" })]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("sans accord explicite");
  });

  it("refuse une raison absente ou trop courte", () => {
    const problems = validateIgnoredCommands([entry({ raison: "court" })]);
    expect(problems.some((p) => p.includes("raison"))).toBe(true);
    expect(MIN_REASON_LENGTH).toBeGreaterThan(10);
  });

  it("refuse un nom invalide, en double, une issue invalide ou un effet inconnu", () => {
    const problems = validateIgnoredCommands([
      entry({ name: "@TICKCLOCK" }),
      entry({ name: "okcmd" }),
      entry({ name: "okcmd" }),
      entry({ name: "badissue", issue: "276" }),
      entry({ name: "badeffect", effet: "lumière" as IgnoredCommand["effet"] }),
    ]);
    expect(problems.some((p) => p.includes("nom invalide"))).toBe(true);
    expect(problems.some((p) => p.includes("en double"))).toBe(true);
    expect(problems.some((p) => p.includes("issue invalide"))).toBe(true);
    expect(problems.some((p) => p.includes("effet inconnu"))).toBe(true);
  });
});
