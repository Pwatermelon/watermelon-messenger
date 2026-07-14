import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import "./index.css";
import { registerServiceWorker } from "./lib/pushNotifications";
import { unlockMessageSounds } from "./utils/messageSounds";

const savedTheme = typeof window !== "undefined" && (localStorage.getItem("wm_theme") === "light" || localStorage.getItem("melon_theme") === "light") ? "light" : "dark";
if (typeof document !== "undefined") {
  const html = document.documentElement;
  html.lang = "ru";
  html.setAttribute("translate", "no");
  html.setAttribute("data-theme", savedTheme);
  // SEO-fallback из home.html — только для роботов без JS; убираем до монтирования SPA.
  document.getElementById("wm-seo-fallback")?.remove();
}

registerServiceWorker();

if (typeof document !== "undefined") {
  const unlock = () => unlockMessageSounds();
  document.addEventListener("pointerdown", unlock, { once: true, capture: true });
  document.addEventListener("keydown", unlock, { once: true, capture: true });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </BrowserRouter>
);
