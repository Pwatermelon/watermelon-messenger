export function getYandexMapsApiKey(): string {
  return import.meta.env.VITE_YANDEX_MAPS_API_KEY?.trim() || "";
}

export function yandexMapsOpenUrl(lat: number, lng: number): string {
  return `https://yandex.ru/maps/?pt=${lng},${lat}&z=16&l=map`;
}

export function yandexMapWidgetUrl(lat: number, lng: number, zoom = 14): string {
  return `https://yandex.ru/map-widget/v1/?ll=${lng},${lat}&z=${zoom}&pt=${lng},${lat},pm2rdm&lang=ru_RU`;
}

/** Static preview; без ключа в чате используется iframe-виджет Яндекса */
export function yandexStaticMapUrl(lat: number, lng: number, width = 400, height = 200, zoom = 15): string | null {
  const apiKey = getYandexMapsApiKey();
  if (!apiKey) return null;
  const ll = `${lng},${lat}`;
  const pt = `${lng},${lat},pm2rdm`;
  return `https://static-maps.yandex.ru/v1?ll=${ll}&size=${width},${height}&z=${zoom}&pt=${pt}&lang=ru_RU&apikey=${encodeURIComponent(apiKey)}`;
}

export function parseLocationCoords(
  content: string,
  metadata?: { lat?: number; lng?: number } | null
): { lat: number; lng: number } | null {
  if (metadata?.lat != null && metadata?.lng != null) {
    return { lat: metadata.lat, lng: metadata.lng };
  }
  const m = content.match(/(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
