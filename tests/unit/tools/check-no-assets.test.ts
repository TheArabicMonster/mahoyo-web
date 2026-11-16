/**
 * Tests unitaires du contrôle « aucun asset commité ».
 *
 * @vitest-environment node
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  ASSET_EXTENSIONS,
  MAX_BINARY_BYTES,
  findAssetViolations,
  findHashMismatches,
  findLargeBinaries,
  findPlaceholderIntegrityIssues,
  formatViolations,
  getAssetExtension,
  looksBinary,
  parseAllowlist,
  parseNulSeparated,
  renderAllowlist,
} from "../../../tools/check-no-assets-lib.js";

describe("getAssetExtension", () => {
  it("détecte les extensions d'assets interdites", () => {
    expect(getAssetExtension("foo.tlg")).toBe(".tlg");
    expect(getAssetExtension("foo.XP3")).toBe(".xp3");
    expect(getAssetExtension("bar.ks")).toBe(".ks");
    expect(getAssetExtension("music.ogg")).toBe(".ogg");
    expect(getAssetExtension("font.ttf")).toBe(".ttf");
  });

  it("retourne null pour une extension non concernée", () => {
    expect(getAssetExtension("README.md")).toBeNull();
    expect(getAssetExtension("src/main.ts")).toBeNull();
    expect(getAssetExtension(".gitignore")).toBeNull();
  });
});

describe("ASSET_EXTENSIONS", () => {
  it("contient les extensions listées dans l'issue #92", () => {
    const expected = [
      ".tlg",
      ".tft",
      ".xp3",
      ".sar",
      ".ks",
      ".ogg",
      ".mp3",
      ".wav",
      ".png",
      ".webp",
      ".jpg",
      ".jpeg",
      ".gif",
      ".ttf",
      ".otf",
      ".woff",
      ".woff2",
    ];
    for (const ext of expected) {
      expect(ASSET_EXTENSIONS).toContain(ext);
    }
  });
});

describe("findAssetViolations", () => {
  it("signale un faux asset non allowlisté", () => {
    const files = ["src/main.ts", "fake-asset.tlg", "public/icon.png"];
    const allowlist = new Set<string>(["public/icon.png"]);
    const violations = findAssetViolations(files, allowlist);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({ path: "fake-asset.tlg", extension: ".tlg" });
  });

  it("ignore les fichiers présents dans l'allowlist", () => {
    const files = ["public/icon-192.png", "public/icon-512.png"];
    const allowlist = new Set<string>(files);
    const violations = findAssetViolations(files, allowlist);

    expect(violations).toHaveLength(0);
  });

  it("ignore les extensions non concernées", () => {
    const files = ["README.md", "src/main.ts", "tools/script.ts"];
    const violations = findAssetViolations(files, new Set());

    expect(violations).toHaveLength(0);
  });

  it("traite les extensions de manière insensible à la casse", () => {
    const files = ["ASSET.TLG", "Mixed.PNG"];
    const violations = findAssetViolations(files, new Set());

    expect(violations).toHaveLength(2);
    expect(violations[0]).toEqual({ path: "ASSET.TLG", extension: ".tlg" });
    expect(violations[1]).toEqual({ path: "Mixed.PNG", extension: ".png" });
  });
});

describe("formatViolations", () => {
  it("liste les fichiers fautifs et l'action à prendre", () => {
    const violations = [
      { path: "fake-asset.tlg", extension: ".tlg" },
      { path: "sound/copyrighted.ogg", extension: ".ogg" },
    ];
    const output = formatViolations(violations);

    expect(output).toContain("Fichiers interdits détectés (2)");
    expect(output).toContain("fake-asset.tlg (.tlg)");
    expect(output).toContain("sound/copyrighted.ogg (.ogg)");
    expect(output).toContain("tools/allowed-assets.txt");
  });

  it("retourne une chaîne vide si aucune violation", () => {
    expect(formatViolations([])).toBe("");
  });
});

describe("parseNulSeparated", () => {
  it("garde les noms non ASCII intacts (sinon l'extension serait masquée)", () => {
    const files = parseNulSeparated("é.tlg\0背景.png\0a b.ks\0");
    expect(files).toEqual(["é.tlg", "背景.png", "a b.ks"]);
    expect(findAssetViolations(files, new Set()).map((v) => v.path)).toEqual(files);
  });

  it("ignore les entrées vides", () => {
    expect(parseNulSeparated("")).toEqual([]);
  });
});

const H1 = "a".repeat(64);
const H2 = "b".repeat(64);

describe("parseAllowlist", () => {
  it("lit le format sha256sum, en ignorant commentaires et lignes vides", () => {
    const { entries, invalid } = parseAllowlist(`# titre\n\n${H1}  public/a.png  # icône\n${H2.toUpperCase()}   dir/b c.png\n`);
    expect(invalid).toEqual([]);
    expect([...entries]).toEqual([
      ["public/a.png", H1],
      ["dir/b c.png", H2],
    ]);
  });

  it("signale les lignes sans empreinte valide", () => {
    const { entries, invalid } = parseAllowlist(`public/a.png\n${"z".repeat(64)}  b.png\n${H1}  ok.png\n${"a".repeat(63)}  court.png`);
    expect([...entries.keys()]).toEqual(["ok.png"]);
    expect(invalid).toHaveLength(3);
  });
});

describe("findHashMismatches", () => {
  const allow = new Map([["public/a.png", H1]]);

  it("détecte un fichier autorisé dont le contenu a changé", () => {
    const v = findHashMismatches(["public/a.png"], allow, () => H2);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ path: "public/a.png", reason: "hash" });
  });

  it("accepte un contenu identique", () => {
    expect(findHashMismatches(["public/a.png"], allow, () => H1)).toEqual([]);
  });

  it("ignore un fichier autorisé non suivi ou absent du disque", () => {
    expect(findHashMismatches(["autre.ts"], allow, () => H2)).toEqual([]);
    expect(findHashMismatches(["public/a.png"], allow, () => null)).toEqual([]);
  });
});

describe("findLargeBinaries", () => {
  const big = { size: MAX_BINARY_BYTES + 1, binary: true };

  it("détecte un gros binaire à extension anodine ou absente", () => {
    const info: Record<string, { size: number; binary: boolean }> = { "x.dat": big, DATA: big };
    const v = findLargeBinaries(["x.dat", "DATA"], new Map(), (p) => info[p] ?? null);
    expect(v.map((x) => x.path)).toEqual(["x.dat", "DATA"]);
    expect(v[0]).toMatchObject({ reason: "binary" });
  });

  it("tolère un petit binaire, un gros fichier texte et le seuil exact", () => {
    const info: Record<string, { size: number; binary: boolean }> = {
      "petit.dat": { size: 100, binary: true },
      "gros.txt": { size: 5_000_000, binary: false },
      "seuil.dat": { size: MAX_BINARY_BYTES, binary: true },
    };
    expect(findLargeBinaries(Object.keys(info), new Map(), (p) => info[p] ?? null)).toEqual([]);
  });

  it("ignore les fichiers autorisés et ceux déjà signalés par leur extension", () => {
    const allow = new Map([["ok.dat", H1]]);
    expect(findLargeBinaries(["ok.dat", "image.png"], allow, () => big)).toEqual([]);
  });

  it("ignore un fichier absent du disque", () => {
    expect(findLargeBinaries(["x.dat"], new Map(), () => null)).toEqual([]);
  });
});

describe("looksBinary", () => {
  it("un octet NUL signale un binaire", () => {
    expect(looksBinary(new Uint8Array([104, 105, 0, 1]))).toBe(true);
    expect(looksBinary(new TextEncoder().encode("texte é 背景"))).toBe(false);
  });
});

describe("renderAllowlist", () => {
  it("réécrit les empreintes en conservant commentaires et lignes vides", () => {
    const text = `# titre\n\n${H1}  a.png  # note\nb.png\n`;
    const out = renderAllowlist(text, new Map([["a.png", H2], ["b.png", H1]]));
    expect(out).toBe(`# titre\n\n${H2}  a.png\n${H1}  b.png\n`);
  });

  it("laisse intacte une ligne sans nouvelle empreinte", () => {
    const text = `${H1}  a.png\n`;
    expect(renderAllowlist(text, new Map())).toBe(text);
  });
});

describe("formatViolations — motifs", () => {
  it("décrit le motif de chaque violation", () => {
    const msg = formatViolations([
      { path: "a.png", extension: ".png" },
      { path: "b.png", extension: "", reason: "hash", detail: "contenu différent" },
      { path: "c.dat", extension: "", reason: "binary", detail: "400 Kio" },
    ]);
    expect(msg).toContain("a.png (.png)");
    expect(msg).toContain("b.png (contenu modifié : contenu différent)");
    expect(msg).toContain("c.dat (gros binaire hors liste, 400 Kio)");
    expect(msg).toContain("--update");
  });
});

describe("findPlaceholderIntegrityIssues (#417)", () => {
  const dirs: string[] = [];
  function tmpAssets(): string {
    const dir = mkdtempSync(join(tmpdir(), "mahoyo-placeholder-check-"));
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function writeManifest(dir: string, manifest: unknown): void {
    writeFileSync(join(dir, "asset-manifest.json"), JSON.stringify(manifest), "utf-8");
  }

  it("signale un manifeste placeholder dans un dossier rempli de fichiers", () => {
    const dir = tmpAssets();
    writeManifest(dir, { version: 1, assetsVersion: "placeholders-v1", images: { black: {} }, audio: {}, scenarios: {} });
    for (let i = 0; i < 80; i++) mkdirSync(join(dir, "bg"), { recursive: true });
    for (let i = 0; i < 80; i++) writeFileSync(join(dir, "bg", `img${i}.webp`), "x");
    const issues = findPlaceholderIntegrityIssues(dir);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toBe("placeholder-mismatch");
    expect(issues[0]!.detail).toContain("80 fichiers");
    expect(issues[0]!.detail).toContain("dist/assets");
  });

  it("accepte un dossier de placeholders cohérent et un dossier réel", () => {
    const placeholder = tmpAssets();
    writeManifest(placeholder, { version: 1, assetsVersion: "placeholders-v1", images: { black: {} }, audio: {}, scenarios: {} });
    writeFileSync(join(placeholder, "bg.png"), "x");
    expect(findPlaceholderIntegrityIssues(placeholder)).toEqual([]);

    const real = tmpAssets();
    writeManifest(real, { version: 1, assetsVersion: "owner-real-v1", images: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`i${i}`, {}])), audio: {}, scenarios: {} });
    for (let i = 0; i < 80; i++) writeFileSync(join(real, `img${i}.webp`), "x");
    expect(findPlaceholderIntegrityIssues(real)).toEqual([]);
  });

  it("signale un manifeste illisible et ignore un dossier sans manifeste", () => {
    const broken = tmpAssets();
    writeFileSync(join(broken, "asset-manifest.json"), "{pas du json", "utf-8");
    expect(findPlaceholderIntegrityIssues(broken)[0]!.reason).toBe("unreadable-manifest");
    expect(findPlaceholderIntegrityIssues(tmpAssets())).toEqual([]);
  });
});
