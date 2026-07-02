import { useEffect, useState } from "react";
import { resolveMediaBlobUrl } from "../utils/mediaImageCache";

/** Загружает защищённое медиа через fetch+Bearer и отдаёт blob: URL для img/video/audio. */
export function useAuthenticatedMediaSrc(path: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<string | null>(() =>
    path?.startsWith("blob:") ? path : null
  );

  useEffect(() => {
    if (!path) {
      setResolved(null);
      return;
    }
    if (path.startsWith("blob:")) {
      setResolved(path);
      return;
    }
    let cancelled = false;
    setResolved(null);
    void resolveMediaBlobUrl(path).then((url) => {
      if (!cancelled) setResolved(url || null);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return resolved;
}
