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
  it("aucun écran ne dépend plus de ?night (l'historique porte la classe en permanence, HUD-12)", () => {
    const el = document.createElement("div");
    for (const screen of ["game", "title", "pause", "flowchart"] as const) {
      syncNightDemo(el, screen, "?night");
      expect(el.classList.contains(NIGHT_CLASS), screen).toBe(false);
    }
  });

  it("sauvegarde, chargement, historique et configuration portent toujours la nuit bleue, sans ?night (HUD-10, HUD-12, HUD-09)", () => {
    const el = document.createElement("div");
    for (const screen of ["save", "load", "backlog", "settings"] as const) {
      syncNightDemo(el, screen, "");
      expect(el.classList.contains(NIGHT_CLASS), screen).toBe(true);
      syncNightDemo(el, screen, "?night=0");
      expect(el.classList.contains(NIGHT_CLASS), screen).toBe(true);
    }
    syncNightDemo(el, "title", "");
    expect(el.classList.contains(NIGHT_CLASS)).toBe(false);
  });

  it("ne touche pas au jeu ni sans paramètre", () => {
    const el = document.createElement("div");
    el.classList.add(NIGHT_CLASS);
    syncNightDemo(el, "game", "?night");
    expect(el.classList.contains(NIGHT_CLASS)).toBe(false);
    syncNightDemo(el, "title", "?night"); // l'écran titre est clair : il ne prend jamais le fond nuit (HUD-07, #195)
    expect(el.classList.contains(NIGHT_CLASS)).toBe(false);
  });
});

describe("DomUIManager : branchement", () => {
  it("les écrans de sauvegarde et de chargement posent la classe nuit sans ?night", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const ui = new DomUIManager();
    ui.init(root, {} as never);
    for (const screen of ["save", "load"] as const) {
      ui.show({ screen, slots: [] });
      expect(root.querySelector("#ui-menu")?.classList.contains(NIGHT_CLASS), screen).toBe(true);
    }
    ui.show({ screen: "game" });
    expect(root.querySelector("#ui-menu")?.classList.contains(NIGHT_CLASS)).toBe(false);
    ui.dispose();
    root.remove();
  });

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
