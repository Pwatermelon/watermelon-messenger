import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { IconLocation } from "./Icons";

type Props = {
  onConfirm: (lat: number, lng: number) => void;
  onCancel: () => void;
};

const DEFAULT_CENTER = { lat: 55.751244, lng: 37.618423 };

const PICKER_MARKER = L.divIcon({
  className: "location-picker-marker",
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

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
    if (!mapNodeRef.current) return;

    let destroyed = false;
    const map = L.map(mapNodeRef.current, { zoomControl: true }).setView(
      [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng],
      11
    );

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    let marker: L.Marker | null = null;

    const setPoint = (lat: number, lng: number, center = false) => {
      setCoords({ lat, lng });
      if (marker) {
        marker.setLatLng([lat, lng]);
      } else {
        marker = L.marker([lat, lng], { draggable: true, icon: PICKER_MARKER }).addTo(map);
        marker.on("dragend", () => {
          const p = marker!.getLatLng();
          setCoords({ lat: p.lat, lng: p.lng });
        });
      }
      if (center) map.setView([lat, lng], 14);
    };

    map.on("click", (e) => setPoint(e.latlng.lat, e.latlng.lng));
    mapHandleRef.current = { setPoint };

    const finishInit = (lat: number, lng: number) => {
      if (destroyed) return;
      setPoint(lat, lng, true);
      setLoading(false);
      requestAnimationFrame(() => map.invalidateSize());
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => finishInit(pos.coords.latitude, pos.coords.longitude),
        () => finishInit(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
        { enableHighAccuracy: true, timeout: 12000 }
      );
    } else {
      finishInit(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
    }

    return () => {
      destroyed = true;
      mapHandleRef.current = null;
      map.remove();
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
          OpenStreetMap — нажмите на карту, перетащите метку или отправьте своё местоположение
        </p>
        {mapError ? <p className="location-picker-error">{mapError}</p> : null}
        <div className="location-picker-map" ref={mapNodeRef} aria-busy={loading}>
          {loading && <div className="location-picker-loading">Загрузка карты…</div>}
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
              disabled={!coords || geoLoading}
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
