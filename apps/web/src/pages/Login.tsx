import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getApiUrl } from "../config";
import { BrandIcon } from "../components/BrandIcon";

const ERRORS: Record<string, string> = {
  yandex_denied: "Авторизация отменена",
  yandex_failed: "Не удалось войти через Яндекс",
  yandex_not_configured: "Yandex OAuth не настроен на сервере",
  yandex_no_email:
    "В Яндекс ID не привязана почта. Создайте или привяжите email в настройках Яндекса и войдите снова.",
  yandex_email_conflict: "Эта почта уже привязана к другому аккаунту Watermelon.",
};

export default function Login() {
  const [params] = useSearchParams();
  const errorCode = params.get("error");
  const { user } = useAuth();
  const [oauthReady, setOauthReady] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${getApiUrl()}/auth/yandex/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { configured?: boolean } | null) => setOauthReady(c?.configured ?? false))
      .catch(() => setOauthReady(false));
  }, []);

  if (user) {
    window.location.replace("/");
    return null;
  }

  return (
    <div className="login-page">
      <div className="login-bg" aria-hidden />
      <div className="login-content">
        <div className="login-brand">
          <div className="login-logo">
            <BrandIcon size={88} />
          </div>
          <h1>Watermelon</h1>
          <p className="login-tagline">Безопасный мессенджер нового поколения</p>
        </div>

        <div className="login-card">
          <h2>Вход</h2>
          <p className="login-hint">
            Используйте Яндекс ID — это единственный способ авторизации. В аккаунте Яндекса должна быть
            привязана почта.
          </p>

          {errorCode && ERRORS[errorCode] && (
            <p className="auth-error">{ERRORS[errorCode]}</p>
          )}

          {oauthReady === false ? (
            <button type="button" className="yandex-btn" disabled>
              <span className="yandex-btn-icon">Я</span>
              Yandex OAuth не настроен
            </button>
          ) : (
            <a href="/api/auth/yandex" className="yandex-btn">
              <span className="yandex-btn-icon">Я</span>
              Войти через Яндекс ID
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
