/**
 * Trace visuelle headless (`tools/trace-visual.ts`) : vérifications sans assets.
 *
 * L'annotation de lignes et la table `instruction → ligne` sont le socle de l'outil :
 * une régression les rendrait silencieusement fausses (toutes les traces pointeraient
 * vers la mauvaise ligne du script).
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { annotateSource, buildLineMap, readPngSize, visibleSourceRect } from "../../../tools/trace-visual.js";
import { lex } from "../../../src/kag/lexer.js";
import { parse } from "../../../src/kag/parser.js";

const SCRIPT = [
  "; commentaire",
  "@bg time=100 rule=crossfade storage=black",
  "*label|",
  "　texte du jeu",
  "@partbg storage=fond srcleft=542 width=522 height=576 id=pb1",
  "@iscript",
  "// JS ignoré par le lexer",
  "@endscript",
  "@trans rule=crossfade time=800",
].join("\n");

describe("annotateSource", () => {
  it("insère une ligne @__line (n=) avant chaque ligne exécutable", () => {
    const annotated = annotateSource(SCRIPT).split(/\r?\n/);
    expect(annotated[0]).toBe("; commentaire"); // commentaire : pas d'annotation
    expect(annotated[1]).toBe("@__line n=2");
    expect(annotated[2]).toBe("@bg time=100 rule=crossfade storage=black");
    // Label et texte : annotés aussi (le texte devient une instruction à part, sans effet de bord).
    expect(annotated).toContain("@__line n=4");
    expect(annotated).toContain("@__line n=5");
    // Le corps du bloc @iscript n'est ni annoté ni interprété (TJS brut).
    expect(annotated).not.toContain("@__line n=7");
    // @endscript ferme le bloc ; @trans (l.9) est annoté à nouveau.
    expect(annotated).toContain("@__line n=9");
  });

  it("ignore les lignes vides et les corps de @macro", () => {
    const annotated = annotateSource("@macro name=x\n@bg storage=interne\n@endmacro\n\n@bg storage=externe");
    const lines = annotated.split(/\r?\n/);
    expect(lines.filter((line) => line.startsWith("@bg storage=interne")).length).toBe(1);
    // Une seule annotation pour le @bg hors macro (ligne 5), aucune à l'intérieur de la macro.
    // La ligne @macro elle-même est dans le corps : aucune annotation l.1 ; seul le @bg hors
    // macro (l.5) en reçoit une.
    expect(lines.filter((line) => line.startsWith("@__line"))).toEqual(["@__line n=5"]);
  });
});

describe("buildLineMap", () => {
  it("associe les instructions visuelles à leur ligne source", () => {
    const script = parse(lex(annotateSource(SCRIPT)));
    const map = buildLineMap(script);
    const all = script.pages.flatMap((page) => page.instructions);
    const visible = all.filter((instruction) => instruction.kind !== "raw" && instruction.kind !== "text");
    const lines = visible.map((instruction) => map.get(instruction)?.line);
    // @bg l.2, @partbg l.5, @trans l.9 (les lignes du bloc @iscript sont hors instructions).
    expect(lines).toContain(2);
    expect(lines).toContain(5);
    expect(lines).toContain(9);
    // `exact` marque la commande qui commence sur la ligne.
    const bg = all.find((instruction) => instruction.kind === "bg");
    expect(map.get(bg!)?.exact).toBe(true);
  });
});

describe("visibleSourceRect", () => {
  const crop = { width: 512, height: 512, srcLeft: 100, srcTop: 0, srcZoomX: 100, srcZoomY: 100 };

  it("sans zoom, la zone visible est le rect déclaré (srcleft/srctop en haut-gauche)", () => {
    // Le renderer applique translate(-srcleft,-srctop) scale(srczoom) autour du centre de l'image :
    // à 100 %, la zone vue est exactement le rect de départ (modèle vérifié sur le corpus).
    expect(visibleSourceRect(crop, { width: 1120, height: 672 })).toEqual({ x0: 100, y0: 0, x1: 612, y1: 512 });
  });

  it("avec zoom, la zone visible est réduite et centrée comme le renderer", () => {
    const zoomed = { ...crop, srcZoomX: 400, srcZoomY: 400 };
    const rect = visibleSourceRect(zoomed, { width: 1120, height: 672 })!;
    expect(rect.x1 - rect.x0).toBeCloseTo(128, 5);
    expect(rect.y1 - rect.y0).toBeCloseTo(128, 5);
  });

  it("sans dimensions d'image connues, la zone n'est pas calculable", () => {
    expect(visibleSourceRect(crop, null)).toBeNull();
  });
});

describe("readPngSize", () => {
  it("lit les dimensions d'un PNG (IHDR) et rejette les fichiers illisibles", () => {
    // PNG 1×1 minimal (mêmes octets que les placeholders e2e).
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753" +
        "de0000000c4944415408d763f8cfc000000301010018dd8db00000000049454e44ae426082",
      "hex",
    );
    const dir = mkdtempSync(join(tmpdir(), "trace-visual-"));
    const path = join(dir, "un.png");
    writeFileSync(path, png);
    expect(readPngSize(path)).toEqual({ width: 1, height: 1 });
    const notPng = join(dir, "pas-un.png");
    writeFileSync(notPng, "pas une image");
    expect(readPngSize(notPng)).toBeNull();
    expect(readPngSize(join(dir, "absent.png"))).toBeNull();
  });
});
