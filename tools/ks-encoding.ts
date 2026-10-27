/**
 * Détection d'encodage et décodage des scripts .ks KiriKiri.
 *
 * Les scripts KAG peuvent être en UTF-16LE (le plus commun pour Mahoyo),
 * UTF-8, Shift_JIS, ou chiffrés (format KiriKiri avec en-tête FE FE <mode>).
 *
 * Cette fonction unifie la détection qui était dupliquée entre normalize-ks.ts
 * et manifest.ts.
 */
import { deflateSync, inflateSync } from "zlib";

export type KsEncoding =
  | "utf-16le"
  | "utf-16be"
  | "utf-8"
  | "shift_jis"
  | "kirikiri-encrypted-0"
  | "kirikiri-encrypted-1"
  | "kirikiri-encrypted-2"
  | "unknown";

export type DecodeResult = {
  text: string;
  encoding: KsEncoding;
  /** true si un BOM était présent (et a été consommé). */
  bom: boolean;
  /** Nombre de caractères de remplacement (U+FFFD) — indique un décodage douteux. */
  replacementCount: number;
};

/**
 * Décode un buffer .ks en texte UTF-8.
 *
 * Ordre de détection :
 * 1. En-tête chiffré KiriKiri (FE FE <mode>) — avant les BOM
 * 2. BOM UTF-16LE (FF FE)
 * 3. BOM UTF-16BE (FE FF)
 * 4. BOM UTF-8 (EF BB BF)
 * 5. Sans BOM : essai UTF-8 strict, puis heuristique UTF-16LE, puis Shift_JIS
 */
export function decodeKs(buffer: Buffer): DecodeResult {
  if (buffer.length === 0) {
    return { text: "", encoding: "utf-8", bom: false, replacementCount: 0 };
  }

  // 1. En-tête chiffré KiriKiri : FE FE <mode>
  if (buffer.length >= 3 && buffer[0] === 0xfe && buffer[1] === 0xfe) {
    const mode = buffer[2];
    if (mode === 0 || mode === 1 || mode === 2) {
      return decodeKirikiriEncrypted(buffer, mode);
    }
    // FE FE avec un mode inconnu : on ne peut pas décoder.
    return {
      text: "",
      encoding: "unknown",
      bom: false,
      replacementCount: buffer.length,
    };
  }

  // 2. BOM UTF-16LE : FF FE
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    const decoder = new TextDecoder("utf-16le", { fatal: false });
    const text = decoder.decode(buffer.subarray(2));
    return { text, encoding: "utf-16le", bom: true, replacementCount: countReplacements(text) };
  }

  // 3. BOM UTF-16BE : FE FF
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const decoder = new TextDecoder("utf-16be", { fatal: false });
    const text = decoder.decode(buffer.subarray(2));
    return { text, encoding: "utf-16be", bom: true, replacementCount: countReplacements(text) };
  }

  // 4. BOM UTF-8 : EF BB BF
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    const text = buffer.toString("utf-8", 3);
    return { text, encoding: "utf-8", bom: true, replacementCount: countReplacements(text) };
  }

  // 5. Sans BOM : essais successifs.
  // 5a. Heuristique UTF-16LE sans BOM :
  // Les scripts KAG sont très chargés en tags ASCII, donc en UTF-16LE
  // les octets impairs sont majoritairement 0x00. On teste AVANT UTF-8 car
  // les null bytes sont techniquement valides en UTF-8 (U+0000).
  if (buffer.length % 2 === 0 && hasUtf16leSignature(buffer)) {
    const decoder = new TextDecoder("utf-16le", { fatal: false });
    const text = decoder.decode(buffer);
    return { text, encoding: "utf-16le", bom: false, replacementCount: countReplacements(text) };
  }

  // 5b. UTF-8 strict (l'ASCII pur tombe ici sans risque).
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const text = decoder.decode(buffer);
    return { text, encoding: "utf-8", bom: false, replacementCount: 0 };
  } catch {
    // Pas de l'UTF-8 valide → continuer.
  }

  // 5c. Shift_JIS en dernier recours.
  const decoder = new TextDecoder("shift_jis", { fatal: false });
  const text = decoder.decode(buffer);
  return { text, encoding: "shift_jis", bom: false, replacementCount: countReplacements(text) };
}

/**
 * Déchiffre un buffer KiriKiri chiffré.
 * Modes : 0 (XOR), 1 (échange de bits), 2 (zlib).
 *
 * NOTE : Les formules sont basées sur la documentation KiriKiri et n'ont pas
 * été validées sur un vrai fichier chiffré (les .ks de Mahoyo sont en clair).
 * Ce support est défensif.
 */
function decodeKirikiriEncrypted(buffer: Buffer, mode: number): DecodeResult {
  const encoding: KsEncoding = `kirikiri-encrypted-${mode}` as KsEncoding;

  try {
    if (mode === 0 || mode === 1) {
      // Après l'en-tête FE FE <mode>, le reste est de l'UTF-16LE transformé.
      const raw = buffer.subarray(3);
      const chars: number[] = [];
      for (let i = 0; i + 1 < raw.length; i += 2) {
        let ch = raw[i] | (raw[i + 1] << 8);
        if (mode === 0) {
          // Mode 0 : XOR conditionnel.
          if (ch >= 0x20) ch ^= ((ch & 0xfe) << 8) ^ 1;
        } else {
          // Mode 1 : échange de bits (opération auto-inverse).
          ch = ((ch & 0xaaaa) >> 1) | ((ch & 0x5555) << 1);
        }
        chars.push(ch);
      }
      const text = String.fromCharCode(...chars);
      return { text, encoding, bom: false, replacementCount: countReplacements(text) };
    }

    if (mode === 2) {
      // Mode 2 : zlib. Après l'en-tête : deux int64 LE (taille compressée,
      // taille décompressée), puis les données zlib.
      const header = buffer.subarray(3);
      //Lire les tailles (int64 LE = 8 octets chacun).
      const _compressedSize = header.readBigInt64LE(0);
      const _decompressedSize = header.readBigInt64LE(8);
      const zlibData = header.subarray(16);
      const decompressed = inflateSync(zlibData);
      // Le résultat décompressé est de l'UTF-16LE.
      const decoder = new TextDecoder("utf-16le", { fatal: false });
      const text = decoder.decode(decompressed);
      return { text, encoding, bom: false, replacementCount: countReplacements(text) };
    }
  } catch (err) {
    // Échec de déchiffrement.
    return {
      text: "",
      encoding: "unknown",
      bom: false,
      replacementCount: buffer.length,
    };
  }

  return { text: "", encoding: "unknown", bom: false, replacementCount: buffer.length };
}

/**
 * Heuristique : détecte si un buffer sans BOM est probablement de l'UTF-16LE.
 * Vérifie que ≥ 25% des octets impairs (positions 1, 3, 5, ...) des 4 premiers
 * Ko valent 0x00 (signature des caractères ASCII en UTF-16LE).
 */
function hasUtf16leSignature(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let nullCount = 0;
  let oddCount = 0;
  for (let i = 1; i < sample.length; i += 2) {
    oddCount++;
    if (sample[i] === 0x00) nullCount++;
  }
  if (oddCount === 0) return false;
  return nullCount / oddCount >= 0.25;
}

function countReplacements(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (ch === "\uFFFD") count++;
  }
  return count;
}
