import { describe, it, expect } from "vitest";
import {
  actionForEvent,
  bindingFromEvent,
  cloneShortcuts,
  defaultShortcuts,
  formatBinding,
  matchesBinding,
  mergeShortcuts,
} from "@/core/shortcuts.js";

const bindings = defaultShortcuts();

describe("raccourcis (#177)", () => {
  it("reprend les défauts de la capture d'origine", () => {
    expect(bindings.saveMenu).toEqual(["s", "F2"]);
    expect(bindings.loadMenu).toEqual(["l", "F3"]);
    expect(bindings.quickSave).toEqual(["F11"]);
    expect(bindings.fullscreen).toEqual(["F4"]);
    expect(bindings.menu).toEqual(["Escape"]);
    expect(bindings.quit).toEqual(["Alt+F4"]);
  });

  it("trouve l'action d'une touche ou d'une combinaison", () => {
    expect(actionForEvent({ key: "s" }, bindings)).toBe("saveMenu");
    expect(actionForEvent({ key: "F4" }, bindings)).toBe("fullscreen");
    expect(actionForEvent({ key: "Escape" }, bindings)).toBe("menu");
    expect(actionForEvent({ key: "F11" }, bindings)).toBe("quickSave");
    expect(actionForEvent({ key: "F4", altKey: true }, bindings)).toBe("quit");
  });

  it("exige les modificateurs exacts", () => {
    expect(actionForEvent({ key: "s", shiftKey: true }, bindings)).toBeNull();
    expect(actionForEvent({ key: "F4", ctrlKey: true }, bindings)).toBeNull();
    expect(matchesBinding({ key: "F4", altKey: true }, "Alt+F4")).toBe(true);
    expect(matchesBinding({ key: "F4" }, "Alt+F4")).toBe(false);
  });

  it("normalise les liaisons capturées", () => {
    expect(bindingFromEvent({ key: "a" })).toBe("a");
    expect(bindingFromEvent({ key: "A", shiftKey: true })).toBe("a");
    expect(bindingFromEvent({ key: "F4" })).toBe("F4");
    expect(bindingFromEvent({ key: "ArrowLeft", ctrlKey: true })).toBe("Ctrl+ArrowLeft");
    expect(bindingFromEvent({ key: "Alt" })).toBeNull();
  });

  it("formate les libellés", () => {
    expect(formatBinding("")).toBe("—");
    expect(formatBinding("s")).toBe("S");
    expect(formatBinding("F12")).toBe("F12");
    expect(formatBinding("Alt+F4")).toBe("Alt+F4");
  });

  it("fusionne et clone sans partager les tableaux", () => {
    const merged = mergeShortcuts(bindings, { saveMenu: ["x"] });
    expect(merged.saveMenu).toEqual(["x"]);
    expect(merged.loadMenu).toEqual(bindings.loadMenu);
    const copy = cloneShortcuts(merged);
    copy.saveMenu.push("y");
    expect(merged.saveMenu).toEqual(["x"]);
  });
});
