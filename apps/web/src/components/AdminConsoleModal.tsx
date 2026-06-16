import { useState } from "react";
import { BrandIcon } from "./BrandIcon";
import AdminPanel from "../pages/AdminPanel";
import { AdminMonitoringPanel } from "./AdminMonitoringPanel";

type TabId = "beta" | "monitoring";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function AdminConsoleModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<TabId>("beta");

  if (!open) return null;

  return (
    <div
      className="admin-console-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Панель администратора"
    >
      <div className="admin-console-modal" onClick={(e) => e.stopPropagation()}>
        <header className="admin-console-header">
          <div className="admin-console-title-wrap">
            <BrandIcon size={28} className="admin-brand-icon" />
            <div>
              <h2 className="admin-console-title">Администрирование</h2>
              <p className="admin-console-subtitle">Beta-доступ и мониторинг</p>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>

        <div className="admin-console-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "beta"}
            className={`admin-console-tab${tab === "beta" ? " admin-console-tab-active" : ""}`}
            onClick={() => setTab("beta")}
          >
            Beta-доступ
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "monitoring"}
            className={`admin-console-tab${tab === "monitoring" ? " admin-console-tab-active" : ""}`}
            onClick={() => setTab("monitoring")}
          >
            Мониторинг
          </button>
        </div>

        <div className="admin-console-body" role="tabpanel">
          {tab === "beta" ? <AdminPanel embedded /> : <AdminMonitoringPanel active={tab === "monitoring"} />}
        </div>
      </div>
    </div>
  );
}
