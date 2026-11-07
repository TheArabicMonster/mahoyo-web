/**
 * KAG3 parser — transforms tokens into a list of "pages" that can be executed
 * by the runtime.
 *
 * Page boundaries are: @pg/[p] (page break), end of input.
 */

import type { AnimationDef, CropSpec, Instruction, ParsedScript, TextSegment, TextStyle, Token, TransformArgs } from "./types.js";
import { storageKey } from "@/core/storage-key.js";
import { parseActionKeys } from "./action.js";

/** Centre de l'écran dans le repère logique 1024×576 : position d'un calque sans `center`/`vcenter`. */
const SCREEN_CENTER_X = 512;
const SCREEN_CENTER_Y = 288;

function parseIntArg(value: string | undefined, fallback = 0): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Normalise un argument storage via storageKey. "" si absent. */
/** `true`/`1` → true, `false`/`0` → false, autre → undefined (attribut ignoré). */
function parseBoolArg(value: string | undefined): boolean | undefined {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

/** `0xRRGGBB` ou `#rrggbb` → `#rrggbb` ; toute autre valeur → undefined. */
function parseColorArg(value: string | undefined): string | undefined {
  const m = value?.trim().match(/^(?:0x|#)([0-9a-f]{6})$/i);
  return m ? `#${m[1].toLowerCase()}` : undefined;
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
function parseTransformArgs(args: Record<string, string>): TransformArgs {
  const num = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined;
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : undefined;
  };
  const zoom = num(args.zoom);
  const zoomx = num(args.zoomx) ?? zoom;
  const zoomy = num(args.zoomy) ?? zoom;
  const rotate = num(args.rotate);
  const out: TransformArgs = {};
  if (zoomx !== undefined) out.zoomx = zoomx;
  if (zoomy !== undefined) out.zoomy = zoomy;
  if (rotate !== undefined) out.rotate = rotate;
  return out;
}

function parsePageLayer(value: string | undefined): "fore" | "back" | undefined {
  if (value === "fore" || value === "back") return value;
  return undefined;
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
      };
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
      if (args.scene === undefined) return { kind: "raw", command: "playtimeline", args } as unknown as Instruction;
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
    case "iscript":
      return { kind: "iscript" };
    case "endscript":
      return { kind: "endscript" };
    case "wait":
      return { kind: "wait", time: parseIntArg(args.time), skippable: args.canskip !== "0" };
    case "wt":
      return { kind: "waitfor", what: "transition", skippable: args.canskip !== "0" };
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
    default:
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

  function flushText() {
    if (pendingSegments.length > 0) {
      current.instructions.push({ kind: "text", segments: pendingSegments });
      pendingSegments = [];
    }
    pendingRuby = null;
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
      // Apply ruby to the first N characters
      const rubyText = content.slice(0, pendingRubyCharCount);
      const rest = content.slice(pendingRubyCharCount);

      pendingSegments.push({ text: rubyText, ruby: pendingRuby });
      pendingRuby = null;
      pendingRubyCharCount = 1;

      if (rest.length > 0) {
        pendingSegments.push({ text: rest });
      }
    } else {
      pendingSegments.push({ text: content });
    }
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

    function flushBlockText() {
      if (blockPending.length > 0) {
        instructions.push({ kind: "text", segments: blockPending });
        blockPending = [];
      }
      blockRuby = null;
    }

    function addBlockText(content: string) {
      if (content.length === 0) return;
      if (blockRuby !== null) {
        const rubyText = content.slice(0, blockRubyCharCount);
        const rest = content.slice(blockRubyCharCount);
        blockPending.push({ text: rubyText, ruby: blockRuby });
        blockRuby = null;
        blockRubyCharCount = 1;
        if (rest.length > 0) {
          blockPending.push({ text: rest });
        }
      } else {
        blockPending.push({ text: content });
      }
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
            blockRuby = token.args.text ?? null;
            blockRubyCharCount = parseIntArg(token.args.char, 1);
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
          // Set pending ruby for next text — DON'T flush here
          // The ruby applies to the next N characters of text
          pendingRuby = token.args.text ?? null;
          pendingRubyCharCount = parseIntArg(token.args.char, 1);
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
