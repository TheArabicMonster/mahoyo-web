import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_HOLD_MS, TOAST_LEAVE_MS, TOAST_MAX_STACK, ToastStack } from "@/ui/toast.js";

describe("ToastStack (#191)", () => {
  let host: HTMLElement;
  let stack: ToastStack;
  const items = () => [...host.querySelectorAll<HTMLElement>(".mh-toast")];

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="ui-toast"></div>';
    host = document.getElementById("ui-toast")!;
    stack = new ToastStack(host, { prefersReducedMotion: () => false });
  });
  afterEach(() => {
    stack.dispose();
    vi.useRealTimers();
  });

  it("déclare une région aria-live polie dès la création, avant tout message", () => {
    expect(host.getAttribute("aria-live")).toBe("polite");
    expect(host.getAttribute("aria-relevant")).toBe("additions");
    expect(host.classList.contains("mh-toast-host")).toBe(true);
    expect(items()).toHaveLength(0);
  });

  it("affiche le message comme texte brut (pas de HTML interprété)", () => {
    stack.show("<b>x</b>");
    expect(items()[0]!.textContent).toBe("<b>x</b>");
    expect(items()[0]!.querySelector("b")).toBeNull();
  });

  it("maintient 2,5 s par défaut, puis efface en fondu", () => {
    expect(TOAST_HOLD_MS).toBe(2500);
    stack.show("hi");
    vi.advanceTimersByTime(TOAST_HOLD_MS - 1);
    expect(items()).toHaveLength(1);
    expect(items()[0]!.dataset.state).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(items()[0]!.dataset.state).toBe("leaving");
    vi.advanceTimersByTime(TOAST_LEAVE_MS - 1);
    expect(items()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(items()).toHaveLength(0);
    expect(stack.count).toBe(0);
  });

  it("respecte une durée explicite", () => {
    stack.show("court", 100);
    vi.advanceTimersByTime(99);
    expect(items()[0]!.dataset.state).toBeUndefined();
    vi.advanceTimersByTime(1 + TOAST_LEAVE_MS);
    expect(items()).toHaveLength(0);
  });

  it("empile 3 toasts au plus : le plus ancien disparaît, l'ordre est conservé", () => {
    expect(TOAST_MAX_STACK).toBe(3);
    for (const m of ["1", "2", "3"]) stack.show(m);
    expect(items().map((e) => e.textContent)).toEqual(["1", "2", "3"]);
    stack.show("4");
    expect(items().map((e) => e.textContent)).toEqual(["2", "3", "4"]);
    stack.show("5");
    expect(items().map((e) => e.textContent)).toEqual(["3", "4", "5"]);
    expect(stack.count).toBe(3);
  });

  it("un toast évincé n'efface pas ses voisins quand son minuteur expire", () => {
    stack.show("1", 1000);
    stack.show("2");
    stack.show("3");
    stack.show("4"); // évince « 1 »
    vi.advanceTimersByTime(1000 + TOAST_LEAVE_MS);
    expect(items().map((e) => e.textContent)).toEqual(["2", "3", "4"]);
  });

  it("chaque toast a sa propre échéance", () => {
    stack.show("a", 500);
    vi.advanceTimersByTime(300);
    stack.show("b", 500);
    vi.advanceTimersByTime(200 + TOAST_LEAVE_MS);
    expect(items().map((e) => e.textContent)).toEqual(["b"]);
    vi.advanceTimersByTime(300 + TOAST_LEAVE_MS);
    expect(items()).toHaveLength(0);
  });

  it("prefers-reduced-motion : retrait immédiat, sans état de fondu", () => {
    stack.dispose();
    stack = new ToastStack(host, { prefersReducedMotion: () => true });
    stack.show("hi");
    vi.advanceTimersByTime(TOAST_HOLD_MS);
    expect(items()).toHaveLength(0);
  });

  it("clear() retire tout ; dispose() rend le conteneur inerte et ignore show()", () => {
    stack.show("a");
    stack.show("b");
    stack.clear();
    expect(items()).toHaveLength(0);
    stack.dispose();
    stack.show("c");
    expect(items()).toHaveLength(0);
    expect(host.hasAttribute("aria-live")).toBe(false);
    expect(host.classList.contains("mh-toast-host")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
