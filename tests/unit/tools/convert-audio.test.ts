/**
 * Tests de la conversion audio WAV → Opus/Ogg (ou AAC/.m4a) du pipeline (#387).
 *
 * Les tests d'encodage réel sont skippés si `ffmpeg` n'est pas disponible ; les tests de
 * construction d'arguments et de nommage ne dépendent que du code.
 *
 * @vitest-environment node
 */
import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AAC_BITRATE,
  AUDIO_OUTPUT_EXT,
  DURATION_TOLERANCE_MS,
  OPUS_BITRATE_MONO,
  OPUS_BITRATE_STEREO,
  convertAudio,
  convertAudioFile,
  ffmpegAudioArgs,
  probeAudioChannels,
  probeDurationMs,
} from "../../../tools/convert-audio.js";

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const skipIfNoFfmpeg = HAS_FFMPEG ? it : it.skip;

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Génère un WAV de test avec ffmpeg (lavfi sine). */
function makeWav(dir: string, name: string, options: { mono?: boolean; seconds?: number } = {}): string {
  const path = join(dir, name);
  mkdirSync(join(dir), { recursive: true });
  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:duration=${options.seconds ?? 0.5}`,
    ...(options.mono ? ["-ac", "1"] : ["-ac", "2"]),
    "-ar",
    "44100",
    path,
  ];
  const result = spawnSync("ffmpeg", args, { stdio: "ignore" });
  if (result.status !== 0) throw new Error(`ffmpeg n'a pas pu générer ${path}`);
  return path;
}

describe("ffmpegAudioArgs / extensions", () => {
  it("utilise libopus 96 kbps stéréo, 64 kbps mono, conteneur Ogg", () => {
    expect(ffmpegAudioArgs("in.wav", "out.ogg", "opus", 2)).toEqual([
      "-y",
      "-i",
      "in.wav",
      "-c:a",
      "libopus",
      "-b:a",
      "96k",
      "-vbr",
      "on",
      "-f",
      "ogg",
      "out.ogg",
    ]);
    expect(ffmpegAudioArgs("in.wav", "out.ogg", "opus", 1)).toContain("64k");
    expect(OPUS_BITRATE_STEREO).toBe(96_000);
    expect(OPUS_BITRATE_MONO).toBe(64_000);
  });

  it("utilise AAC .m4a (repli Safari) conteneur ipod", () => {
    const args = ffmpegAudioArgs("in.wav", "out.m4a", "aac", 2);
    expect(args).toContain("aac");
    expect(args).toContain("128k");
    expect(args).toContain("ipod");
    expect(AUDIO_OUTPUT_EXT).toEqual({ opus: ".ogg", aac: ".m4a" });
    expect(AAC_BITRATE).toBe(128_000);
    expect(DURATION_TOLERANCE_MS).toBe(20);
  });
});

describe("convertAudioFile", () => {
  skipIfNoFfmpeg("convertit un WAV stéréo en Opus/Ogg, durée à ±20 ms, poids fortement réduit", async () => {
    const dir = makeTempDir("mahoyo-opus-stereo-");
    const input = makeWav(dir, "se01.wav", { seconds: 1 });
    const output = join(dir, "se01.ogg");

    const result = await convertAudioFile(input, output, { format: "opus" });

    expect(statSync(output).size).toBeGreaterThan(0);
    expect(statSync(output).size).toBeLessThan(statSync(input).size / 5);
    expect(result.channels).toBe(2);
    expect(result.bitrateKbps).toBe(96);
    expect(result.durationDeltaMs).not.toBeNull();
    expect(Math.abs(result.durationDeltaMs!)).toBeLessThanOrEqual(DURATION_TOLERANCE_MS);
    // Durées réellement lues par ffprobe, des deux côtés.
    const inMs = await probeDurationMs(input);
    const outMs = await probeDurationMs(output);
    expect(Math.abs(outMs! - inMs!)).toBeLessThanOrEqual(DURATION_TOLERANCE_MS);
  });

  skipIfNoFfmpeg("convertit un WAV mono en Opus 64 kbps", async () => {
    const dir = makeTempDir("mahoyo-opus-mono-");
    const input = makeWav(dir, "se_mono.wav", { mono: true, seconds: 0.5 });
    const output = join(dir, "se_mono.ogg");

    const result = await convertAudioFile(input, output, { format: "opus" });

    expect(result.channels).toBe(1);
    expect(result.bitrateKbps).toBe(64);
    expect((await probeAudioChannels(input))).toBe(1);
  });

  skipIfNoFfmpeg("produit un .m4a AAC pour le repli Safari", async () => {
    const dir = makeTempDir("mahoyo-aac-");
    const input = makeWav(dir, "se_aac.wav", { seconds: 0.5 });
    const output = join(dir, "se_aac.m4a");

    await convertAudioFile(input, output, { format: "aac" });
    expect(statSync(output).size).toBeGreaterThan(0);
    // ffprobe reconnaît un flux audio dans le .m4a.
    expect(await probeDurationMs(output)).toBeGreaterThan(0);
  });
});

describe("convertAudio (parcours par dossiers)", () => {
  skipIfNoFfmpeg("convertit les WAV et copie les OGG existants (BGM non réencodées)", async () => {
    const dir = makeTempDir("mahoyo-convert-audio-");
    const inputDir = join(dir, "input");
    const outputDir = join(dir, "output");
    makeWav(join(inputDir, "sound"), "se01.wav", { seconds: 0.3 });
    mkdirSync(join(inputDir, "bgm"), { recursive: true });
    writeFileSync(join(inputDir, "bgm", "m01.ogg"), Buffer.from("fake-ogg-data"));

    const report = await convertAudio({ inputDir, outputDir, format: "opus" });

    expect(report.audios).toHaveLength(2);
    expect(report.converted).toBe(2);
    expect(statSync(join(outputDir, "sound", "se01.ogg")).size).toBeGreaterThan(0);
    // OGG existant copié tel quel (contenu intact, pas de réencodage).
    expect(statSync(join(outputDir, "bgm", "m01.ogg")).size).toBe(Buffer.from("fake-ogg-data").length);
  });

  skipIfNoFfmpeg("produit des .m4a avec format aac (manifeste = extension réelle)", async () => {
    const dir = makeTempDir("mahoyo-convert-audio-aac-");
    const inputDir = join(dir, "input");
    const outputDir = join(dir, "output");
    makeWav(join(inputDir, "se"), "se02.wav", { seconds: 0.3 });

    const report = await convertAudio({ inputDir, outputDir, format: "aac" });

    expect(report.converted).toBe(1);
    expect(statSync(join(outputDir, "se", "se02.m4a")).size).toBeGreaterThan(0);
  });
});
