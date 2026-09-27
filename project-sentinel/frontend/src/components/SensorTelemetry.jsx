const STATUS_TO_BADGE = {
  healthy: "low",
  warning: "medium",
  critical: "high",
};

const STATUS_LABEL = {
  healthy: "Healthy",
  warning: "Watch",
  critical: "Critical",
};

function figureClass(value, alert, critical) {
  if (value >= critical) return "flag";
  if (value >= alert) return "";
  return "verified";
}

export default function SensorTelemetry({ health }) {
  if (!health) {
    return <div className="loading-note">Loading structural telemetry…</div>;
  }

  const badge = STATUS_TO_BADGE[health.status] || "medium";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span className={`risk-badge ${badge}`}>
          <span className="dot" />
          {STATUS_LABEL[health.status] || health.status}
        </span>
        <span className="muted mono" style={{ fontSize: 12.5 }}>
          Asset {health.asset_id} · updated {health.last_updated}
        </span>
      </div>

      <div className="stat-strip">
        <div className="stat-cell">
          <div className="stat-label">Health score</div>
          <div className={`stat-figure ${health.current_health_score < 45 ? "flag" : health.current_health_score >= 75 ? "verified" : ""}`}>
            {health.current_health_score.toFixed(0)}
          </div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Vibration RMS</div>
          <div className={`stat-figure ${figureClass(health.vibration_rms ?? 0, 4.5, 7.1)}`}>
            {health.vibration_rms != null ? health.vibration_rms.toFixed(1) : "—"}
            <span style={{ fontSize: 13, fontWeight: 500 }}> mm/s</span>
          </div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Temperature</div>
          <div className={`stat-figure ${figureClass(health.temperature_c ?? 0, 55, 68)}`}>
            {health.temperature_c != null ? health.temperature_c.toFixed(0) : "—"}
            <span style={{ fontSize: 13, fontWeight: 500 }}>°C</span>
          </div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Structural strain</div>
          <div className={`stat-figure ${figureClass(health.strain_microstrain ?? 0, 800, 1400)}`}>
            {health.strain_microstrain != null ? health.strain_microstrain.toFixed(0) : "—"}
            <span style={{ fontSize: 13, fontWeight: 500 }}> με</span>
          </div>
        </div>
      </div>

      <div className="muted" style={{ fontSize: 12.5, marginTop: 12, maxWidth: "68ch" }}>
        Statistical anomaly z-score: <span className="mono">{health.anomaly_z_score.toFixed(2)}σ</span> against a rolling window.
        Telemetry is simulated ({health.data_source}) rather than read from live IoT hardware, and is generated
        from each project's own delay/budget/schedule figures rather than at random — it's a stand-in for real
        sensors, not a claim that physical sensors are installed on site.
      </div>
    </div>
  );
}
