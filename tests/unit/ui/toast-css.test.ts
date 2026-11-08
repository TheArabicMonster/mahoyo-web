import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * HUD-13 (#191) : jsdom ne calcule pas la mise en page ; on contrôle la feuille `toast.css`
 * (position bas droite, mesures converties du repère 1080 vers 1280×720, absence d'assets,
 * reduced-motion). Les mesures réelles se vérifient au navigateur (voir la PR).
 */
const css = readFileSync(resolve(__dirname, "../../../src/ui/toast.css"), "utf8");
const tokens = readFileSync(resolve(__dirname, "../../../src/ui/tokens.css"), "utf8");

function block(selector: string): string {
  const escaped = selector.replace(/[.>*[\]"=()]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return m?.[1] ?? "";
}

describe("toast.css", () => {
  it("place les toasts en bas à droite, au-dessus des autres couches de l'overlay", () => {
    const host = block(".mh-toast-host");
    expect(host).toMatch(/align-items:\s*flex-end/);
    expect(host).toMatch(/justify-content:\s*flex-end/);
    expect(host).toMatch(/z-index:\s*200/);
  });

  it("marges droite et bas de 27 px (1,6875 rem), cadre de 340×60 px (21,25 × 3,75 rem)", () => {
    expect(block(".mh-toast-host")).toMatch(/padding:\s*0 1\.6875rem 1\.6875rem 0/);
    const toast = block(".mh-toast");
    expect(toast).toMatch(/width:\s*21\.25rem/);
    expect(toast).toMatch(/min-height:\s*3\.75rem/);
  });

  it("utilise le token --mh-toast-fill, qui existe", () => {
    expect(block(".mh-toast")).toContain("var(--mh-toast-fill");
    expect(tokens).toMatch(/--mh-toast-fill:\s*#587888/);
  });

  it("entrée de 0,2 s, sortie sur --mh-dur-fast", () => {
    expect(block(".mh-toast")).toMatch(/--toast-enter:\s*200ms/);
    expect(block('.mh-toast[data-state="leaving"]')).toContain("var(--mh-dur-fast");
  });

  it("chevrons ornés en pseudo-éléments, sans image", () => {
    expect(css).toMatch(/\.mh-toast::before/);
    expect(css).toMatch(/\.mh-toast::after/);
    expect(css).not.toMatch(/url\(/);
  });

  it("supprime toute animation d'entrée et de sortie sous prefers-reduced-motion", () => {
    const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(start).toBeGreaterThan(-1);
    const media = css.slice(start);
    expect(media).toContain(".mh-toast");
    expect(media).toMatch(/animation:\s*none/);
    expect(media).toMatch(/--toast-enter:\s*0ms/);
  });

  it("les toasts n'interceptent pas la souris", () => {
    expect(block(".mh-toast")).toMatch(/pointer-events:\s*none/);
  });
});
