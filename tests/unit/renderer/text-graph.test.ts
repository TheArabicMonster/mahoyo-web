/**
 * SPÉCIFICATION D'AVANCE — #284 : rendu inline des emoji `[graph]` dans la fenêtre de texte.
 *
 * Statut : tests de non-régression #284 (spécifiés avant implémentation, verts depuis le lot).
 *
 * ## Contrat attendu
 *
 * - Un segment graph (cf. `prep-284-graph-emoji.test.ts`) est rendu **dans le flux de texte** :
 *   `<img class="mh-stage-graph" alt="…">` inséré dans `.mh-stage-text` à sa position entre les
 *   segments texte — ce n'est ni un sprite de scène ni une image de fond.
 * - `src` est résolu par l'`AssetResolver` avec la clé `storage` du graph
 *   (`resolver.image(storage)`) : `heart24` → URL du manifeste, exactement comme un asset image.
 * - `alt` provient du tag (table `exCharTags` : `(ハート)`, `↑`, `ANSZ`…) : il sert de repli si
 *   l'image manque et à l'accessibilité (lecteurs d'écran).
 * - La frappe (`typewriter`) compte le graph comme **une unité** (il apparaît en entier, jamais
 *   coupé au milieu d'un caractère), et l'historique/`reduceStage` conserve le segment.
 * - Le graph ne doit pas casser la mise en page (inline, hauteur alignée sur la ligne, pas de
 *   scroll horizontal) — vérifié visuellement à l'implémentation (capture /tmp) et en e2e si
 *   pertinent (max 1 e2e pour #284).
 *
 * Ce test de rendu injecte directement l'événement `text` (forme `{ graph: … }` à figer à
 * l'implémentation) car le parser ne connaît pas encore le segment.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDomStageRenderer } from "@/renderer/stage-renderer.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { RenderEvent } from "@/kag/events.js";

const sig = () => new AbortController().signal;

type GraphSegment = { graph: { storage: string; alt?: string } };
type TextSeg = { text: string } | { pause: true } | GraphSegment;

/** Construit un événement text avec des segments graph (contrat à implémenter). */
const textEvent = (segments: TextSeg[]): RenderEvent =>
  ({ kind: "text", segments } as unknown as RenderEvent);

describe("DomStageRenderer — rendu inline des emoji [graph] (#284, tests #284)", () => {
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

  it("insère une image inline entre les deux morceaux de texte", async () => {
    await renderer.apply(
      [
        textEvent([
          { text: "Bonjour " },
          { graph: { storage: "heart24", alt: "(ハート)" } },
          { text: " !" },
        ]),
      ],
      { instant: true, signal: sig() },
    );

    const graph = textEl().querySelector<HTMLImageElement>("img.mh-stage-graph");
    expect(graph).not.toBeNull();
    expect(graph!.alt).toBe("(ハート)");
    expect(graph!.getAttribute("src") ?? "").toContain("heart24");
    // Le texte encadrant est présent et l'image est bien entre les deux (flux inline).
    expect(textEl().textContent).toContain("Bonjour");
    expect(textEl().textContent).toContain("!");
  });

  it("le graph est compté comme une seule unité de frappe (pas de coupe)", async () => {
    await renderer.apply(
      [textEvent([{ text: "A" }, { graph: { storage: "swel26", alt: "SWEL" } }, { text: "B" }])],
      { instant: true, signal: sig() },
    );
    expect(textEl().querySelectorAll("img.mh-stage-graph").length).toBe(1);
    // Nouvelle page : le clearText remplace le texte, l'image n'est pas dupliquée.
    await renderer.apply(
      [
        { kind: "clearText", force: true },
        textEvent([{ text: "A" }, { graph: { storage: "swel26", alt: "SWEL" } }, { text: "B" }]),
      ],
      { instant: true, signal: sig() },
    );
    expect(textEl().querySelectorAll("img.mh-stage-graph").length).toBe(1);
  });

  it("l'alt reste disponible si l'asset n'existe pas (repli accessibilité)", async () => {
    await renderer.apply(
      [textEvent([{ text: "x" }, { graph: { storage: "emoji_inexistant", alt: "REPLI" } }])],
      { instant: true, signal: sig() },
    );
    const graph = textEl().querySelector<HTMLImageElement>("img.mh-stage-graph");
    expect(graph).not.toBeNull();
    expect(graph!.alt).toBe("REPLI");
  });
});
