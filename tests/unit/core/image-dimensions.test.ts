/**
 * Lecture des dimensions d'images sans décodage (#315) : PNG, WebP (VP8X/VP8/VP8L), JPEG.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { readImageSize } from "@/core/image-dimensions.js";

function pngHeader(width: number, height: number): Uint8Array {
  const data = new Uint8Array(24);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(data.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return data;
}

function webpVp8x(width: number, height: number): Uint8Array {
  const data = new Uint8Array(30);
  const ascii = (s: string, offset: number) => data.set([...s].map((c) => c.charCodeAt(0)), offset);
  ascii("RIFF", 0);
  ascii("WEBP", 8);
  ascii("VP8X", 12);
  const w = width - 1;
  const h = height - 1;
  data[24] = w & 0xff;
  data[25] = (w >> 8) & 0xff;
  data[26] = (w >> 16) & 0xff;
  data[27] = h & 0xff;
  data[28] = (h >> 8) & 0xff;
  data[29] = (h >> 16) & 0xff;
  return data;
}

function webpVp8l(width: number, height: number): Uint8Array {
  const data = new Uint8Array(25);
  const ascii = (s: string, offset: number) => data.set([...s].map((c) => c.charCodeAt(0)), offset);
  ascii("RIFF", 0);
  ascii("WEBP", 8);
  ascii("VP8L", 12);
  data[20] = 0x2f;
  const bits = (width - 1) | ((height - 1) << 14);
  data[21] = bits & 0xff;
  data[22] = (bits >> 8) & 0xff;
  data[23] = (bits >> 16) & 0xff;
  data[24] = (bits >> 24) & 0xff;
  return data;
}

function jpegHeader(width: number, height: number): Uint8Array {
  // SOI + APP0 factice + SOF0 avec dimensions.
  const data = new Uint8Array(20);
  data.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00], 0);
  data.set([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff], 8);
  return data;
}

describe("readImageSize (#315)", () => {
  it("lit les dimensions d'un PNG (IHDR)", () => {
    expect(readImageSize(pngHeader(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });
  it("lit un WebP étendu (VP8X, 24 bits)", () => {
    expect(readImageSize(webpVp8x(1200, 700))).toEqual({ width: 1200, height: 700 });
  });
  it("lit un WebP lossless (VP8L, 14 bits)", () => {
    expect(readImageSize(webpVp8l(800, 600))).toEqual({ width: 800, height: 600 });
  });
  it("lit un JPEG (SOF0)", () => {
    expect(readImageSize(jpegHeader(640, 480))).toEqual({ width: 640, height: 480 });
  });
  it("retourne null pour un format inconnu", () => {
    expect(readImageSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
