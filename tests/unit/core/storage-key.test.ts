import { describe, it, expect } from "vitest";
import { storageKey, isSolidColor } from "@/core/storage-key.js";

describe("storageKey", () => {
  it("retourne une chaîne vide pour une entrée vide", () => {
    expect(storageKey("")).toBe("");
    expect(storageKey("  ")).toBe("");
  });

  it("passe en minuscules", () => {
    expect(storageKey("BG01")).toBe("bg01");
    expect(storageKey("Aoko")).toBe("aoko");
  });

  it("retire le suffixe d'expression |x", () => {
    expect(storageKey("山城01(近)|b")).toBe("山城01(近)");
    expect(storageKey("青子制服03a(全)|i")).toBe("青子制服03a(全)");
    expect(storageKey("sprite|c2")).toBe("sprite");
  });

  it("retire l'extension", () => {
    expect(storageKey("bg/night.tlg")).toBe("night");
    expect(storageKey("title.png")).toBe("title");
    expect(storageKey("m01.ogg")).toBe("m01");
    expect(storageKey("1-0.ks")).toBe("1-0");
  });

  it("retire le chemin de dossier", () => {
    expect(storageKey("bg/night.tlg")).toBe("night");
    expect(storageKey("image\\ui\\about.png")).toBe("about");
    expect(storageKey("data/scenario/1-0.ks")).toBe("1-0");
  });

  it("retire les guillemets environnants", () => {
    expect(storageKey('"night"')).toBe("night");
    expect(storageKey("'night'")).toBe("night");
  });

  it("combine toutes les normalisations", () => {
    expect(storageKey('"bg/Aoko.tlg"|b')).toBe("aoko");
    expect(storageKey("BG/Image.PNG|c2")).toBe("image");
  });

  it("garde les caractères japonais", () => {
    expect(storageKey("山城01(近)|b")).toBe("山城01(近)");
    expect(storageKey("青子")).toBe("青子");
  });

  it("garde les parenthèses", () => {
    expect(storageKey("bg01(floor01).png")).toBe("bg01(floor01)");
  });

  it("ne modifie pas un nom déjà simple", () => {
    expect(storageKey("black")).toBe("black");
    expect(storageKey("m19")).toBe("m19");
  });

  it("retire uniquement la dernière extension", () => {
    expect(storageKey("archive.tar.gz")).toBe("archive.tar");
  });
});

describe("storageKey — espaces", () => {
  it("retire l'espace avant l'extension (le fichier porte un espace, pas la référence)", () => {
    expect(storageKey("bg/nuit (tempête) .png")).toBe("nuit (tempête)");
  });

  it("donne la même clé pour le nom de fichier et pour la référence du script", () => {
    expect(storageKey("bg/nuit .png")).toBe(storageKey("nuit"));
  });

  it("retire les espaces autour de la référence", () => {
    expect(storageKey("  nuit  ")).toBe("nuit");
  });
});

describe("isSolidColor", () => {
  it("détecte les couleurs solides", () => {
    expect(isSolidColor("black")).toBe(true);
    expect(isSolidColor("white")).toBe(true);
    expect(isSolidColor("red")).toBe(true);
  });

  it("normalise avant de tester", () => {
    expect(isSolidColor("BLACK")).toBe(true);
    expect(isSolidColor("White")).toBe(true);
  });

  it("retourne false pour un nom de fichier", () => {
    expect(isSolidColor("aoko")).toBe(false);
    expect(isSolidColor("bg01")).toBe(false);
    expect(isSolidColor("山城01(近)")).toBe(false);
  });
});
