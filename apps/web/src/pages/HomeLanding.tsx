import { useEffect } from "react";
import { Link } from "react-router-dom";
import landing from "../../seo-landing.ru.json";
import { BrandIcon } from "../components/BrandIcon";
import { useDocumentScroll } from "../hooks/useDocumentScroll";

/** Публичная главная для гостей — без редиректа на /login (иначе роботы видят noindex). */
export default function HomeLanding() {
  useDocumentScroll();

  useEffect(() => {
    document.getElementById("wm-seo-fallback")?.remove();
  }, []);

  return (
    <div className="home-landing-page">
      <div className="login-bg" aria-hidden />
      <main className="wm-seo-landing home-landing-main">
        <header className="home-landing-brand">
          <BrandIcon size={72} />
          <h1>{landing.headline}</h1>
          <p className="home-landing-tagline">{landing.tagline}</p>
        </header>
        <p className="home-landing-intro">{landing.intro}</p>
        <h2>Возможности</h2>
        <ul>
          {landing.features.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="home-landing-actions">
          <Link to="/login" className="yandex-btn home-landing-cta">
            <span className="yandex-btn-icon">Я</span>
            Войти через Яндекс ID
          </Link>
        </div>
        <h2>Разделы сайта</h2>
        <ul className="home-landing-links">
          {landing.links.map((item) => (
            <li key={item.href}>
              <Link to={item.href}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
