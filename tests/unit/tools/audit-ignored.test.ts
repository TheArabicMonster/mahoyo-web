/**
 * Garde-fou #287 : classification « ignorée volontairement » de l'audit.
 *
 * Les no-ops déclarés au registre #275 sont comptés sur les commandes **réellement exécutées**
 * (`Runtime.onCommand`), y compris celles encore reconnues en `raw` (`autocache`, `deffont`) :
 * ils ne doivent jamais être classés « inconnues » ni « implémentées ». La variante de test
 * `@playtimeline frame=` est un no-op explicite **hors registre** : elle compte comme implémentée
 * et ne produit ni warning ni inconnue.
 *
 * @vitest-environment node
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { auditScript } from "../../../tools/audit-lib.js";
import {
  IGNORED_COMMANDS,
  IGNORED_COMMANDS_BY_NAME,
  validateIgnoredCommands,
} from "../../../tools/ignored-commands.js";

const TMP_DIR = join(import.meta.dirname, "../../../.tmp-audit-ignored-287");

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

function writeKs(name: string, content: string): string {
  mkdirSync(TMP_DIR, { recursive: true });
  const path = join(TMP_DIR, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

describe("registre #287 — 5 no-ops admis", () => {
  it("valide le registre et n'expose que les 5 no-ops effet aucun", () => {
    expect(validateIgnoredCommands()).toEqual([]);
    expect([...IGNORED_COMMANDS_BY_NAME.keys()].sort()).toEqual([
      "autocache",
      "deffont",
      "loadtimeline",
      "settracerreturn",
      "startchart",
    ]);
    expect(IGNORED_COMMANDS.every((entry) => entry.effet === "aucun")).toBe(true);
    expect(IGNORED_COMMANDS.filter((entry) => entry.issue === "#287").length).toBe(3);
  });
});

describe("auditScript — classification des no-ops déclarés et de la variante playtimeline", () => {
  it("classe les 3 no-ops #287 en ignorées, sans inconnue, et la variante frame= en implémentée", async () => {
    const path = writeKs(
      "noops.ks",
      `*page0|
@settracerreturn storage=sp2.ks target=*endofex02
@startchart storage=main.gc block=246 clearflag=false
@loadtimeline storage=menutest.tla
@playtimeline frame=0
@autocache enabled=true
@deffont face=user
Texte de test.[p]
`,
    );
    const result = await auditScript(path, "noops.ks", null, new Map(), 200);

    // Aucune inconnue : baseline vidée (mode zéro strict).
    expect(result.unknownCommands).toEqual({});
    expect(result.warnings).toEqual({});
    // Les 5 no-ops déclarés sont comptés « ignorée(s) volontairement ».
    expect(result.ignoredCommands).toEqual({
      settracerreturn: 1,
      startchart: 1,
      loadtimeline: 1,
      autocache: 1,
      deffont: 1,
    });
    // La variante playtimeline frame= est tolérée et comptée comme implémentée.
    expect(result.implementedCommands?.playtimeline).toBe(1);
    expect(result.implementedCommands?.settracerreturn).toBeUndefined();
  });

  it("@playtimeline scene= sans données de timeline : autre warning, pas une inconnue", async () => {
    const path = writeKs("scene.ks", "*page0|\n@playtimeline scene=6\nTexte.[p]\n");
    const result = await auditScript(path, "scene.ks", null, new Map(), 200);
    expect(result.unknownCommands).toEqual({});
    expect(Object.keys(result.warnings).some((warning) => warning.includes("timeline introuvable"))).toBe(true);
  });
});
