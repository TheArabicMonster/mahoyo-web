import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/** Profondeur d'accolades CSS en ignorant commentaires et chaînes (garde-fou #403). */
function braceDepth(css: string): { final: number; min: number } {
  let depth = 0;
  let min = 0;
  let inComment = false;
  let inString: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const char = css[i]!;
    if (inComment) {
      if (char === "*" && css[i + 1] === "/") {
        inComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (char === "\\") {
        i++;
        continue;
      }
      if (char === inString) inString = null;
      continue;
    }
    if (char === "/" && css[i + 1] === "*") {
      inComment = true;
      i++;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = char;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      min = Math.min(min, depth);
    }
  }
  return { final: depth, min };
}

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...cssFiles(path));
    else if (path.endsWith(".css")) out.push(path);
  }
  return out;
}

describe("équilibre des accolades CSS (#403)", () => {
  it("toutes les feuilles CSS sont équilibrées, sans profondeur négative", () => {
    const files = cssFiles(join(import.meta.dirname, "..", "..", "..", "src"));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const { final, min } = braceDepth(readFileSync(file, "utf-8"));
      expect(final, `accolades non équilibrées dans ${file}`).toBe(0);
      expect(min, `accolade fermante en trop dans ${file}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("détecte une accolade en trop (régression #403)", () => {
    expect(braceDepth(".a { color: red; }\n}").min).toBe(-1);
    expect(braceDepth(".a { color: red; ").final).toBe(1);
    expect(braceDepth('/* } */ .a { content: "{"; }')).toEqual({ final: 0, min: 0 });
  });
});
