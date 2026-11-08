import { describe, expect, it } from "vitest";
import { isNightDemoRequested, NIGHT_CLASS, syncNightDemo } from "@/ui/night.js";
import { DomUIManager } from "@/ui/ui-manager.js";

describe("isNightDemoRequested", () => {
  it("active la démonstration avec ?night ou ?night=1", () => {
    expect(isNightDemoRequested("?night")).toBe(true);
    expect(isNightDemoRequested("?night=1")).toBe(true);
    expect(isNightDemoRequested("?a=2&night")).toBe(true);
  });

  it("reste inactif sans paramètre ou avec 0/false", () => {
    expect(isNightDemoRequested("")).toBe(false);
    expect(isNightDemoRequested("?other=1")).toBe(false);
    expect(isNightDemoRequested("?night=0")).toBe(false);
    expect(isNightDemoRequested("?night=false")).toBe(false);
  });
});

describe("syncNightDemo", () => {
  it("pose la classe sur les écrans système quand la démonstration est demandée", () => {
    const el = document.createElement("div");
    for (const screen of ["title", "save", "load", "backlog"] as const) {
      syncNightDemo(el, screen, "?night");
      expect(el.classList.contains(NIGHT_CLASS), screen).toBe(true);
    }
  });

  it("ne touche pas au jeu, aux réglages (habillage propre) ni sans paramètre", () => {
    const el = document.createElement("div");
    el.classList.add(NIGHT_CLASS);
    syncNightDemo(el, "game", "?night");
    expect(el.classList.contains(NIGHT_CLASS)).toBe(false);
    syncNightDemo(el, "settings", "?night");
    expect(el.classList.contains(NIGHT_CLASS)).toBe(false);
    syncNightDemo(el, "title", "");
    expect(el.classList.contains(NIGHT_CLASS)).toBe(false);
  });
});

describe("DomUIManager : branchement", () => {
  it("n'ajoute aucune classe nuit par défaut", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const ui = new DomUIManager();
    ui.init(root, {} as never);
    ui.show({ screen: "title", scripts: [], hasContinue: false });
    expect(root.querySelector("#ui-menu")?.classList.contains(NIGHT_CLASS)).toBe(false);
    ui.dispose();
    root.remove();
  });
});
