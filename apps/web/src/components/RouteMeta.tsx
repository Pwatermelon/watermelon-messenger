import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { applyPageMeta, getPageMeta } from "../lib/pageMeta";

/** Обновляет title и meta description при смене маршрута (SPA). */
export default function RouteMeta() {
  const { pathname } = useLocation();

  useEffect(() => {
    applyPageMeta(getPageMeta(pathname));
  }, [pathname]);

  return null;
}
