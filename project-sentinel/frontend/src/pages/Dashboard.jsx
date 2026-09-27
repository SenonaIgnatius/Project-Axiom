import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { listProjects } from "../lib/api.js";
import RiskBadge from "../components/RiskBadge.jsx";
import SectorRiskChart from "../components/SectorRiskChart.jsx";

function formatCrore(value) {
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(2)} lakh cr`;
  return `₹${Math.round(value).toLocaleString("en-IN")} cr`;
}

export default function Dashboard() {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="error-note">
        Couldn't reach the backend — is it running at http://127.0.0.1:8000? ({error})
      </div>
    );
  }

  if (!projects) {
    return <div className="loading-note">Loading project register…</div>;
  }

  const pastDeadline = projects.filter((p) => (p.delayMonths || 0) > 0).length;
  const overrun = projects.reduce((sum, p) => sum + ((p.revisedCost || 0) - (p.originalCost || 0)), 0);
  const originalTotal = projects.reduce((sum, p) => sum + (p.originalCost || 0), 0);
  const flagged = projects.filter(
    (p) => Math.abs(p.reportedProgress - p.verifiedProgress) >= 12 || p.mismatchRedFlag
  ).length;
  const totalRevised = projects.reduce((sum, p) => sum + (p.revisedCost || p.sanctionedCost || 0), 0);

  return (
    <>
      <div className="hero">
        <div className="eyebrow">
          <span className="dot" />
          PAIMANA flash report · December 2025
        </div>
        <h1>
          What's actually happening <span className="accent">on site</span>
        </h1>
        <p className="hero-sub">
          Reported figures come straight from the government's own PAIMANA report — every one links
          to the page it came from. Sentinel then checks them against evidence the implementing agency
          doesn't control: site photos and satellite imagery.
        </p>

        <div className="stat-strip">
          <div className="stat-cell">
            <div className="stat-label">Monitored projects</div>
            <div className="stat-figure">{projects.length}</div>
            <div className="stat-sub">from PAIMANA, Dec 2025</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Past original deadline</div>
            <div className="stat-figure flag">
              {pastDeadline}
              <span style={{ fontSize: 16, color: "var(--muted)" }}> / {projects.length}</span>
            </div>
            <div className="stat-sub">revised completion later than original</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Cost overrun vs. original</div>
            <div className="stat-figure">{formatCrore(overrun)}</div>
            {originalTotal > 0 && (
              <div className="stat-sub">+{Math.round((overrun / originalTotal) * 100)}% over original cost</div>
            )}
          </div>
          <div className="stat-cell">
            <div className="stat-label">Flagged for review</div>
            <div className="stat-figure flag">{flagged}</div>
            <div className="stat-sub">reported vs. verified gap ≥ 12 pts</div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Risk by sector</h2>
          <span className="hint">composite score, 0–100</span>
        </div>
        <SectorRiskChart projects={projects} />
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Project register</h2>
          <span className="hint">{formatCrore(totalRevised)} revised cost · PAIMANA Dec 2025</span>
        </div>

        {projects.length === 0 ? (
          <div className="empty">No projects seeded yet.</div>
        ) : (
          <>
            <div className="table-scroll">
            <table className="register">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Sector</th>
                  <th>State</th>
                  <th>Reported</th>
                  <th>Verified*</th>
                  <th>Delay</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} onClick={() => navigate(`/projects/${p.id}`)}>
                    <td>
                      <div className="proj-name">
                        {p.name}
                        {p.reportNote && <span className="dq-dot" title="Data-quality flag in the source report"> ⚑</span>}
                      </div>
                      <div className="proj-id mono">{p.id} · PAIMANA {p.projectCode}</div>
                    </td>
                    <td>{p.sector}</td>
                    <td>{p.state}</td>
                    <td className="mono">{p.reportedProgress}%</td>
                    <td className="mono">{p.verifiedProgress}%</td>
                    <td className="mono">{p.delayMonths ? `${p.delayMonths} mo` : "—"}</td>
                    <td>
                      <RiskBadge level={p.riskLevel} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
              * Verified figures are illustrative stand-ins until live satellite/photo verification is
              run for each site — uploading a site photo replaces one with a real YOLOv8 estimate.
              Delay is the report's revised completion date minus its original one.{" "}
              <Link to="/provenance">What's real and what isn't →</Link>
            </div>
          </>
        )}
      </div>
    </>
  );
}
