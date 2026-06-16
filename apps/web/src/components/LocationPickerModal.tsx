import { useCallback, useEffect, useRef, useState } from "react";
import { IconLocation } from "./Icons";
import {
  clampZoom,
  latLngToWorldPx,
  osmTileUrl,
  visibleTileRange,
  worldPxToLatLng,
  type LatLng,
} from "../utils/osmMap";

type Props = {
  onConfirm: (lat: number, lng: number) => void;
  onCancel: () => void;
};

const DEFAULT_CENTER: LatLng = { lat: 55.751244, lng: 37.618423 };

export function LocationPickerModal({ onConfirm, onCancel }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, centerX: 0, centerY: 0 });
  const markerDragRef = useRef(false);

  const [center, setCenter] = useState<LatLng>(DEFAULT_CENTER);
  const [marker, setMarker] = useState<LatLng | null>(null);
  const [zoom, setZoom] = useState(13);
  const [mapSize, setMapSize] = useState({ w: 0, h: 0 });
  const [geoLoading, setGeoLoading] = useState(false);
  const [mapError, setMapError] = useState("");

  const updateSize = useCallback(() => {
    const el = mapRef.current;
    if (!el) return;
    setMapSize({ w: el.clientWidth, h: el.clientHeight });
  }, []);

  useEffect(() => {
    updateSize();
    const el = mapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => updateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateSize]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setMarker(DEFAULT_CENTER);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCenter(next);
        setMarker(next);
      },
      () => setMarker(DEFAULT_CENTER),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }, []);

  const setPoint = useCallback((lat: number, lng: number, recenter = false) => {
    const next = { lat, lng };
    setMarker(next);
    if (recenter) setCenter(next);
  }, []);

  const panByPixels = useCallback(
    (dx: number, dy: number) => {
      const z = clampZoom(zoom);
      setCenter((prev) => {
        const c = latLngToWorldPx(prev.lat, prev.lng, z);
        return worldPxToLatLng(c.x - dx, c.y - dy, z);
      });
    },
    [zoom]
  );

  const pointFromClient = useCallback(
    (clientX: number, clientY: number): LatLng | null => {
      const el = mapRef.current;
      if (!el || mapSize.w <= 0 || mapSize.h <= 0) return null;
      const rect = el.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const z = clampZoom(zoom);
      const centerPx = latLngToWorldPx(center.lat, center.lng, z);
      const worldX = centerPx.x + (localX - mapSize.w / 2);
      const worldY = centerPx.y + (localY - mapSize.h / 2);
      return worldPxToLatLng(worldX, worldY, z);
    },
    [center, mapSize, zoom]
  );

  function onMapPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest(".location-picker-marker")) return;
    draggingRef.current = false;
    dragStartRef.current = { x: e.clientX, y: e.clientY, centerX: 0, centerY: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onMapPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (markerDragRef.current) return;
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    if (!draggingRef.current && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      draggingRef.current = true;
    }
    if (!draggingRef.current) return;
    panByPixels(dx - (dragStartRef.current.centerX || 0), dy - (dragStartRef.current.centerY || 0));
    dragStartRef.current = {
      ...dragStartRef.current,
      centerX: dx,
      centerY: dy,
    };
  }

  function onMapPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (markerDragRef.current) return;
    if (!draggingRef.current) {
      const p = pointFromClient(e.clientX, e.clientY);
      if (p) setPoint(p.lat, p.lng);
    }
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function onMarkerPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.stopPropagation();
    markerDragRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onMarkerPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!markerDragRef.current) return;
    const p = pointFromClient(e.clientX, e.clientY);
    if (p) setPoint(p.lat, p.lng);
  }

  function onMarkerPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    markerDragRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

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
        setPoint(lat, lng, true);
        setGeoLoading(false);
      },
      () => {
        setMapError("Не удалось определить местоположение. Разрешите доступ к геолокации в браузере.");
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  const z = clampZoom(zoom);
  const centerPx = latLngToWorldPx(center.lat, center.lng, z);
  const tiles =
    mapSize.w > 0 && mapSize.h > 0
      ? visibleTileRange(mapSize.w, mapSize.h, center, z)
      : null;

  const markerStyle =
    marker && mapSize.w > 0
      ? (() => {
          const p = latLngToWorldPx(marker.lat, marker.lng, z);
          return {
            left: `${mapSize.w / 2 + (p.x - centerPx.x)}px`,
            top: `${mapSize.h / 2 + (p.y - centerPx.y)}px`,
          };
        })()
      : null;

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
        <div className="location-picker-map-wrap">
          <div
            ref={mapRef}
            className="location-picker-map location-picker-osm"
            onPointerDown={onMapPointerDown}
            onPointerMove={onMapPointerMove}
            onPointerUp={onMapPointerUp}
            onPointerCancel={onMapPointerUp}
            role="presentation"
          >
            {tiles &&
              Array.from({ length: tiles.xMax - tiles.xMin + 1 }, (_, xi) =>
                Array.from({ length: tiles.yMax - tiles.yMin + 1 }, (_, yi) => {
                  const x = tiles.xMin + xi;
                  const y = tiles.yMin + yi;
                  const left = mapSize.w / 2 + (x * 256 - centerPx.x);
                  const top = mapSize.h / 2 + (y * 256 - centerPx.y);
                  return (
                    <img
                      key={`${z}-${x}-${y}`}
                      className="location-picker-tile"
                      src={osmTileUrl(z, x, y)}
                      alt=""
                      draggable={false}
                      style={{ left: `${left}px`, top: `${top}px` }}
                    />
                  );
                })
              )}
            {markerStyle && (
              <button
                type="button"
                className="location-picker-marker"
                style={markerStyle}
                aria-label="Метка местоположения"
                onPointerDown={onMarkerPointerDown}
                onPointerMove={onMarkerPointerMove}
                onPointerUp={onMarkerPointerUp}
                onPointerCancel={onMarkerPointerUp}
              >
                <span className="location-picker-marker-pin" />
                <span className="location-picker-marker-shadow" />
              </button>
            )}
          </div>
          <div className="location-picker-zoom">
            <button
              type="button"
              aria-label="Приблизить"
              onClick={() => setZoom((v) => clampZoom(v + 1))}
            >
              +
            </button>
            <button
              type="button"
              aria-label="Отдалить"
              onClick={() => setZoom((v) => clampZoom(v - 1))}
            >
              −
            </button>
          </div>
        </div>
        {marker && (
          <p className="location-picker-coords">
            {marker.lat.toFixed(5)}, {marker.lng.toFixed(5)}
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
              disabled={!marker || geoLoading}
              onClick={() => marker && onConfirm(marker.lat, marker.lng)}
            >
              Отправить
            </button>
          </div>
        </div>
        <p className="location-picker-attribution">
          ©{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap
          </a>
        </p>
      </div>
    </div>
  );
}
