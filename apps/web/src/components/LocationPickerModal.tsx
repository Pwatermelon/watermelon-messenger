import { useEffect, useRef, useState } from "react";
import { IconLocation } from "./Icons";
import { loadYandexMaps } from "../utils/yandexMaps";

type Props = {
  onConfirm: (lat: number, lng: number) => void;
  onCancel: () => void;
};

const DEFAULT_CENTER = { lat: 55.751244, lng: 37.618423 };

type MapHandle = {
  setPoint: (lat: number, lng: number, center?: boolean) => void;
};

export function LocationPickerModal({ onConfirm, onCancel }: Props) {
  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapHandleRef = useRef<MapHandle | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let destroyed = false;
    let map: { destroy: () => void } | null = null;

    void loadYandexMaps()
      .then((ymaps) => ymaps.ready())
      .then(() => {
        if (destroyed || !mapNodeRef.current || !window.ymaps) return;
        const ymaps = window.ymaps;
        let placemark: { geometry: { setCoordinates: (c: number[]) => void } } | null = null;

        const setPoint = (lat: number, lng: number, center = false) => {
          setCoords({ lat, lng });
          const position = [lat, lng];
          if (placemark) {
            placemark.geometry.setCoordinates(position);
          } else {
            const pm = new ymaps.Placemark(position, {}, { preset: "islands#redDotIcon", draggable: true }) as {
              geometry: { setCoordinates: (c: number[]) => void; getCoordinates?: () => number[] };
              events?: { add: (event: string, cb: () => void) => void };
            };
            pm.events?.add("dragend", () => {
              const c = pm.geometry.getCoordinates?.();
              if (c && c.length >= 2) setCoords({ lat: c[0]!, lng: c[1]! });
            });
            placemark = pm;
            mapInst.geoObjects.add(placemark);
          }
          if (center) mapInst.setCenter(position, 14);
        };

        const mapInst = new ymaps.Map(mapNodeRef.current, {
          center: [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng],
          zoom: 11,
          controls: ["zoomControl", "geolocationControl"],
        });

        map = mapInst;
        mapHandleRef.current = { setPoint };

        mapInst.events.add("click", (e) => {
          const c = e.get("coords") as number[];
          if (!c || c.length < 2) return;
          setPoint(c[0]!, c[1]!);
        });

        const finishInit = (lat: number, lng: number) => {
          if (destroyed) return;
          setPoint(lat, lng, true);
          setLoading(false);
        };

        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => finishInit(pos.coords.latitude, pos.coords.longitude),
            () => finishInit(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng)
          );
        } else {
          finishInit(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
        }
      })
      .catch((err: unknown) => {
        if (!destroyed) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить карту");
          setLoading(false);
        }
      });

    return () => {
      destroyed = true;
      mapHandleRef.current = null;
      map?.destroy();
    };
  }, []);

  function useMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        mapHandleRef.current?.setPoint(pos.coords.latitude, pos.coords.longitude, true);
      },
      () => setError("Не удалось определить местоположение")
    );
  }

  return (
    <div
      className="search-overlay location-picker-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="search-modal location-picker-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onCancel} aria-label="Закрыть">
          ×
        </button>
        <h3>Выберите точку на карте</h3>
        <p className="location-picker-hint">Нажмите на карту или перетащите метку</p>
        {error ? (
          <p className="location-picker-error">{error}</p>
        ) : (
          <div className="location-picker-map" ref={mapNodeRef} aria-busy={loading}>
            {loading && <div className="location-picker-loading">Загрузка карты…</div>}
          </div>
        )}
        {coords && (
          <p className="location-picker-coords">
            {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
          </p>
        )}
        <div className="location-picker-actions">
          <button type="button" className="location-picker-geo-btn" onClick={useMyLocation} disabled={Boolean(error)}>
            <IconLocation size={16} /> Моё местоположение
          </button>
          <div className="location-picker-actions-right">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Отмена
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!coords || Boolean(error)}
              onClick={() => coords && onConfirm(coords.lat, coords.lng)}
            >
              Отправить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
