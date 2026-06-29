import { useCallback, useEffect, useState } from "react";
import { getCoinBalance } from "../api";
import { useAuth } from "../context/AuthContext";
import { getPlatinumAckBalance, setPlatinumAckBalance } from "../utils/platinumAck";

export function usePlatinumBalance(userId: string | undefined) {
  const { user } = useAuth();
  const [balance, setBalance] = useState(user?.coinBalance ?? 0);
  const [thankYouAmount, setThankYouAmount] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const { coins } = await getCoinBalance();
      setBalance(coins);

      const ack = getPlatinumAckBalance(userId);
      if (ack === null) {
        setPlatinumAckBalance(userId, coins);
        setThankYouAmount(null);
        return;
      }
      if (coins > ack) {
        setThankYouAmount(coins - ack);
      } else {
        setThankYouAmount(null);
      }
    } catch {
      /* ignore */
    }
  }, [userId]);

  const dismissThankYou = useCallback(() => {
    if (!userId) return;
    setPlatinumAckBalance(userId, balance);
    setThankYouAmount(null);
  }, [userId, balance]);

  useEffect(() => {
    setBalance(user?.coinBalance ?? 0);
  }, [user?.coinBalance]);

  useEffect(() => {
    if (!userId) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, refresh]);

  return { balance, thankYouAmount, dismissThankYou };
}
