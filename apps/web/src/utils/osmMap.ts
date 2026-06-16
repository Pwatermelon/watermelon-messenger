export type LatLng = { lat: number; lng: number };

const TILE_SIZE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
}

export function tileCount(zoom: number): number {
  return 2 ** zoom;
}

export function lngToTileX(lng: number, zoom: number): number {
  const n = tileCount(zoom);
  return ((lng + 180) / 360) * n;
}

export function latToTileY(lat: number, zoom: number): number {
  const n = tileCount(zoom);
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
}

export function tileXToLng(x: number, zoom: number): number {
  const n = tileCount(zoom);
  return (x / n) * 360 - 180;
}

export function tileYToLat(y: number, zoom: number): number {
  const n = tileCount(zoom);
  const rad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return (rad * 180) / Math.PI;
}

/** Pixel offset of lat/lng from map top-left at given zoom (world coords). */
export function latLngToWorldPx(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const x = lngToTileX(lng, zoom) * TILE_SIZE;
  const y = latToTileY(lat, zoom) * TILE_SIZE;
  return { x, y };
}

export function worldPxToLatLng(x: number, y: number, zoom: number): LatLng {
  const tileX = x / TILE_SIZE;
  const tileY = y / TILE_SIZE;
  return {
    lat: tileYToLat(tileY, zoom),
    lng: tileXToLng(tileX, zoom),
  };
}

export function osmTileUrl(z: number, x: number, y: number): string {
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

export function visibleTileRange(
  width: number,
  height: number,
  center: LatLng,
  zoom: number
): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const centerPx = latLngToWorldPx(center.lat, center.lng, zoom);
  const left = centerPx.x - width / 2;
  const top = centerPx.y - height / 2;
  const right = centerPx.x + width / 2;
  const bottom = centerPx.y + height / 2;
  const n = tileCount(zoom);
  const xMin = Math.max(0, Math.floor(left / TILE_SIZE) - 1);
  const xMax = Math.min(n - 1, Math.floor(right / TILE_SIZE) + 1);
  const yMin = Math.max(0, Math.floor(top / TILE_SIZE) - 1);
  const yMax = Math.min(n - 1, Math.floor(bottom / TILE_SIZE) + 1);
  return { xMin, xMax, yMin, yMax };
}
