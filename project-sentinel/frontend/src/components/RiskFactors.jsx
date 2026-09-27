export default function RiskFactors({ factors }) {
  const entries = Object.values(factors || {}).sort(
    (a, b) => b.weighted_contribution - a.weighted_contribution
  );

  if (entries.length === 0) {
    return <div className="empty">No factor breakdown returned for this project.</div>;
  }

  return (
    <div className="card" style={{ padding: "6px 20px" }}>
      {entries.map((f) => (
        <div className="factor-row" key={f.name}>
          <div className="factor-name">{f.name}</div>
          <div>
            <div className="factor-track">
              <div className="factor-fill" style={{ width: `${f.normalized_score}%` }} />
            </div>
          </div>
          <div className="factor-score">{Math.round(f.normalized_score)}</div>
        </div>
      ))}
    </div>
  );
}
