import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  getProject,
  getRiskBreakdown,
  getSatelliteChangeDetection,
  getWeather,
  getAssetHealth,
} from "../lib/api.js";
import RiskBadge from "../components/RiskBadge.jsx";
import DiscrepancyPanel from "../components/DiscrepancyPanel.jsx";
import SatelliteCompare from "../components/SatelliteCompare.jsx";
import RiskFactors from "../components/RiskFactors.jsx";
import PhotoVerify from "../components/PhotoVerify.jsx";
import WeatherStrip from "../components/WeatherStrip.jsx";
import SensorTelemetry from "../components/SensorTelemetry.jsx";
import EscalationPanel from "../components/EscalationPanel.jsx";

export default function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [risk, setRisk] = useState(null);
  const [satellite, setSatellite] = useState(null);
  const [weather, setWeather] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setProject(null);
    setRisk(null);
    setSatellite(null);
    setWeather(null);
    setHealth(null);
    setError(null);

    getProject(id).then(setProject).catch((e) => setError(e.message));
    getRiskBreakdown(id).then(setRisk).catch(() => {});
    getSatelliteChangeDetection(id).then(setSatellite).catch(() => {});
    getWeather(id).then(setWeather).catch(() => {});
    getAssetHealth(id).then(setHealth).catch(() => {});
  }, [id]);

  if (error) {
    return <div className="error-note">Couldn't load this project — {error}</div>;
  }

  if (!project) {
    return <div className="loading-note">Loading…</div>;
  }

  return (
    <>
      <Link to="/" className="back-link">
        ← Project register
      </Link>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>{project.name}</h1>
          <div className="muted mono" style={{ fontSize: 13 }}>
            {project.id} · {project.sector} · {project.state}
          </div>
          {project.projectCode && (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
              PAIMANA {project.projectCode}{project.agency ? ` · ${project.agency}` : ""}
            </div>
          )}
        </div>
        <RiskBadge level={project.riskLevel} />
      </div>

      <div style={{ height: 28 }} />

      <div className="section">
        <div className="eyebrow">01 · CLAIM VS. EVIDENCE</div>
        <div className="section-head">
          <h2>Reported vs. verified progress</h2>
        </div>
        <DiscrepancyPanel project={project} />
      </div>

      <div className="section">
        <div className="eyebrow">02 · SITE IMAGERY</div>
        <div className="section-head">
          <h2>Satellite evidence</h2>
          <span className="hint">drag to compare</span>
        </div>
        {satellite ? (
          <SatelliteCompare data={satellite} />
        ) : (
          <div className="loading-note">Loading satellite record…</div>
        )}
      </div>

      <div className="section">
        <div className="eyebrow">03 · YOLOV8 CLASSIFIER</div>
        <div className="section-head">
          <h2>Verify with a new site photo</h2>
        </div>
        <PhotoVerify projectId={project.id} reportedProgress={project.reportedProgress} />
      </div>

      <div className="section">
        <div className="eyebrow">04 · WEIGHTED COMPOSITE</div>
        <div className="section-head">
          <h2>Risk factor breakdown</h2>
          {risk?.formula && <span className="hint">{risk.formula}</span>}
        </div>
        {risk ? (
          <>
            {risk.explanation && (
              <p className="muted" style={{ fontSize: 13.5, margin: "0 0 14px", maxWidth: "72ch" }}>
                {risk.explanation}
              </p>
            )}
            <RiskFactors factors={risk.factors} />
          </>
        ) : (
          <div className="loading-note">Loading risk breakdown…</div>
        )}
      </div>

      <div className="section">
        <div className="eyebrow">05 · ASSET TELEMETRY</div>
        <div className="section-head">
          <h2>Structural health signal</h2>
        </div>
        <SensorTelemetry health={health} />
      </div>

      {weather && (
        <div className="section">
          <div className="eyebrow">SUPPORTING SIGNAL</div>
          <div className="section-head">
            <h2>Rainfall exposure</h2>
          </div>
          <WeatherStrip weather={weather} />
        </div>
      )}
          <div className="section">
        <div className="eyebrow">06 · ESCALATION</div>
        <div className="section-head">
          <h2>Request clarification from the agency</h2>
        </div>
        <EscalationPanel
          projectId={project.id}
          flagged={Math.abs(project.reportedProgress - project.verifiedProgress) >= 12 || project.mismatchRedFlag}
        />
      </div>
    </>
  );
}
