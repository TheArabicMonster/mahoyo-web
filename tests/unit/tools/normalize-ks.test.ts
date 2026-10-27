/**
 * Tests unitaires pour tools/normalize-ks.ts (transcodeur)
 *
 * normalize-ks ne fait plus de réécriture de storage= ni de suppression
 * de commandes. Il se contente de transcoder (UTF-16LE/UTF-8/Shift_JIS → UTF-8).
 */
import { describe, it, expect } from "vitest";
import { normalizeScriptText, transcodeKagScript } from "../../../tools/normalize-ks.js";

describe("normalizeScriptText", () => {
  it("supprime le BOM", () => {
    expect(normalizeScriptText("\uFEFF[line] Test")).toBe("[line] Test");
  });

  it("normalise les fins de ligne CRLF", () => {
    expect(normalizeScriptText("ligne1\r\nligne2\r\nligne3")).toBe("ligne1\nligne2\nligne3");
  });

  it("normalise les fins de ligne CR", () => {
    expect(normalizeScriptText("ligne1\rligne2\rligne3")).toBe("ligne1\nligne2\nligne3");
  });

  it("supprime les caractères NUL", () => {
    expect(normalizeScriptText("text\u0000suite")).toBe("textsuite");
  });

  it("ne modifie pas un texte déjà normalisé", () => {
    expect(normalizeScriptText("ligne1\nligne2")).toBe("ligne1\nligne2");
  });

  it("combine BOM + CRLF + NUL", () => {
    expect(normalizeScriptText("\uFEFFligne1\r\n\u0000ligne2")).toBe("ligne1\nligne2");
  });

  it("NE modifie PAS les storage=", () => {
    const text = "@bg storage=bg/Night.tlg|b";
    expect(normalizeScriptText(text)).toBe(text);
  });

  it("NE supprime PAS @eval", () => {
    const text = "@eval exp=f.x=1";
    expect(normalizeScriptText(text)).toBe(text);
  });

  it("NE supprime PAS @iscript/@endscript", () => {
    const text = "@iscript\nvar x = 1;\n@endscript";
    expect(normalizeScriptText(text)).toBe(text);
  });

  it("préserve le nombre de lignes", () => {
    const text = "ligne1\r\nligne2\r\nligne3";
    const result = normalizeScriptText(text);
    expect(result.split("\n")).toHaveLength(3);
  });
});

describe("transcodeKagScript", () => {
  it("décode un buffer UTF-8", () => {
    const text = "@bg storage=black\nTexte.";
    const buf = Buffer.from(text, "utf-8");
    const result = transcodeKagScript(buf);
    expect(result.encoding).toBe("utf-8");
    expect(result.text).toBe(text);
  });

  it("décode un buffer UTF-16LE avec BOM", () => {
    const text = "@bg storage=black\nこんにちは。";
    // Créer un buffer UTF-16LE avec BOM
    const bom = Buffer.from([0xff, 0xfe]);
    const content = Buffer.from(text, "utf-16le");
    const buf = Buffer.concat([bom, content]);
    const result = transcodeKagScript(buf);
    expect(result.encoding).toBe("utf-16le");
    expect(result.text).toContain("こんにちは");
    expect(result.text).toContain("@bg");
  });

  it("décode un buffer UTF-8 avec BOM", () => {
    const text = "@bg storage=black";
    const buf = Buffer.from("\uFEFF" + text, "utf-8");
    const result = transcodeKagScript(buf);
    expect(result.encoding).toBe("utf-8");
    expect(result.text).toBe(text); // BOM removed by normalizeScriptText
  });

  it("décode un buffer ASCII (UTF-8 sans BOM)", () => {
    const text = "@bg storage=black\nHello.";
    const buf = Buffer.from(text, "ascii");
    const result = transcodeKagScript(buf);
    expect(result.encoding).toBe("utf-8");
    expect(result.text).toBe(text);
  });

  it("retourne du texte vide pour un buffer vide", () => {
    const result = transcodeKagScript(Buffer.alloc(0));
    expect(result.text).toBe("");
    expect(result.encoding).toBe("utf-8");
  });

  it("préserve les commandes @eval et @iscript", () => {
    const text = "@eval exp=f.x=1\n@iscript\nvar x;\n@endscript";
    const buf = Buffer.from(text, "utf-8");
    const result = transcodeKagScript(buf);
    expect(result.text).toContain("@eval");
    expect(result.text).toContain("@iscript");
    expect(result.text).toContain("@endscript");
  });

  it("préserve les storage= avec suffixe |", () => {
    const text = "@fg storage=Aoko.tlg|b";
    const buf = Buffer.from(text, "utf-8");
    const result = transcodeKagScript(buf);
    expect(result.text).toContain("storage=Aoko.tlg|b");
  });
});
