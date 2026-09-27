const LABELS = {
  low: "Low risk",
  medium: "Watch",
  high: "High risk",
};

export default function RiskBadge({ level }) {
  const key = (level || "low").toLowerCase();
  return (
    <span className={`risk-badge ${key}`}>
      <span className="dot" />
      {LABELS[key] || level}
    </span>
  );
}
