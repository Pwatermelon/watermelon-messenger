import { BETA_LINKS } from "../config/beta";
import { BrandIcon } from "../components/BrandIcon";

export default function BetaWelcome() {
  function enter() {
    localStorage.setItem("wm_beta_welcome_seen", "1");
    window.location.replace("/");
  }

  return (
    <div className="beta-page">
      <div className="beta-bg" aria-hidden />
      <div className="beta-card" data-testid="beta-welcome">
        <div className="beta-logo">
          <BrandIcon size={72} />
        </div>
        <span className="beta-badge">Beta</span>
        <h1>Watermelon на этапе тестирования</h1>
        <p className="beta-lead">
          Спасибо, что вы с нами! Мессенджер активно развивается — возможны баги и изменения интерфейса.
          Следите за новостями в наших соцсетях.
        </p>

        <div className="beta-social">
          <a href={BETA_LINKS.vk} target="_blank" rel="noopener noreferrer" className="beta-social-btn beta-social-vk">
            <span className="beta-social-icon">VK</span>
            ВКонтакте
          </a>
          <a href={BETA_LINKS.telegram} target="_blank" rel="noopener noreferrer" className="beta-social-btn beta-social-tg">
            <span className="beta-social-icon">TG</span>
            Telegram
          </a>
        </div>

        <button type="button" className="beta-enter-btn" data-testid="beta-enter" onClick={enter}>
          Перейти в мессенджер
        </button>
      </div>
    </div>
  );
}
