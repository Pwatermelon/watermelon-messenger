type YMapsApi = {
  ready: (cb?: () => void) => Promise<unknown>;
  Map: new (
    element: HTMLElement | string,
    state: { center: number[]; zoom: number; controls?: string[] },
    options?: Record<string, unknown>
  ) => YMap;
  Placemark: new (
    coords: number[],
    properties?: Record<string, unknown>,
    options?: Record<string, unknown>
  ) => YPlacemark;
};

type YMap = {
  geoObjects: { add: (obj: YPlacemark) => void };
  events: { add: (event: string, cb: (e: YMapEvent) => void) => void };
  setCenter: (center: number[], zoom?: number) => void;
  destroy: () => void;
};

type YPlacemark = {
  geometry: { setCoordinates: (coords: number[]) => void };
};

type YMapEvent = {
  get: (key: string) => unknown;
};

declare global {
  interface Window {
    ymaps?: YMapsApi;
  }
}

let loadPromise: Promise<YMapsApi> | null = null;

export function getYandexMapsApiKey(): string {
  return import.meta.env.VITE_YANDEX_MAPS_API_KEY?.trim() || "";
}

export function loadYandexMaps(): Promise<YMapsApi> {
  if (window.ymaps) return Promise.resolve(window.ymaps);
  if (loadPromise) return loadPromise;

  const apiKey = getYandexMapsApiKey();
  if (!apiKey) {
    return Promise.reject(new Error("Ключ Yandex Maps API не настроен (VITE_YANDEX_MAPS_API_KEY)"));
  }

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
    script.async = true;
    script.onload = () => {
      if (window.ymaps) resolve(window.ymaps);
      else reject(new Error("Yandex Maps API не загрузился"));
    };
    script.onerror = () => reject(new Error("Не удалось загрузить Yandex Maps"));
    document.head.appendChild(script);
  });

  return loadPromise;
}

export function yandexMapsOpenUrl(lat: number, lng: number): string {
  return `https://yandex.ru/maps/?pt=${lng},${lat}&z=16&l=map`;
}

export function yandexMapWidgetUrl(lat: number, lng: number, zoom = 14): string {
  return `https://yandex.ru/map-widget/v1/?ll=${lng},${lat}&z=${zoom}&pt=${lng},${lat},pm2rdm&lang=ru_RU`;
}

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
