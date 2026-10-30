import { describe, it, expect } from "vitest";
import { cssUrl } from "@/renderer/css-url.js";

describe("cssUrl", () => {
  it("met l'URL entre guillemets", () => {
    expect(cssUrl("/assets/bg/black.webp")).toBe('url("/assets/bg/black.webp")');
  });

  it("garde les parenthèses (elles cassent un url() sans guillemets)", () => {
    expect(cssUrl("/assets/bg/nom-(pluie).webp")).toBe('url("/assets/bg/nom-(pluie).webp")');
  });

  it("encode les espaces, guillemets, antislashs et caractères non ASCII", () => {
    const u = cssUrl('/assets/bg/a b"c\\d 背景.png');
    expect(u.startsWith('url("')).toBe(true);
    expect(u.endsWith('")')).toBe(true);
    const inner = u.slice(5, -2);
    expect(inner).not.toMatch(/["\\ ]/);
    expect(decodeURI(inner)).toBe('/assets/bg/a b"c\\d 背景.png');
  });

  it("encode le pourcent pour que le nom d'origine se retrouve au décodage", () => {
    expect(decodeURI(cssUrl("/assets/bg/100%.png").slice(5, -2))).toBe("/assets/bg/100%.png");
  });
});
