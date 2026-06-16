import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { getAdminUsers, approveUser, revokeUser, type AdminUser } from "../api";
import { BrandIcon } from "../components/BrandIcon";

type Props = {
  embedded?: boolean;
};

export default function AdminPanel({ embedded = false }: Props) {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.isAdmin) return;
    const timer = setTimeout(() => {
      load(search);
    }, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [user?.isAdmin, search]);

  async function load(q: string) {
    setLoading(true);
    setError("");
    try {
      setUsers(await getAdminUsers(q.trim() || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(id: string) {
    setActionId(id);
    try {
      await approveUser(id);
      await load(search);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setActionId(null);
    }
  }

  async function handleRevoke(id: string) {
    setActionId(id);
    try {
      await revokeUser(id);
      await load(search);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setActionId(null);
    }
  }

  const { pending, approved } = useMemo(() => {
    const p = users.filter((u) => !u.betaApproved);
    const a = users.filter((u) => u.betaApproved);
    return { pending: p, approved: a };
  }, [users]);

  if (!user?.isAdmin) {
    if (embedded) {
      return <p className="admin-console-muted">Нет доступа</p>;
    }
    return (
      <div className="admin-page">
        <div className="admin-denied">
          <h1>Нет доступа</h1>
          <p>Эта панель только для администраторов.</p>
        </div>
      </div>
    );
  }

  const content = (
    <>
      {!embedded && (
        <header className="admin-header">
          <div>
            <h1 className="admin-title">
              <BrandIcon size={32} className="admin-brand-icon" />
              Beta-доступ
            </h1>
            <p>Заявки пользователей Яндекс ID — только логины</p>
          </div>
        </header>
      )}

      <div className={embedded ? "admin-embedded-search-wrap" : "admin-search-wrap"}>
        <input
          type="search"
          className="admin-search"
          placeholder="Поиск по логину…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {error && <p className="admin-error">{error}</p>}

      {loading ? (
        <p className="admin-loading">Загрузка…</p>
      ) : (
        <>
          <section className="admin-section">
            <h2>Ожидают ({pending.length})</h2>
            {pending.length === 0 ? (
              <p className="admin-empty">{search ? "Ничего не найдено" : "Нет заявок"}</p>
            ) : (
              <ul className="admin-user-list">
                {pending.map((u) => (
                  <AdminUserRow
                    key={u.id}
                    u={u}
                    busy={actionId === u.id}
                    onApprove={() => handleApprove(u.id)}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="admin-section">
            <h2>Доступ открыт ({approved.length})</h2>
            {approved.length === 0 ? (
              <p className="admin-empty">{search ? "Ничего не найдено" : "Пока никого"}</p>
            ) : (
              <ul className="admin-user-list">
                {approved.map((u) => (
                  <AdminUserRow
                    key={u.id}
                    u={u}
                    busy={actionId === u.id}
                    approved
                    onRevoke={u.isAdmin ? undefined : () => handleRevoke(u.id)}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );

  if (embedded) return <div className="admin-embedded">{content}</div>;

  return <div className="admin-page">{content}</div>;
}

function AdminUserRow({
  u,
  busy,
  approved,
  onApprove,
  onRevoke,
}: {
  u: AdminUser;
  busy: boolean;
  approved?: boolean;
  onApprove?: () => void;
  onRevoke?: () => void;
}) {
  return (
    <li className="admin-user-row">
      <span className="admin-login">
        {u.yandexLogin}
        {u.isAdmin && <span className="admin-tag">admin</span>}
      </span>
      <div className="admin-user-actions">
        {!approved && onApprove && (
          <button type="button" className="admin-btn admin-btn-approve" disabled={busy} onClick={onApprove}>
            {busy ? "…" : "Дать доступ"}
          </button>
        )}
        {approved && onRevoke && (
          <button type="button" className="admin-btn admin-btn-revoke" disabled={busy} onClick={onRevoke}>
            {busy ? "…" : "Закрыть"}
          </button>
        )}
      </div>
    </li>
  );
}
