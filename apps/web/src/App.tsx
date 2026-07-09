import { Routes, Route, Navigate, Outlet, useParams } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { WebSocketProvider } from "./context/WebSocketContext";
import { ActiveChatProvider } from "./context/ActiveChatContext";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import BetaWelcome from "./pages/BetaWelcome";
import BetaPending from "./pages/BetaPending";
import HomeOrApp from "./pages/HomeOrApp";
import ChatLegacyRedirect from "./pages/ChatLegacyRedirect";
import IconPreview from "./pages/IconPreview";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import PersonalDataConsent from "./pages/PersonalDataConsent";
import TermsOfService from "./pages/TermsOfService";
import Faq from "./pages/Faq";
import NotFound from "./pages/NotFound";
import CookieBanner from "./components/CookieBanner";
import YandexMetrika from "./components/YandexMetrika";
import LegalGate from "./components/LegalGate";
import RouteMeta from "./components/RouteMeta";

function AuthRequired({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="auth-page"><p className="login-hint">Загрузка…</p></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function MessengerLayout() {
  const { user, token } = useAuth();
  if (!user?.betaApproved) return <Navigate to="/beta/pending" replace />;
  return (
    <WebSocketProvider token={token}>
      <ActiveChatProvider>
        <Outlet />
      </ActiveChatProvider>
    </WebSocketProvider>
  );
}

function ProfileRedirect() {
  const { userId } = useParams();
  return <Navigate to="/" replace state={{ openProfile: userId ?? null }} />;
}

export default function App() {
  return (
    <LegalGate>
      <YandexMetrika />
      <RouteMeta />
      <CookieBanner />
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/icon" element={<IconPreview />} />
      <Route path="/legal/privacy" element={<PrivacyPolicy />} />
      <Route path="/legal/personal-data-consent" element={<PersonalDataConsent />} />
      <Route path="/legal/terms" element={<TermsOfService />} />
      <Route path="/faq" element={<Faq />} />

      <Route path="/beta/pending" element={<AuthRequired><BetaPending /></AuthRequired>} />
      <Route path="/beta/welcome" element={<AuthRequired><BetaWelcome /></AuthRequired>} />
      <Route path="/admin" element={<Navigate to="/" replace />} />

      <Route path="/" element={<HomeOrApp />} />

      <Route element={<AuthRequired><MessengerLayout /></AuthRequired>}>
        <Route path="chat/:chatId" element={<ChatLegacyRedirect />} />
        <Route path="settings" element={<Navigate to="/" replace state={{ openSettings: true }} />} />
        <Route path="profile" element={<Navigate to="/" replace state={{ openProfile: null }} />} />
        <Route path="profile/:userId" element={<ProfileRedirect />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
    </LegalGate>
  );
}
