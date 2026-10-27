import { describe, it, expect } from "vitest";
import { splitCommand, substituteArgs, validateCommandTemplate } from "../../../tools/command-template.js";

describe("splitCommand", () => {
  it("découpe une commande simple", () => {
    expect(splitCommand("ffmpeg -y -i input.ogg output.ogg")).toEqual([
      "ffmpeg", "-y", "-i", "input.ogg", "output.ogg",
    ]);
  });

  it("gère les guillemets doubles", () => {
    expect(splitCommand('ffmpeg -i "input file.ogg" out.ogg')).toEqual([
      "ffmpeg", "-i", "input file.ogg", "out.ogg",
    ]);
  });

  it("gère les guillemets simples", () => {
    expect(splitCommand("ffmpeg -i 'input file.ogg' out.ogg")).toEqual([
      "ffmpeg", "-i", "input file.ogg", "out.ogg",
    ]);
  });

  it("gère les noms avec caractères japonais", () => {
    expect(splitCommand("tlg2png 山城01(近).tlg out.webp")).toEqual([
      "tlg2png", "山城01(近).tlg", "out.webp",
    ]);
  });

  it("retourne un tableau vide pour une chaîne vide", () => {
    expect(splitCommand("")).toEqual([]);
  });
});

describe("substituteArgs", () => {
  it("substitue {in} et {out}", () => {
    const result = substituteArgs(["ffmpeg", "-i", "{in}", "{out}"], "input.ogg", "output.ogg");
    expect(result).toEqual(["ffmpeg", "-i", "input.ogg", "output.ogg"]);
  });

  it("substitue dans le même argument", () => {
    const result = substituteArgs(["convert", "{in}→{out}"], "a.tlg", "b.webp");
    expect(result).toEqual(["convert", "a.tlg→b.webp"]);
  });

  it("ne modifie pas les arguments sans placeholder", () => {
    const result = substituteArgs(["ffmpeg", "-y"], "in", "out");
    expect(result).toEqual(["ffmpeg", "-y"]);
  });
});

describe("validateCommandTemplate", () => {
  it("valide un gabarit correct", () => {
    const err = validateCommandTemplate("ffmpeg -i {in} {out}", true, true);
    // ffmpeg peut ne pas être dans le PATH en test, mais on ne vérifie
    // que les placeholders ici. Si l'exécutable n'est pas un chemin absolu,
    // on ne valide pas son existence.
    expect(err === null || err.includes("introuvable")).toBe(true);
  });

  it("détecte un placeholder manquant", () => {
    const err = validateCommandTemplate("ffmpeg -i input.ogg output.ogg", true, true);
    expect(err).toContain("{in}");
  });

  it("détecte un gabarit vide", () => {
    const err = validateCommandTemplate("", true, true);
    expect(err).toContain("vide");
  });
});
