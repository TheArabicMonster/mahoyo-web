const ASSET_BASE = "/assets";

export function resolveBackground(storage: string): string {
  return `${ASSET_BASE}/bg/${storage}.webp`;
}

export function resolveImage(storage: string): string {
  return `${ASSET_BASE}/image/${storage}.webp`;
}

export function resolveBgm(storage: string): string {
  return `${ASSET_BASE}/bgm/${storage}.ogg`;
}

export function resolveSe(storage: string): string {
  return `${ASSET_BASE}/se/${storage}.ogg`;
}
