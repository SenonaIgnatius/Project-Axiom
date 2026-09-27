import { useState } from "react";
import { sourcePageUrl } from "../lib/api.js";

const FLAG_THRESHOLD = 12.0;

export default function DiscrepancyPanel({ project }) {
  const [showSource, setShowSource] = useState(false);
  const reported = project.reportedProgress;
  const verified = project.verifiedProgress;
  const gap = Math.abs(reported - verified);
  // Computed from the two numbers on screen, so the copy can never contradict them.
  const flagged = gap >= FLAG_THRESHOLD || project.mismatchRedFlag;
  const fromPhoto = project.verifiedBasis === "photo";

  return (
    <div className="card compare">
      <div className="compare-col reported">
        <div className="kicker">Reported by implementing agency</div>
        <div className="compare-figure">{reported}%</div>
        <div className="bar-track">
          <div className="bar-fill reported" style={{ width: `${reported}%` }} />
        </div>
        {project.sourcePage && (
          <div className="provenance-line">
            <span className="mono">
              PAIMANA Dec 2025 · code {project.projectCode} · PDF page {project.sourcePage}
            </span>
            <button className="link-btn" onClick={() => setShowSource((s) => !s)}>
              {showSource ? "Hide source row" : "View source row →"}
            </button>
          </div>
        )}
      </div>

      <div className={`compare-col verified ${flagged ? "gap-flagged" : ""}`}>
        <div className="kicker">Verified progress</div>
        <div className="compare-figure">{verified}%</div>
        <div className="bar-track">
          <div className={`bar-fill ${flagged ? "flagged" : "verified"}`} style={{ width: `${verified}%` }} />
        </div>
        <div className="provenance-line">
          {fromPhoto ? (
            <span className="mono">From an uploaded site photo (YOLOv8)</span>
          ) : (
            <span className="tag-illustrative">Illustrative — live verification pending</span>
          )}
        </div>
      </div>

      <div style={{ gridColumn: "1 / -1" }}>
        <div className={`gap-note ${flagged ? "flag" : "ok"}`}>
          {flagged
            ? `${gap.toFixed(1)} point gap between the reported and verified figures — flagged for review.`
            : `${gap.toFixed(1)} point gap — below the ${FLAG_THRESHOLD}-point review threshold.`}
        </div>

        {project.reportNote && (
          <div className="data-quality-note">
            <strong>Data-quality flag in the source report.</strong> {project.reportNote}
          </div>
        )}

        {showSource && (
          <div className="source-page">
            <div className="source-page-head">
              <div>{project.officialName}</div>
              {project.agency && <div className="muted">{project.agency}</div>}
            </div>
            <img
              src={sourcePageUrl(project.id)}
              alt={`PAIMANA flash report, PDF page ${project.sourcePage}, with this project's row highlighted`}
            />
            <a className="link-btn" href={`${sourcePageUrl(project.id)}?full=1`} target="_blank" rel="noreferrer">
              Open the full page ↗
            </a>
            <div className="muted source-page-foot">
              MoSPI PAIMANA Flash Report, December 2025 — PDF page {project.sourcePage}
              {project.alsoOnPages?.length ? ` (also listed on page ${project.alsoOnPages.join(", ")})` : ""}.
              The page number printed in the report's footer can differ by one. Excerpt shows the page header, column headings and this project's row (highlighted).
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
