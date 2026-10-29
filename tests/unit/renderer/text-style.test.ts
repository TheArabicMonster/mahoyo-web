import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { textStyleToCss } from "@/renderer/text-style.js";
import { createDomStageRenderer } from "@/renderer/stage-renderer.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { RenderEvent } from "@/kag/events.js";

describe("textStyleToCss", () => {
  it("un style vide ne produit aucune propriété", () => {
    expect(textStyleToCss({})).toEqual({});
  });

  it("couleur, taille, gras, italique", () => {
    expect(textStyleToCss({ color: "#ff0000", size: 30, bold: true, italic: true })).toEqual({
      color: "#ff0000",
      "font-size": "30px",
      "font-weight": "bold",
      "font-style": "italic",
    });
  });

  it("bold=false et italic=false annulent explicitement le style", () => {
    const css = textStyleToCss({ bold: false, italic: false });
    expect(css["font-weight"]).toBe("normal");
    expect(css["font-style"]).toBe("normal");
  });

  it("le contour s'applique dès qu'une couleur de contour est donnée", () => {
    expect(textStyleToCss({ edgeColor: "#003366" })["text-shadow"]).toContain("#003366");
  });

  it("edge=false désactive le contour même avec une couleur", () => {
    expect(textStyleToCss({ edge: false, edgeColor: "#003366" })["text-shadow"]).toBeUndefined();
  });

  it("edge=true sans couleur utilise du noir", () => {
    expect(textStyleToCss({ edge: true })["text-shadow"]).toContain("#000000");
  });

  it("la police est protégée contre les guillemets", () => {
    expect(textStyleToCss({ face: 'a"b' })["font-family"]).toBe('"ab", serif');
  });
});

describe("DomStageRenderer — style du texte et ploy", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer>;
  const opts = () => ({ instant: true, signal: new AbortController().signal });

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    renderer = createDomStageRenderer({ resolver: createAssetResolver() });
    renderer.mount(root);
  });

  afterEach(() => {
    renderer.dispose();
    root.remove();
  });

  it("rend le texte stylé dans un <span> et laisse le texte simple en nœud texte", async () => {
    const events: RenderEvent[] = [
      { kind: "clearText" },
      { kind: "text", segments: [
        { text: "ab" },
        { text: "c", style: { color: "#ff0000", italic: true } },
      ] },
    ];
    await renderer.apply(events, opts());
    const textEl = root.querySelector(".mh-stage-text") as HTMLElement;
    expect(textEl.textContent).toBe("abc");
    const spans = textEl.querySelectorAll("span");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.textContent).toBe("c");
    expect(spans[0]?.style.color).toBe("rgb(255, 0, 0)");
    expect(spans[0]?.style.fontStyle).toBe("italic");
  });

  it("applique le style à un caractère avec ruby", async () => {
    await renderer.apply([
      { kind: "clearText" },
      { kind: "text", segments: [{ text: "お", ruby: "え", style: { bold: true } }] },
    ], opts());
    const ruby = root.querySelector(".mh-stage-text ruby") as HTMLElement;
    expect(ruby.style.fontWeight).toBe("bold");
    expect(ruby.querySelector("rt")?.textContent).toBe("え");
  });

  it("expose la bulle ploy sur la textbox puis la retire", async () => {
    const textbox = root.querySelector("#textbox") as HTMLElement;
    await renderer.apply([{ kind: "ploy", ploy: { mode: "lu13", ox: 20, oy: -30 } }], opts());
    expect(textbox.dataset.ployMode).toBe("lu13");
    expect(textbox.style.getPropertyValue("--ploy-ox")).toBe("20px");
    expect(textbox.style.getPropertyValue("--ploy-oy")).toBe("-30px");

    await renderer.apply([{ kind: "ploy", ploy: null }], opts());
    expect(textbox.dataset.ployMode).toBeUndefined();
    expect(textbox.style.getPropertyValue("--ploy-ox")).toBe("");
  });
});
