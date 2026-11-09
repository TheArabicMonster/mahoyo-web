/**
 * KAG3 parser — transforms tokens into a list of "pages" that can be executed
 * by the runtime.
 *
 * Page boundaries are: @pg/[p] (page break), end of input.
 */

import type { AppearanceArgs, CropSpec, Instruction, ParsedScript, TextSegment, TextStyle, Token, TransformArgs } from "./types.js";
import { storageKey } from "@/core/storage-key.js";
import { parseActionKeys, parseNoiseActKeys } from "./action.js";

/** Centre de l'écran dans le repère logique 1024×576 : position d'un calque sans `center`/`vcenter`. */
const SCREEN_CENTER_X = 512;
const SCREEN_CENTER_Y = 288;

function parseIntArg(value: string | undefined, fallback = 0): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Lecture insensible à la casse d'un attribut : KAG n'impose pas la casse des noms d'attributs
 * (`minCycle` dans les scripts, `mincycle` dans `swingPropInfo` de tagex.tjs).
 */
function argCaseInsensitive(args: Record<string, string>, ...names: string[]): string | undefined {
  for (const name of names) {
    if (args[name] !== undefined) return args[name];
  }
  const lowered = new Map<string, string>();
  for (const [key, value] of Object.entries(args)) {
    const lower = key.toLowerCase();
    if (!lowered.has(lower)) lowered.set(lower, value);
  }
  for (const name of names) {
    const value = lowered.get(name.toLowerCase());
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Normalise un argument storage via storageKey. "" si absent. */
/** `true`/`1` → true, `false`/`0` → false, autre → undefined (attribut ignoré). */
function parseBoolArg(value: string | undefined): boolean | undefined {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

/**
 * `0xRRGGBB` / `#rrggbb` → `#rrggbb` ; `0xAARRGGBB` → `#rrggbbaa` si l'alpha n'est pas opaque
 * (utilisé par `@staffrollsetting bgcolor=0xFF000000`). Toute autre valeur → undefined.
 */
function parseColorArg(value: string | undefined): string | undefined {
  const raw = value?.trim();
  const rgb = raw?.match(/^(?:0x|#)([0-9a-f]{6})$/i);
  if (rgb) return `#${rgb[1].toLowerCase()}`;
  const argb = raw?.match(/^(?:0x|#)([0-9a-f]{2})([0-9a-f]{6})$/i);
  if (argb) {
    const alpha = parseInt(argb[1], 16);
    const color = `#${argb[2].toLowerCase()}`;
    return alpha === 0xff ? color : `${color}${argb[1].toLowerCase()}`;
  }
  return undefined;
}

/**
 * Couleur d'un effet plugin : `0xRRGGBB`, `#rrggbb` ou entier décimal (le corpus utilise
 * `color=16777215`). Toute valeur illisible → undefined (défaut de l'appelant).
 */
function parseRgbColorArg(value: string | undefined): string | undefined {
  const hex = parseColorArg(value);
  if (hex) return hex;
  const trimmed = value?.trim() ?? "";
  if (!/^\d+$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 0xffffff) return undefined;
  return `#${n.toString(16).padStart(6, "0")}`;
}

/** Construit le style d'un @font : seuls les attributs valides sont retenus. */
function parseFontStyle(args: Record<string, string>): TextStyle {
  const style: TextStyle = {};
  if (args.face) style.face = args.face;
  const size = Number.parseInt(args.size ?? "", 10);
  if (Number.isFinite(size) && size > 0) style.size = size;
  const color = parseColorArg(args.color);
  if (color) style.color = color;
  const bold = parseBoolArg(args.bold);
  if (bold !== undefined) style.bold = bold;
  const italic = parseBoolArg(args.italic);
  if (italic !== undefined) style.italic = italic;
  const edge = parseBoolArg(args.edge);
  if (edge !== undefined) style.edge = edge;
  const edgeColor = parseColorArg(args.edgecolor);
  if (edgeColor) style.edgeColor = edgeColor;
  const shadow = parseBoolArg(args.shadow);
  if (shadow !== undefined) style.shadow = shadow;
  const shadowColor = parseColorArg(args.shadowcolor);
  if (shadowColor) style.shadowColor = shadowColor;
  return style;
}

function normStorage(value: string | undefined): string {
  return value ? storageKey(value) : "";
}

/** Normalise un argument storage optionnel (undefined si absent). */
function normStorageOpt(value: string | undefined): string | undefined {
  return value ? storageKey(value) : undefined;
}

/**
 * Zoom et rotation d'un `@bg`, `@fg` ou `@chgfg` : `zoom` (en %) règle les deux axes,
 * `zoomx`/`zoomy` les précisent (négatif = miroir), `rotate` est en degrés. Un axe non
 * précisé reste absent (le runtime le lit comme 100 %). Une valeur illisible (expression
 * `&…`) est ignorée sans invalider le reste de la commande.
 */
/** Nombre flottant optionnel (attribut absent/invalide → undefined). */
function numArg(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseTransformArgs(args: Record<string, string>): TransformArgs {
  const zoom = numArg(args.zoom);
  const zoomx = numArg(args.zoomx) ?? zoom;
  const zoomy = numArg(args.zoomy) ?? zoom;
  const rotate = numArg(args.rotate);
  const out: TransformArgs = {};
  if (zoomx !== undefined) out.zoomx = zoomx;
  if (zoomy !== undefined) out.zoomy = zoomy;
  if (rotate !== undefined) out.rotate = rotate;
  const afx = numArg(args.afx);
  const afy = numArg(args.afy);
  if (afx !== undefined) out.afx = afx;
  if (afy !== undefined) out.afy = afy;
  return out;
}

/** Booléen KAG : `false`/`0` = false, toute autre valeur (ou absente si `defaultTrue`) = true. */
function parseKagBool(value: string | undefined, defaultTrue = true): boolean {
  if (value === undefined) return defaultTrue;
  return value !== "0" && value !== "false";
}

/**
 * Apparence d'un calque : `type=` (mode de fusion), `effect=` (filtre), `blur=`/`xblur=`/`yblur=`
 * (flou de boîte), `brightness=`, `contrast=`. `effect=none`/vide = aucun filtre. Un axe de flou
 * omis vaut l'autre (le moteur pose `xblur`/`yblur` depuis `blur` dans `@image`).
 */
function parseAppearanceArgs(args: Record<string, string>): AppearanceArgs {
  const int = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined;
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? undefined : n;
  };
  const out: AppearanceArgs = {};
  const type = int(args.type);
  if (type !== undefined) out.type = type;
  const effect = args.effect?.trim();
  if (effect !== undefined && effect !== "" && effect !== "none") out.effect = effect;
  const blur = int(args.blur);
  const blurx = int(args.xblur) ?? blur;
  const blury = int(args.yblur) ?? blur;
  if (blurx !== undefined) out.blurx = blurx;
  if (blury !== undefined) out.blury = blury;
  const brightness = int(args.brightness);
  if (brightness !== undefined) out.brightness = brightness;
  const contrast = int(args.contrast);
  if (contrast !== undefined) out.contrast = contrast;
  return out;
}

/**
 * Arguments d'une annotation ruby (`[ruby]` ou `@ruby`).
 *
 * `text` est le ruby. `char` est soit un **nombre** de caractères du texte suivant couverts par le
 * ruby (KAG3 standard), soit — extension TYPE-MOON (`data/override/tagex.tjs`, handler `ruby`) —
 * une **chaîne de texte de base** qui est affichée, le ruby étant réparti sur ses caractères.
 */
function parseRubyArgs(args: Record<string, string>): { ruby: string; charCount: number; baseText?: string } {
  const ruby = args.text ?? "";
  const rawChar = args.char;
  if (rawChar !== undefined && !/^[+-]?\d+$/.test(rawChar.trim())) {
    return { ruby, charCount: 1, baseText: rawChar };
  }
  return { ruby, charCount: parseIntArg(rawChar, 1) };
}

/**
 * Segments d'un ruby à texte de base explicite : chaque caractère de base est affiché avec une part
 * du ruby (répartition proportionnelle, approximation de la répartition par largeur du moteur).
 */
function rubyBaseSegments(baseText: string, ruby: string): TextSegment[] {
  if (baseText.length === 0) return [];
  const segments: TextSegment[] = [];
  for (let i = 0; i < baseText.length; i++) {
    const start = Math.round((i * ruby.length) / baseText.length);
    const end = Math.round(((i + 1) * ruby.length) / baseText.length);
    const part = ruby.slice(start, end);
    segments.push(part.length > 0 ? { text: baseText[i]!, ruby: part } : { text: baseText[i]! });
  }
  return segments;
}

/** Fermetures de blocs conditionnels/ignore : sans effet si le bloc n'a pas été ouvert. */
const CONDITIONAL_CLOSERS = new Set(["endif", "else", "elsif", "endignore"]);

function parsePageLayer(value: string | undefined): "fore" | "back" | undefined {
  if (value === "fore" || value === "back") return value;
  return undefined;
}


/**
 * Macros emoji de `data/scenario/macro.tjs` (`exCharTags`) : tags de texte qui s'expansent en
 * `[graph storage=<base><fontSize> alt="…"]`. La taille est ajoutée par le runtime (style courant).
 */
const EMOJI_TAGS: ReadonlyMap<string, { base: string; alt: string }> = new Map([
  ["heart", { base: "heart", alt: "(ハート)" }],
  ["ageage", { base: "アゲアゲ", alt: "↑" }],
  ["ansz", { base: "アンサズ", alt: "ANSZ" }],
  ["ingz", { base: "イングズ", alt: "INGZ" }],
  ["eywz", { base: "エイワズ", alt: "EYWZ" }],
  ["swel", { base: "ソウェル", alt: "SWEL" }],
]);

/** `[graph storage=… alt=…]` : image inline dans le flux de texte (null si storage vide). */
function graphSegment(args: Record<string, string>): TextSegment | null {
  const storage = normStorage(args.storage);
  if (!storage) return null;
  return args.alt === undefined ? { graph: { storage } } : { graph: { storage, alt: args.alt } };
}

/** Tag emoji (`[heart]`…) → marqueur interne, converti en graph par le runtime. */
function emojiSegment(name: string): TextSegment | null {
  const emoji = EMOJI_TAGS.get(name.toLowerCase());
  return emoji ? { emoji: { base: emoji.base, alt: emoji.alt } } : null;
}

/**
 * `[cockrobin]…[endcockrobin]` : bloc conditionnel « robin » du plugin (`robinserifplugin.tjs`).
 * Les deux drapeaux de configuration valent `false` par défaut dans le TJS : le bloc est donc
 * ignoré (comportement moteur par défaut, approximation documentée). Retourne l'index du token
 * après `[endcockrobin]` (fin du tableau si le tag manque).
 */
function skipCockrobinBlock(tokens: Token[], start: number): number {
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "tag" && token.name.toLowerCase() === "endcockrobin") return i + 1;
  }
  return tokens.length;
}

export function parseCommand(token: Extract<Token, { type: "command" }>): Instruction {
  const { name, args } = token;

  switch (name) {
    case "bg":
      return {
        kind: "bg",
        storage: normStorage(args.storage),
        time: parseIntArg(args.time),
        rule: args.rule,
        page: parsePageLayer(args.page),
        left: args.left !== undefined ? parseIntArg(args.left) : undefined,
        top: args.top !== undefined ? parseIntArg(args.top) : undefined,
        noclear: args.noclear === "1",
        nowait: args.nowait === "1",
        canskip: args.canskip !== "0",
        ...parseTransformArgs(args),
        ...parseAppearanceArgs(args),
      };
    case "fg":
      return {
        kind: "fg",
        storage: normStorage(args.storage),
        center: parseIntArg(args.center, SCREEN_CENTER_X),
        vcenter: parseIntArg(args.vcenter, SCREEN_CENTER_Y),
        index: parseIntArg(args.index),
        opacity: args.opacity !== undefined ? parseIntArg(args.opacity) / 255 : undefined,
        page: parsePageLayer(args.page),
        id: args.id,
        partbgId: args.partbgid,
        time: parseIntArg(args.time),
        rule: args.rule,
        nowait: args.nowait === "1",
        canskip: args.canskip !== "0",
        ...parseTransformArgs(args),
        ...parseAppearanceArgs(args),
      };
    case "chgfg":
      // @chgfg : change l'image d'un calque existant (garde position/z/opacity).
      return {
        kind: "chgfg",
        storage: normStorage(args.storage),
        id: args.id,
        index: args.index !== undefined ? parseIntArg(args.index) : undefined,
        page: parsePageLayer(args.page),
        time: parseIntArg(args.time),
        rule: args.rule,
        nowait: args.nowait === "1",
        canskip: args.canskip !== "0",
        ...parseTransformArgs(args),
        ...parseAppearanceArgs(args),
      };
    case "infg": {
      // @infg (fgplugin.tjs) : apparition animée d'un calque depuis (final - mx, final - my).
      // Le port pose le calque directement sur la page affichée (fore) et anime vers la position
      // finale (pas de @trans implicite : approximation documentée).
      const opacity = args.opacity !== undefined ? parseIntArg(args.opacity) / 255 : 1;
      return {
        kind: "infg",
        storage: normStorage(args.storage),
        id: args.id,
        index: args.index !== undefined ? parseIntArg(args.index) : undefined,
        center: parseIntArg(args.center, SCREEN_CENTER_X),
        vcenter: parseIntArg(args.vcenter, SCREEN_CENTER_Y),
        opacity,
        time: parseIntArg(args.time, 300),
        accel: parseIntArg(args.accel, 0),
        mx: parseIntArg(args.mx, 24),
        my: parseIntArg(args.my, 0),
        ...parseTransformArgs(args),
        ...parseAppearanceArgs(args),
      };
    }
    case "outfg": {
      // @outfg (fgplugin.tjs) : le calque courant glisse de (mx, my) et disparaît en `time` ms.
      return {
        kind: "outfg",
        page: parsePageLayer(args.page),
        id: args.id,
        storage: normStorageOpt(args.storage ?? args.target),
        time: parseIntArg(args.time, 300),
        accel: parseIntArg(args.accel, 0),
        mx: parseIntArg(args.mx, 24),
        my: parseIntArg(args.my, 0),
      };
    }
    case "layopt": {
      // @layopt (KAG3, mainwindow.tjs `.layopt`) : options d'un calque existant.
      // left/top sont approximés en center/vcenter (le port ne modélise pas le coin haut-gauche).
      const opacity = args.opacity !== undefined ? parseIntArg(args.opacity) / 255 : undefined;
      return {
        kind: "layopt",
        page: parsePageLayer(args.page),
        id: args.id,
        storage: normStorageOpt(args.storage),
        layer: args.layer,
        center: args.center !== undefined ? parseIntArg(args.center) : args.left !== undefined ? parseIntArg(args.left) : undefined,
        vcenter: args.vcenter !== undefined ? parseIntArg(args.vcenter) : args.top !== undefined ? parseIntArg(args.top) : undefined,
        opacity,
        visible: parseBoolArg(args.visible),
      };
    }
    case "bindbg":
      // @bindbg (tagex.tjs) : les calques suivent les mouvements du fond. Approximation : le
      // décalage est visuel au moment des panoramiques (`bgMove`), non persisté.
      return { kind: "bindbg", enabled: args.enabled !== undefined ? args.enabled !== "0" && args.enabled !== "false" : true, page: parsePageLayer(args.page) };
    case "cm":
      // @cm (KAG3) : vide les calques de message. Le port émet un clearText explicite (force).
      return { kind: "cm" };
    case "cm4pg":
      // @cm4pg (tagex.tjs) : appelle cm puis originalStoreFlags() (copie des drapeaux de cache
      // moteur, sans effet visible). Rendu identique à @cm dans le port.
      return { kind: "cm4pg" };
    case "clall":
      return { kind: "clall", page: parsePageLayer(args.page) };
    case "clfg":
    case "clpartbg": {
      const page = parsePageLayer(args.page);
      const storage = normStorageOpt(args.storage);
      const index = args.index !== undefined ? parseIntArg(args.index) : undefined;
      const id = args.id;
      return { kind: "clfg", storage, index, id, page };
    }
    case "backlay":
      return { kind: "backlay", storage: args.storage };
    case "trans":
      return {
        kind: "trans",
        rule: args.rule,
        time: parseIntArg(args.time),
        nowait: args.nowait === "1",
        canskip: args.canskip !== "0",
        cond: args.cond,
        // Moteur (tagex.tjs) : exchange=true par défaut ; `noback=1` supprime le backlay
        // automatique de fin de transition bloquante (#253).
        exchange: args.exchange === undefined ? true : parseKagBool(args.exchange),
        noback: args.noback !== undefined && parseKagBool(args.noback),
      };
    case "fgact":
    case "partbgact": {
      // @fgact = animation de sprite avec keyframes
      // @partbgact = animation d'un partbg (panorama cropé)
      const isPartbg = name === "partbgact";
      const storage = normStorage(args.storage);
      const page = parsePageLayer(args.page);
      const keyframes = parseActionKeys(args.keys, args.props);
      const loop = args.loop === "1";
      const id = args.id;
      const partbgid = args.partbgid;

      if (keyframes.length >= 2) {
        // On a des vraies keyframes -> instruction animate
        return {
          kind: "animate",
          def: { storage, page, keyframes, loop, id, partbgid, isPartbg },
        };
      }

      // Fallback: traiter comme un @fg statique (position initiale de la 1ère keyframe)
      const firstFrame = keyframes[0];
      const center = firstFrame?.center ?? parseIntArg(args.center, SCREEN_CENTER_X);
      const vcenter = firstFrame?.vcenter ?? parseIntArg(args.vcenter, SCREEN_CENTER_Y);
      const index = parseIntArg(args.index);
      const opacity = firstFrame?.opacity ?? (args.opacity !== undefined ? parseIntArg(args.opacity) / 255 : undefined);
      if (isPartbg) {
        return {
          kind: "partbg",
          storage,
          center,
          vcenter,
          index: index || 1000,
          opacity,
          page,
          id,
          crop: {
            width: parseIntArg(args.width),
            height: parseIntArg(args.height),
            srcLeft: parseFloat(args.srcleft ?? "0"),
            srcTop: parseFloat(args.srctop ?? "0"),
            srcZoomX: parseIntArg(args.srczoomx, 100),
            srcZoomY: parseIntArg(args.srczoomy, 100),
          },
        };
      }
      return {
        kind: "fg",
        storage,
        center,
        vcenter,
        index: index || 1,
        opacity,
        page,
        id,
      };
    }
    case "partbg": {
      // @partbg = partie de background (panorama cropé).
      // Rendu : un div width×height overflow:hidden positionné à center/vcenter,
      // contenant un <img> translaté de (-srcleft,-srctop) et scalé srczoom/100.
      const storage = normStorage(args.storage);
      // Un axe omis vaut le centre de l'écran (KAG : calque centré par défaut), pas 0 : sans cela
      // un partbg sans `vcenter` était à moitié hors cadre (#134).
      const center = parseIntArg(args.center, SCREEN_CENTER_X);
      const vcenter = parseIntArg(args.vcenter, SCREEN_CENTER_Y);
      const index = parseIntArg(args.index, 1000);
      const opacity = args.opacity !== undefined ? parseIntArg(args.opacity) / 255 : undefined;
      const page = parsePageLayer(args.page);
      const id = args.id;
      const noclear = args.noclear === "1";
      const bgstorage = args.bgstorage ? normStorage(args.bgstorage) : undefined;
      const time = parseIntArg(args.time);
      const rule = args.rule;
      // srczoom (uniforme) ou srczoomx/srczoomy (séparé). Défaut 100.
      const srcZoomX = args.srczoomx !== undefined ? parseIntArg(args.srczoomx) : parseIntArg(args.srczoom, 100);
      const srcZoomY = args.srczoomy !== undefined ? parseIntArg(args.srczoomy) : parseIntArg(args.srczoom, 100);
      const crop: CropSpec = {
        width: parseIntArg(args.width),
        height: parseIntArg(args.height),
        srcLeft: parseFloat(args.srcleft ?? "0"),
        srcTop: parseFloat(args.srctop ?? "0"),
        srcZoomX,
        srcZoomY,
        bgStorage: bgstorage,
      };
      return {
        kind: "partbg",
        storage,
        center,
        vcenter,
        index,
        opacity,
        page,
        id,
        noclear,
        bgstorage,
        time,
        rule,
        nowait: args.nowait === "1",
        canskip: args.canskip !== "0",
        crop,
        ...parseAppearanceArgs(args),
      };
    }
    case "bgact": {
      // @bgact = animation du fond (panoramique, zoom, rotation) : `props=-storage,left,top,…`.
      // Le runtime n'en retient que la première keyframe (état de départ), sans toucher au
      // reste de la page : voir `applyBgact`.
      return {
        kind: "bgact",
        storage: normStorage(args.storage),
        page: parsePageLayer(args.page),
        keyframes: parseActionKeys(args.keys, args.props),
      };
    }
    case "movefg":
    case "movepartbg": {
      // @movefg / @movepartbg = déplacer un sprite/partie de background
      const isPartbg = name === "movepartbg";
      const storage = normStorage(args.storage);
      const page = parsePageLayer(args.page);
      const time = parseIntArg(args.time, 1000);
      // Un attribut absent signifie « conserver la valeur courante » (≠ 0).
      const centerOpt = args.center !== undefined ? parseIntArg(args.center) : undefined;
      const vcenterOpt = args.vcenter !== undefined ? parseIntArg(args.vcenter) : undefined;
      const opacity = args.opacity !== undefined ? parseIntArg(args.opacity) / 255 : undefined;
      const id = args.id;

      if (time > 0) {
        // Créer une animation simple à 2 keyframes
        return {
          kind: "animate",
          def: {
            storage,
            page,
            isMove: true,
            isPartbg,
            keyframes: [
              { time: 0, duration: time, interp: "l", easing: "linear", accel: 0 },
              { time, duration: time, interp: "l", easing: "linear", accel: 0, center: centerOpt, vcenter: vcenterOpt, opacity },
            ],
            id,
          },
        };
      }

      // Déplacement instantané : l'instruction `fg` exige une position, donc un
      // attribut absent retombe sur 0 (cas absent du corpus, qui fournit toujours
      // center et vcenter).
      return {
        kind: "fg",
        storage,
        center: centerOpt ?? 0,
        vcenter: vcenterOpt ?? 0,
        index: parseIntArg(args.index) || 1,
        opacity,
        page,
      };
    }
    case "play":
      return {
        kind: "play",
        storage: normStorage(args.storage),
        volume: args.volume !== undefined ? parseIntArg(args.volume) : undefined,
      };
    case "playpause":
      // Pause de la BGM avec fondu ; `storage` désigne la piste concernée.
      return { kind: "playpause", time: parseIntArg(args.time, 0), storage: normStorageOpt(args.storage) };
    case "playresume":
      return {
        kind: "playresume",
        time: parseIntArg(args.time, 0),
        volume: args.volume !== undefined ? parseIntArg(args.volume, 100) : 100,
        storage: normStorageOpt(args.storage),
      };
    case "playstop":
      return {
        kind: "playstop",
        time: args.time !== undefined ? parseIntArg(args.time) : undefined,
      };
    case "fadebgm":
      return {
        kind: "fadebgm",
        time: parseIntArg(args.time, 1000),
        volume: args.volume !== undefined ? parseIntArg(args.volume) : undefined,
      };
    case "xchgbgm":
      // KAG3 : échange de BGM avec fondu croisé (time/intime/outtime/overlap/volume).
      return {
        kind: "xchgbgm",
        storage: normStorage(args.storage),
        time: args.time !== undefined ? parseIntArg(args.time) : undefined,
        intime: args.intime !== undefined ? parseIntArg(args.intime) : undefined,
        outtime: args.outtime !== undefined ? parseIntArg(args.outtime) : undefined,
        overlap: args.overlap !== undefined ? parseIntArg(args.overlap) : undefined,
        volume: args.volume !== undefined ? parseIntArg(args.volume) : undefined,
        loop: args.loop === undefined ? undefined : parseKagBool(args.loop),
      };
    case "clickskip":
      // KAG3 : autorise/interdit le saut au clic (fin de texte, interruption d'effets).
      return { kind: "clickskip", enabled: parseKagBool(args.enabled) };
    case "cancelskip":
      // KAG3 : annule l'état de skip courant.
      return { kind: "cancelskip" };
    case "effectskip":
      // Override TYPE-MOON (tagex.tjs) : autorise/interdit le skip des effets.
      return { kind: "effectskip", enabled: parseKagBool(args.enabled) };
    case "wb":
      // KAG3 : attend la fin du fondu BGM (impossible à interrompre par défaut).
      return { kind: "waitfor", what: "bgmFade", skippable: args.canskip !== undefined && parseKagBool(args.canskip, false) };
    case "se":
      return {
        kind: "se",
        storage: normStorage(args.storage),
        volume: args.volume !== undefined ? parseIntArg(args.volume) : undefined,
        loop: args.loop === "1" || args.loop === "true",
        delay: args.delay !== undefined ? parseIntArg(args.delay) : undefined,
      };
    case "seloop": {
      // @seloop = SE en boucle avec fondu d'entrée (time) ; accepte cond=.
      const storage = normStorage(args.storage);
      if (storage === "") return { kind: "raw", command: "seloop", args } as unknown as Instruction;
      return {
        kind: "seact",
        storage,
        delay: 0,
        fadeIn: parseIntArg(args.time, 0),
        volume: args.volume !== undefined ? parseIntArg(args.volume, 100) : 100,
        loop: true,
        cond: args.cond,
      };
    }
    case "playtimeline": {
      // @playtimeline scene=N next=ms : séquence minutée issue des données *tladata du script.
      // Variante de test `frame=N` (menutest.ks, gamemenu.ks) sans `scene=` : tolérée en no-op
      // explicite (pas un no-op volontaire permanent, donc hors registre #275) — les .tla ne sont
      // pas convertis par le pipeline (#287).
      if (args.scene === undefined) {
        return {
          kind: "noop",
          command: "playtimeline",
          reason: "variante frame= sans scene= (timeline .tla non convertie) — tolérée (#287)",
        };
      }
      const next = args.next !== undefined ? parseIntArg(args.next, 0) : undefined;
      return { kind: "playtimeline", scene: parseIntArg(args.scene, 0), next };
    }
    case "seact": {
      // @seact = SE avec délai et fondu
      // Format: keys=(delay,action,storage,fadein,vol,?,loop,pan,vol2,pan2)
      // On ignore pan (non supporté par HTML5 audio).
      const keys = args.keys;
      if (!keys) {
        return { kind: "seact", storage: "", delay: 0, fadeIn: 0, volume: 100, loop: false };
      }
      // Extraire le contenu entre parenthèses
      const match = keys.match(/^\(([^)]+)\)$/);
      if (!match) {
        return { kind: "seact", storage: "", delay: 0, fadeIn: 0, volume: 100, loop: false };
      }
      const cells = match[1].split(",");
      const delay = parseIntArg(cells[0], 0);
      // cells[1] = action (toujours "play", ignoré)
      const storage = normStorage(cells[2] ?? "");
      const fadeIn = parseIntArg(cells[3], 0);
      const volume = parseIntArg(cells[4], 100);
      // cells[5] = ? (ignoré)
      const loop = (cells[6] ?? "0") === "1";
      // cells[7] = pan (ignoré)
      // cells[8] = vol2 (cible du fondu, ignoré pour l'instant)
      // cells[9] = pan2 (ignoré)
      return { kind: "seact", storage, delay, fadeIn, volume, loop };
    }
    case "sestop":
      return {
        kind: "sestop",
        storage: normStorageOpt(args.storage),
        time: args.time !== undefined ? parseIntArg(args.time) : undefined,
      };
    case "fadese":
      return {
        kind: "fadese",
        storage: normStorageOpt(args.storage),
        time: parseIntArg(args.time, 1000),
        volume: parseIntArg(args.volume, 100),
      };
    case "quake":
    case "shock":
      return {
        kind: "quake",
        vmax: parseIntArg(args.vmax, 5),
        hmax: parseIntArg(args.hmax, 0),
        time: parseIntArg(args.time, 500),
        interval: parseIntArg(args.interval, 40),
      };
    case "stopquake":
      return { kind: "stopquake" };
    case "lockquickmenu":
      return { kind: "lockquickmenu" };
    case "unlockquickmenu":
      return { kind: "unlockquickmenu" };
    case "pauseautomode":
      return { kind: "pauseautomode" };
    case "resumeautomode":
      return { kind: "resumeautomode" };
    case "textoff":
      return { kind: "textoff", time: parseIntArg(args.time, 300) };
    case "texton":
      return { kind: "texton" };
    case "position":
      return {
        kind: "position",
        visible: args.visible !== undefined ? args.visible !== "false" : undefined,
        // Image de cadre de la fenêtre de message (`txtwindow02`…), `""` = sans image (#173).
        // `page=back` n'est pas distingué : le port n'a qu'une fenêtre de message.
        ...(args.frame !== undefined ? { frame: args.frame } : {}),
      };
    case "invisibleframe":
      return { kind: "invisibleframe" };
    case "visibleframe":
      return { kind: "visibleframe" };
    case "noise":
      return {
        kind: "noise",
        opacity: parseIntArg(args.opacity, 128),
        monocro: args.monocro === "1" || args.monocro === "true",
        page: parsePageLayer(args.page),
      };
    case "haze":
      return {
        kind: "haze",
        power: parseIntArg(args.power, 5),
        delta: parseIntArg(args.delta, 5),
        omega: parseIntArg(args.omega, 5),
        page: parsePageLayer(args.page),
      };
    case "stophaze":
      return { kind: "stophaze", page: parsePageLayer(args.page) };
    case "shake": {
      // @shake (override TYPE-MOON, tagex.tjs `.shake`) : secousse sinusoïdale. `storage`/`page`
      // visent un calque dans le moteur ; le port applique la secousse à l'écran (approximation).
      const time = argCaseInsensitive(args, "time");
      return {
        kind: "shake",
        vmax: parseIntArg(args.vmax, 10),
        hmax: parseIntArg(args.hmax, 0),
        cycle: Math.max(1, parseIntArg(argCaseInsensitive(args, "cycle"), 300)),
        ...(time === undefined ? {} : { time: parseIntArg(time) }),
      };
    }
    case "swing": {
      // @swing (tagex.tjs `.swing`) : secousse aléatoire continue ; l'arrêt se fait par @stopswing.
      const time = argCaseInsensitive(args, "time");
      const rate = Number.parseFloat(argCaseInsensitive(args, "rate") ?? "");
      return {
        kind: "swing",
        minCycle: Math.max(1, parseIntArg(argCaseInsensitive(args, "mincycle"), 1000)),
        maxCycle: Math.max(1, parseIntArg(argCaseInsensitive(args, "maxcycle"), 2000)),
        minVibration: Math.max(0, parseIntArg(argCaseInsensitive(args, "minvibration"), 5)),
        maxVibration: Math.max(0, parseIntArg(argCaseInsensitive(args, "maxvibration"), 10)),
        rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
        ...(time === undefined ? {} : { time: parseIntArg(time) }),
      };
    }
    case "stopswing":
      return { kind: "stopswing" };
    case "noiseact":
      // @noiseact (noiseplugin.tjs `kt.noiseact`) : action sur les propriétés du bruit.
      return { kind: "noiseact", keyframes: parseNoiseActKeys(args.keys, args.props) };
    case "focusline": {
      // @focusline (focuslineplugin.tjs) : lignes de concentration, approximées en canvas.
      const cmin = parseIntArg(args.cmin, 50);
      const cmax = parseIntArg(args.cmax, 100);
      const lmin = parseIntArg(args.lmin, 25);
      const lmax = parseIntArg(args.lmax, 50);
      const emin = parseIntArg(args.emin, 2000);
      const emax = parseIntArg(args.emax, 2000);
      return {
        kind: "focusline",
        cx: parseIntArg(args.cx, SCREEN_CENTER_X),
        cy: parseIntArg(args.cy, SCREEN_CENTER_Y),
        minLength: Math.max(0, Math.min(cmin, cmax)),
        maxLength: Math.max(0, Math.max(cmin, cmax)),
        minLines: Math.max(0, Math.min(lmin, lmax)),
        maxLines: Math.max(0, Math.max(lmin, lmax)),
        appear: Math.max(0, Math.max(emin, emax)),
        color: parseRgbColorArg(args.color) ?? "#ffffff",
        opacity: Math.min(1, Math.max(0, parseIntArg(args.opacity, 255) / 255)),
        status: args.status ?? "play",
      };
    }
    case "stopfocusline":
      return { kind: "stopfocusline" };
    case "clearfocusline":
      return { kind: "clearfocusline" };
    case "stopnoise":
      return { kind: "stopnoise" };
    case "stopaction":
      return { kind: "stopaction" };
    case "stoptrans":
      return { kind: "stoptrans" };
    case "beginploy":
      return { kind: "beginploy" };
    case "endploy":
      return { kind: "endploy" };
    case "ploysay": {
      // @ploysay mode=lu13 ox=50 oy=-30 : positionne une bulle « ploy » (omake).
      // `mode` est conservé tel quel : sa sémantique vient d'un plugin TJS absent.
      if (!args.mode) {
        return { kind: "raw", command: "ploysay", args } as unknown as Instruction;
      }
      return {
        kind: "ploysay",
        mode: args.mode,
        ox: parseIntArg(args.ox, 0),
        oy: parseIntArg(args.oy, 0),
      };
    }
    case "font":
      return { kind: "font", style: parseFontStyle(args) };
    case "italic":
      // Macro de macro.ks (`@font italic=true`), gérée en natif pour fonctionner
      // même si macro.ks n'est pas chargé.
      return { kind: "font", style: { italic: true } };
    case "resetfont":
    case "rf":
      return { kind: "resetfont" };
    case "staffrollinit":
      return { kind: "staffrollinit", face: args.face };
    case "staffrolltext":
      return {
        kind: "staffrolltext",
        text: args.text ?? "",
        y: parseIntArg(args.y, 0),
        size: parseIntArg(args.size, 16),
        face: args.face,
        cmx: args.cmx !== undefined ? parseIntArg(args.cmx) : undefined,
      };
    case "staffrollstart":
      return {
        kind: "staffrollstart",
        height: parseIntArg(args.height, 10000),
        time: parseIntArg(args.time, 60000),
      };
    case "staffrolluninit":
      // Termine/libère l'affichage des crédits (data/scenario/staffrollplugin.tjs).
      return { kind: "staffrolluninit" };
    case "staffrollsetting":
      // Couleur de fond demandée : stockée, jamais peinte par le plugin d'origine (cf. events.ts).
      return { kind: "staffrollsetting", bgcolor: parseColorArg(args.bgcolor) };
    case "wstaffroll":
      // Attend la fin du défilement (staffrollplugin.tjs : canskip forcé à false).
      return { kind: "waitfor", what: "staffroll", skippable: false };
    case "iscript":
      return { kind: "iscript" };
    case "endscript":
      return { kind: "endscript" };
    case "wait":
      return { kind: "wait", time: parseIntArg(args.time), skippable: args.canskip !== "0" };
    case "wt":
      return {
        kind: "waitfor",
        what: "transition",
        skippable: args.canskip !== "0",
        // Moteur (tagex.tjs) : après l'attente, backlay fore→back sauf `noback=1` (#253).
        noback: args.noback !== undefined && parseKagBool(args.noback),
      };
    case "wact":
      return { kind: "waitfor", what: "animation", skippable: args.canskip !== "0" };
    case "wm":
      return { kind: "waitfor", what: "quake", skippable: args.canskip !== "0" };
    case "jump": {
      // @jump target=*label (intra-script) ou @jump storage=xxx.ks (inter-script)
      // storage est un nom de fichier : on garde la casse et l'extension.
      const target = (args.target ?? "").replace(/^\*/, "") || undefined;
      const storage = args.storage || undefined;
      const cond = args.exp ?? args.cond;
      return { kind: "jump", target, storage, cond };
    }
    case "call": {
      // @call target=*label (intra-script) ou @call storage=xxx.ks (inter-script)
      // storage est un nom de fichier : on garde la casse et l'extension.
      const target = (args.target ?? "").replace(/^\*/, "") || undefined;
      const storage = args.storage || undefined;
      const cond = args.cond;
      return { kind: "call", target, storage, cond };
    }
    case "return":
      return { kind: "return" };
    case "l":
      // @l en commande = pause texte (équivalent au tag [l]).
      return { kind: "text", segments: [{ pause: true }] };
    case "p":
      // @p en commande = pause + page break (comme @pg avec [p]).
      return { kind: "text", segments: [{ pause: true }] };
    case "r":
      // @r en commande = saut de ligne (équivalent au tag [r]).
      return { kind: "break" };
    case "eval": {
      const cond = args.cond;
      return { kind: "eval", expression: args.exp ?? "", cond };
    }
    case "image": {
      // @image : charge une image dans une couche, sans transition (KAG3 standard).
      // `layer=base` (tous les usages du corpus) = fond de la page ; un numéro de couche
      // pose un sprite (approximation : centré, comme @fg).
      const layerArg = args.layer;
      const layerNum = layerArg !== undefined && /^[0-9]+$/.test(layerArg) ? parseInt(layerArg, 10) : undefined;
      const layer: "base" | number = layerNum !== undefined ? layerNum : "base";
      const left = args.left === undefined ? undefined : parseIntArg(args.left, 0);
      const top = args.top === undefined ? undefined : parseIntArg(args.top, 0);
      const opacity = args.opacity === undefined ? undefined : parseIntArg(args.opacity, 255) / 255;
      return {
        kind: "image",
        storage: normStorage(args.storage ?? ""),
        page: parsePageLayer(args.page),
        layer,
        left,
        top,
        opacity,
        visible: args.visible === undefined ? undefined : args.visible !== "0" && args.visible !== "false",
        ...parseAppearanceArgs(args),
      };
    }
    case "chgpartbg": {
      // Change l'image/les paramètres d'un partbg existant (partbgplugin.tjs, `kt.chgpartbg`).
      return {
        kind: "chgpartbg",
        storage: args.storage !== undefined ? normStorage(args.storage) : undefined,
        id: normStorage(args.id) || undefined,
        page: parsePageLayer(args.page),
        time: args.time !== undefined ? parseIntArg(args.time) : undefined,
        rule: args.rule,
        nowait: args.nowait !== undefined && parseKagBool(args.nowait),
        canskip: args.canskip !== undefined ? parseKagBool(args.canskip) : undefined,
        ...parseTransformArgs(args),
        ...parseAppearanceArgs(args),
      };
    }
    case "dispclock": {
      // Horloge in-game (macro.tjs, tagHandlers.dispclock) : fond + 4 aiguilles.
      const zoom = numArg(args.zoom);
      const zoomx = numArg(args.zoomx) ?? zoom ?? 100;
      const zoomy = numArg(args.zoomy) ?? zoom ?? 100;
      const effect = args.effect?.trim();
      return {
        kind: "dispclock",
        h: parseIntArg(args.h, 0),
        m: parseIntArg(args.m, 0),
        left: parseIntArg(args.left, 0),
        top: parseIntArg(args.top, 0),
        zoomx,
        zoomy,
        effect: effect !== undefined && effect !== "" && effect !== "none" ? effect : undefined,
        time: args.time !== undefined ? parseIntArg(args.time) : undefined,
      };
    }
    case "tickclock": {
      // Avance les aiguilles (macro.tjs, tagHandlers.tickclock). Le moteur attend la fin des
      // animations par défaut ; l'attribut `wait` inverse `nowait`.
      const wait = args.wait === undefined ? true : !parseKagBool(args.wait);
      return { kind: "tickclock", h: parseIntArg(args.h, 0), m: parseIntArg(args.m, 0), wait };
    }
    case "setdefaultmessageaction":
      // action continue des messages (`continuousType` du message layer).
      return { kind: "setdefaultmessageaction", type: args.type?.trim() ?? "" };
    case "resetdefaultmessageaction":
      return { kind: "resetdefaultmessageaction" };
    case "current": {
      // @current (KAG3) : couche de message courante (message0/message1) ; le port n'a qu'une
      // textbox, la couche est mémorisée dans l'état (approximation documentée).
      const layer = args.layer === "message0" || args.layer === "message1" ? args.layer : undefined;
      const withBack = args.withback !== undefined && args.withback !== "0" && args.withback !== "false";
      return { kind: "current", ...(layer === undefined ? {} : { layer }), ...(withBack ? { withBack } : {}) };
    }
    case "store":
      // @store (KAG3) : autorise/interdit la sauvegarde et le chargement (défaut : activé).
      return { kind: "store", enabled: args.enabled === undefined || (args.enabled !== "0" && args.enabled !== "false") };
    // No-ops justifiés du registre #275 (effet "aucun", issue #287) : le parser les reconnaît
    // explicitement pour ne pas émettre de warning de commande inconnue. L'audit les classe
    // « ignorée(s) volontairement » via le registre ; les raisons détaillées y sont centralisées.
    case "settracerreturn":
      return { kind: "noop", command: "settracerreturn", reason: "traceur debug : script système sp2.ks non chargé par le player (#287)" };
    case "startchart":
      return { kind: "noop", command: "startchart", reason: "carte de fin de chapitre .gc non modélisée ; scripts système non chargés (#287)" };
    case "loadtimeline":
      return { kind: "noop", command: "loadtimeline", reason: "timelines .tla non converties ; menutest.ks non chargé (#287)" };
    case "action": {
      // @action (tagex.tjs, override/action.tjs) : action animée d'un calque par module.
      // Seul LayerNormalMoveModule a une sémantique complète (startx/x, starty/y, time).
      const storage = args.storage !== undefined ? normStorage(args.storage) : undefined;
      return {
        kind: "action",
        module: args.module?.trim() || "LayerNormalMoveModule",
        page: parsePageLayer(args.page),
        id: args.id !== undefined ? normStorage(args.id) : undefined,
        storage: storage === "" ? undefined : storage,
        startx: numArg(args.startx),
        starty: numArg(args.starty),
        x: numArg(args.x),
        y: numArg(args.y),
        time: parseIntArg(args.time, 0),
        accel: numArg(args.accel),
        delay: args.delay !== undefined ? parseIntArg(args.delay, 0) : undefined,
        nonstop: args.nonstop !== undefined ? parseKagBool(args.nonstop) : false,
      };
    }
    case "removeaction":
      // @removeaction (tagex.tjs) : annule les actions en conservant l'état courant.
      return {
        kind: "removeaction",
        page: parsePageLayer(args.page),
        id: args.id !== undefined ? normStorage(args.id) : undefined,
        storage: args.storage !== undefined ? normStorage(args.storage) : undefined,
      };
    case "pauseaction":
      // @pauseaction (tagex.tjs) : pause de toutes les actions, ou de la cible indiquée.
      return {
        kind: "pauseaction",
        all: args.all !== undefined && parseKagBool(args.all),
        page: parsePageLayer(args.page),
        id: args.id !== undefined ? normStorage(args.id) : undefined,
        storage: args.storage !== undefined ? normStorage(args.storage) : undefined,
      };
    case "resumeaction":
      // @resumeaction (tagex.tjs) : relance des actions en pause.
      return {
        kind: "resumeaction",
        page: parsePageLayer(args.page),
        id: args.id !== undefined ? normStorage(args.id) : undefined,
        storage: args.storage !== undefined ? normStorage(args.storage) : undefined,
      };
    case "pauseploy":
      // @pauseploy (tagex.tjs) : fin de la bulle « ploy » + police par défaut.
      return { kind: "pauseploy" };
    case "resumeploy":
      // @resumeploy (tagex.tjs) : rétablit la bulle « ploy » masquée par @pauseploy.
      return { kind: "resumeploy" };
    case "beginfallnote":
      // @beginfallnote (fallnoteplugin.tjs) : pluie de notes (approximation particules CSS).
      return { kind: "beginfallnote", ...(numArg(args.index) === undefined ? {} : { index: numArg(args.index) }), page: parsePageLayer(args.page) };
    case "fallnoteopt": {
      // @fallnoteopt (fallnoteplugin.tjs) : options de la pluie de notes (seul `rate` approximé).
      const rate = numArg(args.rate);
      return { kind: "fallnoteopt", ...(rate === undefined ? {} : { rate }) };
    }
    case "endfallnote":
      // @endfallnote (fallnoteplugin.tjs) : arrête l'émission de nouvelles notes.
      return { kind: "endfallnote" };
    case "s":
      // @s : arrête le déroulement en attendant une sélection (bouton/lien).
      return { kind: "stop" };
    default:
      if (CONDITIONAL_CLOSERS.has(name)) {
        // @endif/@else/@elsif/@endignore orphelins (aucun @if ne les ouvre dans le script) :
        // dans le moteur, ces tags terminent un bloc et sont sans effet hors bloc.
        return { kind: "noop", command: name, reason: "fermeture de bloc conditionnel sans ouverture" };
      }
      return { kind: "raw", command: name, args };
  }
}

export function parse(tokens: Token[]): ParsedScript {
  const pages: ParsedScript["pages"] = [];
  const labels: ParsedScript["labels"] = {};

  let current: { label?: string; instructions: Instruction[] } = { instructions: [] };

  const labelInstructionIndex: ParsedScript["labelInstructionIndex"] = {};

  // Text accumulation with ruby support
  let pendingSegments: TextSegment[] = [];
  // Pending ruby annotation that applies to the next text characters
  let pendingRuby: string | null = null;
  let pendingRubyCharCount = 1; // how many chars the ruby covers
  // Groupe partagé par les cellules d'une même annotation ruby : permet au rendu de réunir
  // graph + caractères couverts dans un seul <ruby> (#300).
  let pendingRubyGroup: number | null = null;
  let rubyGroupSeq = 0;

  function flushText() {
    if (pendingSegments.length > 0) {
      current.instructions.push({ kind: "text", segments: pendingSegments });
      pendingSegments = [];
    }
    pendingRuby = null;
    pendingRubyGroup = null;
  }

  function pushPage() {
    flushText();
    if (current.instructions.length > 0 || current.label) {
      pages.push(current);
    }
    current = { instructions: [] };
  }

  /**
   * Add text content, applying any pending ruby annotation.
   * [ruby text=ふ] applies to the next character.
   * [ruby char=N text=foo] applies to the next N characters.
   */
  function addText(content: string) {
    if (content.length === 0) return;

    if (pendingRuby !== null) {
      // Ruby sur les N prochains caractères (N peut avoir déjà été entamé par un graph, #300).
      const take = Math.min(pendingRubyCharCount, content.length);
      const rubyText = content.slice(0, take);
      const rest = content.slice(take);
      const continues = take < pendingRubyCharCount;
      if (continues && pendingRubyGroup === null) pendingRubyGroup = ++rubyGroupSeq;
      const group = pendingRubyGroup;
      pendingSegments.push({
        text: rubyText,
        ruby: pendingRuby,
        ...(group === null ? {} : { rubyGroup: group }),
      });
      pendingRubyCharCount -= take;
      if (pendingRubyCharCount <= 0) {
        pendingRuby = null;
        pendingRubyCharCount = 1;
        pendingRubyGroup = null;
      }
      if (rest.length > 0) {
        pendingSegments.push({ text: rest });
      }
    } else {
      pendingSegments.push({ text: content });
    }
  }

  /**
   * Pose une annotation ruby (posée par `[ruby …]`) sur un segment graph/emoji : le moteur compte
   * l'image comme un caractère de base (`putGraph` incrémente `rubyCharCount`, puis `drawRuby`),
   * donc le ruby couvre l'image — pas le texte suivant (#300). Si l'annotation couvre plusieurs
   * cellules, le reliquat reste en attente pour les caractères suivants (même groupe ruby).
   */
  function annotateGraphRuby(segment: TextSegment): TextSegment {
    if (pendingRuby === null || (!("graph" in segment) && !("emoji" in segment))) return segment;
    const ruby = pendingRuby;
    // Groupe utile seulement si l'annotation couvre encore d'autres cellules après l'image.
    if (pendingRubyGroup === null && pendingRubyCharCount > 1) pendingRubyGroup = ++rubyGroupSeq;
    const rubyGroup = pendingRubyGroup === null ? undefined : pendingRubyGroup;
    const annotated: TextSegment =
      "graph" in segment
        ? { graph: { ...segment.graph, ruby, ...(rubyGroup === undefined ? {} : { rubyGroup }) } }
        : "emoji" in segment
          ? { emoji: { ...segment.emoji, ruby, ...(rubyGroup === undefined ? {} : { rubyGroup }) } }
          : segment;
    pendingRubyCharCount -= 1;
    if (pendingRubyCharCount <= 0) {
      pendingRuby = null;
      pendingRubyCharCount = 1;
      pendingRubyGroup = null;
    }
    return annotated;
  }

  /**
   * Parse a sequence of tokens into a flat list of instructions, stopping when
   * one of the given terminator commands is encountered. The terminator token
   * itself is not consumed.
   */
  function parseBlockInstructions(
    tokens: Token[],
    start: number,
    terminators: string[],
  ): { instructions: Instruction[]; terminator: string | null; nextIndex: number } {
    const instructions: Instruction[] = [];
    let blockPending: TextSegment[] = [];
    let blockRuby: string | null = null;
    let blockRubyCharCount = 1;
    let blockRubyGroup: number | null = null;

    function flushBlockText() {
      if (blockPending.length > 0) {
        instructions.push({ kind: "text", segments: blockPending });
        blockPending = [];
      }
      blockRuby = null;
      blockRubyGroup = null;
    }

    function addBlockText(content: string) {
      if (content.length === 0) return;
      if (blockRuby !== null) {
        const take = Math.min(blockRubyCharCount, content.length);
        const rubyText = content.slice(0, take);
        const rest = content.slice(take);
        const continues = take < blockRubyCharCount;
        if (continues && blockRubyGroup === null) blockRubyGroup = ++rubyGroupSeq;
        const group = blockRubyGroup;
        blockPending.push({
          text: rubyText,
          ruby: blockRuby,
          ...(group === null ? {} : { rubyGroup: group }),
        });
        blockRubyCharCount -= take;
        if (blockRubyCharCount <= 0) {
          blockRuby = null;
          blockRubyCharCount = 1;
          blockRubyGroup = null;
        }
        if (rest.length > 0) {
          blockPending.push({ text: rest });
        }
      } else {
        blockPending.push({ text: content });
      }
    }

    /** Même règle que `annotateGraphRuby` pour les graph/emoji d'un bloc conditionnel (#300). */
    function annotateBlockGraphRuby(segment: TextSegment): TextSegment {
      if (blockRuby === null || (!("graph" in segment) && !("emoji" in segment))) return segment;
      const ruby = blockRuby;
      if (blockRubyGroup === null && blockRubyCharCount > 1) blockRubyGroup = ++rubyGroupSeq;
      const rubyGroup = blockRubyGroup === null ? undefined : blockRubyGroup;
      const annotated: TextSegment =
        "graph" in segment
          ? { graph: { ...segment.graph, ruby, ...(rubyGroup === undefined ? {} : { rubyGroup }) } }
          : "emoji" in segment
            ? { emoji: { ...segment.emoji, ruby, ...(rubyGroup === undefined ? {} : { rubyGroup }) } }
            : segment;
      blockRubyCharCount -= 1;
      if (blockRubyCharCount <= 0) {
        blockRuby = null;
        blockRubyCharCount = 1;
        blockRubyGroup = null;
      }
      return annotated;
    }

    let i = start;
    while (i < tokens.length) {
      const token = tokens[i];
      if (token.type === "command" && terminators.includes(token.name)) {
        break;
      }

      switch (token.type) {
        case "command": {
          flushBlockText();
          if (token.name === "if") {
            const { instruction, nextIndex } = parseConditional(tokens, i);
            instructions.push(instruction);
            i = nextIndex;
          } else if (token.name === "macro") {
            const { instruction, nextIndex } = parseMacro(tokens, i);
            instructions.push(instruction);
            i = nextIndex;
          } else if (token.name === "ruby") {
            const rubyArgs = parseRubyArgs(token.args);
            if (rubyArgs.baseText !== undefined) {
              blockPending.push(...rubyBaseSegments(rubyArgs.baseText, rubyArgs.ruby));
              blockRuby = null;
            } else {
              blockRuby = rubyArgs.ruby;
              blockRubyCharCount = rubyArgs.charCount;
              blockRubyGroup = null;
            }
            i++;
          } else {
            instructions.push(parseCommand(token));
            i++;
          }
          break;
        }
        case "tag": {
          if (token.name === "r") {
            flushBlockText();
            instructions.push({ kind: "break" });
          } else if (token.name === "l") {
            blockPending.push({ pause: true });
          } else if (token.name === "ruby") {
            const rubyArgs = parseRubyArgs(token.args);
            if (rubyArgs.baseText !== undefined) {
              blockPending.push(...rubyBaseSegments(rubyArgs.baseText, rubyArgs.ruby));
              blockRuby = null;
              blockRubyGroup = null;
            } else {
              blockRuby = rubyArgs.ruby;
              blockRubyCharCount = rubyArgs.charCount;
              blockRubyGroup = ++rubyGroupSeq;
            }
          } else if (token.name === "graph") {
            const segment = graphSegment(token.args);
            if (segment) blockPending.push(annotateBlockGraphRuby(segment));
            i++;
          } else if (EMOJI_TAGS.has(token.name.toLowerCase())) {
            const segment = emojiSegment(token.name);
            if (segment) blockPending.push(annotateBlockGraphRuby(segment));
            i++;
          } else if (token.name === "cockrobin") {
            // Bloc conditionnel robin masqué par défaut (flags cf.* = false dans le TJS).
            flushBlockText();
            i = skipCockrobinBlock(tokens, i + 1);
            break;
          } else if (token.name.toLowerCase() === "endcockrobin") {
            // Fin de bloc orpheline (bloc déjà ignoré) : sans effet.
            i++;
          } else if (token.name === "p") {
            // [p] = page break inside a block: flush pending text and emit a pause.
            flushBlockText();
            instructions.push({ kind: "text", segments: [{ pause: true }] });
          } else {
            // Inline tags like [chgfg ...], [fg ...], [se ...] are semantically
            // identical to their @command forms. Route through parseCommand.
            flushBlockText();
            instructions.push(
              parseCommand({ type: "command", name: token.name, args: token.args }),
            );
          }
          i++;
          break;
        }
        case "text": {
          addBlockText(token.content);
          i++;
          break;
        }
        case "label": {
          // Labels inside blocks are not valid jump targets; ignore them.
          i++;
          break;
        }
        case "comment":
        case "linebreak": {
          i++;
          break;
        }
      }
    }

    flushBlockText();
    const terminatorToken = tokens[i];
    const terminator =
      terminatorToken && terminatorToken.type === "command" && terminators.includes(terminatorToken.name)
        ? terminatorToken.name
        : null;
    return { instructions, terminator, nextIndex: i };
  }

  function parseConditional(tokens: Token[], start: number): { instruction: Instruction; nextIndex: number } {
    const ifToken = tokens[start] as Extract<Token, { type: "command" }>;
    const branches: Array<{ cond?: string; instructions: Instruction[] }> = [];
    // Le vrai script Mahoyo utilise exp=, pas cond=
    let currentCond: string | undefined = ifToken.args.exp ?? ifToken.args.cond;
    let i = start + 1;

    while (i <= tokens.length) {
      const { instructions, terminator, nextIndex } = parseBlockInstructions(tokens, i, [
        "elsif",
        "else",
        "endif",
      ]);
      branches.push({ cond: currentCond, instructions });

      if (terminator === "elsif") {
        const elsifToken = tokens[nextIndex] as Extract<Token, { type: "command" }>;
        currentCond = elsifToken.args.exp ?? elsifToken.args.cond;
        i = nextIndex + 1;
      } else if (terminator === "else") {
        const elseRes = parseBlockInstructions(tokens, nextIndex + 1, ["endif"]);
        branches.push({ cond: undefined, instructions: elseRes.instructions });
        if (elseRes.terminator !== "endif") {
          console.warn(`Missing @endif for @if starting at token ${start}`);
        }
        return { instruction: { kind: "conditional", branches }, nextIndex: elseRes.nextIndex + 1 };
      } else if (terminator === "endif") {
        return { instruction: { kind: "conditional", branches }, nextIndex: nextIndex + 1 };
      } else {
        console.warn(`Missing @endif for @if starting at token ${start}`);
        return { instruction: { kind: "conditional", branches }, nextIndex: tokens.length };
      }
    }

    console.warn(`Missing @endif for @if starting at token ${start}`);
    return { instruction: { kind: "conditional", branches }, nextIndex: tokens.length };
  }

  function parseMacro(tokens: Token[], start: number): { instruction: Instruction; nextIndex: number } {
    const macroToken = tokens[start] as Extract<Token, { type: "command" }>;
    const name = macroToken.args.name ?? "";
    // Collect raw tokens between @macro and @endmacro for deferred parsing
    // (substitution of %param|default must happen before parseCommand).
    let i = start + 1;
    const rawTokens: Token[] = [];
    let depth = 1; // handle nested @macro
    while (i < tokens.length) {
      const t = tokens[i];
      if (t.type === "command" && t.name === "macro") depth++;
      if (t.type === "command" && t.name === "endmacro") {
        depth--;
        if (depth === 0) break;
      }
      rawTokens.push(t);
      i++;
    }
    if (depth > 0) {
      console.warn(`Missing @endmacro for @macro starting at token ${start}`);
    }
    return {
      instruction: { kind: "macrodef", name, rawTokens },
      nextIndex: i < tokens.length ? i + 1 : tokens.length,
    };
  }

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex];
    switch (token.type) {
      case "command": {
        if (token.name === "pg") {
          // @pg is a page break macro
          pushPage();
        } else if (token.name === "if") {
          flushText();
          const { instruction, nextIndex } = parseConditional(tokens, tokenIndex);
          current.instructions.push(instruction);
          tokenIndex = nextIndex - 1;
        } else if (token.name === "macro") {
          flushText();
          const { instruction, nextIndex } = parseMacro(tokens, tokenIndex);
          current.instructions.push(instruction);
          tokenIndex = nextIndex - 1;
        } else if (token.name === "ruby") {
          // @ruby s'applique au texte qui suit : ne pas vider le tampon de texte ici.
          const rubyArgs = parseRubyArgs(token.args);
          if (rubyArgs.baseText !== undefined) {
            pendingSegments.push(...rubyBaseSegments(rubyArgs.baseText, rubyArgs.ruby));
            pendingRuby = null;
            pendingRubyGroup = null;
          } else {
            pendingRuby = rubyArgs.ruby;
            pendingRubyCharCount = rubyArgs.charCount;
            pendingRubyGroup = null;
          }
        } else {
          flushText();
          current.instructions.push(parseCommand(token));
        }
        break;
      }
      case "tag": {
        if (token.name === "p") {
          pushPage();
        } else if (token.name === "r") {
          flushText();
          current.instructions.push({ kind: "break" });
        } else if (token.name === "l") {
          // [l] is a click-wait marker — insert a pause segment
          pendingSegments.push({ pause: true });
        } else if (token.name === "ruby") {
          // Set pending ruby for next text — DON'T flush here.
          // `char` numérique = nombre de caractères suivants ; `char` chaîne = texte de base
          // affiché (extension TYPE-MOON de tagex.tjs), avec le ruby réparti dessus.
          const rubyArgs = parseRubyArgs(token.args);
          if (rubyArgs.baseText !== undefined) {
            pendingSegments.push(...rubyBaseSegments(rubyArgs.baseText, rubyArgs.ruby));
            pendingRuby = null;
            pendingRubyGroup = null;
          } else {
            pendingRuby = rubyArgs.ruby;
            pendingRubyCharCount = rubyArgs.charCount;
            pendingRubyGroup = null;
          }
        } else if (token.name === "graph") {
          // [graph] : image inline dans le flux de texte (ne vide pas le tampon).
          const segment = graphSegment(token.args);
          if (segment) pendingSegments.push(annotateGraphRuby(segment));
        } else if (EMOJI_TAGS.has(token.name.toLowerCase())) {
          const segment = emojiSegment(token.name);
          if (segment) pendingSegments.push(annotateGraphRuby(segment));
        } else if (token.name === "cockrobin") {
          // Bloc conditionnel robin masqué par défaut (flags cf.* = false dans le TJS).
          flushText();
          tokenIndex = skipCockrobinBlock(tokens, tokenIndex + 1) - 1;
        } else if (token.name.toLowerCase() === "endcockrobin") {
          // Fin de bloc orpheline : sans effet.
        } else {
          // Inline tags like [chgfg ...], [fg ...], [se ...] are semantically
          // identical to their @command forms. Route through parseCommand.
          flushText();
          current.instructions.push(
            parseCommand({ type: "command", name: token.name, args: token.args }),
          );
        }
        break;
      }
      case "label": {
        // Labels are jump targets, not page breaks. Keep the first label
        // of the current page; additional labels in the same page still
        // resolve to the same page index.
        flushText();
        if (!current.label) {
          current.label = token.name;
        }
        labels[token.name] = pages.length;
        labelInstructionIndex[token.name] = current.instructions.length;
        break;
      }
      case "text": {
        addText(token.content);
        break;
      }
      case "comment":
      case "linebreak":
        break;
    }
  }

  pushPage();

  return { pages, labels, labelInstructionIndex };
}
