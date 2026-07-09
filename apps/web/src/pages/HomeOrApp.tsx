import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { WebSocketProvider } from "../context/WebSocketContext";
import { ActiveChatProvider } from "../context/ActiveChatContext";
import ChatLayout from "./ChatLayout";
import HomeLanding from "./HomeLanding";

/** Гость — публичный лендинг на /; авторизованный — мессенджер. */
export default function HomeOrApp() {
  const { user, isLoading, token } = useAuth();

  if (isLoading) {
    return (
      <div className="auth-page">
        <p className="login-hint">Загрузка…</p>
      </div>
    );
  }

  if (!user) return <HomeLanding />;

  if (!user.betaApproved) return <Navigate to="/beta/pending" replace />;

  return (
    <WebSocketProvider token={token}>
      <ActiveChatProvider>
        <ChatLayout />
      </ActiveChatProvider>
    </WebSocketProvider>
  );
}
