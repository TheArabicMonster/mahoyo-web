/**
 * #300 — rendu `<ruby><img class="mh-stage-graph"><rt>…</rt></ruby>`.
 *
 * Le moteur dessine le ruby au-dessus de l'image inline (`putGraph` + `drawRuby`), le texte
 * suivant n'étant pas annoté quand `char=1`. Le rendu doit donc réunir l'image (et, pour
 * `char>1`, les caractères suivants du même groupe) dans un seul `<ruby>`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDomStageRenderer } from "@/renderer/stage-renderer.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { RenderEvent } from "@/kag/events.js";

const sig = () => new AbortController().signal;

type Seg = {
  text?: string;
  ruby?: string;
  rubyGroup?: number;
  graph?: { storage: string; alt?: string; ruby?: string; rubyGroup?: number };
};
const textEvent = (segments: Seg[]): RenderEvent => ({ kind: "text", segments } as unknown as RenderEvent);

describe("DomStageRenderer — ruby sur l'image inline (#300)", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer>;
  const textEl = () => root.querySelector(".mh-stage-text") as HTMLElement;

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

  it("[ruby text=X char=1][emoji] : <ruby> contenant l'image + <rt>, ponctuation non annotée", async () => {
    await renderer.apply(
      [
        textEvent([
          { graph: { storage: "ansz26", alt: "ANSZ", ruby: "アンサズ", rubyGroup: 1 } },
          { text: "、" },
        ]),
      ] as RenderEvent[],
      { instant: true, signal: sig() },
    );
    const rubies = textEl().querySelectorAll("ruby");
    expect(rubies.length).toBe(1);
    const ruby = rubies[0]!;
    const img = ruby.querySelector("img.mh-stage-graph");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("alt")).toBe("ANSZ");
    expect(img!.getAttribute("src") ?? "").toContain("ansz26");
    expect(ruby.querySelector("rt")?.textContent).toBe("アンサズ");
    // La ponctuation suit le ruby sans être annotée.
    expect(textEl().textContent).toContain("、");
    expect(textEl().querySelector("ruby")?.textContent).not.toContain("、");
  });

  it("char=2 : un seul <ruby> pour l'image + le caractère suivant du même groupe", async () => {
    await renderer.apply(
      [
        textEvent([
          { graph: { storage: "ansz26", alt: "ANSZ", ruby: "タービン", rubyGroup: 7 } },
          { text: "回", ruby: "タービン", rubyGroup: 7 },
          { text: "路" },
        ]),
      ] as RenderEvent[],
      { instant: true, signal: sig() },
    );
    const rubies = textEl().querySelectorAll("ruby");
    expect(rubies.length).toBe(1);
    const ruby = rubies[0]!;
    expect(ruby.querySelector("img.mh-stage-graph")).not.toBeNull();
    expect(ruby.textContent).toContain("回");
    expect(ruby.querySelector("rt")?.textContent).toBe("タービン");
    // « 路 » reste hors du ruby.
    const outside = textEl().textContent ?? "";
    expect(outside.endsWith("路")).toBe(true);
  });

  it("[graph] sans ruby : image simple, hors <ruby> (non-régression)", async () => {
    await renderer.apply(
      [textEvent([{ text: "x" }, { graph: { storage: "heart24", alt: "(ハート)" } }])] as RenderEvent[],
      { instant: true, signal: sig() },
    );
    expect(textEl().querySelector("ruby")).toBeNull();
    expect(textEl().querySelector("img.mh-stage-graph")).not.toBeNull();
  });

  it("ruby texte standard inchangé (non-régression)", async () => {
    await renderer.apply(
      [textEvent([{ text: "瞬", ruby: "またた" }, { text: "き" }])] as RenderEvent[],
      { instant: true, signal: sig() },
    );
    const ruby = textEl().querySelector("ruby");
    expect(ruby?.textContent).toContain("瞬");
    expect(ruby?.querySelector("rt")?.textContent).toBe("またた");
  });
});
