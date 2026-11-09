/**
 * Tests de l'identification des fichiers `.ks` en réalité binaires (issue #111)
 * et de leur exclusion du corpus narratif, y compris quand leur nom figure dans
 * la liste des scripts système.
 *
 * Les contenus sont synthétiques (signatures connues, aucun asset du jeu).
 *
 * @vitest-environment node
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, describe, expect, it } from "vitest";
import { detectBinaryAsset, isEncrypted, listCorpus } from "../../../tools/audit-lib.js";

/** Début d'un PNG décodé par erreur en Shift-JIS (0x89 0x50 0x4E 0x47 → « 臼NG »). */
const PNG_AS_SHIFTJIS = "臼NG\n\u001c\n\nIHDR\t`<\u0008\u0006rest";
/** Début d'un WAV/RIFF décodé par erreur en UTF-16LE (« RIFF » → « 䥒䙆 »). */
const WAV_AS_UTF16 = "䥒䙆✸\u0002䅗䕖浦⁴\u0010\u0001\u0002rest";
/** WAV/RIFF lisible tel quel. */
const WAV_AS_ASCII = "RIFF\u0060\u0000\u0000\u0000WAVEfmt rest";

const TMP_DIR = mkdtempSync(join(tmpdir(), "mahoyo-audit-binary-"));

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("detectBinaryAsset", () => {
  it("identifie un PNG déguisé en .ks (décodage Shift-JIS)", () => {
    expect(detectBinaryAsset(PNG_AS_SHIFTJIS)).toEqual({ kind: "image", format: "png" });
  });

  it("identifie un WAV déguisé en .ks (décodage UTF-16 ou RIFF intact)", () => {
    expect(detectBinaryAsset(WAV_AS_UTF16)).toEqual({ kind: "audio", format: "wav" });
    expect(detectBinaryAsset(WAV_AS_ASCII)).toEqual({ kind: "audio", format: "wav" });
  });

  it("identifie un TLG déguisé en .ks", () => {
    expect(detectBinaryAsset("TLG5.0\u0000rest")).toEqual({ kind: "image", format: "tlg" });
  });

  it("classe un binaire sans signature connue en indéterminé", () => {
    const unknown = "\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008".repeat(20);
    expect(detectBinaryAsset(unknown)).toEqual({ kind: "unknown", format: "inconnu (chiffré ou binaire)" });
  });

  it("retourne null pour un vrai script KAG", () => {
    expect(detectBinaryAsset("; commentaire\n*start\n@bg storage=bg01\nBonjour.[p]\n")).toBeNull();
    expect(detectBinaryAsset("")).toBeNull();
  });

  it("reste cohérent avec isEncrypted", () => {
    expect(isEncrypted(PNG_AS_SHIFTJIS)).toBe(true);
    expect(isEncrypted(WAV_AS_UTF16)).toBe(true);
    expect(isEncrypted("; commentaire\n*start\n")).toBe(false);
  });
});

describe("listCorpus — exclusion des binaires", () => {
  it("sépare scripts, scripts système et fichiers binaires (même si le nom est dans SKIP_SCRIPTS)", () => {
    const files: Record<string, string> = {
      "1-0.ks": "; début\n*start\n@bg storage=bg01\nTexte.[p]\n",
      "note0.ks": PNG_AS_SHIFTJIS,
      "my01_042.ks": WAV_AS_UTF16,
      // Même nom que dans SKIP_SCRIPTS : la détection binaire prime sur la liste.
      "basicchoice.ks": WAV_AS_UTF16,
      "gamemenu.ks": "; menu système\n*start\n",
    };
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(TMP_DIR, name), content, "utf-8");
    }

    const listing = listCorpus(TMP_DIR);

    expect(listing.allKsFiles).toHaveLength(5);
    expect(listing.auditableScripts).toEqual(["1-0.ks"]);
    expect(listing.systemScripts).toEqual(["gamemenu.ks"]);
    expect(listing.binaryAssets).toEqual([
      { file: "basicchoice.ks", kind: "audio", format: "wav" },
      { file: "my01_042.ks", kind: "audio", format: "wav" },
      { file: "note0.ks", kind: "image", format: "png" },
    ]);
    // Compatibilité : la liste des fichiers écartés reste exposée.
    expect(listing.encryptedScripts).toEqual(["basicchoice.ks", "my01_042.ks", "note0.ks"]);
    // Le contenu texte des binaires n'est pas conservé pour le loader.
    expect(listing.scriptTexts.has("note0.ks")).toBe(false);
    expect(listing.scriptTexts.has("1-0.ks")).toBe(true);
  });

  it("ne consacre pas un dossier vide", () => {
    const empty = join(TMP_DIR, "vide");
    mkdirSync(empty);
    const listing = listCorpus(empty);
    expect(listing.auditableScripts).toEqual([]);
    expect(listing.binaryAssets).toEqual([]);
  });
});
