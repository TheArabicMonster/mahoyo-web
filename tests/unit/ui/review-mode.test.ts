import { describe, it, expect } from "vitest";
import {
  REVIEW_CATEGORIES,
  buildSessionExport,
  captureGeometry,
  categoryFromKey,
  categoryLabel,
  isReviewMode,
  summarizeFlags,
  type ReviewFlag,
  type ReviewFlagMeta,
} from "../../../src/ui/review-mode.js";

function flag(overrides: Partial<ReviewFlagMeta> = {}): ReviewFlagMeta {
  return {
    id: "flag-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    sessionMs: 1200,
    category: "texte",
    note: "note",
    route: "#/game",
    screen: "game",
    script: { scriptName: "1-0.ks", page: 3, instruction: 7, segment: null },
    text: "Texte courant",
    scene: { bg: "bg02", sprites: [], effect: null, textbox: { visible: true, frame: true } },
    timelineLayers: [],
    transition: null,
    audio: { loops: [] },
    settings: { language: "fr", audio: { master: 1, bgm: 0.8, se: 0.8, voice: 1, muted: false } },
    environment: {
      viewport: { width: 1280, height: 720 },
      dpr: 1,
      userAgent: "test",
      assetsVersion: "v1",
    },
    diagnostics: { console: [], failedRequests: [] },
    hasCapture: false,
    ...overrides,
  };
}

describe("mode revue (#400) — activation", () => {
  it("ne s'active que sur review=1 ou mark=1 (valeur stricte)", () => {
    expect(isReviewMode("?review=1")).toBe(true);
    expect(isReviewMode("review=1")).toBe(true);
    expect(isReviewMode("?mark=1&foo=bar")).toBe(true);
    expect(isReviewMode("?review=0")).toBe(false);
    expect(isReviewMode("?review=true")).toBe(false);
    expect(isReviewMode("?perf=1")).toBe(false);
    expect(isReviewMode("")).toBe(false);
  });
});

describe("mode revue (#400) — catégories", () => {
  it("expose les 7 catégories dans l'ordre et leurs touches 1-7", () => {
    expect(REVIEW_CATEGORIES.map((category) => category.id)).toEqual([
      "texte",
      "sprite",
      "fond",
      "transition",
      "son",
      "icone",
      "autre",
    ]);
    expect(REVIEW_CATEGORIES.map((category) => category.key)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(REVIEW_CATEGORIES.map((category) => category.label)).toEqual([
      "Texte",
      "Sprite",
      "Fond",
      "Transition",
      "Son",
      "Icône",
      "Autre",
    ]);
  });

  it("résout une touche vers une catégorie et un libellé", () => {
    expect(categoryFromKey("3")).toBe("fond");
    expect(categoryFromKey("7")).toBe("autre");
    expect(categoryFromKey("0")).toBeNull();
    expect(categoryFromKey("a")).toBeNull();
    expect(categoryLabel("transition")).toBe("Transition");
  });
});

describe("mode revue (#400) — sérialisation et export", () => {
  it("construit un export de session complet et versionné", () => {
    const flags: ReviewFlag[] = [{ ...flag(), capture: "data:image/jpeg;base64,AAA" }];
    const session = buildSessionExport(flags, {
      startedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 5000,
      route: "#/game",
      viewport: { width: 1280, height: 720 },
      dpr: 2,
      language: "fr",
      assetsVersion: "abc",
      userAgent: "test-agent",
    });
    expect(session.kind).toBe("mahoyo-review-session");
    expect(session.version).toBe(1);
    expect(session.session.language).toBe("fr");
    expect(session.session.dpr).toBe(2);
    expect(session.flags).toHaveLength(1);
    expect(session.flags[0]!.capture).toContain("data:image/jpeg");
    expect(session.flags[0]!.script.instruction).toBe(7);
    expect(session.flags[0]!.scene.bg).toBe("bg02");
    // JSON exportable tel quel (aucune référence cyclique).
    expect(() => JSON.stringify(session)).not.toThrow();
  });

  it("résume le nombre de flags, les catégories et les scripts", () => {
    const flags: ReviewFlagMeta[] = [
      flag(),
      flag({ id: "flag-2", category: "sprite", script: { scriptName: "1-0.ks", page: 8, instruction: 2, segment: null } }),
      flag({ id: "flag-3", category: "son", script: { scriptName: "2-0.ks", page: 0, instruction: 0, segment: null } }),
    ];
    const summary = summarizeFlags(flags);
    expect(summary).toContain("3 flag(s)");
    expect(summary).toContain("Texte=1");
    expect(summary).toContain("Sprite=1");
    expect(summary).toContain("Son=1");
    expect(summary).toContain("1-0.ks");
    expect(summary).toContain("2-0.ks");
    expect(summarizeFlags([])).toBe("Aucun flag posé.");
  });
});

describe("mode revue (#415) — géométrie de capture", () => {
  it("produit une image 16:9 plein cadre (960×540, échelle 0.9375)", () => {
    const geometry = captureGeometry();
    expect(geometry).toEqual({ width: 960, height: 540, scale: 0.9375 });
    expect(geometry.width / geometry.height).toBeCloseTo(16 / 9, 5);
  });

  it("reste 16:9 pour d'autres largeurs maximales", () => {
    for (const maxWidth of [320, 480, 1024]) {
      const geometry = captureGeometry(maxWidth);
      expect(geometry.width / geometry.height).toBeCloseTo(16 / 9, 2);
      expect(geometry.width).toBeLessThanOrEqual(1024);
    }
    expect(captureGeometry(480)).toEqual({ width: 480, height: 270, scale: 480 / 1024 });
  });
});
