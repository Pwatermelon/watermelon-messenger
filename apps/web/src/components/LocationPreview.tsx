import { useState } from "react";
import { IconLocation } from "./Icons";
import { yandexMapWidgetUrl, yandexMapsOpenUrl, yandexStaticMapUrl } from "../utils/yandexMaps";

type Props = {
  lat: number;
  lng: number;
};

export function LocationPreview({ lat, lng }: Props) {
  const mapUrl = yandexMapsOpenUrl(lat, lng);
  const staticUrl = yandexStaticMapUrl(lat, lng);
  const widgetUrl = yandexMapWidgetUrl(lat, lng);
  const [useWidget, setUseWidget] = useState(!staticUrl);

  return (
    <a
      href={mapUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="message-location-preview"
      title="Открыть в Яндекс Картах"
    >
      <div className="message-location-map-wrap">
        {useWidget ? (
          <iframe
            src={widgetUrl}
            title="Геопозиция"
            className="message-location-widget"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        ) : (
          <img
            src={staticUrl!}
            alt=""
            className="message-location-map"
            onError={() => setUseWidget(true)}
          />
        )}
      </div>
      <span className="message-location-label">
        <IconLocation size={14} /> Геопозиция
      </span>
    </a>
  );
}
