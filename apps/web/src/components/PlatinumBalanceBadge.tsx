type Props = {
  balance: number;
};

export default function PlatinumBalanceBadge({ balance }: Props) {
  return (
    <div className="sidebar-platinum-balance" title="Platinum за поддержку проекта">
      <span className="sidebar-platinum-star" aria-hidden>
        ✦
      </span>
      <span className="sidebar-platinum-amount">{balance}</span>
    </div>
  );
}
