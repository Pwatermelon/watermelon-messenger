import { useCallback, useEffect, useState } from "react";
import { getGrafanaDashboards, prepareGrafanaSession, type GrafanaDashboard } from "../api";
import { getApiUrl } from "../config";

type Props = {
  active: boolean;
};

export function AdminMonitoringPanel({ active }: Props) {
  const [dashboards, setDashboards] = useState<GrafanaDashboard[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sessionReady, setSessionReady] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await prepareGrafanaSession();
      setSessionReady(true);
      const list = await getGrafanaDashboards();
      setDashboards(list);
      setSelectedUid((prev) => prev ?? list[0]?.uid ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось открыть мониторинг");
      setSessionReady(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  const current = dashboards.find((d) => d.uid === selectedUid) ?? dashboards[0];
  const iframeSrc = sessionReady && current ? `${getApiUrl()}${current.embedPath}` : null;

  if (loading) {
    return <p className="admin-console-muted">Загрузка мониторинга…</p>;
  }

  if (error) {
    return (
      <div className="admin-console-error-wrap">
        <p className="admin-console-error">{error}</p>
        <button type="button" className="btn-secondary" onClick={() => void load()}>
          Повторить
        </button>
      </div>
    );
  }

  return (
    <div className="admin-monitoring">
      <div className="admin-monitoring-tabs" role="tablist" aria-label="Дашборды">
        {dashboards.map((d) => (
          <button
            key={d.uid}
            type="button"
            role="tab"
            aria-selected={d.uid === current?.uid}
            className={`admin-monitoring-tab${d.uid === current?.uid ? " admin-monitoring-tab-active" : ""}`}
            onClick={() => setSelectedUid(d.uid)}
          >
            {d.title}
          </button>
        ))}
      </div>
      {iframeSrc ? (
        <iframe
          key={iframeSrc}
          title={current?.title ?? "Мониторинг"}
          src={iframeSrc}
          className="admin-monitoring-frame"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <p className="admin-console-muted">Нет дашбордов</p>
      )}
    </div>
  );
}
