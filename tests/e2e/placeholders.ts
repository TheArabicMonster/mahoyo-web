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

/** PNG uni 1×1 exporté pour les specs qui interceptent les images (`cg-mode.spec.ts`). */
export function png1x1(r: number, g: number, b: number): Buffer {
  return pngSolid(1, 1, r, g, b);
}

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

/** Pages des chapitres suivants (parcours complet #94) : assez pour lire, choisir et enchaîner. */
export const PLACEHOLDER_CHAPTER_PAGES = 6;

/** Marqueur de la page de test `@cm` (#86) : première page du prologue, vidée par `@cm`. */
export const PLACEHOLDER_CM_MARKER = "Page CM — texte à vider par @cm";

/** Textes distinctifs des scripts, pour vérifier dans le DOM quel chapitre est joué. */
export const PLACEHOLDER_SCRIPT_MARKERS = {
  prologue: "Page de test e2e",
  voieA: "Chapitre 1 — Voie A",
  voieB: "Chapitre 1 — Voie B",
  chapitre2: "Chapitre 2 — Épilogue",
} as const;

/** Chapitres exposés à l'écran titre (Extra > Archive) et au flowchart. */
export const PLACEHOLDER_CHAPTERS = [
  { id: "1-0", label: "Prologue", file: "1-0.ks", arc: "Prologue" },
  { id: "1-1a", label: PLACEHOLDER_SCRIPT_MARKERS.voieA, file: "1-1a.ks", arc: "Chapitre 1" },
  { id: "1-1b", label: PLACEHOLDER_SCRIPT_MARKERS.voieB, file: "1-1b.ks", arc: "Chapitre 1" },
  { id: "2-0", label: PLACEHOLDER_SCRIPT_MARKERS.chapitre2, file: "2-0.ks", arc: "Chapitre 2" },
] as const;

/**
 * Table d'enchaînement (même format que `story-chain.json`, voir `docs/ENCHAINEMENT_SCRIPTS.md`).
 *
 * À la fin de `1-0.ks`, le joueur choisit sa voie (un **choix** de deux options) ; la voie choisie
 * mène au chapitre 1, qui s'enchaîne automatiquement vers le chapitre 2, puis la fin. C'est le
 * support du parcours complet e2e (#94) : choix, changement de chapitre et enchaînement.
 */
export const PLACEHOLDER_CHAIN = {
  version: 1,
  first: "1-0.ks",
  next: {
    "1-0.ks": [
      { to: "1-1a.ks", choice: "Accompagner Aoko" },
      { to: "1-1b.ks", choice: "Suivre Alice" },
    ],
    "1-1a.ks": [{ to: "2-0.ks" }],
    "1-1b.ks": [{ to: "2-0.ks" }],
  },
  chapters: PLACEHOLDER_CHAPTERS,
} as const;

/**
 * Pages d'un script de test (sans `@return`), avec un marqueur de texte pour l'identifier dans le
 * DOM. `start` permet d'insérer une page spéciale (ex. `@cm`, #86) sans casser la numérotation.
 */
function pageBodies(marker: string, count: number, start = 0): string {
  return Array.from({ length: count }, (_, i) => {
    const n = String(start + i + 1).padStart(2, "0");
    return `${marker} — page ${n} — texte original généré pour le player. La lecture continue.[p]`;
  }).join("\n");
}

/** Pages d'un script de test terminé par `@return`. */
function pagesFor(marker: string, count: number, start = 0): string {
  return `${pageBodies(marker, count, start)}\n@return\n`;
}

/**
 * Ouverture du prologue (#70) : géométrie du `@partbg` du vrai `1-0.ks`, relevée avec
 * `npm run trace:visual -- 1-0.ks` (le vrai script reste local, non commité).
 *
 * `@partbg … center=748 width=522 height=576 srcleft=542` sur une image de fond 1120×672 :
 * le wrapper occupe x ∈ [487, 1009] et y ∈ [0, 576] dans le repère logique du stage (1024×576),
 * et l'image interne, décalée de -542 px, couvre tout le cadre (rect source x[542, 1064]).
 */
export const PLACEHOLDER_OPENING = {
  center: 748,
  vcenter: 288,
  width: 522,
  height: 576,
  srcLeft: 542,
  /** Dimensions de l'image placeholder de fond de l'opening (mêmes proportions que les bg convertis). */
  imageWidth: 1120,
  imageHeight: 672,
} as const;

/**
 * Commandes d'ouverture du prologue : `@bg` noir puis `@partbg`, écrits directement sur la page
 * `fore`. Le vrai `1-0.ks` passe par un trans implicite `back → fore` (`time=800`) ; ici on écrit
 * sur `fore` pour éviter toute animation (stabilité e2e) tout en gardant la même géométrie.
 */
function prologueOpening(): string {
  return [
    "@bg page=fore time=0 rule=crossfade storage=black",
    "@partbg page=fore rule=crossfade time=0 storage=partbg" +
      ` srcleft=${PLACEHOLDER_OPENING.srcLeft} index=1000 width=${PLACEHOLDER_OPENING.width}` +
      ` height=${PLACEHOLDER_OPENING.height} center=${PLACEHOLDER_OPENING.center} id=pb1 bgstorage=black`,
  ].join("\n");
}

/**
 * Page de test `@cm` (#86) : le marqueur s'affiche, puis `@cm` vide la page et `@s` marque un
 * point d'arrêt — le texte de la page est alors vide alors que la boîte reste affichée.
 * Le e2e dédié (`text-clear.spec.ts`) vérifie ce vidage, puis qu'un clic passe à la page suivante.
 */
function cmPage(): string {
  return `${PLACEHOLDER_CM_MARKER} — texte original généré pour le player.[l]
@cm
@s`;
}

/** Les quatre scripts du parcours complet (textes originaux, aucun asset du jeu). */
function placeholderScripts(): Record<string, string> {
  return {
    // Page de test @cm (#86) insérée après les deux premières pages « normales » : la numérotation
    // et les assertions existantes sur « page 01 »/« page 02 » restent valides.
    "1-0.ks": `${prologueOpening()}\n${pageBodies(PLACEHOLDER_SCRIPT_MARKERS.prologue, 2)}\n${cmPage()}\n${pageBodies(PLACEHOLDER_SCRIPT_MARKERS.prologue, PLACEHOLDER_SCENARIO_PAGES - 2, 2)}\n@return\n`,
    "1-1a.ks": pagesFor(PLACEHOLDER_SCRIPT_MARKERS.voieA, PLACEHOLDER_CHAPTER_PAGES),
    "1-1b.ks": pagesFor(PLACEHOLDER_SCRIPT_MARKERS.voieB, PLACEHOLDER_CHAPTER_PAGES),
    "2-0.ks": pagesFor(PLACEHOLDER_SCRIPT_MARKERS.chapitre2, PLACEHOLDER_CHAPTER_PAGES),
  };
}

/** Manifest minimal : résout les clés logiques vers les PNG générés (jamais de vrai asset). */
function placeholderManifest(): string {
  const image = (url: string) => ({ url, source: url, kind: "image" as const });
  const scenario = (file: string) => ({ url: `scenario/${file}`, source: `scenario/${file}`, encoding: "utf-8" });
  return JSON.stringify(
    {
      version: 1,
      generatedAt: new Date(0).toISOString(),
      images: {
        black: image("bg/black.png"),
        white: image("bg/white.png"),
        placeholder: image("image/placeholder.png"),
        // Image de fond de l'opening (#70) : dimensions natives d'un bg converti (1120×672), pour
        // que le crop `@partbg srcleft=542 width=522` montre bien une zone de l'image.
        partbg: image("image/partbg.png"),
        txtwindow02: image("image/txtwindow02.png"),
        linebreak_a: image("image/linebreak_a.png"),
        pagebreak_a: image("image/pagebreak_a.png"),
      },
      audio: {},
      scenarios: Object.fromEntries(
        ["1-0.ks", "1-1a.ks", "1-1b.ks", "2-0.ks"].map((file) => [file.replace(/\.ks$/, ""), scenario(file)]),
      ),
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

  // Fond et sprites : PNG uni (les placeholders ne sont pas jugés sur leur contenu).
  writePng(join(assets, "bg", "black.png"), 1, 1, 0, 0, 0);
  writePng(join(assets, "bg", "white.png"), 1, 1, 255, 255, 255);
  writePng(join(assets, "image", "placeholder.png"), 1, 1, 255, 0, 0);
  // Image de fond de l'opening du prologue (#70) : dimensions natives 1120×672, nécessaires pour
  // que le rect source du `@partbg` (srcleft=542, width=522) reste dans l'image et couvre le cadre.
  writePng(
    join(assets, "image", "partbg.png"),
    PLACEHOLDER_OPENING.imageWidth,
    PLACEHOLDER_OPENING.imageHeight,
    32,
    48,
    64,
  );
  // Cadre de la fenêtre de message par défaut (#182) : sans lui, le player retombe sur l'ancienne
  // boîte. Vrai PNG, résolu par le manifeste (`txtwindow02` → `image/txtwindow02.png`).
  writePng(join(assets, "image", "txtwindow02.png"), 1, 1, 0, 0, 0);
  // Bandes d'animation des indicateurs d'attente (`linebreak_a`, `pagebreak_a`) : 40 vignettes.
  writePng(join(assets, "image", "linebreak_a.png"), LINE_GLYPH.width * LINE_GLYPH.frames, LINE_GLYPH.height, 255, 255, 255);
  writePng(join(assets, "image", "pagebreak_a.png"), PAGE_GLYPH.width * PAGE_GLYPH.frames, PAGE_GLYPH.height, 255, 255, 255);
  writePng(join(assets, "rule", "rule.png"), 1, 1, 128, 128, 128);

  // Scripts du parcours complet (#94) + table d'enchaînement (choix puis enchaînement de chapitres).
  const scripts = placeholderScripts();
  mkdirSync(join(assets, "scenario"), { recursive: true });
  for (const [file, content] of Object.entries(scripts)) {
    writeFileSync(join(assets, "scenario", file), content);
  }
  writeFileSync(join(assets, "story-chain.json"), JSON.stringify(PLACEHOLDER_CHAIN, null, 2));
  writeFileSync(join(assets, "asset-manifest.json"), placeholderManifest());

  // 7 PNG + partbg + 5 scripts/manifest = 13 fichiers (utile aux diagnostics).
  return 11 + Object.keys(scripts).length + 1;
}

// ── Corpus de placeholders pour la lecture complète (#269) ─────────────────────────────────────
//
// La DoD v1.0 exige que la CI exécute « la même logique de lecture » que la lecture complète avec
// des placeholders originaux. On réutilise le jeu de placeholders e2e (manifeste, PNG, scripts du
// parcours complet) et on le complète jusqu'à `size` scripts narratifs, chacun exerçant des
// commandes visuelles différentes. Un marqueur permet au test `full-read` de connaître la taille
// attendue du corpus (au lieu du seuil de 221 scripts des vrais assets).

/** Marqueur écrit à la racine du corpus : sa présence active le mode « placeholders » de full-read. */
export const PLACEHOLDER_CORPUS_MARKER = "placeholder-corpus.json";

/** Taille du corpus de référence de la DoD v1.0 (221 scripts narratifs, voir docs/LECTURE_COMPLETE.md). */
export const FULL_READ_CORPUS_SIZE = 221;

/** Contenu du marqueur `placeholder-corpus.json`. */
export type PlaceholderCorpusMarker = {
  kind: "mahoyo-placeholder-corpus";
  version: 1;
  /** Nombre de scripts narratifs du corpus généré (tous audités par `full-read`). */
  scripts: number;
};

/**
 * Corps d'un script de corpus : commandes visuelles variées (rotation sur 4 variantes), texte
 * original de test, points de clic et fin de script. Aucun asset du jeu n'est référencé.
 */
function corpusScriptBody(index: number): string {
  const n = String(index).padStart(3, "0");
  const variants = [
    // 0 : fond + cadre de message + pages
    `@bg page=fore time=0 rule=crossfade storage=black
@invisibleframe
@position frame=txtwindow02
Corpus e2e ${n} — ouverture de scène.[p]
Corpus e2e ${n} — deuxième page lue.[p]
@visibleframe
@return
`,
    // 1 : sprite + mouvement + nettoyage
    `@bg page=fore time=0 rule=crossfade storage=white
@fg storage=placeholder center=512 vcenter=288 index=1000
Corpus e2e ${n} — sprite affiché.[p]
@clfg
@return
`,
    // 2 : partbg (crop) + zone de texte
    `@bg page=fore time=0 rule=crossfade storage=black
@partbg page=fore rule=crossfade time=0 storage=partbg srcleft=542 index=1000 width=522 height=576 center=748 id=pb1 bgstorage=black
Corpus e2e ${n} — calque partbg.[p]
@clpartbg id=pb1
@return
`,
    // 3 : backlay/trans + tremblement + attente
    `@bg page=fore time=0 rule=crossfade storage=black
@backlay
@bg page=back time=0 storage=white
@trans time=0 rule=crossfade
@quake time=0 hmax=0 vmax=0
@wait time=0
Corpus e2e ${n} — transition et attente.[p]
@return
`,
  ];
  return variants[index % variants.length]!;
}

/**
 * Génère un corpus de lecture complète en placeholders sous `<publicDir>/assets/` :
 * manifeste, images, scripts du parcours complet, puis `size - 4` scripts `corpus-NNN.ks` et le
 * marqueur `placeholder-corpus.json`. Renvoie le marqueur écrit (taille attendue par full-read).
 */
export function generateFullReadCorpus(publicDir: string, size = FULL_READ_CORPUS_SIZE): PlaceholderCorpusMarker {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`Taille de corpus invalide : ${size}`);
  }
  generatePlaceholderAssets(publicDir);
  const assets = join(publicDir, "assets");
  const scenarioDir = join(assets, "scenario");
  // Les scripts du parcours complet (1-0, 1-1a, 1-1b, 2-0) sont tous narratifs et audités.
  const baseCount = Object.keys(placeholderScripts()).length;
  const expected = Math.max(size, baseCount);
  for (let i = baseCount; i < expected; i++) {
    const n = String(i - baseCount + 1).padStart(3, "0");
    writeFileSync(join(scenarioDir, `corpus-${n}.ks`), corpusScriptBody(i));
  }
  const marker: PlaceholderCorpusMarker = { kind: "mahoyo-placeholder-corpus", version: 1, scripts: expected };
  writeFileSync(join(assets, PLACEHOLDER_CORPUS_MARKER), JSON.stringify(marker, null, 2));
  return marker;
}
