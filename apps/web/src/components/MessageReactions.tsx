import type { MessageReaction } from "@melon/shared";

type Props = {
  reactions: MessageReaction[];
  userId?: string;
  onToggle: (emoji: string) => void;
};

export function MessageReactions({ reactions, userId, onToggle }: Props) {
  if (!reactions.length) return null;

  const grouped = new Map<string, { count: number; mine: boolean }>();
  for (const r of reactions) {
    const cur = grouped.get(r.emoji) ?? { count: 0, mine: false };
    cur.count += 1;
    if (r.userId === userId) cur.mine = true;
    grouped.set(r.emoji, cur);
  }

  return (
    <div className="message-reactions">
      {[...grouped.entries()].map(([emoji, { count, mine }]) => (
        <button
          key={emoji}
          type="button"
          className={`message-reaction-chip${mine ? " message-reaction-chip-mine" : ""}`}
          onClick={() => onToggle(emoji)}
        >
          <span>{emoji}</span>
          {count > 1 && <span className="message-reaction-count">{count}</span>}
        </button>
      ))}
    </div>
  );
}
