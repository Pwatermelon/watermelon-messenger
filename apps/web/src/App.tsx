import { Routes, Route, Navigate, Outlet, useParams } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { WebSocketProvider } from "./context/WebSocketContext";
import { ActiveChatProvider } from "./context/ActiveChatContext";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import BetaWelcome from "./pages/BetaWelcome";
import BetaPending from "./pages/BetaPending";
import Platinum from "./pages/Platinum";
import ChatLayout from "./pages/ChatLayout";
import ChatLegacyRedirect from "./pages/ChatLegacyRedirect";
import IconPreview from "./pages/IconPreview";

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
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/platinum" element={<Platinum />} />
      <Route path="/icon" element={<IconPreview />} />

      <Route path="/beta/pending" element={<AuthRequired><BetaPending /></AuthRequired>} />
      <Route path="/beta/welcome" element={<AuthRequired><BetaWelcome /></AuthRequired>} />
      <Route path="/admin" element={<Navigate to="/" replace />} />

      <Route element={<AuthRequired><MessengerLayout /></AuthRequired>}>
        <Route path="/" element={<ChatLayout />} />
        <Route path="chat/:chatId" element={<ChatLegacyRedirect />} />
        <Route path="settings" element={<Navigate to="/" replace state={{ openSettings: true }} />} />
        <Route path="profile" element={<Navigate to="/" replace state={{ openProfile: null }} />} />
        <Route path="profile/:userId" element={<ProfileRedirect />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
