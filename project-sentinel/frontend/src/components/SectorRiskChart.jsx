import { useState } from "react";

// Average composite risk score per sector. Single series, one hue; each bar's
// value is printed as text, and hovering/focusing a row lists its projects.
export default function SectorRiskChart({ projects }) {
  const [active, setActive] = useState(null);

  const sectors = Object.values(
    projects.reduce((acc, p) => {
      (acc[p.sector] ||= { sector: p.sector, items: [] }).items.push(p);
      return acc;
    }, {})
  )
    .map((s) => ({ ...s, avg: s.items.reduce((t, p) => t + p.riskScore, 0) / s.items.length }))
    .sort((a, b) => b.avg - a.avg);

  return (
    <div className="card sector-chart" role="list" aria-label="Average risk score by sector">
      {sectors.map((s) => (
        <div
          key={s.sector}
          role="listitem"
          tabIndex={0}
          className={`sector-row ${active === s.sector ? "active" : ""}`}
          onMouseEnter={() => setActive(s.sector)}
          onMouseLeave={() => setActive(null)}
          onFocus={() => setActive(s.sector)}
          onBlur={() => setActive(null)}
          aria-label={`${s.sector}: average risk ${Math.round(s.avg)} out of 100 across ${s.items.length} projects`}
        >
          <div className="sector-label">
            {s.sector}
            <span className="muted mono"> · {s.items.length}</span>
          </div>
          <div className="sector-track">
            <div className="sector-fill" style={{ width: `${s.avg}%` }} />
          </div>
          <div className="sector-value mono">{Math.round(s.avg)}</div>

          {active === s.sector && (
            <div className="sector-tip" role="tooltip">
              {[...s.items]
                .sort((a, b) => b.riskScore - a.riskScore)
                .map((p) => (
                  <div key={p.id} className="sector-tip-row">
                    <span>{p.name}</span>
                    <span className="mono">{p.riskScore}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      ))}
      <div className="muted sector-foot">
        Average composite risk score (0–100) per sector. Hover or focus a row to see its projects.
      </div>
    </div>
  );
}
