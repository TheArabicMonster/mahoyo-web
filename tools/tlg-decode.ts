/**
 * Décodeur d'images TLG (KiriKiri) écrit pour le projet, sans dépendance externe.
 *
 * Formats pris en charge :
 *  - `TLG0.0` (conteneur « sds ») : en-tête `TLG0.0\0sds\x1a`, taille des données
 *    (u32 LE), image TLG interne, puis tags éventuels (ignorés) ;
 *  - `TLG5.0` (« raw ») : image découpée en bandes de `blockHeight` lignes, chaque
 *    composante (B, G, R, [A]) compressée par LZSS (fenêtre de 4096 octets) ;
 *  - `TLG6.0` : reconnu mais non décodé (Golomb-Rice + prédicteurs), voir
 *    `TlgUnsupportedError`. Utiliser `--tlg-cmd` avec un convertisseur externe.
 *
 * Le décodeur ne produit que des pixels RGBA 8 bits ; `encodePng` les écrit en PNG
 * avec le zlib de Node (aucune dépendance lourde).
 */
import { deflateSync } from "zlib";

export type TlgImage = {
  width: number;
  height: number;
  /** 3 (BGR) ou 4 (BGRA) composantes dans le fichier source. */
  channels: 3 | 4;
  /** Pixels RGBA, `width * height * 4` octets, lignes de haut en bas. */
  rgba: Uint8Array;
};

/** Format reconnu mais non pris en charge par ce décodeur (ex. TLG6). */
export class TlgUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TlgUnsupportedError";
  }
}

/** Fichier corrompu ou qui n'est pas un TLG. */
export class TlgFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TlgFormatError";
  }
}

const MAGIC_LEN = 11;
const TLG0_SDS_MAGIC = "TLG0.0\0sds\x1a";
const TLG5_MAGIC = "TLG5.0\0raw\x1a";
const TLG6_MAGIC = "TLG6.0\0raw\x1a";
const WINDOW_SIZE = 4096;

function magicOf(buf: Uint8Array, offset = 0): string {
  let s = "";
  for (let i = 0; i < MAGIC_LEN && offset + i < buf.length; i++) s += String.fromCharCode(buf[offset + i]);
  return s;
}

/** Indique si le tampon commence par une signature TLG connue (TLG0.0, TLG5.0, TLG6.0). */
export function isTlg(buf: Uint8Array): boolean {
  const m = magicOf(buf);
  return m === TLG0_SDS_MAGIC || m === TLG5_MAGIC || m === TLG6_MAGIC;
}

/**
 * Décompresse un flux LZSS de TLG5 dans `out`.
 *
 * Le flux est une suite de groupes : un octet de drapeaux (bit 0 d'abord), puis pour
 * chaque bit soit un littéral (bit à 0), soit une référence (bit à 1) codée sur deux
 * octets : position dans la fenêtre sur 12 bits, longueur - 3 sur 4 bits ; la longueur
 * 18 est étendue par un octet supplémentaire. La fenêtre (4096 octets) et sa position
 * d'écriture `r` se poursuivent d'une composante et d'une bande à l'autre.
 *
 * @returns la nouvelle position d'écriture dans la fenêtre
 */
export function lzssDecompress(
  input: Uint8Array,
  out: Uint8Array,
  window: Uint8Array,
  startR: number,
): number {
  let r = startR;
  let ip = 0;
  let op = 0;
  let flags = 0;
  const inLen = input.length;
  const outLen = out.length;

  while (ip < inLen) {
    flags >>= 1;
    if ((flags & 256) === 0) {
      flags = input[ip++] | 0xff00;
    }
    if (flags & 1) {
      if (ip + 2 > inLen) throw new TlgFormatError("LZSS : référence tronquée");
      let mpos = input[ip] | ((input[ip + 1] & 0x0f) << 8);
      let mlen = ((input[ip + 1] & 0xf0) >> 4) + 3;
      ip += 2;
      if (mlen === 18) {
        if (ip >= inLen) throw new TlgFormatError("LZSS : longueur étendue tronquée");
        mlen += input[ip++];
      }
      if (op + mlen > outLen) throw new TlgFormatError("LZSS : dépassement du tampon de sortie");
      while (mlen-- > 0) {
        const c = window[mpos];
        out[op++] = c;
        window[r] = c;
        mpos = (mpos + 1) & (WINDOW_SIZE - 1);
        r = (r + 1) & (WINDOW_SIZE - 1);
      }
    } else {
      if (op >= outLen) throw new TlgFormatError("LZSS : dépassement du tampon de sortie");
      const c = input[ip++];
      out[op++] = c;
      window[r] = c;
      r = (r + 1) & (WINDOW_SIZE - 1);
    }
  }
  if (op !== outLen) throw new TlgFormatError(`LZSS : ${op} octets décodés au lieu de ${outLen}`);
  return r;
}

/** Décode une image TLG5.0 « raw » commençant à `offset`. */
function decodeTlg5(buf: Uint8Array, offset: number): TlgImage {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = offset + MAGIC_LEN;
  if (p + 13 > buf.length) throw new TlgFormatError("TLG5 : en-tête tronqué");
  const channels = buf[p];
  const width = view.getUint32(p + 1, true);
  const height = view.getUint32(p + 5, true);
  const blockHeight = view.getUint32(p + 9, true);
  p += 13;

  if (channels !== 3 && channels !== 4) {
    throw new TlgFormatError(`TLG5 : nombre de composantes non pris en charge (${channels})`);
  }
  if (width === 0 || height === 0 || blockHeight === 0) throw new TlgFormatError("TLG5 : dimensions nulles");
  if (width * height > 1 << 28) throw new TlgFormatError("TLG5 : image démesurée");

  const blockCount = Math.floor((height - 1) / blockHeight) + 1;
  // Table des tailles de bandes : on lit les bandes à la suite, la table est sautée.
  p += blockCount * 4;

  const rgba = new Uint8Array(width * height * 4);
  const window = new Uint8Array(WINDOW_SIZE);
  let r = 0;
  /** Dernière ligne reconstruite (4 octets par pixel), pour le prédicteur vertical. */
  const prev = new Uint8Array(width * 4);
  const comps: Uint8Array[] = [];

  for (let by = 0; by < height; by += blockHeight) {
    const rows = Math.min(blockHeight, height - by);
    const size = rows * width;
    comps.length = 0;
    for (let c = 0; c < channels; c++) {
      if (p + 5 > buf.length) throw new TlgFormatError("TLG5 : bande tronquée");
      const mark = buf[p];
      const len = view.getUint32(p + 1, true);
      p += 5;
      if (p + len > buf.length) throw new TlgFormatError("TLG5 : données de bande tronquées");
      const data = buf.subarray(p, p + len);
      p += len;
      const comp = new Uint8Array(size);
      if (mark === 0) {
        r = lzssDecompress(data, comp, window, r);
      } else {
        if (len !== size) throw new TlgFormatError("TLG5 : bande brute de taille inattendue");
        comp.set(data);
      }
      comps.push(comp);
    }

    for (let y = 0; y < rows; y++) {
      const base = y * width;
      const dst = (by + y) * width * 4;
      // Prédicteur : pixel = valeur du dessus + cumul horizontal des différences ;
      // décorrélation des couleurs : B et R sont stockés relativement à G.
      let pb = 0;
      let pg = 0;
      let pr = 0;
      let pa = 0;
      for (let x = 0; x < width; x++) {
        const g = comps[1][base + x];
        const b = (comps[0][base + x] + g) & 0xff;
        const rr = (comps[2][base + x] + g) & 0xff;
        pb = (pb + b) & 0xff;
        pg = (pg + g) & 0xff;
        pr = (pr + rr) & 0xff;
        const o = x * 4;
        const vb = (prev[o] + pb) & 0xff;
        const vg = (prev[o + 1] + pg) & 0xff;
        const vr = (prev[o + 2] + pr) & 0xff;
        let va: number;
        if (channels === 4) {
          pa = (pa + comps[3][base + x]) & 0xff;
          va = (prev[o + 3] + pa) & 0xff;
        } else {
          va = 0xff;
        }
        // Mémorise la ligne (ordre B, G, R, A) puis écrit en RGBA.
        prev[o] = vb;
        prev[o + 1] = vg;
        prev[o + 2] = vr;
        prev[o + 3] = channels === 4 ? va : 0;
        rgba[dst + o] = vr;
        rgba[dst + o + 1] = vg;
        rgba[dst + o + 2] = vb;
        rgba[dst + o + 3] = va;
      }
    }
  }

  return { width, height, channels, rgba };
}

/** Décode un fichier TLG (TLG0.0 enveloppant du TLG5, ou TLG5 direct). */
export function decodeTlg(buf: Uint8Array): TlgImage {
  const magic = magicOf(buf);
  if (magic === TLG0_SDS_MAGIC) {
    // Conteneur : 11 octets de signature, taille des données (u32), puis l'image interne.
    const inner = MAGIC_LEN + 4;
    if (buf.length < inner + MAGIC_LEN) throw new TlgFormatError("TLG0.0 : conteneur tronqué");
    const innerMagic = magicOf(buf, inner);
    if (innerMagic === TLG5_MAGIC) return decodeTlg5(buf, inner);
    if (innerMagic === TLG6_MAGIC) throw new TlgUnsupportedError("TLG6.0 (dans TLG0.0) non pris en charge");
    throw new TlgFormatError(`TLG0.0 : image interne inconnue (${JSON.stringify(innerMagic)})`);
  }
  if (magic === TLG5_MAGIC) return decodeTlg5(buf, 0);
  if (magic === TLG6_MAGIC) throw new TlgUnsupportedError("TLG6.0 non pris en charge");
  throw new TlgFormatError("signature TLG inconnue (fichier chiffré ou autre format)");
}

// ── Écriture PNG ──

let crcTable: Uint32Array | undefined;

function crc32(data: Uint8Array, seed = 0xffffffff): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = seed;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}

/** Encode des pixels RGBA 8 bits en PNG (filtre 0, zlib de Node). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) throw new Error("encodePng : taille de tampon incohérente");
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

/** Convertit un fichier TLG en PNG. */
export function tlgToPng(buf: Uint8Array): Buffer {
  const img = decodeTlg(buf);
  return encodePng(img.width, img.height, img.rgba);
}
