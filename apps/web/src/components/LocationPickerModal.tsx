import { useEffect, useRef, useState } from "react";
import { IconLocation } from "./Icons";
import {
  loadYandexMaps,
  YandexMapsKeyMissingError,
  type YandexMap,
  type YandexPlacemark,
} from "../utils/loadYandexMaps";

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
  const [geoLoading, setGeoLoading] = useState(false);
  const [mapError, setMapError] = useState("");

  useEffect(() => {
    const mapNode = mapNodeRef.current;
    if (!mapNode) return;

    let destroyed = false;
    let map: YandexMap | null = null;
    let placemark: YandexPlacemark | null = null;

    const finishInit = (lat: number, lng: number) => {
      if (destroyed) return;
      mapHandleRef.current?.setPoint(lat, lng, true);
      setLoading(false);
    };

    loadYandexMaps()
      .then((ymaps) => {
        if (destroyed || !mapNodeRef.current) return;

        const setPoint = (lat: number, lng: number, center = false) => {
          const point: [number, number] = [lat, lng];
          setCoords({ lat, lng });
          if (placemark) {
            placemark.geometry.setCoordinates(point);
          } else if (map) {
            placemark = new ymaps.Placemark(
              point,
              {},
              { draggable: true, preset: "islands#redCircleDotIcon" }
            );
            placemark.events.add("dragend", () => {
              const [nextLat, nextLng] = placemark!.geometry.getCoordinates();
              setCoords({ lat: nextLat, lng: nextLng });
            });
            map.geoObjects.add(placemark);
          }
          if (center && map) map.setCenter(point, 14);
        };

        map = new ymaps.Map(
          mapNodeRef.current,
          {
            center: [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng],
            zoom: 11,
            controls: ["zoomControl"],
          },
          { suppressMapOpenBlock: true }
        );

        map.events.add("click", (e) => {
          const [lat, lng] = e.get("coords");
          setPoint(lat, lng);
        });

        mapHandleRef.current = { setPoint };

        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => finishInit(pos.coords.latitude, pos.coords.longitude),
            () => finishInit(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
            { enableHighAccuracy: true, timeout: 12000 }
          );
        } else {
          finishInit(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
        }
      })
      .catch((err: unknown) => {
        if (destroyed) return;
        if (err instanceof YandexMapsKeyMissingError) {
          setMapError("Не настроен ключ Яндекс Карт (VITE_YANDEX_MAPS_API_KEY)");
        } else {
          setMapError("Не удалось загрузить Яндекс Карты");
        }
        setLoading(false);
      });

    return () => {
      destroyed = true;
      mapHandleRef.current = null;
      map?.destroy();
      map = null;
      placemark = null;
    };
  }, []);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setMapError("Геолокация не поддерживается в этом браузере");
      return;
    }
    setGeoLoading(true);
    setMapError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        mapHandleRef.current?.setPoint(lat, lng, true);
        setGeoLoading(false);
      },
      () => {
        setMapError("Не удалось определить местоположение. Разрешите доступ к геолокации в браузере.");
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
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
        <p className="location-picker-hint">
          Яндекс Карты — нажмите на карту, перетащите метку или отправьте своё местоположение
        </p>
        {mapError ? <p className="location-picker-error">{mapError}</p> : null}
        <div className="location-picker-map-wrap">
          {loading && <div className="location-picker-loading">Загрузка карты…</div>}
          <div className="location-picker-map" ref={mapNodeRef} aria-busy={loading} />
        </div>
        {coords && (
          <p className="location-picker-coords">
            {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
          </p>
        )}
        <div className="location-picker-actions">
          <button type="button" className="location-picker-geo-btn" onClick={useMyLocation} disabled={geoLoading}>
            <IconLocation size={16} /> {geoLoading ? "Определяем…" : "Моё местоположение"}
          </button>
          <div className="location-picker-actions-right">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Отмена
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!coords || geoLoading || !!mapError}
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
