import type { Chat } from "@melon/shared";
import { mediaUrl } from "../utils/mediaUrl";
import { userDisplayName } from "../utils/userDisplay";

type Props = {
  chats: Chat[];
  userId?: string;
  currentChatId?: string;
  onSelect: (chatId: string) => void;
  onClose: () => void;
  sending?: boolean;
};

function chatLabel(chat: Chat, userId?: string): string {
  if (chat.type === "group") return chat.name ?? "Группа";
  const other = chat.members.find((m) => m.id !== userId);
  return other ? userDisplayName(other) : "Диалог";
}

function chatAvatar(chat: Chat, userId?: string): string | null {
  if (chat.type === "group" && chat.avatarUrl) return chat.avatarUrl;
  const other = chat.members.find((m) => m.id !== userId);
  return other?.avatarUrl ?? null;
}

export function ForwardMessageModal({ chats, userId, currentChatId, onSelect, onClose, sending }: Props) {
  const list = chats.filter((c) => c.id !== currentChatId);

  return (
    <div className="search-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="search-modal forward-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} disabled={sending} aria-label="Закрыть">
          ×
        </button>
        <h3>Переслать в…</h3>
        <div className="forward-chat-list">
          {list.length === 0 ? (
            <p className="search-hint">Нет других чатов</p>
          ) : (
            list.map((chat) => {
              const avatar = chatAvatar(chat, userId);
              const label = chatLabel(chat, userId);
              return (
                <button
                  key={chat.id}
                  type="button"
                  className="forward-chat-item"
                  disabled={sending}
                  onClick={() => onSelect(chat.id)}
                >
                  <span className="forward-chat-avatar">
                    {avatar ? (
                      <img src={mediaUrl(avatar)} alt="" />
                    ) : (
                      label.slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <span className="forward-chat-name">{label}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
