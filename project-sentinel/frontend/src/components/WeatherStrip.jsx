export default function WeatherStrip({ weather }) {
  if (!weather) return null;

  if (weather.available === false) {
    return (
      <div className="card" style={{ padding: "16px 20px" }}>
        <div className="muted" style={{ fontSize: 13.5 }}>
          No rainfall record for this site yet, so the rainfall factor contributes 0 to the risk
          score until one is added. (Sentinel doesn't borrow another project's rainfall.)
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: "16px 20px", display: "flex", gap: 28, flexWrap: "wrap" }}>
      <div>
        <div className="kicker muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Rainfall, last 30 days</div>
        <div className="mono" style={{ fontSize: 16 }}>{weather.rainfall_30d_total_mm.toFixed(0)} mm</div>
      </div>
      <div>
        <div className="kicker muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Rainfall exposure score</div>
        <div className="mono" style={{ fontSize: 16 }}>{Math.round(weather.rainfall_risk_score)} / 100</div>
      </div>
      <div style={{ maxWidth: "38ch" }}>
        <div className="muted" style={{ fontSize: 12.5 }}>
          Sites with sustained heavy rainfall tend to see schedule slippage that isn't visible
          in a single progress report.
        </div>
      </div>
    </div>
  );
}
