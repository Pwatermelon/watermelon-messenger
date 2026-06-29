type Props = {
  amount: number;
  onClose: () => void;
};

export default function SupportThankYouModal({ amount, onClose }: Props) {
  return (
    <div className="support-thanks-overlay" role="dialog" aria-modal="true" aria-label="Благодарность за поддержку">
      <div className="support-thanks-modal">
        <span className="support-thanks-star" aria-hidden>
          ✦
        </span>
        <h2>Спасибо за поддержку проекта!</h2>
        <p className="support-thanks-lead">
          Благодарим за поддержку — дарим вам{" "}
          <strong className="support-thanks-amount">{amount} Platinum</strong>.
        </p>
        <button type="button" className="btn support-thanks-btn" onClick={onClose}>
          Отлично
        </button>
      </div>
    </div>
  );
}
