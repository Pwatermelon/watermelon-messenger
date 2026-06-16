import { getYandexMapsApiKey } from "./yandexMaps";

export class YandexMapsKeyMissingError extends Error {
  constructor() {
    super("YANDEX_MAPS_KEY_MISSING");
    this.name = "YandexMapsKeyMissingError";
  }
}

export type YandexCoords = [number, number];

export type YandexPlacemark = {
  geometry: {
    setCoordinates: (coords: YandexCoords) => void;
    getCoordinates: () => YandexCoords;
  };
  events: {
    add: (event: string, cb: () => void) => void;
  };
};

export type YandexMap = {
  destroy: () => void;
  geoObjects: {
    add: (obj: YandexPlacemark) => void;
  };
  events: {
    add: (event: string, cb: (e: { get: (key: string) => YandexCoords }) => void) => void;
  };
  setCenter: (coords: YandexCoords, zoom?: number) => void;
};

export type YandexMapsApi = {
  ready: (cb: () => void) => void;
  Map: new (
    element: HTMLElement | string,
    state: { center: YandexCoords; zoom: number; controls?: string[] },
    options?: { suppressMapOpenBlock?: boolean }
  ) => YandexMap;
  Placemark: new (
    coords: YandexCoords,
    properties?: object,
    options?: { draggable?: boolean; preset?: string }
  ) => YandexPlacemark;
};

declare global {
  interface Window {
    ymaps?: YandexMapsApi;
  }
}

let loadPromise: Promise<YandexMapsApi> | null = null;

export function loadYandexMaps(): Promise<YandexMapsApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("YANDEX_MAPS_BROWSER_ONLY"));
  }

  const apiKey = getYandexMapsApiKey();
  if (!apiKey) {
    return Promise.reject(new YandexMapsKeyMissingError());
  }

  if (window.ymaps) {
    return new Promise((resolve) => {
      window.ymaps!.ready(() => resolve(window.ymaps!));
    });
  }

  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
    script.async = true;
    script.onload = () => {
      if (!window.ymaps) {
        reject(new Error("YANDEX_MAPS_LOAD_FAILED"));
        return;
      }
      window.ymaps.ready(() => resolve(window.ymaps!));
    };
    script.onerror = () => reject(new Error("YANDEX_MAPS_LOAD_FAILED"));
    document.head.appendChild(script);
  });

  return loadPromise;
}
