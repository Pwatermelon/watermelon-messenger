import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getApiUrl } from "../config";
import { BrandIcon } from "../components/BrandIcon";
import { LEGAL } from "../config/legal";
import { useDocumentScroll } from "../hooks/useDocumentScroll";
import { fetchLegalConfig, yandexLoginUrl, type LegalConfig } from "../lib/legalConfig";

const ERRORS: Record<string, string> = {
  yandex_denied: "Авторизация отменена",
  yandex_failed: "Не удалось войти через Яндекс",
  yandex_not_configured: "Yandex OAuth не настроен на сервере",
  yandex_no_email:
    "В Яндекс ID не привязана почта. Создайте или привяжите email в настройках Яндекса и войдите снова.",
  yandex_email_conflict: "Эта почта уже привязана к другому аккаунту Watermelon.",
  yandex_consent_required:
    "Для входа нужно принять пользовательское соглашение и согласие на обработку персональных данных.",
};

export default function Login() {
  const [params] = useSearchParams();
  const errorCode = params.get("error");
  const accountDeleted = params.get("deleted") === "1";
  const { user } = useAuth();
  const [oauthReady, setOauthReady] = useState<boolean | null>(null);
  const [legalCfg, setLegalCfg] = useState<LegalConfig | null>(null);
  const [pdConsent, setPdConsent] = useState(false);
  useDocumentScroll();

  useEffect(() => {
    fetchLegalConfig()
      .then(setLegalCfg)
      .catch(() => setLegalCfg(null));
  }, []);

  useEffect(() => {
    fetch(`${getApiUrl()}/auth/yandex/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { configured?: boolean } | null) => setOauthReady(c?.configured ?? false))
      .catch(() => setOauthReady(false));
  }, []);

  function handleYandexLogin() {
    if (!pdConsent || !legalCfg) return;
    window.location.href = yandexLoginUrl(legalCfg);
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  const canLogin = oauthReady !== false && pdConsent && legalCfg !== null;

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

          {accountDeleted && (
            <p className="auth-success">Аккаунт удалён. Для входа снова авторизуйтесь через Яндекс ID.</p>
          )}

          {errorCode && ERRORS[errorCode] && (
            <p className="auth-error">{ERRORS[errorCode]}</p>
          )}

          <div className="login-privacy-banner">
            <span>Перед входом ознакомьтесь с </span>
            <Link to="/legal/privacy" target="_blank" rel="noopener noreferrer">
              политикой конфиденциальности
            </Link>
            <span> и другими документами ниже.</span>
          </div>

          <label className="login-consent">
            <input
              type="checkbox"
              checked={pdConsent}
              onChange={(e) => setPdConsent(e.target.checked)}
            />
            <span>
              Я подтверждаю, что ознакомился с документами, даю{" "}
              <Link to="/legal/personal-data-consent" target="_blank" rel="noopener noreferrer">
                согласие на обработку персональных данных
              </Link>
              , принимаю{" "}
              <Link to="/legal/terms" target="_blank" rel="noopener noreferrer">
                пользовательское соглашение
              </Link>{" "}
              и{" "}
              <Link to="/legal/privacy" target="_blank" rel="noopener noreferrer">
                политику конфиденциальности
              </Link>
              . Мне исполнилось 14 лет.
            </span>
          </label>

          {legalCfg && (
            <p className="login-legal-version">
              Версии документов: ПДн {legalCfg.consentVersion}, оферта {legalCfg.termsVersion}, политика{" "}
              {legalCfg.privacyVersion}
            </p>
          )}

          {!pdConsent && oauthReady !== false && (
            <p className="login-consent-required">Отметьте подтверждение выше, чтобы активировать вход.</p>
          )}

          {oauthReady === false ? (
            <button type="button" className="yandex-btn" disabled>
              <span className="yandex-btn-icon">Я</span>
              Yandex OAuth не настроен
            </button>
          ) : (
            <button
              type="button"
              className="yandex-btn"
              disabled={!canLogin}
              onClick={handleYandexLogin}
              aria-disabled={!canLogin}
            >
              <span className="yandex-btn-icon">Я</span>
              Войти через Яндекс ID
            </button>
          )}

          <p className="login-legal-links">
            <Link to="/legal/privacy">Политика конфиденциальности</Link>
            {" · "}
            <Link to="/legal/personal-data-consent">Согласие на ПДн</Link>
            {" · "}
            <Link to="/legal/terms">Пользовательское соглашение</Link>
            {" · "}
            <Link to="/faq">FAQ</Link>
          </p>
          <p className="login-legal-contact">
            Контакт по персональным данным:{" "}
            <a href={`mailto:${LEGAL.operator.email}`}>{LEGAL.operator.email}</a>
          </p>
        </div>
      </div>
    </div>
  );
}
