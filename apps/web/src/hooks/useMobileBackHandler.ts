import { useEffect, useRef } from "react";

type Options = {
  compact: boolean;
  chatOpen: boolean;
  onCloseChat: () => void;
};

/**
 * На мобилке: системная «Назад» закрывает чат, а не уводит со страницы мессенджера.
 */
export function useMobileBackHandler({ compact, chatOpen, onCloseChat }: Options) {
  const chatLayerRef = useRef(false);
  const onCloseChatRef = useRef(onCloseChat);
  onCloseChatRef.current = onCloseChat;

  useEffect(() => {
    if (!compact) return;
    if (chatOpen && !chatLayerRef.current) {
      window.history.pushState(
        { wmChat: 1 },
        "",
        `${window.location.pathname}${window.location.search}`
      );
      chatLayerRef.current = true;
    }
    if (!chatOpen) {
      chatLayerRef.current = false;
    }
  }, [compact, chatOpen]);

  useEffect(() => {
    if (!compact) return;
    const onPopState = () => {
      if (!chatLayerRef.current) return;
      chatLayerRef.current = false;
      onCloseChatRef.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [compact]);

  function closeChatWithHistory() {
    if (compact && chatLayerRef.current) {
      window.history.back();
      return;
    }
    onCloseChat();
  }

  return { closeChatWithHistory };
}
