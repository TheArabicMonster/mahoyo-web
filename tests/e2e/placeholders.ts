/**
 * Génère les assets **synthétiques** servis aux tests e2e (mode placeholders).
 *
 * Aucun asset sous copyright : les images sont générées algorithmiquement (PNG uni) et le scénario
 * est un texte original écrit pour les tests. Le jeu de placeholders est **autonome et
 * déterministe** : il ne dépend pas des vrais assets locaux (`public/assets`, ignoré par git), ce
 * qui permet à la CI de lancer la suite sans aucun asset du jeu.
 *
 * Le dossier passé ici est le `publicDir` de Vite (`MAHOYO_E2E_ASSETS`) : il est servi à la racine,
 * donc les fichiers vont sous `<publicDir>/assets/**` pour répondre aux URLs `/assets/...` du
 * player. C'est le même contrat qu'un `public/` local qui contient `public/assets/`.
 *
 * Choix de conception (issue #243) :
 * - un `asset-manifest.json` minimal est écrit pour que le `AssetResolver` résolve les clés
 *   logiques (`txtwindow02`, `black`, `linebreak_a`…) vers des fichiers `.png` **valides** : un PNG
 *   renommé `.webp` n'est pas décodé par le navigateur (`<img>` en erreur) et faisait retomber la
 *   fenêtre de message sur l'ancienne boîte ;
 * - le scénario `1-0.ks` fournit assez de pages pour que les tests qui lisent une vingtaine de
 *   pages (historique, menus) n'atteignent pas la fin du script ;
 * - les vrais assets (`MAHOYO_E2E_REAL_ASSETS=1`) ne sont **pas** copiés ici : ils se servent
 *   directement en pointant `MAHOYO_E2E_ASSETS` vers un dossier qui contient `assets/`.
 */
import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeCrc32() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return (data: Buffer): number => {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
}
const crc32 = makeCrc32();

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length);
  const combined = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(combined));
  return Buffer.concat([lenBuf, combined, crcBuf]);
}

/** PNG RGB uni `width × height` (sans alpha), valide pour le navigateur. */
export function pngSolid(width: number, height: number, r: number, g: number, b: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // color type RGB
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter method
  ihdr.writeUInt8(0, 12); // interlace
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 0; // filtre « none »
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const idatData = deflateSync(raw);
  return Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", idatData), pngChunk("IEND", Buffer.alloc(0))]);
}

function writePng(path: string, width: number, height: number, r: number, g: number, b: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, pngSolid(width, height, r, g, b));
}

/** Dimensions des bandes d'indicateur (voir `CLICK_GLYPHS` dans `src/renderer/text-frame.ts`). */
const LINE_GLYPH = { width: 24, height: 24, frames: 40 };
const PAGE_GLYPH = { width: 32, height: 24, frames: 40 };

/**
 * Scénario original de test : 40 pages, aucune commande qui dépend d'un asset réel.
 *
 * Les tests lisent jusqu'à 20 pages d'affilée (historique) après en avoir déjà lu quelques-unes :
 * le script doit donc rester loin de sa fin. Chaque page produit un point clic (`#textbox-indicator`).
 */
export const PLACEHOLDER_SCENARIO_PAGES = 40;

function placeholderScenario(): string {
  const pages = Array.from({ length: PLACEHOLDER_SCENARIO_PAGES }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    return `Page de test e2e ${n} — texte original généré pour le player. La lecture continue.[p]`;
  });
  return `${pages.join("\n")}\n@return\n`;
}

/** Manifest minimal : résout les clés logiques vers les PNG générés (jamais de vrai asset). */
function placeholderManifest(): string {
  const image = (url: string) => ({ url, source: url, kind: "image" as const });
  return JSON.stringify(
    {
      version: 1,
      generatedAt: new Date(0).toISOString(),
      images: {
        black: image("bg/black.png"),
        white: image("bg/white.png"),
        placeholder: image("image/placeholder.png"),
        txtwindow02: image("image/txtwindow02.png"),
        linebreak_a: image("image/linebreak_a.png"),
        pagebreak_a: image("image/pagebreak_a.png"),
      },
      audio: {},
      scenarios: {
        "1-0": { url: "scenario/1-0.ks", source: "scenario/1-0.ks", encoding: "utf-8" },
      },
    },
    null,
    2,
  );
}

/**
 * Écrit le jeu de placeholders complet sous `<publicDir>/assets/` (le chemin que le player
 * demande) et renvoie le nombre de fichiers écrits. Idempotent : réécrit les mêmes fichiers,
 * ne supprime rien d'autre.
 */
export function generatePlaceholderAssets(publicDir: string): number {
  const assets = join(publicDir, "assets");

  // Fond et sprites : PNG 1×1 (les placeholders ne sont pas jugés sur leur contenu).
  writePng(join(assets, "bg", "black.png"), 1, 1, 0, 0, 0);
  writePng(join(assets, "bg", "white.png"), 1, 1, 255, 255, 255);
  writePng(join(assets, "image", "placeholder.png"), 1, 1, 255, 0, 0);
  // Cadre de la fenêtre de message par défaut (#182) : sans lui, le player retombe sur l'ancienne
  // boîte. Vrai PNG, résolu par le manifeste (`txtwindow02` → `image/txtwindow02.png`).
  writePng(join(assets, "image", "txtwindow02.png"), 1, 1, 0, 0, 0);
  // Bandes d'animation des indicateurs d'attente (`linebreak_a`, `pagebreak_a`) : 40 vignettes.
  writePng(join(assets, "image", "linebreak_a.png"), LINE_GLYPH.width * LINE_GLYPH.frames, LINE_GLYPH.height, 255, 255, 255);
  writePng(join(assets, "image", "pagebreak_a.png"), PAGE_GLYPH.width * PAGE_GLYPH.frames, PAGE_GLYPH.height, 255, 255, 255);
  writePng(join(assets, "rule", "rule.png"), 1, 1, 128, 128, 128);

  mkdirSync(join(assets, "scenario"), { recursive: true });
  writeFileSync(join(assets, "scenario", "1-0.ks"), placeholderScenario());
  writeFileSync(join(assets, "asset-manifest.json"), placeholderManifest());

  return 10;
}
