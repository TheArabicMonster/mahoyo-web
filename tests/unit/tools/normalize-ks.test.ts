/**
 * Tests unitaires pour tools/normalize-ks.ts
 *
 * On teste les fonctions pures uniquement (pas d'I/O).
 */
import { describe, it, expect } from "vitest";
import {
  detectEncoding,
  decodeBuffer,
  normalizeScriptText,
  stripUnsupportedCommands,
  normalizeStorage,
  normalizeAssets,
  normalizeKagScript,
} from "../../../tools/normalize-ks.js";

describe("detectEncoding", () => {
  it("retourne shift_jis par défaut", () => {
    expect(detectEncoding(Buffer.from("test"))).toBe("shift_jis");
  });

  it("retourne shift_jis même pour un buffer vide", () => {
    expect(detectEncoding(Buffer.alloc(0))).toBe("shift_jis");
  });
});

describe("decodeBuffer", () => {
  it("décode un buffer UTF-8", () => {
    const text = "こんにちは世界";
    const buf = Buffer.from(text, "utf-8");
    expect(decodeBuffer(buf, "utf-8")).toBe(text);
  });

  it("décode un buffer Shift_JIS", () => {
    // "こんにちは" en Shift_JIS
    const buf = Buffer.from([0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd]);
    const decoded = decodeBuffer(buf, "shift_jis");
    expect(decoded).toContain("こんにちは");
  });

  it("décode un buffer ASCII (compatible Shift_JIS)", () => {
    const buf = Buffer.from("Hello World", "ascii");
    expect(decodeBuffer(buf, "shift_jis")).toBe("Hello World");
  });
});

describe("normalizeScriptText", () => {
  it("supprime le BOM", () => {
    const text = "\uFEFF[line] Ceci est un test";
    expect(normalizeScriptText(text)).toBe("[line] Ceci est un test");
  });

  it("normalise les fins de ligne CRLF", () => {
    const text = "ligne1\r\nligne2\r\nligne3";
    expect(normalizeScriptText(text)).toBe("ligne1\nligne2\nligne3");
  });

  it("normalise les fins de ligne CR", () => {
    const text = "ligne1\rligne2\rligne3";
    expect(normalizeScriptText(text)).toBe("ligne1\nligne2\nligne3");
  });

  it("ne modifie pas un texte déjà normalisé", () => {
    const text = "ligne1\nligne2\nligne3";
    expect(normalizeScriptText(text)).toBe(text);
  });

  it("gère un BOM + CRLF combiné", () => {
    const text = "\uFEFFligne1\r\nligne2";
    expect(normalizeScriptText(text)).toBe("ligne1\nligne2");
  });
});

describe("stripUnsupportedCommands", () => {
  it("supprime @eval", () => {
    const text = "@eval f.flag = 1\n[line] Suite";
    const result = stripUnsupportedCommands(text);
    expect(result).not.toContain("@eval");
    expect(result).toContain("[line] Suite");
  });

  it("supprime @iscript", () => {
    const text = "@iscript\nvar x = 1;\n@endscript\nSuite";
    const result = stripUnsupportedCommands(text);
    expect(result).not.toContain("@iscript");
    expect(result).not.toContain("@endscript");
    expect(result).toContain("Suite");
  });

  it("préserve les numéros de ligne (remplace par ligne vide)", () => {
    const text = "ligne0\n@eval f.x=1\nligne2";
    const result = stripUnsupportedCommands(text);
    const lines = result.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("ligne0");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("ligne2");
  });

  it("conserve les commandes supportées", () => {
    const text = "@bg storage=bg01\n[line] Bonjour";
    const result = stripUnsupportedCommands(text);
    expect(result).toBe(text);
  });

  it("ne supprime pas @eval au milieu d'une ligne (pas un tag)", () => {
    // Un @eval qui n'est pas en début de ligne après trim n'est pas un tag KAG
    const text = "texte @eval f.x=1";
    const result = stripUnsupportedCommands(text);
    // Ici le trim détecte @eval au début → supprimé. C'est le comportement attendu.
    // Les tags KAG sont toujours en début de ligne.
    expect(result).toContain("texte @eval");
  });
});

describe("normalizeStorage", () => {
  it("supprime l'extension .tlg", () => {
    expect(normalizeStorage("bg/night.tlg")).toBe("bg_night");
  });

  it("supprime l'extension .png", () => {
    expect(normalizeStorage("bg/sunset.png")).toBe("bg_sunset");
  });

  it("supprime l'extension .ogg", () => {
    expect(normalizeStorage("bgm/title.ogg")).toBe("bgm_title");
  });

  it("convertit en minuscules", () => {
    expect(normalizeStorage("BG/Night.TLG")).toBe("bg_night");
  });

  it("remplace les backslashes par des underscores", () => {
    expect(normalizeStorage("bg\\night.tlg")).toBe("bg_night");
  });

  it("remplace les slashes par des underscores", () => {
    expect(normalizeStorage("bg/night.tlg")).toBe("bg_night");
  });

  it("gère un nom sans chemin", () => {
    expect(normalizeStorage("title.ogg")).toBe("title");
  });

  it("gère un chemin profond", () => {
    expect(normalizeStorage("image/bg/night.tlg")).toBe("image_bg_night");
  });
});

describe("normalizeAssets", () => {
  it("normalise les attributs storage", () => {
    const text = "@bg storage=bg/night.tlg";
    const result = normalizeAssets(text);
    expect(result).toBe("@bg storage=bg_night");
  });

  it("normalise storage dans les crochets", () => {
    const text = "[playbgm storage=bgm/title.ogg]";
    const result = normalizeAssets(text);
    expect(result).toBe("[playbgm storage=bgm_title]");
  });

  it("normalise plusieurs storage dans un même texte", () => {
    const text = "@bg storage=bg/night.tlg\n[playbgm storage=bgm/rain.ogg]";
    const result = normalizeAssets(text);
    expect(result).toContain("storage=bg_night");
    expect(result).toContain("storage=bgm_rain");
  });

  it("préserve le reste de la ligne", () => {
    const text = "@bg storage=bg/night.tlg time=1000";
    const result = normalizeAssets(text);
    expect(result).toContain("time=1000");
  });
});

describe("normalizeKagScript", () => {
  it("applique toutes les normalisations en séquence", () => {
    const input = "\uFEFF@eval f.x=1\r\n@bg storage=bg/night.tlg\r\nTexte";
    const result = normalizeKagScript(input);

    // BOM supprimé
    expect(result).not.toContain("\uFEFF");
    // CRLF → LF
    expect(result).not.toContain("\r");
    // @eval supprimé
    expect(result).not.toContain("@eval");
    // storage normalisé
    expect(result).toContain("storage=bg_night");
    // Texte conservé
    expect(result).toContain("Texte");
  });

  it("retourne un texte propre pour un script simple", () => {
    const input = "@bg storage=bg/sunset.png\n[line] Bonjour le monde";
    const result = normalizeKagScript(input);
    expect(result).toBe("@bg storage=bg_sunset\n[line] Bonjour le monde");
  });
});
